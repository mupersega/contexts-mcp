#!/usr/bin/env node
import express from "express";
import { marked } from "marked";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";
import {
  layout,
  contextListPage,
  contextCardFragment,
  documentListPage,
  documentCardFragment,
  documentViewPage,
  documentEditPage,
  searchPage,
} from "./templates.js";

const app = express();
app.use(express.urlencoded({ extended: true }));

// --- Context routes ---

app.get("/", async (_req, res) => {
  const contexts = await storage.listContexts();
  res.send(contextListPage(contexts));
});

app.post("/ctx", async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).send(`<div class="flash flash-error">Invalid name. Use letters, numbers, hyphens, underscores.</div>`);
      return;
    }
    await storage.createContext(name);
    res.send(contextCardFragment(name));
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

// --- Document routes ---

app.get("/ctx/:context", async (req, res) => {
  try {
    const docs = await storage.listDocuments(req.params.context);
    res.send(documentListPage(req.params.context, docs));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/docs", async (req, res) => {
  try {
    const { document: docName, title, tags: rawTags, content } = req.body;
    if (!docName || !/^[a-zA-Z0-9_-]+$/.test(docName)) {
      res.status(400).send(`<div class="flash flash-error">Invalid document name.</div>`);
      return;
    }
    const tags = rawTags
      ? rawTags.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [];
    await storage.createDocument(req.params.context, docName, title || docName, tags, content || "");
    const doc = await storage.getDocument(req.params.context, docName);
    res.send(
      documentCardFragment(req.params.context, {
        name: docName,
        title: doc.meta.title,
        tags: doc.meta.tags,
        created: doc.meta.created,
        updated: doc.meta.updated,
      })
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.get("/ctx/:context/:doc", async (req, res) => {
  try {
    const { context, doc: docName } = req.params;
    const doc = await storage.getDocument(context, docName);
    const htmlContent = await marked.parse(doc.content);
    res.send(
      documentViewPage(
        context,
        docName,
        doc.meta.title,
        doc.meta.tags,
        doc.meta.created,
        doc.meta.updated,
        htmlContent
      )
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.get("/ctx/:context/:doc/edit", async (req, res) => {
  try {
    const { context, doc: docName } = req.params;
    const doc = await storage.getDocument(context, docName);
    res.send(documentEditPage(context, docName, doc.meta.title, doc.meta.tags, doc.content));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).send(layout("Not Found", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/:doc/edit", async (req, res) => {
  try {
    const { context, doc: docName } = req.params;
    const { title, tags: rawTags, content } = req.body;
    const tags = rawTags
      ? rawTags.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [];
    await storage.updateDocument(context, docName, { title, tags, content });
    res.redirect(`/ctx/${context}/${docName}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(layout("Error", `<div class="flash flash-error">${escHtml(msg)}</div>`));
  }
});

app.post("/ctx/:context/:doc/append", async (req, res) => {
  try {
    const { context, doc: docName } = req.params;
    await storage.appendToDocument(context, docName, req.body.content || "");
    const doc = await storage.getDocument(context, docName);
    const htmlContent = await marked.parse(doc.content);
    res.send(htmlContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.delete("/ctx/:context/:doc", async (req, res) => {
  try {
    const { context, doc: docName } = req.params;
    // Delete by updating with empty then removing file
    const path = await import("path");
    const fs = await import("fs/promises");
    const filePath = path.join(storage.getDataDir(), context, `${docName}.md`);
    await fs.rm(filePath);
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
  const contexts = await storage.listContexts();

  if (!q) {
    res.send(searchPage(null, "", "", contexts));
    return;
  }

  const results = await searchContexts(
    storage.getDataDir(),
    q,
    context || undefined
  );
  res.send(searchPage(results, q, context, contexts));
});

// --- Start ---

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
