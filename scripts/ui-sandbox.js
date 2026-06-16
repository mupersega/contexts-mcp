// ui-sandbox.js — launch a DISPOSABLE contexts web UI for autonomous walkthroughs.
//
// Spins up dist/web.js against a throwaway temp dataDir on a free ephemeral port,
// seeded with a fixture that exercises the real surface (multiple item kinds, an
// archived context, a search target, metadata + links). Prints one machine-readable
// line `SANDBOX_READY {json}` once the server is serving, then stays alive until
// killed (SIGINT/SIGTERM), at which point it tears the child + temp dir down.
//
// This is the safe instance the roaming/dogfood agents drive — it can be trashed
// freely without touching the user's real contexts.
//
//   node scripts/ui-sandbox.js            # seed fixtures, run until Ctrl-C
//   KEEP=1 node scripts/ui-sandbox.js     # leave temp dataDir on exit (for inspection)

import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const webEntry = path.join(repoRoot, "dist", "web.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// --- Fixture: written as plain files, exactly how storage reads them back. ---
function seed(dataDir) {
  const write = (rel, body) => {
    const full = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, "utf-8");
  };

  // A rich, in-progress context: md w/ frontmatter, a plain txt, full metadata.
  write(
    "alpha-notes/_context.yaml",
    [
      "title: Alpha Notes",
      "description: Primary working context for the walkthrough.",
      "status: in-progress",
      "tags:",
      "  - demo",
      "  - walk",
      "links:",
      "  - label: Project home",
      "    url: https://example.com/alpha",
      "",
    ].join("\n"),
  );
  write(
    "alpha-notes/readme.md",
    ["---", "title: Read Me First", "tags: [intro, guide]", "---", "", "# Alpha", "", "Some **markdown** with a [link](https://example.com).", ""].join("\n"),
  );
  write("alpha-notes/scratch.txt", "plain text item, no frontmatter, nothing fancy\n");

  // A bare context (no _context.yaml) holding the structured kinds.
  write("data-bits/config.json", JSON.stringify({ enabled: true, retries: 3, name: "demo" }, null, 2) + "\n");
  write("data-bits/rows.csv", "id,name,score\n1,alpha,90\n2,beta,75\n");
  write("data-bits/settings.yaml", ["mode: fast", "limit: 10", "flags:", "  - a", "  - b", ""].join("\n"));

  // An archived context — must be hidden from the default list, shown when opted in.
  write("archived-thing/_context.yaml", ["title: Old Archived Thing", "status: archived", "tags: [old]", ""].join("\n"));
  write("archived-thing/old.md", ["---", "title: Stale", "---", "", "Archived content.", ""].join("\n"));

  // A search target with a distinctive token, for exercising full-text search.
  write("query-target/_context.yaml", ["title: Query Target", "status: active", "tags: [search]", ""].join("\n"));
  write("query-target/findme.md", ["---", "title: Find Me", "---", "", "The magic token is ZEBRAFISH and it appears exactly once.", ""].join("\n"));
}

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "contexts-ui-sandbox-"));
  seed(dataDir);

  const child = spawn(process.execPath, [webEntry], {
    env: { ...process.env, CONTEXTS_DATA_DIR: dataDir, CONTEXTS_UI_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let announced = false;
  const url = `http://localhost:${port}`;
  const announce = () => {
    if (announced) return;
    announced = true;
    process.stdout.write(`SANDBOX_READY ${JSON.stringify({ url, dataDir, pid: child.pid, port })}\n`);
  };

  child.stdout.on("data", (b) => {
    const s = b.toString();
    process.stderr.write(`[ui] ${s}`);
    if (s.includes("Contexts UI running")) announce();
  });
  child.stderr.on("data", (b) => process.stderr.write(`[ui:err] ${b}`));

  // Fallback: the ready line is on stdout, but announce on a timer too in case
  // buffering hides it — the server is listening well before this fires.
  setTimeout(announce, 2500);

  let cleaning = false;
  const cleanup = (code) => {
    if (cleaning) return;
    cleaning = true;
    try { child.kill(); } catch {}
    if (!process.env.KEEP) {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
    } else {
      process.stderr.write(`[sandbox] kept dataDir: ${dataDir}\n`);
    }
    process.exit(code ?? 0);
  };

  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
  child.on("exit", (code) => cleanup(code ?? 0));
}

main().catch((err) => {
  process.stderr.write(`[sandbox] failed: ${err?.stack || err}\n`);
  process.exit(1);
});
