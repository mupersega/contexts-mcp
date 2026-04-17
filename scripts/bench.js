#!/usr/bin/env node
// scripts/bench.js — write-path throughput smoke test.
//
// Creates a throwaway data dir next to the repo, spawns N contexts × K items
// with the storage module's normal code path, and prints p50/p95/p99 for the
// operations that matter for interactive feel: createContext, createItem,
// updateContextMetadata, and list_contexts(include_metadata=true).
//
// Usage: node scripts/bench.js
// Override via env: BENCH_N=50 BENCH_K=20 node scripts/bench.js

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tmpRoot = path.join(os.tmpdir(), `contexts-mcp-bench-${process.pid}-${Date.now()}`);

process.env.CONTEXTS_DATA_DIR = tmpRoot;
process.env.CONTEXTS_UI_PORT = "0"; // unused, but keep loadConfig happy if it ever reads

const storage = await import(pathToFileURL(path.join(repoRoot, "dist", "storage.js")).href);

const N = parseInt(process.env.BENCH_N || "20", 10);
const K = parseInt(process.env.BENCH_K || "10", 10);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function time(fn) {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function report(label, samples) {
  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const total = samples.reduce((s, v) => s + v, 0);
  console.log(
    `${label.padEnd(32)} n=${String(samples.length).padStart(4)}   p50=${p50.toFixed(2).padStart(7)}ms   p95=${p95.toFixed(2).padStart(7)}ms   p99=${p99.toFixed(2).padStart(7)}ms   total=${total.toFixed(1)}ms`,
  );
}

async function run() {
  console.log(`contexts-mcp bench`);
  console.log(`  data dir: ${tmpRoot}`);
  console.log(`  N=${N} contexts × K=${K} items per context (${N * K} items total)`);
  console.log("");

  await storage.ensureDataDir();

  const createContextSamples = [];
  const createItemSamples = [];
  const updateMetaSamples = [];

  for (let i = 0; i < N; i++) {
    const name = `bench-${String(i).padStart(4, "0")}`;
    createContextSamples.push(await time(() => storage.createContext(name)));

    for (let k = 0; k < K; k++) {
      const base = `item-${String(k).padStart(3, "0")}`;
      const content = `# ${base}\n\nSome body content line 1.\nSome body content line 2.\n`;
      createItemSamples.push(
        await time(() => storage.createItem(name, base, "md", { title: base, content }))
      );
    }

    updateMetaSamples.push(
      await time(() =>
        storage.updateContextMetadata(name, {
          title: `Bench ${i}`,
          description: "benchmark context",
          status: i % 7 === 0 ? "archived" : "active",
          tags: ["bench"],
        })
      )
    );
  }

  const listSamples = [];
  for (let t = 0; t < 5; t++) {
    listSamples.push(await time(() => storage.listContexts({ includeMetadata: true })));
  }
  const listRecentSamples = [];
  for (let t = 0; t < 5; t++) {
    listRecentSamples.push(
      await time(() =>
        storage.listContexts({ includeMetadata: true, sort: "recent_activity" })
      )
    );
  }
  const diagSamples = [];
  for (let t = 0; t < 3; t++) {
    diagSamples.push(await time(() => storage.getDiagnostics()));
  }

  console.log("");
  report("createContext",                 createContextSamples);
  report("createItem (md)",               createItemSamples);
  report("updateContextMetadata",         updateMetaSamples);
  report("list_contexts(metadata)",       listSamples);
  report("list_contexts(recent_activity)", listRecentSamples);
  report("getDiagnostics",                diagSamples);
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
    console.error("bench failed:", err);
    process.exit(1);
  });
