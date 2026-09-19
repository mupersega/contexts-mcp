#!/usr/bin/env node
// scripts/bench-mcp.js — end-to-end MCP benchmark at the protocol boundary.
//
// Unlike scripts/bench.js (which times storage functions in-process), this
// spawns the real server (dist/index.js) over stdio and drives it with the
// official MCP client, so every number includes JSON-RPC framing, Zod
// validation, handler work, and response serialization — exactly what a host
// like Claude Code pays per call.
//
// Two costs are reported for every scenario, because both are what users feel:
//   - wall-clock latency   (p50 / p95 / max, ms)
//   - response payload     (bytes, and ~tokens at 4 bytes/token) — this is what
//                          the model has to read, and it dominates perceived
//                          "slowness" far more than server CPU does.
//
// Usage:
//   node scripts/bench-mcp.js                       # synthetic corpus
//   BENCH_CORPUS="$LOCALAPPDATA/contexts-mcp/data" node scripts/bench-mcp.js
//                                                   # copy of a real corpus (items only)
//   BENCH_OUT=baseline.json node scripts/bench-mcp.js   # also write JSON for diffing
//   BENCH_REPS=20                                   # repetitions per scenario (default 10)

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const serverEntry = path.join(repoRoot, "dist", "index.js");
const tmpRoot = path.join(os.tmpdir(), `contexts-mcp-benchmcp-${process.pid}-${Date.now()}`);
const REPS = parseInt(process.env.BENCH_REPS || "10", 10);
const ITEM_EXT = new Set(["md", "txt", "json", "yaml", "yml", "csv", "sql"]);

// --- corpus -----------------------------------------------------------------

function copyCorpus(src) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  let contexts = 0, items = 0, bytes = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const from = path.join(src, ent.name);
    const to = path.join(tmpRoot, ent.name);
    fs.mkdirSync(to);
    contexts++;
    for (const f of fs.readdirSync(from, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const ext = f.name.slice(f.name.lastIndexOf(".") + 1);
      if (f.name !== "_context.yaml" && (!ITEM_EXT.has(ext) || f.name.startsWith("."))) continue;
      fs.copyFileSync(path.join(from, f.name), path.join(to, f.name));
      if (f.name !== "_context.yaml") { items++; bytes += fs.statSync(path.join(to, f.name)).size; }
    }
  }
  return { contexts, items, bytes };
}

function synthCorpus(N = 20, K = 10) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const words = "alpha beta gamma delta storage graph render layout widget cache index search token latency schema transport".split(" ");
  let bytes = 0;
  for (let i = 0; i < N; i++) {
    const ctx = path.join(tmpRoot, `ctx-${String(i).padStart(3, "0")}`);
    fs.mkdirSync(ctx);
    fs.writeFileSync(path.join(ctx, "_context.yaml"), `title: Context ${i}\ntags: [bench]\nlinks: []\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\nlast_activity: 2026-01-01T00:00:00.000Z\n`);
    for (let k = 0; k < K; k++) {
      const lines = [];
      for (let l = 0; l < 40 + (k * 13) % 200; l++) {
        lines.push(`Line ${l}: ${words[(i + k + l) % words.length]} ${words[(i * k + l) % words.length]} ${words[(l * 7) % words.length]}.`);
      }
      const body = `---\ntitle: Item ${k} of ${i}\ntags: [t${k % 3}]\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n${lines.join("\n")}\n`;
      fs.writeFileSync(path.join(ctx, `item-${String(k).padStart(3, "0")}.md`), body);
      bytes += body.length;
    }
  }
  return { contexts: N, items: N * K, bytes };
}

// Pick targets that exist in whatever corpus we have.
function pickTargets() {
  const contexts = fs.readdirSync(tmpRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  let largest = { ctx: null, item: null, size: -1 };
  let smallest = { ctx: null, item: null, size: Infinity };
  let mostItems = { ctx: null, n: -1 };
  for (const c of contexts) {
    const files = fs.readdirSync(path.join(tmpRoot, c)).filter((f) => f.endsWith(".md") && !f.startsWith("."));
    if (files.length > mostItems.n) mostItems = { ctx: c, n: files.length };
    for (const f of files) {
      const size = fs.statSync(path.join(tmpRoot, c, f)).size;
      const item = f.slice(0, -3);
      if (size > largest.size) largest = { ctx: c, item, size };
      if (size < smallest.size) smallest = { ctx: c, item, size };
    }
  }
  return { contexts, largest, smallest, mostItems };
}

// --- measurement --------------------------------------------------------------

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const res = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, res };
}

function payloadBytes(result) {
  // What goes back over the wire to the host (the JSON-RPC result member).
  return Buffer.byteLength(JSON.stringify(result), "utf8");
}

const rows = [];
function printRow(row) {
  process.stdout.write(
    `${row.label.padEnd(46)} n=${String(row.n).padStart(3)}  p50=${row.p50.toFixed(1).padStart(7)}ms  p95=${row.p95.toFixed(1).padStart(7)}ms  max=${row.max.toFixed(1).padStart(7)}ms  bytes=${String(row.bytes).padStart(7)}  ~tok=${String(row.tokens).padStart(6)}${row.errors ? `  ERR=${row.errors}` : ""}\n`
  );
}

// `fn(i)` may do setup work; only the returned promise from `measure` is timed.
// Simplest form: fn returns the call promise directly (whole thing timed).
async function scenario(label, fn, { reps = REPS, warm = 1 } = {}) {
  for (let i = 0; i < warm; i++) await fn(i, async (p) => p);
  const ms = [], bytes = [];
  let errors = 0;
  for (let i = 0; i < reps; i++) {
    try {
      let inner = null;
      const measure = async (p) => { inner = await timed(() => p); return inner.res; };
      const { ms: outer, res } = await timed(() => fn(i, measure));
      ms.push(inner ? inner.ms : outer);
      bytes.push(payloadBytes(res));
      if (res && res.isError) errors++;
    } catch {
      errors++;
    }
  }
  ms.sort((a, b) => a - b);
  bytes.sort((a, b) => a - b);
  const row = {
    label, n: ms.length, errors,
    p50: pct(ms, 50), p95: pct(ms, 95), max: ms[ms.length - 1] || 0,
    bytes: pct(bytes, 50), tokens: Math.round(pct(bytes, 50) / 4),
  };
  rows.push(row);
  printRow(row);
  return row;
}

// --- main -------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(serverEntry)) throw new Error("dist/index.js missing — run `npm run build` first");
  const corpus = process.env.BENCH_CORPUS ? copyCorpus(process.env.BENCH_CORPUS) : synthCorpus();
  const t = pickTargets();
  console.log("contexts-mcp bench-mcp (stdio, real server, official client)");
  console.log(`  data dir : ${tmpRoot}${process.env.BENCH_CORPUS ? ` (copied from ${process.env.BENCH_CORPUS})` : " (synthetic)"}`);
  console.log(`  corpus   : ${corpus.contexts} contexts, ${corpus.items} items, ${(corpus.bytes / 1024).toFixed(0)} KB of item text`);
  console.log(`  largest  : ${t.largest.ctx}/${t.largest.item} (${t.largest.size} B); most items: ${t.mostItems.ctx} (${t.mostItems.n})`);
  console.log(`  reps     : ${REPS}\n`);

  // Startup: spawn -> initialize -> tools/list. Paid once per Claude Code session.
  const startup = await timed(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: { ...process.env, CONTEXTS_DATA_DIR: tmpRoot },
      stderr: "pipe",
    });
    const client = new Client({ name: "bench-mcp", version: "0.0.0" });
    await client.connect(transport);
    return client;
  });
  const client = startup.res;
  const tools = await timed(() => client.listTools());
  const toolsBytes = payloadBytes(tools.res);
  rows.push({ label: "startup (spawn+initialize)", n: 1, errors: 0, p50: startup.ms, p95: startup.ms, max: startup.ms, bytes: 0, tokens: 0 });
  rows.push({ label: "tools/list", n: 1, errors: 0, p50: tools.ms, p95: tools.ms, max: tools.ms, bytes: toolsBytes, tokens: Math.round(toolsBytes / 4) });
  printRow(rows[0]);
  printRow(rows[1]);
  console.log(`  (${tools.res.tools.length} tools advertised)\n`);

  const call = (name, args) => client.callTool({ name, arguments: args });

  // --- read path (warm, no writes in between) ---
  await scenario("list_contexts", () => call("list_contexts", {}));
  await scenario("list_contexts(metadata, recent_activity)", () => call("list_contexts", { include_metadata: true, sort: "recent_activity" }));
  await scenario(`list_items(${t.mostItems.ctx})`, () => call("list_items", { context: t.mostItems.ctx }));
  await scenario("get_item(smallest)", () => call("get_item", { context: t.smallest.ctx, item: t.smallest.item }));
  await scenario("get_item(largest)", () => call("get_item", { context: t.largest.ctx, item: t.largest.item }));
  await scenario("get_item(largest, raw)", () => call("get_item", { context: t.largest.ctx, item: t.largest.item, raw: true }));
  await scenario("get_item_links(largest)", () => call("get_item_links", { context: t.largest.ctx, item: t.largest.item }));
  await scenario("search_contexts(common word)", () => call("search_contexts", { query: process.env.BENCH_CORPUS ? "the" : "storage" }));
  await scenario("search_contexts(rare word)", () => call("search_contexts", { query: "zzqxv-nomatch" }));
  await scenario("get_graph", () => call("get_graph", {}));
  await scenario("context_diagnose", () => call("context_diagnose", {}));

  // --- write path ---
  const wctx = "bench-writes";
  await call("create_context", { name: wctx });
  await scenario("create_item (small md)", (i) => call("create_item", { context: wctx, item: `note-${i}`, title: `Note ${i}`, content: "hello world\n" }), { warm: 0 });
  await call("create_item", { context: wctx, item: "log", title: "Log", content: "start\n" });
  await scenario("append_to_item (small md)", (i) => call("append_to_item", { context: wctx, item: "log", content: `entry ${i}\n` }));
  await scenario("update_item (small md)", (i) => call("update_item", { context: wctx, item: "log", content: `rewritten ${i}\n` }));
  // The big one: rewriting the largest item means the whole content crosses the wire.
  const big = await call("get_item", { context: t.largest.ctx, item: t.largest.item, raw: true });
  const bigContent = JSON.parse(big.content[0].text).content.replace(/^---[\s\S]*?---\n/, "");
  await scenario("update_item (largest md, full rewrite)", (i) => call("update_item", { context: t.largest.ctx, item: t.largest.item, content: bigContent + `\nedit ${i}\n` }));
  await scenario("update_context_metadata", (i) => call("update_context_metadata", { name: wctx, description: `desc ${i}` }));

  // --- the interactive pattern users actually hit: write, then read ---
  // After any write the graph signature changes, so the next read that touches
  // the graph (get_item's footer, get_item_links, get_graph) pays a rebuild.
  // `measure` times only the read half.
  await scenario("get_item(small) right after a write", async (i, measure) => {
    await call("append_to_item", { context: wctx, item: "log", content: `wr ${i}\n` });
    return measure(call("get_item", { context: wctx, item: "log" }));
  });
  await scenario("get_item_links right after a write", async (i, measure) => {
    await call("append_to_item", { context: wctx, item: "log", content: `wr2 ${i}\n` });
    return measure(call("get_item_links", { context: wctx, item: "log" }));
  }, { reps: 3 });
  await scenario("search_contexts right after a write", async (i, measure) => {
    await call("append_to_item", { context: wctx, item: "log", content: `wr3 ${i}\n` });
    return measure(call("search_contexts", { query: "rewritten" }));
  }, { reps: 3 });
  await scenario("list_contexts(metadata) right after a write", async (i, measure) => {
    await call("append_to_item", { context: wctx, item: "log", content: `wr4 ${i}\n` });
    return measure(call("list_contexts", { include_metadata: true, sort: "recent_activity" }));
  }, { reps: 3 });

  await client.close();

  if (process.env.BENCH_OUT) {
    fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify({ when: new Date().toISOString(), corpus, rows }, null, 2));
    console.log(`\nwrote ${process.env.BENCH_OUT}`);
  }
}

main()
  .catch((err) => { console.error("bench-mcp failed:", err); process.exitCode = 1; })
  .finally(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });
