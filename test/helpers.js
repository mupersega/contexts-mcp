// test/helpers.js — shared setup for the node:test suite.
//
// Every test file gets its own throwaway data dir (set via CONTEXTS_DATA_DIR
// before dist/ is imported, because config caches the resolved dir on first
// load). Nothing here touches the user's real data dir.

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");
export const distDir = path.join(repoRoot, "dist");

export function freshDataDir(tag) {
  const dir = path.join(os.tmpdir(), `contexts-mcp-test-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.CONTEXTS_DATA_DIR = dir;
  return dir;
}

export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// Import a compiled module from dist/ (tests run against the build, like users do).
export async function loadDist(name) {
  return import(pathToFileURL(path.join(distDir, name)).href);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
