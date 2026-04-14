#!/usr/bin/env node
import express from "express";
import { marked } from "marked";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";
import {
  CONTEXT_NAME_REGEX,
  ContextLink,
  ITEM_EXTENSIONS,
  ITEM_NAME_REGEX,
  ItemExtension,
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

const app = express();
app.use(express.urlencoded({ extended: true }));

// --- Helpers ---

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseExtQuery(raw: unknown): ItemExtension | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if ((ITEM_EXTENSIONS as readonly string[]).includes(raw)) {
    return raw as ItemExtension;
  }
  return undefined;
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

// --- Context routes ---

app.get("/", async (_req, res) => {
  const contexts = await storage.listContexts(true);
  res.send(contextListPage(contexts));
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
    // Verify the context exists to produce a clean 404.
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
    // Re-read to get the persisted metadata/fs stats.
    const items = await storage.listItems(req.params.context);
    const created = items.find((i) => i.name === item && i.extension === ext);
    if (!created) throw new Error("Item created but could not be re-read");
    res.send(itemCardFragment(req.params.context, created));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.get("/ctx/:context/:item", async (req, res) => {
  try {
    const { context, item: itemName } = req.params;
    const preferred = parseExtQuery(req.query.ext);
    const item = await storage.getItem(context, itemName, preferred);
    const isMarkdown = item.extension === "md";
    const contentHtml = isMarkdown
      ? await marked.parse(item.content)
      : escHtml(item.content);
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
        isMarkdown
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
  const contexts = await storage.listContexts(false);
  const contextNames = contexts.map((c) => c.name);

  if (!q) {
    res.send(searchPage(null, "", "", contextNames));
    return;
  }

  const results = await searchContexts(storage.getDataDir(), q, {
    contextFilter: context || undefined,
  });
  res.send(searchPage(results, q, context, contextNames));
});

// --- Start ---

const PORT = parseInt(process.env.CONTEXTS_UI_PORT || "3141", 10);

async function main() {
  await storage.ensureDataDir();
  app.listen(PORT, () => {
    console.log(`Contexts UI running at http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
