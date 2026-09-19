#!/usr/bin/env node
// Usage: N=100 K=20 node scripts/scale.js   (FULL=1 also times the exact full rebuild)
// Generates N contexts x K items of synthetic text in a temp data dir and times
// the paths that scale with corpus size: corpus read, graph build (cold and
// incremental), steady-state reads, search. Deletes the temp dir afterwards.
// scripts/scale.js — scale probe: cold build, incremental rebuild after one edit, search.
import fs from "fs";
import path from "path";
import os from "os";

const N = parseInt(process.env.N || "100", 10);
const K = parseInt(process.env.K || "20", 10);
const dir = path.join(os.tmpdir(), `contexts-scale-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });
process.env.CONTEXTS_DATA_DIR = dir;

const vocab = [];
for (let i = 0; i < 3000; i++) vocab.push("w" + i.toString(36) + "x".repeat(i % 5));
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let bytes = 0;
for (let i = 0; i < N; i++) {
  const c = path.join(dir, `ctx-${String(i).padStart(4, "0")}`);
  fs.mkdirSync(c);
  fs.writeFileSync(path.join(c, "_context.yaml"), `title: Context ${i}\ndescription: A longer description of context ${i}.\ntags: [a, b]\nlinks: []\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\nlast_activity: 2026-01-01T00:00:00.000Z\n`);
  for (let k = 0; k < K; k++) {
    const words = [];
    const len = 400 + Math.floor(rnd() * 1600);
    for (let w = 0; w < len; w++) words.push(vocab[Math.floor(rnd() * rnd() * vocab.length)]);
    const body = `---\ntitle: Item ${k} of ${i}\ntags: [t${k % 5}]\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n` + words.join(" ").replace(/(.{80,100}) /g, "$1\n") + "\n";
    fs.writeFileSync(path.join(c, `item-${String(k).padStart(3, "0")}.md`), body);
    bytes += body.length;
  }
}
console.log(`corpus: ${N} x ${K} = ${N * K} items, ${(bytes / 1048576).toFixed(1)} MB`);

const storage = await import("../dist/storage.js");
const graph = await import("../dist/graph.js");
const search = await import("../dist/search.js");
const t = () => Number(process.hrtime.bigint()) / 1e6;
const time = async (label, fn) => { const a = t(); const r = await fn(); console.log(`${label.padEnd(44)} ${(t() - a).toFixed(0).padStart(7)} ms`); return r; };

await time("corpusSignature", () => storage.corpusSignature());
await time("listContexts(metadata) cold", () => storage.listContexts({ includeMetadata: true, sort: "recent_activity" }));
await time("listContexts(metadata) warm", () => storage.listContexts({ includeMetadata: true, sort: "recent_activity" }));
await time("getCorpus cold (read + parse all)", () => storage.getCorpus());
await time("getCorpus warm (stats only)", () => storage.getCorpus());
const s1 = await time("rebuildGraph(auto) cold (index everything)", () => graph.rebuildGraph("auto"));
console.log(`   -> ${s1.nodes} nodes, ${s1.edges} edges, reindexed ${s1.reindexed}, rescored ${s1.rescored}, pass ${s1.pass}`);
await storage.appendToItem("ctx-0000", "item-000", "an edit " + vocab[5]);
const s2 = await time("rebuildGraph(auto) after one edit", () => graph.rebuildGraph("auto"));
console.log(`   -> reindexed ${s2.reindexed}, rescored ${s2.rescored}, pass ${s2.pass}`);
await time("getGraph() steady state", () => graph.getGraph());
await time("search (common token) cold", () => search.searchContexts(dir, "w1", {}));
await time("search (common token) warm", () => search.searchContexts(dir, "w1", {}));
await time("search (no match) warm", () => search.searchContexts(dir, "zzzz-nope", {}));
console.log(`rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
const idx = fs.statSync(path.join(dir, ".graph-index.json")).size, gc = fs.statSync(path.join(dir, ".graph-cache.json")).size;
console.log(`disk: .graph-index.json ${(idx / 1048576).toFixed(1)} MB, .graph-cache.json ${(gc / 1024).toFixed(0)} KB`);
if (process.env.FULL) {
  const s3 = await time("rebuildGraph(full) exact O(n^2)", () => graph.rebuildGraph("full"));
  console.log(`   -> ${s3.edges} edges (exact)`);
}
fs.rmSync(dir, { recursive: true, force: true });
