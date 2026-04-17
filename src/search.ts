import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { ContextMetadata, ItemExtension } from "./types.js";
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

export async function searchContexts(
  dataDir: string,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  let contexts: string[];
  if (opts.contextFilter) {
    contexts = [opts.contextFilter];
  } else {
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    contexts = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  const filterByStatus = opts.contextStatus !== undefined;
  const filterByContextTags = opts.contextTagFilter && opts.contextTagFilter.length > 0;
  const includeArchived = opts.includeArchived === true;
  const contextStatusLower = opts.contextStatus?.toLowerCase();
  const contextTagsLower = opts.contextTagFilter?.map((t) => t.toLowerCase());

  const needsMeta = filterByStatus || filterByContextTags || !includeArchived;

  for (const ctx of contexts) {
    const ctxPath = path.join(dataDir, ctx);

    if (needsMeta) {
      let meta: ContextMetadata | null = null;
      try {
        meta = await getContextMetadata(ctx);
      } catch {
        meta = null;
      }
      if (!includeArchived && meta && meta.status === "archived") continue;
      if (filterByStatus) {
        if (!meta || !meta.status || meta.status.toLowerCase() !== contextStatusLower) {
          continue;
        }
      }
      if (filterByContextTags && contextTagsLower) {
        if (!meta) continue;
        const metaTagsLower = meta.tags.map((t) => t.toLowerCase());
        if (!contextTagsLower.some((t) => metaTagsLower.includes(t))) {
          continue;
        }
      }
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

      const filePath = path.join(ctxPath, entry);
      const raw = await fs.readFile(filePath, "utf-8");

      let itemTitle: string;
      let itemTags: string[];
      let fullText: string;

      if (parsed.ext === "md") {
        const fm = matter(raw);
        const meta = fm.data as { title?: string; tags?: string[] };
        itemTags = Array.isArray(meta.tags) ? meta.tags : [];

        if (opts.tagFilter && opts.tagFilter.length > 0) {
          const docTagsLower = itemTags.map((t) => t.toLowerCase());
          if (!opts.tagFilter.some((t) => docTagsLower.includes(t.toLowerCase()))) {
            continue;
          }
        }

        itemTitle = meta.title || parsed.base;
        fullText = [itemTitle, itemTags.join(" "), fm.content].join("\n");
      } else {
        if (opts.tagFilter && opts.tagFilter.length > 0) continue;
        itemTitle = parsed.base;
        itemTags = [];
        fullText = raw;
      }

      const lines = fullText.split("\n");
      const matchingLines = lines.filter((line) =>
        line.toLowerCase().includes(queryLower)
      );

      if (matchingLines.length > 0) {
        results.push({
          context: ctx,
          item: parsed.base,
          extension: parsed.ext,
          title: itemTitle,
          tags: itemTags,
          matches: matchingLines.slice(0, 5),
        });
      }
    }
  }

  results.sort((a, b) => {
    if (a.context !== b.context) return a.context < b.context ? -1 : 1;
    return a.item < b.item ? -1 : a.item > b.item ? 1 : 0;
  });

  return results;
}
