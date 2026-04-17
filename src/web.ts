#!/usr/bin/env node
import express from "express";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { marked } from "marked";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";
import {
  CONTEXT_META_FILENAME,
  CONTEXT_NAME_REGEX,
  ContextLink,
  ITEM_EXTENSIONS,
  ITEM_NAME_REGEX,
  ItemExtension,
  ListContextsSort,
  ListContextsSortSchema,
} from "./types.js";
import {
  layout,
  contextListPage,
  contextCardFragment,
  contextMetaEditPage,
  itemListPage,
  itemCardFragment,
  itemViewPage,
  itemEditPage,
  searchPage,
} from "./templates.js";
import { loadConfig, MissingDataDirError, packageVersion } from "./config.js";

const app = express();
app.use(express.urlencoded({ extended: true }));

// --- Helpers ---

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || "").trim().split(/\s+/)[0];
      const langAttr = language ? ` data-lang="${escHtml(language)}"` : "";
      const classAttr = language ? ` class="language-${escHtml(language)}"` : "";
      return `<pre${langAttr}><code${classAttr}>${escHtml(text)}\n</code></pre>`;
    },
  },
});

function parseExtQuery(raw: unknown): ItemExtension | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if ((ITEM_EXTENSIONS as readonly string[]).includes(raw)) {
    return raw as ItemExtension;
  }
  return undefined;
}

function parseSort(raw: unknown): ListContextsSort {
  if (typeof raw === "string") {
    const parsed = ListContextsSortSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  }
  return "name";
}

function parseTruthy(raw: unknown): boolean {
  return raw === "1" || raw === "true" || raw === "on";
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// --- Context routes ---

app.get("/", async (req, res) => {
  const sort = parseSort(req.query.sort);
  const showArchived = parseTruthy(req.query.show_archived);
  const contexts = await storage.listContexts({
    includeMetadata: true,
    sort,
    includeArchived: showArchived,
  });
  // Second read only when needed: a separate call for archived count keeps
  // the primary grid query cheap when the toggle is off.
  let archivedCount = 0;
  if (!showArchived) {
    const all = await storage.listContexts({ includeMetadata: true, includeArchived: true });
    archivedCount = all.filter((c) => c.metadata?.status === "archived").length;
  }
  res.send(contextListPage(contexts, { sort, showArchived, archivedCount }));
});

app.post("/ctx", async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name || !CONTEXT_NAME_REGEX.test(name)) {
      res.status(400).send(`<div class="flash flash-error">Invalid name. Use letters, numbers, hyphens, underscores.</div>`);
      return;
    }
    await storage.createContext(name);
    res.send(contextCardFragment({ name, metadata: await storage.getContextMetadata(name) }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.delete("/ctx/:name", async (req, res) => {
  try {
    await storage.deleteContext(req.params.name);
    res.send("");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

// --- Context metadata routes ---

app.get("/ctx/:context/meta/edit", async (req, res) => {
  try {
    await storage.listItems(req.params.context);
    const meta = await storage.getContextMetadata(req.params.context);
    res.send(contextMetaEditPage(req.params.context, meta));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/meta", async (req, res) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const links: ContextLink[] = [];
    for (let i = 0; i < 10; i++) {
      const label = body[`link_label_${i}`]?.trim();
      const url = body[`link_url_${i}`]?.trim();
      if (label && url) links.push({ label, url });
    }
    await storage.updateContextMetadata(req.params.context, {
      title: body.title?.trim() || undefined,
      description: body.description?.trim() || undefined,
      status: body.status?.trim() || undefined,
      tags: parseTags(body.tags),
      links,
    });
    res.redirect(`/ctx/${req.params.context}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(layout("Error", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

// --- Context zip download ---

app.get("/ctx/:context.zip", async (req, res) => {
  const ctx = req.params.context;
  try {
    // Confirm the context exists and is safe to serve — listItems throws for
    // invalid names, so the zip route inherits the same path-safety guard.
    await storage.listItems(ctx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(msg);
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${ctx}.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(err.message);
  });
  archive.pipe(res);

  const dir = path.join(storage.getDataDir(), ctx);
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    // Include the _context.yaml metadata file too; skip the version stamp and
    // anything that doesn't look like a supported item file.
    if (entry === storage.VERSION_STAMP_FILENAME) continue;
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    if (entry !== CONTEXT_META_FILENAME && !storage.splitItemFilename(entry)) continue;
    archive.file(full, { name: entry });
  }
  await archive.finalize();
});

// --- Item routes ---

app.get("/ctx/:context", async (req, res) => {
  try {
    const items = await storage.listItems(req.params.context);
    const meta = await storage.getContextMetadata(req.params.context);
    res.send(itemListPage(req.params.context, meta, items));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/items", async (req, res) => {
  try {
    const { item, extension, title, tags: rawTags, content } = req.body;
    if (!item || !ITEM_NAME_REGEX.test(item)) {
      res.status(400).send(`<div class="flash flash-error">Invalid item name.</div>`);
      return;
    }
    const ext = parseExtQuery(extension) || "md";
    const tags = parseTags(rawTags);
    await storage.createItem(req.params.context, item, ext, {
      title: title || item,
      tags,
      content: content || "",
    });
    const items = await storage.listItems(req.params.context);
    const created = items.find((i) => i.name === item && i.extension === ext);
    if (!created) throw new Error("Item created but could not be re-read");
    res.send(itemCardFragment(req.params.context, created));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

// Raw-bytes item route — used by the UI Download button and direct tooling.
app.get("/ctx/:context/:item/raw", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    const raw = await storage.getItemRaw(context, itemName, preferred);
    const disposition = parseTruthy(req.query.download) ? "attachment" : "inline";
    res.setHeader("Content-Type", raw.contentType);
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${raw.filename}"`
    );
    res.send(raw.content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).type("text/plain").send(msg);
  }
});

app.get("/ctx/:context/:item", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    const rawMode = parseTruthy(req.query.raw);
    const item = await storage.getItem(context, itemName, preferred);
    const isMarkdown = item.extension === "md";
    let contentHtml: string;
    if (rawMode) {
      // Always show the verbatim file content in raw mode (md includes frontmatter).
      const rawItem = await storage.getItemRaw(context, itemName, preferred);
      contentHtml = escHtml(rawItem.content);
    } else if (isMarkdown) {
      contentHtml = await marked.parse(item.content);
    } else {
      contentHtml = escHtml(item.content);
    }
    const fm = item.frontmatter;
    res.send(
      itemViewPage(
        context,
        itemName,
        item.extension,
        fm?.title || itemName,
        fm?.tags || [],
        item.created,
        item.updated,
        contentHtml,
        isMarkdown,
        rawMode,
      )
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.get("/ctx/:context/:item/edit", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    const item = await storage.getItem(context, itemName, preferred);
    const isMarkdown = item.extension === "md";
    const fm = item.frontmatter;
    res.send(
      itemEditPage(
        context,
        itemName,
        item.extension,
        fm?.title || itemName,
        fm?.tags || [],
        item.content,
        isMarkdown
      )
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/:item/edit", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    const { title, tags: rawTags, content } = req.body;
    const ext = await storage.findItemExtension(context, itemName, preferred);
    const isMarkdown = ext === "md";
    await storage.updateItem(context, itemName, {
      extension: ext,
      title: isMarkdown ? title : undefined,
      tags: isMarkdown ? parseTags(rawTags) : undefined,
      content,
    });
    res.redirect(`/ctx/${context}/${itemName}?ext=${ext}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(layout("Error", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/:item/append", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    await storage.appendToItem(context, itemName, req.body.content || "", preferred);
    const item = await storage.getItem(context, itemName, preferred);
    const isMarkdown = item.extension === "md";
    const contentHtml = isMarkdown
      ? await marked.parse(item.content)
      : escHtml(item.content);
    res.send(contentHtml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.delete("/ctx/:context/:item", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    await storage.deleteItem(context, itemName, preferred);
    res.send("");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

// --- Search ---

app.get("/search", async (req, res) => {
  const q = (req.query.q as string) || "";
  const context = (req.query.context as string) || "";
  const includeArchived = parseTruthy(req.query.show_archived);
  const contexts = await storage.listContexts({ includeArchived: true });
  const contextNames = contexts.map((c) => c.name);

  if (!q) {
    res.send(searchPage(null, "", "", contextNames, includeArchived));
    return;
  }

  const results = await searchContexts(storage.getDataDir(), q, {
    contextFilter: context || undefined,
    includeArchived,
  });
  res.send(searchPage(results, q, context, contextNames, includeArchived));
});

// --- Diagnose ---

app.get("/diagnose", async (_req, res) => {
  const diag = await storage.getDiagnostics();
  res.json(diag);
});

// --- Shutdown ---

// Invariant: the shutdown handler MUST NOT write to the data dir. Shutdown is
// release-the-port only — any mid-flight storage write is expected to finish
// before the 200ms timer fires, and we do not rewrite metadata on exit.
app.post("/shutdown", (_req, res) => {
  res.send(
    `<span id="footer-text">SERVER TERMINATED &mdash; PORT ${PORT} RELEASED</span>`
  );
  setTimeout(() => process.exit(0), 200);
});

// --- Start ---

let PORT = 3141;

async function main() {
  try {
    const cfg = loadConfig();
    PORT = cfg.uiPort;
    console.error(`[contexts-mcp-ui] version:   ${packageVersion()}`);
    console.error(`[contexts-mcp-ui] data dir:  ${cfg.dataDir} (from ${cfg.source.dataDir})`);
    console.error(`[contexts-mcp-ui] config:    ${cfg.configPath}`);
    await storage.ensureDataDir();
  } catch (err) {
    if (err instanceof MissingDataDirError) {
      console.error("[contexts-mcp-ui] startup failed — no data dir configured.");
      console.error("");
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  app.listen(PORT, () => {
    console.log(`Contexts UI running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[contexts-mcp-ui] Fatal:", err);
  process.exit(1);
});
