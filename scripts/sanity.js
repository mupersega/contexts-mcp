#!/usr/bin/env node
// scripts/sanity.js — the invariant checks that catch "quietly wrong" bugs.
//
// No framework. Runs against a throwaway data dir. Exits non-zero on failure.

import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tmpRoot = path.join(os.tmpdir(), `contexts-mcp-sanity-${process.pid}-${Date.now()}`);

process.env.CONTEXTS_DATA_DIR = tmpRoot;

const storage = await import(pathToFileURL(path.join(repoRoot, "dist", "storage.js")).href);
const graph = await import(pathToFileURL(path.join(repoRoot, "dist", "graph.js")).href);

let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${label}\n        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function run() {
  console.log("contexts-mcp sanity");
  console.log(`  data dir: ${tmpRoot}`);
  console.log("");
  await storage.ensureDataDir();

  await check("re-creating a deleted item succeeds (no stale index)", async () => {
    await storage.createContext("reuse");
    await storage.createItem("reuse", "thing", "md", { title: "first", content: "a" });
    await storage.deleteItem("reuse", "thing");
    await storage.createItem("reuse", "thing", "md", { title: "second", content: "b" });
    const items = await storage.listItems("reuse");
    assertEq(items.length, 1, "item count after recreate");
    assertEq(items[0].title, "second", "title after recreate");
  });

  await check("tag update replaces, not unions", async () => {
    await storage.createContext("tags");
    await storage.updateContextMetadata("tags", { tags: ["a", "b"] });
    await storage.updateContextMetadata("tags", { tags: ["c"] });
    const meta = await storage.getContextMetadata("tags");
    assertEq(meta.tags, ["c"], "tag replacement");
  });

  await check("_context.yaml survives a round-trip of mutations", async () => {
    await storage.createContext("yaml-rt");
    await storage.updateContextMetadata("yaml-rt", {
      title: "Round Trip",
      description: "yaml integrity test",
      status: "active",
      tags: ["alpha", "beta"],
      links: [{ label: "spec", url: "https://example.com" }],
    });
    await storage.createItem("yaml-rt", "note", "md", { title: "n", content: "body" });
    const raw = fs.readFileSync(path.join(tmpRoot, "yaml-rt", "_context.yaml"), "utf-8");
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("yaml failed to parse");
    const p = parsed;
    assertEq(p.title, "Round Trip", "title preserved");
    assertEq(p.tags, ["alpha", "beta"], "tags preserved");
    if (typeof p.last_activity !== "string" || p.last_activity.length === 0) {
      throw new Error("last_activity not set after item write");
    }
  });

  await check("archived contexts filtered from default list", async () => {
    await storage.createContext("visible");
    await storage.createContext("hidden");
    await storage.updateContextMetadata("hidden", { status: "archived" });
    const defaultList = await storage.listContexts({ includeMetadata: true });
    const names = defaultList.map((c) => c.name);
    if (names.includes("hidden")) throw new Error("archived context leaked into default list");
    if (!names.includes("visible")) throw new Error("visible context missing");
    const full = await storage.listContexts({ includeMetadata: true, includeArchived: true });
    const fullNames = full.map((c) => c.name);
    if (!fullNames.includes("hidden")) throw new Error("archived context missing from include_archived=true");
  });

  await check("sort=recent_activity puts most-recently-touched first", async () => {
    await storage.createContext("older");
    await storage.createContext("newer");
    await storage.createItem("older", "a", "md", { content: "old" });
    await new Promise((r) => setTimeout(r, 25));
    await storage.createItem("newer", "a", "md", { content: "new" });
    const list = await storage.listContexts({
      includeMetadata: true,
      sort: "recent_activity",
    });
    // "newer" should precede "older".
    const idxNewer = list.findIndex((c) => c.name === "newer");
    const idxOlder = list.findIndex((c) => c.name === "older");
    if (idxNewer === -1 || idxOlder === -1) throw new Error("contexts missing from list");
    if (idxNewer > idxOlder) {
      throw new Error(`recent_activity sort: newer(${idxNewer}) should precede older(${idxOlder})`);
    }
  });

  await check("getItemRaw preserves frontmatter on md", async () => {
    await storage.createContext("raw");
    await storage.createItem("raw", "note", "md", { title: "T", content: "body here" });
    const raw = await storage.getItemRaw("raw", "note");
    if (!raw.content.startsWith("---")) throw new Error("raw md should lead with frontmatter");
    if (!raw.content.includes("body here")) throw new Error("raw md should contain body");
    assertEq(raw.filename, "note.md", "filename");
  });

  await check("sql extension accepted", async () => {
    await storage.createContext("sqlctx");
    await storage.createItem("sqlctx", "query", "sql", {
      content: "SELECT 1;\n",
    });
    const raw = await storage.getItemRaw("sqlctx", "query");
    assertEq(raw.extension, "sql", "ext");
    assertEq(raw.contentType, "application/sql; charset=utf-8", "mime");
  });

  await check("attachments: add/list/dedup, traversal-guard, not-an-item, delete", async () => {
    await storage.createContext("eviden");
    const srcPng = path.join(tmpRoot, "src-shot.png");
    fs.writeFileSync(srcPng, Buffer.from("89504e470d0a1a0a0000", "hex"));
    const info = await storage.addAttachment("eviden", srcPng, "shot");
    assertEq(info.filename, "shot.png", "attachment filename");
    if (info.size <= 0) throw new Error("attachment size should be > 0");
    assertEq((await storage.listAttachments("eviden")).map((a) => a.filename), ["shot.png"], "list after add");
    // same name dedups rather than clobbering
    const info2 = await storage.addAttachment("eviden", srcPng, "shot");
    assertEq(info2.filename, "shot-1.png", "dedup filename");
    // unsupported extension rejected
    const srcExe = path.join(tmpRoot, "evil.exe");
    fs.writeFileSync(srcExe, "x");
    let rejectedExt = false;
    try { await storage.addAttachment("eviden", srcExe); } catch { rejectedExt = true; }
    if (!rejectedExt) throw new Error("unsupported extension should be rejected");
    // path traversal rejected at the resolve boundary
    let rejectedTraversal = false;
    try { storage.attachmentFilePath("eviden", "../../secret.png"); } catch { rejectedTraversal = true; }
    if (!rejectedTraversal) throw new Error("traversal filename should be rejected");
    // assets dir must NOT surface as an item
    if ((await storage.listItems("eviden")).some((i) => i.name === "assets")) {
      throw new Error("assets dir leaked into items");
    }
    await storage.deleteAttachment("eviden", "shot.png");
    assertEq((await storage.listAttachments("eviden")).map((a) => a.filename), ["shot-1.png"], "list after delete");
  });

  await check("graph: parseLinks detects md + wiki links, rejects invalid/traversal", async () => {
    const refs = graph.parseLinks(
      "See [o](/ctx/projx/notes) and [[ideas]] and [[projy/spec]] and [bad](/ctx/..) and [[no spaces]]",
      "home"
    );
    const keys = refs.map((r) => `${r.context}/${r.item ?? ""}`);
    if (!keys.includes("projx/notes")) throw new Error("missed md internal link");
    if (!keys.includes("home/ideas")) throw new Error("missed same-context wiki link");
    if (!keys.includes("projy/spec")) throw new Error("missed cross-context wiki link");
    if (keys.some((k) => k.includes(".."))) throw new Error("traversal '/ctx/..' was not rejected");
    if (keys.includes("home/no spaces")) throw new Error("invalid item name not rejected");
  });

  await check("graph: tfidf groups topically-similar docs", async () => {
    const docs = [
      { id: "db1", text: "database schema migration postgres index query table" },
      { id: "db2", text: "postgres database index query performance table tuning" },
      { id: "ui1", text: "button layout flexbox component render viewport spacing" },
    ];
    const rel = graph.tfidfRelated(docs, 2, 0.0);
    const top = rel.get("db1")[0];
    assertEq(top.id, "db2", "db1's nearest neighbour is the other database doc");
  });

  await check("graph: build yields outbound links + backlinks", async () => {
    await storage.createContext("gctxa");
    await storage.createContext("gctxb");
    await storage.createItem("gctxa", "alpha", "md", {
      content: "About databases. See [[gctxb/beta]] and [g](/ctx/gctxa/gamma).",
    });
    await storage.createItem("gctxb", "beta", "md", { content: "Database indexing and queries." });
    await storage.createItem("gctxa", "gamma", "md", { content: "Unrelated UI flexbox layout." });
    graph.invalidateGraphCache();
    const a = await graph.getItemConnections("gctxa", "alpha");
    assertEq(a.outbound.map((o) => o.id).sort(), ["gctxa/gamma", "gctxb/beta"], "alpha outbound");
    const beta = await graph.getItemConnections("gctxb", "beta");
    assertEq(beta.backlinks.map((b) => b.id), ["gctxa/alpha"], "beta backlink from alpha");
  });

  await check("graph: ollama similarity backend falls back to tf-idf when unreachable", async () => {
    process.env.CONTEXTS_SIMILARITY = "ollama";
    process.env.CONTEXTS_OLLAMA_URL = "http://127.0.0.1:1"; // nothing listening -> forces fallback
    graph.invalidateGraphCache();
    const g = await graph.buildGraph(); // must not throw; falls back to TF-IDF
    if (!g.nodes.length) throw new Error("buildGraph returned no nodes under ollama-fallback");
    delete process.env.CONTEXTS_SIMILARITY;
    delete process.env.CONTEXTS_OLLAMA_URL;
    graph.invalidateGraphCache();
  });

  await check("graph: archived contexts excluded by default, included on opt-in", async () => {
    await storage.createContext("garc");
    await storage.updateContextMetadata("garc", { status: "archived" });
    await storage.createItem("garc", "secret", "md", { content: "an archived item" });
    graph.invalidateGraphCache();
    const def = await graph.getGraph(); // default = exclude archived
    if (def.nodes.some((n) => n.id === "garc/secret")) throw new Error("archived item leaked into default graph");
    const all = await graph.getGraph(true);
    if (!all.nodes.some((n) => n.id === "garc/secret")) throw new Error("archived item missing from include-archived graph");
    graph.invalidateGraphCache();
  });

  await check("graph: related edges are undirected and deduped (one per pair)", async () => {
    await storage.createContext("grel");
    await storage.createItem("grel", "db1", "md", { content: "database schema migration postgres index query table tuning" });
    await storage.createItem("grel", "db2", "md", { content: "postgres database index query table migration schema performance" });
    graph.invalidateGraphCache();
    const g = await graph.getGraph();
    const pair = g.edges.filter(
      (e) =>
        e.kind === "related" &&
        ((e.source === "grel/db1" && e.target === "grel/db2") ||
          (e.source === "grel/db2" && e.target === "grel/db1"))
    );
    if (pair.length !== 1) throw new Error(`expected exactly 1 related edge for db1/db2, got ${pair.length}`);
    graph.invalidateGraphCache();
  });

  await check("graph: an explicit link suppresses the related edge for the same pair", async () => {
    await storage.createContext("gsup");
    await storage.createItem("gsup", "a", "md", { content: "database schema migration postgres index. See [[gsup/b]]." });
    await storage.createItem("gsup", "b", "md", { content: "database schema migration postgres index query table." });
    graph.invalidateGraphCache();
    const g = await graph.getGraph();
    if (!g.edges.some((e) => e.kind === "link" && e.source === "gsup/a" && e.target === "gsup/b")) {
      throw new Error("expected explicit link a -> b");
    }
    const related = g.edges.some(
      (e) =>
        e.kind === "related" &&
        ((e.source === "gsup/a" && e.target === "gsup/b") || (e.source === "gsup/b" && e.target === "gsup/a"))
    );
    if (related) throw new Error("related edge should be suppressed when an explicit link exists");
    graph.invalidateGraphCache();
  });

  await check("graph: corpus signature is stable across reads, moves on mutation", async () => {
    await storage.createContext("gsig");
    await storage.createItem("gsig", "one", "md", { content: "first item" });
    const sigA = await storage.corpusSignature();
    const sigA2 = await storage.corpusSignature(); // no mutation between reads
    assertEq(sigA, sigA2, "signature is stable when nothing changed (no rebuild trigger)");
    await storage.updateItem("gsig", "one", { content: "first item, edited" });
    const sigB = await storage.corpusSignature();
    if (sigB === sigA) throw new Error("signature must change after an in-context edit");
    await storage.createItem("gsig", "two", "md", { content: "second item" });
    const sigC = await storage.corpusSignature();
    if (sigC === sigB) throw new Error("signature must change after adding an item");
    await storage.deleteContext("gsig");
    const sigD = await storage.corpusSignature();
    if (sigD === sigC) throw new Error("signature must change after deleting a context");
  });

  console.log("");
  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

async function cleanup() {
  try {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

run()
  .then(cleanup)
  .catch(async (err) => {
    await cleanup();
    console.error("sanity failed:", err);
    process.exit(1);
  });
