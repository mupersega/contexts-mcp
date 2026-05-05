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

  await check("pinned=true round-trips through _context.yaml", async () => {
    await storage.createContext("pin-rt");
    await storage.updateContextMetadata("pin-rt", { title: "T" });
    // Hand-craft the metadata write since setContextPinned doesn't exist yet — verify
    // the read+write path preserves an explicit pinned: true in the YAML.
    const metaPath = path.join(tmpRoot, "pin-rt", "_context.yaml");
    const existing = yaml.load(fs.readFileSync(metaPath, "utf-8")) || {};
    existing.pinned = true;
    fs.writeFileSync(metaPath, yaml.dump(existing));
    const meta = await storage.getContextMetadata("pin-rt");
    if (meta.pinned !== true) throw new Error(`expected pinned=true, got ${JSON.stringify(meta.pinned)}`);
  });

  await check("pinned=false is omitted from _context.yaml on write", async () => {
    await storage.createContext("pin-omit");
    await storage.updateContextMetadata("pin-omit", { title: "T" });
    const metaPath = path.join(tmpRoot, "pin-omit", "_context.yaml");
    const raw = fs.readFileSync(metaPath, "utf-8");
    if (raw.includes("pinned:")) throw new Error("pinned key should not appear when false");
  });

  await check("setContextPinned does NOT bump last_activity", async () => {
    await storage.createContext("pin-no-bump");
    await storage.createItem("pin-no-bump", "seed", "md", { content: "x" });
    const before = (await storage.getContextMetadata("pin-no-bump")).last_activity;
    if (!before) throw new Error("seed item should have set last_activity");
    await new Promise((r) => setTimeout(r, 25));
    await storage.setContextPinned("pin-no-bump", true);
    const after = (await storage.getContextMetadata("pin-no-bump")).last_activity;
    if (after !== before) {
      throw new Error(`last_activity changed from ${before} to ${after} — pin should not bump it`);
    }
    const meta = await storage.getContextMetadata("pin-no-bump");
    if (meta.pinned !== true) throw new Error("pinned should be true after setContextPinned(true)");
  });

  await check("setContextPinned(false) clears the field", async () => {
    await storage.createContext("pin-clear");
    await storage.setContextPinned("pin-clear", true);
    await storage.setContextPinned("pin-clear", false);
    const meta = await storage.getContextMetadata("pin-clear");
    if (meta.pinned === true) throw new Error("pinned should be unset after setContextPinned(false)");
    const raw = fs.readFileSync(path.join(tmpRoot, "pin-clear", "_context.yaml"), "utf-8");
    if (raw.includes("pinned:")) throw new Error("pinned key should not appear in YAML after unpin");
  });

  await check("setContextPinned errors when the context does not exist", async () => {
    let threw = false;
    try {
      await storage.setContextPinned("does-not-exist", true);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("expected setContextPinned to throw for missing context");
  });

  await check("pinned context floats to top of sort=name", async () => {
    await storage.createContext("zzz-pinned");
    await storage.createContext("aaa-unpinned");
    await storage.createContext("bbb-unpinned");
    await storage.setContextPinned("zzz-pinned", true);
    const list = await storage.listContexts({ includeMetadata: true, sort: "name" });
    const names = list.map((c) => c.name);
    const idxPin = names.indexOf("zzz-pinned");
    const idxAaa = names.indexOf("aaa-unpinned");
    const idxBbb = names.indexOf("bbb-unpinned");
    if (idxPin === -1 || idxAaa === -1 || idxBbb === -1) throw new Error("contexts missing");
    if (idxPin > idxAaa || idxPin > idxBbb) {
      throw new Error(`pinned should be first; got [${names.join(", ")}]`);
    }
    if (idxAaa > idxBbb) throw new Error("unpinned group must remain alphabetical");
  });

  await check("pinned context floats to top of sort=recent_activity", async () => {
    await storage.createContext("recent-pinned");
    await storage.createContext("recent-active");
    await storage.createItem("recent-pinned", "old", "md", { content: "x" });
    await new Promise((r) => setTimeout(r, 25));
    await storage.createItem("recent-active", "new", "md", { content: "y" });
    await storage.setContextPinned("recent-pinned", true);
    const list = await storage.listContexts({
      includeMetadata: true,
      sort: "recent_activity",
    });
    const idxPin = list.findIndex((c) => c.name === "recent-pinned");
    const idxAct = list.findIndex((c) => c.name === "recent-active");
    if (idxPin === -1 || idxAct === -1) throw new Error("contexts missing");
    if (idxPin > idxAct) {
      throw new Error(`pinned should beat recent_activity; got pin=${idxPin}, active=${idxAct}`);
    }
  });

  await check("archived+pinned hidden by default; floats when include_archived=true", async () => {
    await storage.createContext("arch-pin");
    await storage.createContext("plain");
    await storage.setContextPinned("arch-pin", true);
    await storage.updateContextMetadata("arch-pin", { status: "archived" });

    const def = await storage.listContexts({ includeMetadata: true });
    if (def.find((c) => c.name === "arch-pin")) {
      throw new Error("archived+pinned context should be hidden by default");
    }

    const all = await storage.listContexts({ includeMetadata: true, includeArchived: true });
    const idxPin = all.findIndex((c) => c.name === "arch-pin");
    const idxPlain = all.findIndex((c) => c.name === "plain");
    if (idxPin === -1 || idxPlain === -1) throw new Error("contexts missing in include_archived list");
    if (idxPin > idxPlain) {
      throw new Error(`archived+pinned should still float when shown; got pin=${idxPin}, plain=${idxPlain}`);
    }
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
