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
