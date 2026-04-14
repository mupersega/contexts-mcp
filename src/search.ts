import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import yaml from "js-yaml";
import {
  CONTEXT_META_FILENAME,
  ContextMetadata,
  ITEM_EXTENSIONS,
  ITEM_NAME_REGEX,
  ItemExtension,
} from "./types.js";

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
}

function splitItemFilename(filename: string): { base: string; ext: ItemExtension } | null {
  if (filename === CONTEXT_META_FILENAME) return null;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const base = filename.slice(0, dotIdx);
  const ext = filename.slice(dotIdx + 1);
  if (!(ITEM_EXTENSIONS as readonly string[]).includes(ext)) return null;
  if (!ITEM_NAME_REGEX.test(base)) return null;
  return { base, ext: ext as ItemExtension };
}

async function readContextMetadata(
  dataDir: string,
  ctx: string
): Promise<ContextMetadata | null> {
  const metaPath = path.join(dataDir, ctx, CONTEXT_META_FILENAME);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const r = parsed as Record<string, unknown>;
    return {
      title: typeof r.title === "string" ? r.title : undefined,
      description: typeof r.description === "string" ? r.description : undefined,
      status: typeof r.status === "string" ? r.status : undefined,
      tags: Array.isArray(r.tags)
        ? r.tags.filter((t): t is string => typeof t === "string")
        : [],
      links: Array.isArray(r.links)
        ? (r.links as unknown[]).flatMap((l) =>
            l &&
            typeof l === "object" &&
            typeof (l as { label?: unknown }).label === "string" &&
            typeof (l as { url?: unknown }).url === "string"
              ? [{ label: (l as { label: string }).label, url: (l as { url: string }).url }]
              : []
          )
        : [],
      created: typeof r.created === "string" ? r.created : "",
      updated: typeof r.updated === "string" ? r.updated : "",
    };
  } catch {
    return null;
  }
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
  const contextStatusLower = opts.contextStatus?.toLowerCase();
  const contextTagsLower = opts.contextTagFilter?.map((t) => t.toLowerCase());

  for (const ctx of contexts) {
    const ctxPath = path.join(dataDir, ctx);

    // Context-level metadata filters.
    if (filterByStatus || filterByContextTags) {
      const meta = await readContextMetadata(dataDir, ctx);
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
        // Preserve historical behaviour: title + tags + body are all searchable.
        fullText = [itemTitle, itemTags.join(" "), fm.content].join("\n");
      } else {
        // Non-md items have no tags — they can't match a per-item tag filter.
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
