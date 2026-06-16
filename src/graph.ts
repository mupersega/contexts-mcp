// The context graph: links between items (explicit + wiki) and semantic
// similarity (TF-IDF). Pure functions (parseLinks, tokenize, tfidfRelated) are
// unit-testable without disk; buildGraph/getGraph read the corpus via storage.
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

// --- TF-IDF similarity (pure) ---

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

// For each doc, the top-K most similar other docs (cosine >= threshold).
export function tfidfRelated(
  docs: { id: string; text: string }[],
  topK = 4,
  threshold = 0.08
): Map<string, { id: string; score: number }[]> {
  const N = docs.length;
  const df = new Map<string, number>();
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
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
  const result = new Map<string, { id: string; score: number }[]>();
  for (let i = 0; i < vecs.length; i++) {
    const sims: { id: string; score: number }[] = [];
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

// --- Graph build (reads the corpus via storage) ---

interface NodeContent {
  context: string;
  item: string;
  title: string;
  size: number;
  content: string;
}

export async function buildGraph(): Promise<Graph> {
  const corpus = await storage.getAllItemsContent();

  // One node per item, keyed by context/baseName. Prefer markdown content when a
  // base name exists in multiple kinds (md is the linkable/readable variant).
  const nodeMap = new Map<string, NodeContent>();
  for (const it of corpus) {
    const id = `${it.context}/${it.name}`;
    const existing = nodeMap.get(id);
    if (!existing || it.extension === "md") {
      nodeMap.set(id, {
        context: it.context,
        item: it.name,
        title: it.title || it.name,
        size: it.content.length,
        content: it.content,
      });
    }
  }

  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();
  for (const [id, node] of nodeMap) {
    for (const ref of parseLinks(node.content, node.context)) {
      if (ref.item === null) continue; // context-level links: skipped in v1
      const targetId = `${ref.context}/${ref.item}`;
      if (targetId === id || !nodeMap.has(targetId)) continue;
      const ekey = `${id}->${targetId}`;
      if (edgeSeen.has(ekey)) continue;
      edgeSeen.add(ekey);
      edges.push({ source: id, target: targetId, kind: "link", weight: 1 });
    }
  }

  // Semantic "related" edges (undirected), excluding pairs already linked.
  const explicit = new Set<string>();
  for (const e of edges) {
    explicit.add(undirectedKey(e.source, e.target));
  }
  const related = tfidfRelated(
    [...nodeMap.entries()].map(([id, n]) => ({ id, text: `${n.title} ${n.title} ${n.content}` })),
    4,
    0.08
  );
  const relSeen = new Set<string>();
  for (const [id, sims] of related) {
    for (const s of sims) {
      const key = undirectedKey(id, s.id);
      if (explicit.has(key) || relSeen.has(key)) continue;
      relSeen.add(key);
      edges.push({ source: id, target: s.id, kind: "related", weight: s.score });
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const nodes: GraphNode[] = [...nodeMap.entries()].map(([id, n]) => ({
    id,
    context: n.context,
    item: n.item,
    title: n.title,
    size: n.size,
    degree: degree.get(id) || 0,
  }));
  return { nodes, edges };
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// --- Cached accessors ---

let _cache: { graph: Graph; at: number } | null = null;
const CACHE_TTL_MS = 5000;

export async function getGraph(): Promise<Graph> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.graph;
  const graph = await buildGraph();
  _cache = { graph, at: now };
  return graph;
}

export function invalidateGraphCache(): void {
  _cache = null;
}

export async function getItemConnections(context: string, item: string): Promise<ItemConnections> {
  const graph = await getGraph();
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
