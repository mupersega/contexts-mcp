import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { ContextMetadata, ItemExtension, CONTEXT_NAME_REGEX } from "./types.js";
import { getContextMetadata, splitItemFilename } from "./storage.js";

export interface SearchResult {
  context: string;
  item: string;
  extension: ItemExtension;
  title: string;
  tags: string[];
  matches: string[];
}

export interface SearchOptions {
  contextFilter?: string;
  tagFilter?: string[];
  contextStatus?: string;
  contextTagFilter?: string[];
  // Default behavior is to skip contexts whose metadata.status === 'archived'.
  // Callers opt in to include them.
  includeArchived?: boolean;
}

interface ContextMetaFilter {
  includeArchived: boolean;
  contextStatusLower?: string;
  contextTagsLower?: string[];
}

interface ItemContent {
  title: string;
  tags: string[];
  fullText: string;
}

async function selectContexts(dataDir: string, contextFilter?: string): Promise<string[]> {
  if (contextFilter) return CONTEXT_NAME_REGEX.test(contextFilter) ? [contextFilter] : [];
  const entries = await fs.readdir(dataDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
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

function extractItemContent(
  raw: string,
  parsed: { base: string; ext: ItemExtension },
  tagFilterLower?: string[]
): ItemContent | null {
  if (parsed.ext === "md") {
    const fm = matter(raw);
    const meta = fm.data as { title?: string; tags?: string[] };
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    if (tagFilterLower && tagFilterLower.length > 0) {
      const docTagsLower = tags.map((t) => t.toLowerCase());
      if (!tagFilterLower.some((t) => docTagsLower.includes(t))) return null;
    }
    const title = meta.title || parsed.base;
    return { title, tags, fullText: [title, tags.join(" "), fm.content].join("\n") };
  }
  if (tagFilterLower && tagFilterLower.length > 0) return null;
  return { title: parsed.base, tags: [], fullText: raw };
}

export async function searchContexts(
  dataDir: string,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult[]> {
  const queryLower = query.toLowerCase();
  const includeArchived = opts.includeArchived === true;
  const contextStatusLower = opts.contextStatus?.toLowerCase();
  const contextTagsLower = opts.contextTagFilter?.map((t) => t.toLowerCase());
  const tagFilterLower = opts.tagFilter?.map((t) => t.toLowerCase());
  const metaFilter: ContextMetaFilter = { includeArchived, contextStatusLower, contextTagsLower };
  const needsMeta =
    contextStatusLower !== undefined ||
    (contextTagsLower !== undefined && contextTagsLower.length > 0) ||
    !includeArchived;

  const contexts = await selectContexts(dataDir, opts.contextFilter);
  const results: SearchResult[] = [];

  for (const ctx of contexts) {
    const ctxPath = path.join(dataDir, ctx);

    if (needsMeta) {
      let meta: ContextMetadata | null = null;
      try {
        meta = await getContextMetadata(ctx);
      } catch {
        meta = null;
      }
      if (!passesContextMeta(meta, metaFilter)) continue;
    }

    let entries: string[];
    try {
      entries = await fs.readdir(ctxPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const parsed = splitItemFilename(entry);
      if (!parsed) continue;

      const raw = await fs.readFile(path.join(ctxPath, entry), "utf-8");
      const content = extractItemContent(raw, parsed, tagFilterLower);
      if (!content) continue;

      const matchingLines = content.fullText
        .split("\n")
        .filter((line) => line.toLowerCase().includes(queryLower));
      if (matchingLines.length === 0) continue;

      results.push({
        context: ctx,
        item: parsed.base,
        extension: parsed.ext,
        title: content.title,
        tags: content.tags,
        matches: matchingLines.slice(0, 5),
      });
    }
  }

  results.sort((a, b) => {
    if (a.context !== b.context) return a.context < b.context ? -1 : 1;
    return a.item < b.item ? -1 : a.item > b.item ? 1 : 0;
  });

  return results;
}
