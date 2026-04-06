import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

export interface SearchResult {
  context: string;
  document: string;
  title: string;
  tags: string[];
  matches: string[];
}

export async function searchContexts(
  dataDir: string,
  query: string,
  contextFilter?: string,
  tagFilter?: string[]
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  let contexts: string[];
  if (contextFilter) {
    contexts = [contextFilter];
  } else {
    const entries = await fs.readdir(dataDir, { withFileTypes: true });
    contexts = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  for (const ctx of contexts) {
    const ctxPath = path.join(dataDir, ctx);
    let files: string[];
    try {
      files = (await fs.readdir(ctxPath)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of files) {
      const raw = await fs.readFile(path.join(ctxPath, file), "utf-8");
      const parsed = matter(raw);
      const meta = parsed.data as { title?: string; tags?: string[] };
      const docTags = meta.tags || [];

      if (tagFilter && tagFilter.length > 0) {
        const docTagsLower = docTags.map((t) => t.toLowerCase());
        if (!tagFilter.some((t) => docTagsLower.includes(t.toLowerCase()))) {
          continue;
        }
      }

      const fullText = [meta.title || "", docTags.join(" "), parsed.content].join("\n");
      const lines = fullText.split("\n");
      const matchingLines = lines.filter((line) =>
        line.toLowerCase().includes(queryLower)
      );

      if (matchingLines.length > 0) {
        results.push({
          context: ctx,
          document: file.replace(/\.md$/, ""),
          title: meta.title || file.replace(/\.md$/, ""),
          tags: docTags,
          matches: matchingLines.slice(0, 5),
        });
      }
    }
  }

  return results;
}
