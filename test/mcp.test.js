// test/mcp.test.js — protocol-level tests: spawn the built server over stdio
// and drive it with the official client, exactly as a host does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { freshDataDir, removeDir, distDir } from "./helpers.js";

const dataDir = freshDataDir("mcp");
const serverEntry = path.join(distDir, "index.js");

async function connect(clientOptions) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, CONTEXTS_DATA_DIR: dataDir },
    stderr: "pipe",
  });
  const client = new Client({ name: "contexts-mcp-test", version: "0.0.0" }, clientOptions);
  await client.connect(transport);
  return client;
}

const textOf = (res) => res.content.map((c) => c.text).join("");

let client;
before(async () => {
  client = await connect({ versionNegotiation: { mode: "auto" } });
});
after(async () => {
  await client?.close();
  removeDir(dataDir);
});

test("negotiates the 2026-07-28 era with a modern client", () => {
  assert.equal(client.getProtocolEra(), "modern");
});

test("a legacy (2025 initialize) client still connects and can call tools", async () => {
  const legacy = await connect(undefined);
  try {
    assert.equal(legacy.getProtocolEra(), "legacy");
    const r = await legacy.callTool({ name: "list_contexts", arguments: {} });
    assert.ok(!r.isError);
  } finally {
    await legacy.close();
  }
});

test("tools/list is deterministic and advertises annotations", async () => {
  const a = await client.listTools();
  const b = await client.listTools();
  assert.deepEqual(a.tools.map((t) => t.name), b.tools.map((t) => t.name));
  const names = a.tools.map((t) => t.name);
  for (const n of ["list_contexts", "get_item", "edit_item", "search_contexts", "delete_item"]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  const byName = Object.fromEntries(a.tools.map((t) => [t.name, t]));
  assert.equal(byName.get_item.annotations.readOnlyHint, true);
  assert.equal(byName.delete_item.annotations.destructiveHint, true);
  assert.equal(byName.edit_item.annotations.readOnlyHint, false);
  // Every input schema is a plain object schema (hosts drop tools with root-level allOf/if/then).
  for (const t of a.tools) assert.equal(t.inputSchema.type, "object", `${t.name} inputSchema.type`);
});

test("create -> append -> edit -> read round trip with paging", async () => {
  let r = await client.callTool({ name: "create_context", arguments: { name: "proto" } });
  assert.ok(!r.isError, textOf(r));
  r = await client.callTool({
    name: "create_item",
    arguments: { context: "proto", item: "notes", title: "Notes", tags: ["t"], content: "line one\nline two\nline three" },
  });
  assert.ok(!r.isError, textOf(r));
  r = await client.callTool({ name: "append_to_item", arguments: { context: "proto", item: "notes", content: "line four" } });
  assert.ok(!r.isError, textOf(r));
  r = await client.callTool({
    name: "edit_item",
    arguments: { context: "proto", item: "notes", old_string: "line two", new_string: "LINE TWO" },
  });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /1 replacement/);

  r = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "notes" } });
  const body = textOf(r);
  assert.match(body, /title: "Notes"/);
  assert.match(body, /LINE TWO/);
  assert.match(body, /line four/);
  assert.doesNotMatch(body, /\[lines /, "small item must not be paged");

  r = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "notes", offset: 2, limit: 2 } });
  const paged = textOf(r);
  assert.match(paged, /\[lines 2-3 of \d+; continue with offset=4\]/);
  assert.match(paged, /LINE TWO/);
  assert.doesNotMatch(paged, /line one/);

  // ambiguous edit is refused, nothing changes
  r = await client.callTool({
    name: "edit_item",
    arguments: { context: "proto", item: "notes", old_string: "line", new_string: "x" },
  });
  assert.ok(r.isError);
  assert.match(textOf(r), /occurs \d+ times/);
});

test("a large item is cut at the byte cap with a continuation note", async () => {
  const bigLine = "x".repeat(1000);
  const content = Array.from({ length: 100 }, (_, i) => `${i}:${bigLine}`).join("\n"); // ~100 KB
  let r = await client.callTool({ name: "create_item", arguments: { context: "proto", item: "big", content } });
  assert.ok(!r.isError, textOf(r));
  r = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "big" } });
  const out = textOf(r);
  assert.ok(Buffer.byteLength(out) < 70_000, `payload ${Buffer.byteLength(out)} should be capped`);
  const m = out.match(/\[lines 1-(\d+) of 100 \(58\.6 KB cap\); continue with offset=(\d+)\]/);
  assert.ok(m, `continuation note missing in: ${out.slice(0, 200)}`);
  r = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "big", offset: Number(m[2]) } });
  assert.match(textOf(r), /; end of item\]/);
  // raw is never paged
  r = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "big", raw: true } });
  assert.ok(Buffer.byteLength(textOf(r)) > 100_000);
});

test("search ranks title hits first, caps results, trims lines", async () => {
  await client.callTool({ name: "create_context", arguments: { name: "srch" } });
  for (let i = 0; i < 30; i++) {
    await client.callTool({
      name: "create_item",
      arguments: { context: "srch", item: `doc-${i}`, title: i === 7 ? "Widget manual" : `Doc ${i}`, content: `about the widget ${"pad ".repeat(120)}widget again\nno hit here` },
    });
  }
  let r = await client.callTool({ name: "search_contexts", arguments: { query: "widget", limit: 5 } });
  const out = textOf(r);
  const lines = out.split("\n");
  assert.match(lines[0], /^srch\/doc-7 — Widget manual/, "title hit ranks first");
  assert.match(out, /5 of 30 matching items shown/);
  const hitLines = lines.filter((l) => l.startsWith("    "));
  assert.equal(hitLines.length, 5, "one trimmed line per item");
  for (const l of hitLines) assert.ok(l.length <= 210, `line too long: ${l.length}`);
  assert.ok(Buffer.byteLength(out) < 3000);

  r = await client.callTool({ name: "search_contexts", arguments: { query: "zzz-no-such-token" } });
  assert.match(textOf(r), /No matches/);
});

test("invalid names are rejected at the boundary with isError, not a crash", async () => {
  const r = await client.callTool({ name: "create_context", arguments: { name: "../escape" } });
  assert.ok(r.isError);
  const r2 = await client.callTool({ name: "get_item", arguments: { context: "proto", item: "nope" } });
  assert.ok(r2.isError);
  assert.match(textOf(r2), /not found/);
  // server still alive
  const r3 = await client.callTool({ name: "list_contexts", arguments: {} });
  assert.ok(!r3.isError);
});

test("listing outputs are compact text", async () => {
  const r = await client.callTool({ name: "list_items", arguments: { context: "srch" } });
  const out = textOf(r);
  assert.ok(!out.trim().startsWith("["), "list_items should not be a JSON array");
  assert.equal(out.split("\n").length, 31, "header + one line per item");
  const c = await client.callTool({ name: "list_contexts", arguments: { include_metadata: true } });
  assert.ok(!textOf(c).trim().startsWith("["));
  assert.match(textOf(c), /^proto/m);
});

test("data dir contains no stray files from the server (tmp writes are cleaned)", () => {
  const stray = fs.readdirSync(dataDir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(stray, []);
});

test("rebuild_graph reports build stats for both modes", async () => {
  let r = await client.callTool({ name: "rebuild_graph", arguments: { mode: "auto" } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /Graph rebuilt \(auto, (incremental|pruned-full), tfidf\) in [\d.]+s: \d+ nodes, \d+ edges, \d+ items re-indexed, \d+ re-scored\./);
  r = await client.callTool({ name: "rebuild_graph", arguments: {} });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /Graph rebuilt \(full, exact, tfidf\)/);
});
