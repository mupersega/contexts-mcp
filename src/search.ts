import { ContextMetadata, ItemExtension, CONTEXT_NAME_REGEX } from "./types.js";
import { getContextMetadata, getCorpus, CorpusDoc } from "./storage.js";

export interface SearchResult {
  context: string;
  item: string;
  extension: ItemExtension;
  title: string;
  tags: string[];
  // Matching lines, trimmed to a window around the first hit so one long
  // paragraph cannot dominate the payload.
  matches: string[];
  // Total number of matching lines in the item (matches[] is capped).
  matchCount: number;
  // Relevance: title/tag hits weigh more than body hits.
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  // Number of matching items before `limit` was applied.
  total: number;
}

export interface SearchOptions {
  contextFilter?: string;
  tagFilter?: string[];
  contextStatus?: string;
  contextTagFilter?: string[];
  // Default behavior is to skip contexts whose metadata.status === 'archived'.
  // Callers opt in to include them.
  includeArchived?: boolean;
  // Max items returned (after ranking). Default 20.
  limit?: number;
  // Max matching lines returned per item. Default 5.
  linesPerItem?: number;
}

export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_LINES_PER_ITEM = 5;
// Each returned line is cut to this many characters around the first hit.
const LINE_WINDOW = 200;

interface ContextMetaFilter {
  includeArchived: boolean;
  contextStatusLower?: string;
  contextTagsLower?: string[];
}

function passesContextMeta(meta: ContextMetadata | null, f: ContextMetaFilter): boolean {
  if (!f.includeArchived && meta && meta.status === "archived") return false;
  if (f.contextStatusLower !== undefined) {
    if (!meta || !meta.status || meta.status.toLowerCase() !== f.contextStatusLower) {
      return false;
    }
  }
  if (f.contextTagsLower) {
    if (!meta) return false;
    const metaTagsLower = meta.tags.map((t) => t.toLowerCase());
    if (!f.contextTagsLower.some((t) => metaTagsLower.includes(t))) return false;
  }
  return true;
}

// Cut a line to a window around the first occurrence of the query so a hit in
// a 2,000-character paragraph costs ~200 characters, not 2,000.
export function windowLine(line: string, queryLower: string, width = LINE_WINDOW): string {
  const trimmed = line.trim();
  if (trimmed.length <= width) return trimmed;
  const at = trimmed.toLowerCase().indexOf(queryLower);
  const half = Math.floor(width / 2);
  let start = Math.max(0, at - half);
  const end = Math.min(trimmed.length, start + width);
  if (end - start < width) start = Math.max(0, end - width);
  return (start > 0 ? "…" : "") + trimmed.slice(start, end) + (end < trimmed.length ? "…" : "");
}

function scoreDoc(doc: CorpusDoc, queryLower: string, bodyHits: number): number {
  let score = bodyHits;
  if (doc.title.toLowerCase().includes(queryLower)) score += 10;
  if (doc.tags.some((t) => t.toLowerCase() === queryLower)) score += 8;
  else if (doc.tags.some((t) => t.toLowerCase().includes(queryLower))) score += 4;
  return score;
}

// `dataDir` is kept for signature compatibility; the corpus comes from the
// storage cache (one stat per item per call, reads only for changed files).
export async function searchContexts(
  _dataDir: string,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResponse> {
  const queryLower = query.toLowerCase();
  if (queryLower.length === 0) return { results: [], total: 0 };
  const includeArchived = opts.includeArchived === true;
  const contextStatusLower = opts.contextStatus?.toLowerCase();
  const contextTagsLower = opts.contextTagFilter?.map((t) => t.toLowerCase());
  const tagFilterLower = opts.tagFilter?.map((t) => t.toLowerCase());
  const metaFilter: ContextMetaFilter = { includeArchived, contextStatusLower, contextTagsLower };
  const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_SEARCH_LIMIT;
  const linesPerItem = opts.linesPerItem && opts.linesPerItem > 0 ? opts.linesPerItem : DEFAULT_LINES_PER_ITEM;
  const needsMeta =
    contextStatusLower !== undefined || (contextTagsLower !== undefined && contextTagsLower.length > 0);
  const contextFilter = opts.contextFilter && CONTEXT_NAME_REGEX.test(opts.contextFilter) ? opts.contextFilter : undefined;
  if (opts.contextFilter && !contextFilter) return { results: [], total: 0 };

  const corpus = await getCorpus();

  // Which contexts pass the metadata filters (archived is already on each doc).
  const contexts = new Set<string>();
  for (const d of corpus) {
    if (contextFilter && d.context !== contextFilter) continue;
    if (!includeArchived && d.archived) continue;
    contexts.add(d.context);
  }
  const allowed = new Set<string>();
  await Promise.all(
    [...contexts].map(async (ctx) => {
      if (!needsMeta) {
        allowed.add(ctx);
        return;
      }
      let meta: ContextMetadata | null = null;
      try {
        meta = await getContextMetadata(ctx);
      } catch {
        meta = null;
      }
      if (passesContextMeta(meta, metaFilter)) allowed.add(ctx);
    })
  );

  const all: SearchResult[] = [];
  for (const d of corpus) {
    if (!allowed.has(d.context)) continue;
    if (tagFilterLower && tagFilterLower.length > 0) {
      const docTagsLower = d.tags.map((t) => t.toLowerCase());
      if (!tagFilterLower.some((t) => docTagsLower.includes(t))) continue;
    }
    const matching: string[] = [];
    let matchCount = 0;
    // Cheap pre-check before the per-line scan.
    if (d.content.toLowerCase().includes(queryLower)) {
      for (const line of d.content.split("\n")) {
        if (!line.toLowerCase().includes(queryLower)) continue;
        matchCount++;
        if (matching.length < linesPerItem) matching.push(windowLine(line, queryLower));
      }
    }
    const score = scoreDoc(d, queryLower, matchCount);
    if (score === 0) continue;
    all.push({
      context: d.context,
      item: d.name,
      extension: d.extension,
      title: d.title,
      tags: d.tags,
      matches: matching,
      matchCount,
      score,
    });
  }

  all.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.context !== b.context) return a.context < b.context ? -1 : 1;
    return a.item < b.item ? -1 : a.item > b.item ? 1 : 0;
  });

  return { results: all.slice(0, limit), total: all.length };
}
