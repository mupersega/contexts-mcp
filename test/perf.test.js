// test/perf.test.js — performance budgets at the protocol boundary.
//
// These are regression guards, not benchmarks: the budgets are several times
// the measured values so they only trip on real regressions (a synchronous
// graph rebuild sneaking back onto the read path, an unbounded search payload,
// pretty-printed listings). scripts/bench-mcp.js is the tool for numbers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { freshDataDir, removeDir, distDir } from "./helpers.js";

const dataDir = freshDataDir("perf");
const N_CONTEXTS = 20;
const N_ITEMS = 10;

function synth() {
  const words = "alpha beta gamma delta storage graph render layout widget cache index search token latency".split(" ");
  for (let i = 0; i < N_CONTEXTS; i++) {
    const ctx = path.join(dataDir, `ctx-${String(i).padStart(3, "0")}`);
    fs.mkdirSync(ctx);
    for (let k = 0; k < N_ITEMS; k++) {
      const lines = [];
      for (let l = 0; l < 60 + (k * 13) % 200; l++) {
        lines.push(`Line ${l}: ${words[(i + k + l) % words.length]} ${words[(i * k + l) % words.length]} ${words[(l * 7) % words.length]}.`);
      }
      fs.writeFileSync(
        path.join(ctx, `item-${String(k).padStart(3, "0")}.md`),
        `---\ntitle: Item ${k} of ${i}\ntags: [t${k % 3}]\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n${lines.join("\n")}\n`
      );
    }
  }
}

const ms = async (fn) => {
  const t0 = process.hrtime.bigint();
  const res = await fn();
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, res };
};
const bytes = (res) => Buffer.byteLength(JSON.stringify(res));
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let client;
before(async () => {
  synth();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(distDir, "index.js")],
    env: { ...process.env, CONTEXTS_DATA_DIR: dataDir },
    stderr: "pipe",
  });
  client = new Client({ name: "perf", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  await client.callTool({ name: "create_context", arguments: { name: "w" } });
  await client.callTool({ name: "create_item", arguments: { context: "w", item: "log", content: "start" } });
  // warm the graph once so the budgets measure steady state, not the cold build
  await client.callTool({ name: "get_item", arguments: { context: "w", item: "log" } });
});
after(async () => {
  await client?.close();
  removeDir(dataDir);
});

const call = (name, args) => client.callTool({ name, arguments: args });

test("budget: get_item right after a write does not pay a graph rebuild", async () => {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await call("append_to_item", { context: "w", item: "log", content: `entry ${i}` });
    samples.push((await ms(() => call("get_item", { context: "w", item: "log" }))).ms);
  }
  const p50 = median(samples);
  assert.ok(p50 < 60, `get_item after write p50=${p50.toFixed(1)}ms (budget 60ms; a sync rebuild is ~250ms+)`);
});

test("budget: search latency and payload are bounded", async () => {
  const samples = [];
  let res;
  for (let i = 0; i < 5; i++) {
    const r = await ms(() => call("search_contexts", { query: "storage" }));
    samples.push(r.ms);
    res = r.res;
  }
  const p50 = median(samples);
  assert.ok(p50 < 80, `search p50=${p50.toFixed(1)}ms (budget 80ms)`);
  const b = bytes(res);
  assert.ok(b < 12_000, `search payload ${b} bytes for a query matching every item (budget 12 KB)`);
});

test("budget: listings stay small", async () => {
  const items = await call("list_items", { context: "ctx-000" });
  assert.ok(bytes(items) < 1_500, `list_items(10 items) = ${bytes(items)} bytes`);
  const ctxs = await call("list_contexts", { include_metadata: true });
  assert.ok(bytes(ctxs) < 3_000, `list_contexts(metadata, 21 contexts) = ${bytes(ctxs)} bytes`);
});

test("budget: reads and writes are single-digit milliseconds at p50", async () => {
  const reads = [];
  for (let i = 0; i < 10; i++) reads.push((await ms(() => call("get_item", { context: "ctx-003", item: "item-004" }))).ms);
  const writes = [];
  for (let i = 0; i < 10; i++) writes.push((await ms(() => call("append_to_item", { context: "w", item: "log", content: `w${i}` }))).ms);
  assert.ok(median(reads) < 25, `get_item p50=${median(reads).toFixed(1)}ms`);
  assert.ok(median(writes) < 25, `append p50=${median(writes).toFixed(1)}ms`);
});
