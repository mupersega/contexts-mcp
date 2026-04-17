#!/usr/bin/env node
// Cross-platform UI launcher. Starts the web server detached if it's not
// already responding on the configured port, then opens the browser.
//
// Mirrors what scripts/contexts-ui.vbs does on Windows, but works anywhere
// Node does — so the Desktop icon flow doesn't have to be Windows-only.

import { spawn } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, MissingDataDirError } from "../dist/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const webEntry = path.join(repoRoot, "dist", "web.js");

function pingPort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, attempts = 20, intervalMs = 200) {
  for (let i = 0; i < attempts; i++) {
    if (await pingPort(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32" ? "cmd" :
    platform === "darwin" ? "open" :
    "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch (err) {
    console.error(`Could not open browser: ${err.message}\nOpen ${url} manually.`);
  }
}

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof MissingDataDirError) {
      console.error("No data dir configured. Run: contexts-mcp-setup (or: npm run setup).");
      process.exit(1);
    }
    throw err;
  }

  const port = cfg.uiPort;
  const url = `http://localhost:${port}`;

  const running = await pingPort(port);
  if (!running) {
    const child = spawn(process.execPath, [webEntry], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    const up = await waitForPort(port);
    if (!up) {
      console.error(`UI did not come up on :${port} within a few seconds.`);
      process.exit(1);
    }
  }

  openBrowser(url);
}

main().catch((err) => {
  console.error("Launcher failed:", err);
  process.exit(1);
});
