// The context graph: links between items (explicit + wiki) and semantic
// similarity (TF-IDF, or optional Ollama embeddings). Pure functions
// (parseLinks, tokenize, tfidfRelated, prunedRelated) are unit-testable without
// disk; buildGraph/getGraph read the corpus via storage.
//
// Two build modes:
//   - "auto" (every automatic rebuild): incremental. Only items whose
//     size/mtime changed are re-read and re-tokenized (via the persisted
//     per-document index), and only those items are re-scored against the
//     corpus; their neighbour lists, and the lists of the items they touch, are
//     patched in place. Cost is proportional to what changed, not to the
//     corpus. When a large share of the corpus changed at once (or nothing is
//     indexed yet) it falls back to one pruned full pass, which is itself
//     near-linear (top terms per doc, inverted index, common terms skipped).
//   - "full" (manual trigger only): drops every cache, re-reads and
//     re-tokenizes everything, and runs the exact all-pairs cosine over
//     untruncated vectors. Best link quality, O(n^2) time — minutes on a large
//     corpus, which is fine when a human asked for it.
import * as storage from "./storage.js";
import { CONTEXT_NAME_REGEX, ITEM_NAME_REGEX } from "./types.js";

export interface LinkRef {
  context: string;
  item: string | null; // null = a context-level link (no specific item)
}

export interface GraphNode {
  id: string; // "context/itemBaseName"
  context: string;
  item: string;
  title: string;
  size: number; // content length, for node sizing in the viz
  degree: number; // number of incident edges
}

export interface GraphEdge {
  source: string; // node id
  target: string; // node id
  kind: "link" | "related";
  weight: number; // 1 for an explicit link; cosine score for "related"
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ConnRef {
  id: string;
  context: string;
  item: string;
  title: string;
}
export interface ItemConnections {
  outbound: ConnRef[];
  backlinks: ConnRef[];
  related: (ConnRef & { score: number })[];
}

export type BuildMode = "auto" | "full";

// --- Link parsing (pure) ---

// Internal markdown links: ...](/ctx/<context>) or ...](/ctx/<context>/<item>)
const MD_LINK_RE = /\]\(\s*\/ctx\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9][a-zA-Z0-9_-]*))?(?:[^)]*)?\)/g;
// Wiki links: [[item]] (same context) or [[context/item]], optional |alias.
const WIKI_LINK_RE = /\[\[\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/g;

export function parseLinks(content: string, currentContext: string): LinkRef[] {
  const out: LinkRef[] = [];
  const seen = new Set<string>();
  const push = (context: string, item: string | null) => {
    if (!CONTEXT_NAME_REGEX.test(context)) return;
    if (item !== null && !ITEM_NAME_REGEX.test(item)) return;
    const key = `${context}/${item ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ context, item });
  };

  let m: RegExpExecArray | null;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(content))) push(m[1], m[2] ?? null);

  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(content))) {
    const target = m[1].trim();
    if (target.includes("/")) {
      const idx = target.indexOf("/");
      push(target.slice(0, idx), target.slice(idx + 1));
    } else {
      push(currentContext, target);
    }
  }
  return out;
}

// --- Tokenizing + TF-IDF (pure) ---

const STOPWORDS = new Set(
  ("the a an and or but if then else for to of in on at by with as is are was were be been being this " +
    "that these those it its from into over under not no nor so than too very can will just don dont " +
    "you your yours we our ours they them their he she his her him who whom which what when where why how " +
    "all any both each few more most other some such only own same out up down off again here there once " +
    "do does did doing have has had having i me my mine us about above below between through during before after")
    .split(/\s+/)
);

export function tokenize(text: string): string[] {
  const m = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g);
  if (!m) return [];
  return m.filter((t) => !STOPWORDS.has(t));
}

// Term frequencies of a document. `keep` caps the number of distinct terms
// (highest counts win) so an index entry stays small and similarity stays
// bounded per doc; 0 keeps everything (used by the exact "full" mode).
export function termFrequencies(text: string, keep = 0): [string, number][] {
  const tf = new Map<string, number>();
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + 1);
  const entries = [...tf.entries()];
  if (keep > 0 && entries.length > keep) {
    entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    entries.length = keep;
  }
  return entries;
}

export interface Related {
  id: string;
  score: number;
}

interface DocVec {
  id: string;
  vec: Map<string, number>;
  norm: number;
}

function cosine(a: DocVec, b: DocVec): number {
  const [small, large] = a.vec.size <= b.vec.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small.vec) {
    const wl = large.vec.get(t);
    if (wl) dot += w * wl;
  }
  return dot / (a.norm * b.norm);
}

// Exact all-pairs cosine over full TF-IDF vectors: O(n^2 * terms). The "full"
// mode's similarity, and the reference the pruned variant is judged against.
export function tfidfRelated(
  docs: { id: string; text: string }[],
  topK = 4,
  threshold = 0.08
): Map<string, Related[]> {
  const N = docs.length;
  const df = new Map<string, number>();
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>(termFrequencies(d.text));
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { id: d.id, tf };
  });
  const vecs: DocVec[] = tfs.map(({ id, tf }) => {
    const vec = new Map<string, number>();
    let sumSq = 0;
    for (const [t, f] of tf) {
      const idf = Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
      const w = (1 + Math.log(f)) * idf;
      vec.set(t, w);
      sumSq += w * w;
    }
    return { id, vec, norm: Math.sqrt(sumSq) || 1 };
  });
  const result = new Map<string, Related[]>();
  for (let i = 0; i < vecs.length; i++) {
    const sims: Related[] = [];
    for (let j = 0; j < vecs.length; j++) {
      if (i === j) continue;
      const score = cosine(vecs[i], vecs[j]);
      if (score >= threshold) sims.push({ id: vecs[j].id, score });
    }
    sims.sort((a, b) => b.score - a.score);
    result.set(vecs[i].id, sims.slice(0, topK));
  }
  return result;
}

// --- Pruned similarity state (the automatic path) ---
//
// Three cuts keep scoring near-linear:
//   1. each doc contributes only its top `keepTerms` terms by TF-IDF weight;
//   2. terms present in more than `maxDfRatio` of documents (or more than
//      `maxPosting` docs) are dropped — they carry little IDF weight and are
//      exactly the terms that make the pair count explode;
//   3. dot products are accumulated through an inverted index, so a pair is
//      touched only once per shared term and never if it shares none.
// Scores are cosines over the truncated vectors: a slight overestimate versus
// the exact pass, which is why the threshold is a little higher. The point is
// culling: keeping the strongest few links per item, cheaply.
//
// The state is incremental: adding, removing or re-scoring one document costs
// its own postings, not the corpus. Document frequencies drift as documents
// change (an unchanged doc keeps the weights it was given when it was last
// scored); a periodic full pruned pass (see FULL_PASS_RATIO) corrects that.
export const PRUNED_DEFAULTS = { keepTerms: 100, maxDfRatio: 0.2, maxPosting: 400, topK: 4, threshold: 0.12 };
type PrunedOptions = typeof PRUNED_DEFAULTS;

interface SimVec {
  terms: string[];
  weights: number[]; // normalized
}

interface SimState {
  opts: PrunedOptions;
  df: Map<string, number>; // term -> number of docs whose tf list has it
  tfs: Map<string, [string, number][]>; // id -> tf list (what df is counted over)
  vecs: Map<string, SimVec>;
  postings: Map<string, Map<string, number>>; // term -> id -> weight
}

function simCreate(opts: PrunedOptions): SimState {
  return { opts, df: new Map(), tfs: new Map(), vecs: new Map(), postings: new Map() };
}

function simDfCap(s: SimState): number {
  return Math.min(s.opts.maxPosting, Math.max(10, Math.floor(s.tfs.size * s.opts.maxDfRatio)));
}

function simMakeVec(s: SimState, tf: [string, number][]): SimVec {
  const N = s.tfs.size;
  const dfCap = simDfCap(s);
  const pairs: [string, number][] = [];
  for (const [t, f] of tf) {
    const dft = s.df.get(t) || 0;
    if (dft > dfCap) continue;
    const idf = Math.log((N + 1) / (dft + 1)) + 1;
    pairs.push([t, (1 + Math.log(f)) * idf]);
  }
  pairs.sort((a, b) => b[1] - a[1]);
  if (pairs.length > s.opts.keepTerms) pairs.length = s.opts.keepTerms;
  let sumSq = 0;
  for (const [, w] of pairs) sumSq += w * w;
  const norm = Math.sqrt(sumSq) || 1;
  return { terms: pairs.map((p) => p[0]), weights: pairs.map((p) => p[1] / norm) };
}

// Register a doc's tf list (df bookkeeping only; call simVectorize after).
function simAddTf(s: SimState, id: string, tf: [string, number][]): void {
  const old = s.tfs.get(id);
  if (old) for (const [t] of old) s.df.set(t, (s.df.get(t) || 1) - 1);
  s.tfs.set(id, tf);
  for (const [t] of tf) s.df.set(t, (s.df.get(t) || 0) + 1);
}

function simUnpost(s: SimState, id: string): void {
  const v = s.vecs.get(id);
  if (!v) return;
  for (const t of v.terms) {
    const list = s.postings.get(t);
    if (!list) continue;
    list.delete(id);
    if (list.size === 0) s.postings.delete(t);
  }
  s.vecs.delete(id);
}

// (Re)compute a doc's vector against the current df and post it.
function simVectorize(s: SimState, id: string): void {
  simUnpost(s, id);
  const tf = s.tfs.get(id);
  if (!tf) return;
  const v = simMakeVec(s, tf);
  s.vecs.set(id, v);
  v.terms.forEach((t, k) => {
    let list = s.postings.get(t);
    if (!list) s.postings.set(t, (list = new Map()));
    list.set(id, v.weights[k]);
  });
}

function simRemove(s: SimState, id: string): void {
  simUnpost(s, id);
  const old = s.tfs.get(id);
  if (old) {
    for (const [t] of old) {
      const n = (s.df.get(t) || 1) - 1;
      if (n <= 0) s.df.delete(t);
      else s.df.set(t, n);
    }
    s.tfs.delete(id);
  }
}

// Dot products of one doc against every doc it shares a kept term with.
function simScore(s: SimState, id: string): Map<string, number> {
  const acc = new Map<string, number>();
  const v = s.vecs.get(id);
  if (!v) return acc;
  for (let k = 0; k < v.terms.length; k++) {
    const list = s.postings.get(v.terms[k]);
    if (!list) continue;
    const wi = v.weights[k];
    for (const [j, wj] of list) {
      if (j === id) continue;
      acc.set(j, (acc.get(j) || 0) + wi * wj);
    }
  }
  return acc;
}

function topRelated(scores: Map<string, number>, topK: number, threshold: number): Related[] {
  const sims: Related[] = [];
  for (const [id, score] of scores) if (score >= threshold) sims.push({ id, score });
  sims.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return sims.slice(0, topK);
}

// Pure, one-shot form of the pruned pass (tests, and the periodic full pass).
export function prunedRelated(
  docs: { id: string; tf: [string, number][] }[],
  opts: Partial<PrunedOptions> = {}
): Map<string, Related[]> {
  const s = simCreate({ ...PRUNED_DEFAULTS, ...opts });
  for (const d of docs) simAddTf(s, d.id, d.tf);
  for (const d of docs) simVectorize(s, d.id);
  const result = new Map<string, Related[]>();
  for (const d of docs) result.set(d.id, topRelated(simScore(s, d.id), s.opts.topK, s.opts.threshold));
  return result;
}

// --- Optional Ollama embeddings ---

// CONTEXTS_SIMILARITY=ollama uses local embeddings for better topical grouping;
// ANY failure (Ollama down, bad response, timeout) falls back to the
// always-available, zero-dependency TF-IDF path. Embeddings are cached per
// document in the index (keyed by model), so only changed items are
// re-embedded, and only changed items are re-scored.

const EMBED_TOPK = 4;
const EMBED_THRESHOLD = 0.55;

function ollamaEnabled(): boolean {
  return process.env.CONTEXTS_SIMILARITY === "ollama";
}

// Operator-configured local endpoint only (default localhost) — never a value
// an end user can supply, so no SSRF surface.
function ollamaUrl(): string {
  return (process.env.CONTEXTS_OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "");
}

function ollamaModel(): string {
  return process.env.CONTEXTS_OLLAMA_MODEL || "nomic-embed-text";
}

async function embedOllama(text: string, timeoutMs = 4000): Promise<number[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ollamaUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ollamaModel(), prompt: text.slice(0, 8000) }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama embeddings HTTP ${res.status}`);
    const j = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(j.embedding) || j.embedding.length === 0) {
      throw new Error("ollama: empty embedding");
    }
    return j.embedding;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeVec(v: number[]): Float64Array {
  let s = 0;
  for (const x of v) s += x * x;
  const norm = Math.sqrt(s) || 1;
  return Float64Array.from(v, (x) => x / norm);
}

function embedScore(id: string, vecs: Map<string, Float64Array>): Map<string, number> {
  const out = new Map<string, number>();
  const a = vecs.get(id);
  if (!a) return out;
  for (const [j, b] of vecs) {
    if (j === id) continue;
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let k = 0; k < n; k++) dot += a[k] * b[k];
    out.set(j, dot);
  }
  return out;
}

// --- Per-document index (persisted) ---

// What a rebuild needs from each item, keyed by file identity so unchanged
// items are never re-read or re-tokenized. Holds only what similarity and
// linking need — never the content itself. `neighbors` is the doc's current
// related list; keeping it here is what makes a rebuild incremental.
interface DocIndexEntry {
  size: number;
  mtimeMs: number;
  title: string;
  length: number;
  links: LinkRef[];
  tf: [string, number][]; // top INDEX_TERMS terms by count
  neighbors?: Related[];
  embedding?: { model: string; v: number[] };
}

const INDEX_TERMS = 150;
const INDEX_VERSION = 2;

// When more than this share of the corpus (or more than 50 items) changed in
// one rebuild, run a full pruned pass instead of patching: it is about as
// cheap at that point, and it resets the IDF drift that incremental scoring
// accumulates.
const FULL_PASS_RATIO = 0.1;

interface DiskIndex {
  version: number;
  similarity: string; // which backend the neighbour lists were scored by
  sinceFull?: number; // cumulative incremental touches since the last full pruned pass
  docs: Record<string, DocIndexEntry>;
}

let _index: Map<string, DocIndexEntry> | null = null;
let _indexSimilarity = "";
let _sim: SimState | null = null;

async function loadIndex(): Promise<Map<string, DocIndexEntry>> {
  if (_index) return _index;
  _index = new Map();
  _indexSimilarity = "";
  _sim = null;
  const disk = (await storage.readGraphIndexFile()) as DiskIndex | null;
  if (disk && typeof disk === "object" && disk.version === INDEX_VERSION && disk.docs && typeof disk.docs === "object") {
    _indexSimilarity = typeof disk.similarity === "string" ? disk.similarity : "";
    _sinceFull = typeof disk.sinceFull === "number" ? disk.sinceFull : 0;
    for (const [id, e] of Object.entries(disk.docs)) {
      if (e && typeof e.size === "number" && typeof e.mtimeMs === "number" && Array.isArray(e.tf) && Array.isArray(e.links)) {
        _index.set(id, e);
      }
    }
  }
  return _index;
}

// Rebuild the in-memory pruned state from the index's tf lists (cold start).
function simFromIndex(index: Map<string, DocIndexEntry>): SimState {
  const s = simCreate(PRUNED_DEFAULTS);
  for (const [id, e] of index) simAddTf(s, id, e.tf);
  for (const id of index.keys()) simVectorize(s, id);
  return s;
}

// Drop `id` from every neighbour list that holds it (deleted or about to be
// re-scored). O(n * topK).
function forgetNeighbor(index: Map<string, DocIndexEntry>, id: string): void {
  for (const e of index.values()) {
    if (!e.neighbors || e.neighbors.length === 0) continue;
    const i = e.neighbors.findIndex((n) => n.id === id);
    if (i !== -1) e.neighbors.splice(i, 1);
  }
}

// Install `id`'s fresh scores: its own top-K, and a place in the lists of the
// docs it scored against when it beats what they have.
function patchNeighbors(
  index: Map<string, DocIndexEntry>,
  id: string,
  scores: Map<string, number>,
  topK: number,
  threshold: number
): void {
  const mine = index.get(id);
  if (!mine) return;
  mine.neighbors = topRelated(scores, topK, threshold);
  for (const [j, score] of scores) {
    if (score < threshold) continue;
    const other = index.get(j);
    if (!other) continue;
    const list = other.neighbors ?? (other.neighbors = []);
    if (list.length >= topK && list[list.length - 1].score >= score) continue;
    list.push({ id, score });
    list.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    if (list.length > topK) list.length = topK;
  }
}

// --- Graph build ---

export interface BuildStats {
  mode: BuildMode;
  ms: number;
  nodes: number;
  edges: number;
  reindexed: number; // items re-tokenized this build
  rescored: number; // items whose neighbour lists were recomputed
  pass: "incremental" | "pruned-full" | "exact";
  similarity: "tfidf" | "ollama";
}

let _lastBuild: BuildStats | null = null;
// Debounce scales from AUTO build cost only — a manual multi-minute exact
// pass must not push the next ~100 ms incremental rebuild minutes away.
let _lastAutoMs = 0;
// Incremental patches only ever thin neighbour lists (an evicted 5th-best is
// never re-found), so track cumulative touches since the last corrective
// full pass; persisted in the index file so restarts don't reset the drift.
let _sinceFull = 0;
export function lastBuildStats(): BuildStats | null {
  return _lastBuild;
}

async function buildGraphWithArchived(
  mode: BuildMode
): Promise<{ graph: Graph; archived: Set<string>; stats: BuildStats }> {
  const t0 = Date.now();
  if (mode === "full") {
    storage.clearCorpusCache();
    _index = new Map();
    _indexSimilarity = "";
    _sim = null;
  }
  const corpus = await storage.getCorpus();
  const index = await loadIndex();

  // One node per item, keyed by context/baseName. Prefer markdown content when a
  // base name exists in multiple kinds (md is the linkable/readable variant).
  const chosen = new Map<string, storage.CorpusDoc>();
  for (const d of corpus) {
    const id = `${d.context}/${d.name}`;
    const existing = chosen.get(id);
    if (!existing || d.extension === "md") chosen.set(id, d);
  }
  const ids = [...chosen.keys()];

  // 1. Refresh index entries for changed items; note deletions.
  const changed: string[] = [];
  const deleted: string[] = [];
  const archived = new Set<string>();
  for (const id of ids) {
    const d = chosen.get(id)!;
    if (d.archived) archived.add(id);
    const hit = index.get(id);
    if (hit && hit.size === d.size && hit.mtimeMs === d.mtimeMs) continue;
    const text = `${d.title} ${d.title} ${d.content}`;
    index.set(id, {
      size: d.size,
      mtimeMs: d.mtimeMs,
      title: d.title || d.name,
      length: d.content.length,
      links: parseLinks(d.content, d.context),
      tf: termFrequencies(text, INDEX_TERMS),
      neighbors: hit?.neighbors,
    });
    changed.push(id);
  }
  for (const id of index.keys()) if (!chosen.has(id)) deleted.push(id);
  for (const id of deleted) {
    index.delete(id);
    forgetNeighbor(index, id);
    if (_sim) simRemove(_sim, id);
  }

  // 2. Similarity: decide backend and pass.
  const wantOllama = ollamaEnabled();
  const backend: BuildStats["similarity"] = wantOllama ? "ollama" : "tfidf";
  const backendKey = wantOllama ? `ollama:${ollamaModel()}` : "tfidf";
  // Unchanged docs must already carry neighbour lists scored by this backend;
  // changed (and new) docs are about to be scored, so they need not.
  const changedSet = new Set(changed);
  const hasNeighbors =
    _indexSimilarity === backendKey &&
    ids.every((id) => changedSet.has(id) || index.get(id)!.neighbors !== undefined);
  const touched = changed.length + deleted.length;
  let pass: BuildStats["pass"];
  if (mode === "full") pass = "exact";
  else if (!hasNeighbors || touched + _sinceFull > Math.max(50, Math.floor(ids.length * FULL_PASS_RATIO))) pass = "pruned-full";
  else pass = "incremental";
  let rescored = 0;

  let ollamaFailed = false;
  if (wantOllama) {
    try {
      const model = ollamaModel();
      const CONCURRENCY = 4;
      const todo = ids.filter((id) => index.get(id)!.embedding?.model !== model);
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const batch = todo.slice(i, i + CONCURRENCY);
        const embs = await Promise.all(
          batch.map((id) => {
            const d = chosen.get(id)!;
            return embedOllama(`${d.title} ${d.title} ${d.content}`);
          })
        );
        embs.forEach((v, k) => {
          index.get(batch[k])!.embedding = { model, v };
        });
      }
      const vecs = new Map<string, Float64Array>();
      for (const id of ids) vecs.set(id, normalizeVec(index.get(id)!.embedding!.v));
      if (pass === "incremental") {
        for (const id of changed) {
          forgetNeighbor(index, id);
          patchNeighbors(index, id, embedScore(id, vecs), EMBED_TOPK, EMBED_THRESHOLD);
        }
        rescored = changed.length;
      } else {
        for (const id of ids) index.get(id)!.neighbors = topRelated(embedScore(id, vecs), EMBED_TOPK, EMBED_THRESHOLD);
        rescored = ids.length;
      }
    } catch {
      ollamaFailed = true; // fall through to TF-IDF — resilience over the optional enhancement
    }
  }

  const effectiveBackend: BuildStats["similarity"] = wantOllama && !ollamaFailed ? "ollama" : "tfidf";
  const effectiveKey = effectiveBackend === "ollama" ? backendKey : "tfidf";
  if (effectiveBackend === "tfidf") {
    if (pass === "exact") {
      const related = tfidfRelated(
        ids.map((id) => {
          const d = chosen.get(id)!;
          return { id, text: `${d.title} ${d.title} ${d.content}` };
        }),
        4,
        0.08
      );
      for (const id of ids) index.get(id)!.neighbors = related.get(id) ?? [];
      _sim = simFromIndex(index);
      rescored = ids.length;
    } else {
      // Backend switched, ollama fell over, or too much changed: full pruned pass.
      if (pass === "incremental" && (_indexSimilarity !== "tfidf" || ollamaFailed)) pass = "pruned-full";
      if (!_sim || pass === "pruned-full") {
        _sim = simFromIndex(index);
      } else {
        for (const id of changed) simAddTf(_sim, id, index.get(id)!.tf);
        for (const id of changed) simVectorize(_sim, id);
      }
      if (pass === "incremental") {
        for (const id of changed) {
          forgetNeighbor(index, id);
          patchNeighbors(index, id, simScore(_sim, id), _sim.opts.topK, _sim.opts.threshold);
        }
        rescored = changed.length;
      } else {
        // Every doc is scored, so each just takes its own top-K; the symmetric
        // patching the incremental path does would be redundant work here.
        for (const id of ids) index.get(id)!.neighbors = topRelated(simScore(_sim, id), _sim.opts.topK, _sim.opts.threshold);
        rescored = ids.length;
      }
    }
  }
  _indexSimilarity = effectiveKey;

  // 3. Edges: explicit links, then related (undirected, deduped, never
  //    doubling an explicit link).
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const id of ids) {
    for (const ref of index.get(id)!.links) {
      if (ref.item === null) continue; // context-level links: skipped in v1
      const targetId = `${ref.context}/${ref.item}`;
      if (targetId === id || !chosen.has(targetId)) continue;
      const ekey = `${id}->${targetId}`;
      if (edgeSeen.has(ekey)) continue;
      edgeSeen.add(ekey);
      edges.push({ source: id, target: targetId, kind: "link", weight: 1 });
    }
  }
  const explicit = new Set<string>();
  for (const e of edges) explicit.add(undirectedKey(e.source, e.target));
  const relSeen = new Set<string>();
  for (const id of ids) {
    for (const s of index.get(id)!.neighbors ?? []) {
      if (!chosen.has(s.id)) continue;
      const key = undirectedKey(id, s.id);
      if (explicit.has(key) || relSeen.has(key)) continue;
      relSeen.add(key);
      edges.push({ source: id, target: s.id, kind: "related", weight: Math.round(s.score * 1000) / 1000 });
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const nodes: GraphNode[] = ids.map((id) => {
    const d = chosen.get(id)!;
    const e = index.get(id)!;
    return { id, context: d.context, item: d.name, title: e.title, size: e.length, degree: degree.get(id) || 0 };
  });

  // 4. Write-behind: the index only changes when something was re-scored.
  if (rescored > 0 || deleted.length > 0 || mode === "full") {
    const docs: Record<string, DocIndexEntry> = {};
    for (const [id, e] of index) docs[id] = e;
    if (pass === "incremental") _sinceFull += touched;
  else _sinceFull = 0;
  await storage.writeGraphIndexFile({ version: INDEX_VERSION, similarity: effectiveKey, sinceFull: _sinceFull, docs } satisfies DiskIndex);
  }

  const stats: BuildStats = {
    mode,
    ms: Date.now() - t0,
    nodes: nodes.length,
    edges: edges.length,
    reindexed: changed.length,
    rescored,
    pass,
    similarity: effectiveBackend,
  };
  _lastBuild = stats;
  if (stats.pass !== "exact") _lastAutoMs = stats.ms;
  return { graph: { nodes, edges }, archived, stats };
}

// Public one-shot build (no caching). Tests and diagnostics.
export async function buildGraph(includeArchived = false, mode: BuildMode = "auto"): Promise<Graph> {
  const { graph, archived } = await buildGraphWithArchived(mode);
  return includeArchived ? graph : deriveActive(graph, archived);
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function deriveActive(all: Graph, archivedNodeIds: Set<string>): Graph {
  if (archivedNodeIds.size === 0) return all;
  const edges = all.edges.filter((e) => !archivedNodeIds.has(e.source) && !archivedNodeIds.has(e.target));
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const nodes = all.nodes
    .filter((n) => !archivedNodeIds.has(n.id))
    .map((n) => ({ ...n, degree: degree.get(n.id) || 0 }));
  return { nodes, edges };
}

// --- Cached accessors ---

// Event-driven, not time-driven: the built graph is held until the corpus
// actually changes. storage.corpusSignature() is a cheap filesystem fingerprint
// that advances on every write; a read compares it with the signature the cache
// was built against.
//
// Stale-while-revalidate: when a graph already exists and the signature has
// moved, the read is served from the existing graph immediately and ONE
// rebuild is scheduled in the background (single-flight, debounced so a burst
// of writes yields one rebuild after the burst rather than a chain of them).
// Connections can be at most one rebuild behind. Only a cold process with no
// memory or disk cache builds synchronously.
//
// Two layers: process memory (fastest, per-process) and a persisted file in the
// data dir (survives restarts, shared between the MCP and web-UI processes).
// The file holds the full graph once plus the archived node ids; the active
// variant is derived on load, so the file is half the size it would be with
// both variants and the cold read stays small.
const _cache = new Map<string, Graph>();
let _cacheSig: string | null = null;
let _ignoreDisk = false;
let _inflight: Promise<void> | null = null;
let _timer: NodeJS.Timeout | null = null;
let _lastBuildEnd = 0;

// Minimum gap between the end of one automatic rebuild and the start of the
// next, scaled by how long the last build took.
const REBUILD_DEBOUNCE_MS = 1500;

const DISK_CACHE_VERSION = 3;

interface DiskGraphCache {
  version: number;
  signature: string;
  similarity: string;
  graph: Graph; // every node, including archived
  archived: string[]; // node ids whose context is archived
}

// The similarity backend is part of the cache identity: a graph built with
// TF-IDF must not be served after the operator switches to Ollama (or swaps
// embedding models), and vice versa.
function similarityMode(): string {
  return ollamaEnabled() ? `ollama:${ollamaModel()}` : "tfidf";
}

function isDiskCache(x: unknown): x is DiskGraphCache {
  if (!x || typeof x !== "object") return false;
  const c = x as DiskGraphCache;
  return (
    c.version === DISK_CACHE_VERSION &&
    typeof c.signature === "string" &&
    typeof c.similarity === "string" &&
    !!c.graph &&
    Array.isArray(c.graph.nodes) &&
    Array.isArray(c.graph.edges) &&
    Array.isArray(c.archived)
  );
}

function commit(all: Graph, archived: Set<string>, sig: string): void {
  _cache.set("all", all);
  _cache.set("active", deriveActive(all, archived));
  _cacheSig = sig;
}

// Build for the current corpus and commit to memory + disk. If the corpus
// moved again while building, schedule one more pass.
async function rebuild(mode: BuildMode): Promise<BuildStats> {
  const sig = await storage.corpusSignature();
  const { graph: all, archived, stats } = await buildGraphWithArchived(mode);
  commit(all, archived, sig);
  await storage.writeGraphCacheFile({
    version: DISK_CACHE_VERSION,
    signature: sig,
    similarity: similarityMode(),
    graph: all,
    archived: [...archived],
  } satisfies DiskGraphCache);
  return stats;
}

function kickRebuild(mode: BuildMode = "auto"): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = rebuild(mode)
    .then(async () => {
      const sig = await storage.corpusSignature();
      if (sig !== _cacheSig) scheduleRebuild();
    })
    .catch((err) => {
      console.error("[contexts-mcp] graph rebuild failed:", err instanceof Error ? err.message : err);
    })
    .finally(() => {
      _inflight = null;
      _lastBuildEnd = Date.now();
    });
  return _inflight;
}

function debounceMs(): number {
  return Math.max(REBUILD_DEBOUNCE_MS, _lastAutoMs * 2);
}

function scheduleRebuild(): void {
  if (_inflight || _timer) return;
  const wait = debounceMs() - (Date.now() - _lastBuildEnd);
  if (wait <= 0) {
    void kickRebuild();
    return;
  }
  _timer = setTimeout(() => {
    _timer = null;
    void kickRebuild();
  }, wait);
  _timer.unref();
}

export async function getGraph(includeArchived = false): Promise<Graph> {
  const key = includeArchived ? "all" : "active";
  const sig = await storage.corpusSignature();

  if (sig === _cacheSig) {
    const hit = _cache.get(key);
    if (hit) return hit;
  }

  // Signature moved (or first read in this process): prefer a fresh disk cache
  // written by this or the sibling process.
  if (!_ignoreDisk) {
    const disk = await storage.readGraphCacheFile();
    if (isDiskCache(disk) && disk.signature === sig && disk.similarity === similarityMode()) {
      commit(disk.graph, new Set(disk.archived), sig);
      return _cache.get(key)!;
    }
  }

  const stale = _cache.get(key);
  if (stale) {
    // Serve what we have; refresh off the read path.
    scheduleRebuild();
    return stale;
  }

  await kickRebuild();
  const built = _cache.get(key);
  if (built) return built;
  // kickRebuild logs and swallows failures for the background refresh path; a
  // cold start has nothing to serve, so surface a real error instead of
  // returning undefined into every caller's `.nodes`.
  throw new Error("graph build failed on cold start — see the server log for the cause");
}

// Resolve once no rebuild is pending or in flight and the cache matches the
// corpus. Used by tests and by callers that explicitly want a fresh graph.
export async function whenFresh(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    if (_inflight) await _inflight;
    const sig = await storage.corpusSignature();
    if (sig === _cacheSig && !_inflight && !_timer) return;
    await kickRebuild();
  }
}

// Manual rebuild. "full" drops every cache (corpus, index, graph) and runs the
// exact similarity pass; "auto" is the incremental path run synchronously.
// Returns the build's stats so a UI or tool can report what it cost.
export async function rebuildGraph(mode: BuildMode = "full"): Promise<BuildStats> {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  if (_inflight) await _inflight;
  if (mode === "full") {
    _cache.clear();
    _cacheSig = null;
  }
  let stats: BuildStats | null = null;
  _inflight = rebuild(mode)
    .then((s) => {
      stats = s;
    })
    .finally(() => {
      _inflight = null;
      _lastBuildEnd = Date.now();
    });
  await _inflight;
  return stats!;
}

// Force a rebuild on the next read regardless of corpus state. Normal operation
// doesn't need this (the signature handles freshness); the tests use it to drop
// cross-test state, and it's a safe manual reset. Also stops trusting the disk
// graph cache for the rest of this process — "force a rebuild" must mean an
// actual rebuild, not a reload of what was just invalidated. The per-document
// index is still reloaded from disk, which is what a cold process does.
export function invalidateGraphCache(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  _cache.clear();
  _cacheSig = null;
  _ignoreDisk = true;
  _index = null;
  _indexSimilarity = "";
  _sim = null;
  storage.clearCorpusCache();
}

// Set of all existing node ids ("context/item") — used to flag unresolved
// wiki-links. Includes archived items so links to them still resolve.
export async function getNodeIds(): Promise<Set<string>> {
  const g = await getGraph(true);
  return new Set(g.nodes.map((n) => n.id));
}

// Subgraph scoped to one context: its items plus their direct (1-hop) neighbours,
// and the edges among the kept nodes. Empty if the context has no items.
export async function getContextSubgraph(context: string, includeArchived = false): Promise<Graph> {
  const g = await getGraph(includeArchived);
  const inCtx = new Set(g.nodes.filter((n) => n.context === context).map((n) => n.id));
  if (inCtx.size === 0) return { nodes: [], edges: [] };
  const keep = new Set(inCtx);
  for (const e of g.edges) {
    if (inCtx.has(e.source)) keep.add(e.target);
    if (inCtx.has(e.target)) keep.add(e.source);
  }
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

// Connections include archived by default so viewing any item (even an archived
// one) shows its full link set; the /graph overview excludes archived by default.
export async function getItemConnections(
  context: string,
  item: string,
  includeArchived = true
): Promise<ItemConnections> {
  const graph = await getGraph(includeArchived);
  const id = `${context}/${item}`;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ref = (nid: string): ConnRef => {
    const n = byId.get(nid);
    const [ctx, ...rest] = nid.split("/");
    return { id: nid, context: n?.context ?? ctx, item: n?.item ?? rest.join("/"), title: n?.title ?? nid };
  };
  const outbound: ConnRef[] = [];
  const backlinks: ConnRef[] = [];
  const related: (ConnRef & { score: number })[] = [];
  for (const e of graph.edges) {
    if (e.kind === "link") {
      if (e.source === id) outbound.push(ref(e.target));
      else if (e.target === id) backlinks.push(ref(e.source));
    } else {
      if (e.source === id) related.push({ ...ref(e.target), score: e.weight });
      else if (e.target === id) related.push({ ...ref(e.source), score: e.weight });
    }
  }
  related.sort((a, b) => b.score - a.score);
  return { outbound, backlinks, related };
}
