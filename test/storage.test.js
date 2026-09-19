// test/storage.test.js — invariants of the disk layer (ported from scripts/sanity.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { freshDataDir, removeDir, loadDist, sleep } from "./helpers.js";

const dataDir = freshDataDir("storage");
let storage;

before(async () => {
  storage = await loadDist("storage.js");
  await storage.ensureDataDir();
});
after(() => removeDir(dataDir));

test("re-creating a deleted item succeeds (no stale index)", async () => {
  await storage.createContext("reuse");
  await storage.createItem("reuse", "thing", "md", { title: "first", content: "a" });
  await storage.deleteItem("reuse", "thing");
  await storage.createItem("reuse", "thing", "md", { title: "second", content: "b" });
  const items = await storage.listItems("reuse");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "second");
});

test("no-op update preserves the revert backup (md + non-md)", async () => {
  await storage.createContext("noop");
  await storage.createItem("noop", "doc", "md", { title: "t", content: "AAA" });
  await storage.updateItem("noop", "doc", { content: "BBB" });
  assert.ok(await storage.hasBackup("noop", "doc"), "backup after a real edit");
  await storage.updateItem("noop", "doc", { title: "t", content: "BBB" });
  await storage.updateItem("noop", "doc", { title: "t", content: "BBB\n" });
  await storage.revertItem("noop", "doc");
  assert.match((await storage.getItem("noop", "doc")).content, /AAA/);

  await storage.createItem("noop", "data", "csv", { content: "a,b\n1,2\n" });
  await storage.updateItem("noop", "data", { content: "a,b\n9,9\n" });
  await storage.updateItem("noop", "data", { content: "a,b\n9,9\n" });
  await storage.revertItem("noop", "data");
  assert.match((await storage.getItem("noop", "data")).content, /1,2/);
});

test("tag update replaces, not unions", async () => {
  await storage.createContext("tags");
  await storage.updateContextMetadata("tags", { tags: ["a", "b"] });
  await storage.updateContextMetadata("tags", { tags: ["c"] });
  assert.deepEqual((await storage.getContextMetadata("tags")).tags, ["c"]);
});

test("_context.yaml survives a round-trip of mutations", async () => {
  await storage.createContext("yaml-rt");
  await storage.updateContextMetadata("yaml-rt", {
    title: "Round Trip",
    description: "yaml integrity test",
    status: "active",
    tags: ["alpha", "beta"],
    links: [{ label: "spec", url: "https://example.com" }],
  });
  await storage.createItem("yaml-rt", "note", "md", { title: "n", content: "body" });
  const parsed = yaml.load(fs.readFileSync(path.join(dataDir, "yaml-rt", "_context.yaml"), "utf-8"));
  assert.equal(parsed.title, "Round Trip");
  assert.deepEqual(parsed.tags, ["alpha", "beta"]);
  assert.ok(typeof parsed.last_activity === "string" && parsed.last_activity.length > 0);
});

test("archived contexts filtered from default list", async () => {
  await storage.createContext("visible");
  await storage.createContext("hidden");
  await storage.updateContextMetadata("hidden", { status: "archived" });
  const names = (await storage.listContexts({ includeMetadata: true })).map((c) => c.name);
  assert.ok(!names.includes("hidden"));
  assert.ok(names.includes("visible"));
  const all = (await storage.listContexts({ includeMetadata: true, includeArchived: true })).map((c) => c.name);
  assert.ok(all.includes("hidden"));
});

test("sort=recent_activity puts most-recently-touched first", async () => {
  await storage.createContext("older");
  await storage.createContext("newer");
  await storage.createItem("older", "a", "md", { content: "old" });
  await sleep(25);
  await storage.createItem("newer", "a", "md", { content: "new" });
  const list = await storage.listContexts({ includeMetadata: true, sort: "recent_activity" });
  const idxNewer = list.findIndex((c) => c.name === "newer");
  const idxOlder = list.findIndex((c) => c.name === "older");
  assert.ok(idxNewer !== -1 && idxOlder !== -1);
  assert.ok(idxNewer < idxOlder, `newer(${idxNewer}) should precede older(${idxOlder})`);
});

test("getItemRaw preserves frontmatter on md", async () => {
  await storage.createContext("raw");
  await storage.createItem("raw", "note", "md", { title: "T", content: "body here" });
  const raw = await storage.getItemRaw("raw", "note");
  assert.ok(raw.content.startsWith("---"));
  assert.match(raw.content, /body here/);
  assert.equal(raw.filename, "note.md");
});

test("sql extension accepted", async () => {
  await storage.createContext("sqlctx");
  await storage.createItem("sqlctx", "query", "sql", { content: "SELECT 1;\n" });
  const raw = await storage.getItemRaw("sqlctx", "query");
  assert.equal(raw.extension, "sql");
  assert.equal(raw.contentType, "application/sql; charset=utf-8");
});

test("attachments: add/list/dedup, traversal-guard, not-an-item, delete", async () => {
  await storage.createContext("eviden");
  const srcPng = path.join(dataDir, "src-shot.png");
  fs.writeFileSync(srcPng, Buffer.from("89504e470d0a1a0a0000", "hex"));
  const info = await storage.addAttachment("eviden", srcPng, "shot");
  assert.equal(info.filename, "shot.png");
  assert.ok(info.size > 0);
  assert.deepEqual((await storage.listAttachments("eviden")).map((a) => a.filename), ["shot.png"]);
  const info2 = await storage.addAttachment("eviden", srcPng, "shot");
  assert.equal(info2.filename, "shot-1.png");
  const srcExe = path.join(dataDir, "evil.exe");
  fs.writeFileSync(srcExe, "x");
  await assert.rejects(() => storage.addAttachment("eviden", srcExe));
  assert.throws(() => storage.attachmentFilePath("eviden", "../../secret.png"));
  assert.ok(!(await storage.listItems("eviden")).some((i) => i.name === "assets"));
  await storage.deleteAttachment("eviden", "shot.png");
  assert.deepEqual((await storage.listAttachments("eviden")).map((a) => a.filename), ["shot-1.png"]);
});

test("path traversal in context/item names is rejected", async () => {
  await assert.rejects(() => storage.getItem("../..", "x"));
  await assert.rejects(() => storage.createItem("..", "x", "md", {}));
  await assert.rejects(() => storage.deleteContext(".."));
});

test("editItem: exact replacement, uniqueness, replace_all, snapshot", async () => {
  await storage.createContext("edit");
  await storage.createItem("edit", "doc", "md", { title: "E", content: "alpha\nbeta\nalpha\n" });
  await assert.rejects(() => storage.editItem("edit", "doc", "alpha", "ALPHA"), /2 times/);
  await assert.rejects(() => storage.editItem("edit", "doc", "missing", "x"), /not found/);
  const r = await storage.editItem("edit", "doc", "beta", "BETA");
  assert.equal(r.replacements, 1);
  assert.equal((await storage.getItem("edit", "doc")).content, "alpha\nBETA\nalpha\n");
  const r2 = await storage.editItem("edit", "doc", "alpha", "A", { replaceAll: true });
  assert.equal(r2.replacements, 2);
  assert.equal((await storage.getItem("edit", "doc")).content, "A\nBETA\nA\n");
  assert.ok(await storage.hasBackup("edit", "doc"));
  await storage.revertItem("edit", "doc");
  assert.equal((await storage.getItem("edit", "doc")).content, "alpha\nBETA\nalpha\n");
  // frontmatter is untouched by a body edit
  const raw = await storage.getItemRaw("edit", "doc");
  assert.match(raw.content, /title: E/);
  // non-md works on the raw text
  await storage.createItem("edit", "cfg", "json", { content: '{"a":1}' });
  await storage.editItem("edit", "cfg", '"a":1', '"a":2');
  assert.equal((await storage.getItem("edit", "cfg")).content, '{"a":2}');
});
