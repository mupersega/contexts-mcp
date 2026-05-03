#!/usr/bin/env node
import fs from "fs";
import path from "path";
import readline from "readline";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_UI_PORT,
  configPath,
  defaultDataDir,
  packageVersion,
  writeConfig,
} from "./config.js";

interface RawConfig {
  dataDir?: string;
  uiPort?: number;
}

// Read current config without going through loadConfig() — loadConfig throws
// if neither env nor file is set, but setup needs to inspect partial state.
function readRawConfig(): RawConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return {
      dataDir: typeof parsed.dataDir === "string" ? parsed.dataDir : undefined,
      uiPort: typeof parsed.uiPort === "number" ? parsed.uiPort : undefined,
    };
  } catch {
    return {};
  }
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

function printIntro(existing: RawConfig, envDataDir: string | undefined): void {
  console.log("");
  console.log(`contexts-mcp setup  (v${packageVersion()})`);
  console.log("");
  console.log(`Config file: ${configPath()}`);
  if (existing.dataDir || existing.uiPort !== undefined) {
    console.log("");
    console.log("Current config:");
    if (existing.dataDir) console.log(`  dataDir: ${existing.dataDir}`);
    if (existing.uiPort !== undefined) console.log(`  uiPort:  ${existing.uiPort}`);
  }
  if (envDataDir) {
    console.log("");
    console.log(`Note: CONTEXTS_DATA_DIR is set in this environment (${envDataDir}).`);
    console.log("      Env var wins at runtime — the config file is only used when it's unset.");
  }
  console.log("");
}

async function promptDataDir(rl: readline.Interface, existing: RawConfig): Promise<string> {
  const suggested = existing.dataDir || defaultDataDir();
  const answer = (await prompt(rl, `Data directory [${suggested}]: `)).trim();
  return path.resolve(answer || suggested);
}

async function promptPort(rl: readline.Interface, existing: RawConfig): Promise<number> {
  const suggested = existing.uiPort !== undefined ? existing.uiPort : DEFAULT_UI_PORT;
  const answer = (await prompt(rl, `UI port [${suggested}]: `)).trim();
  const parsed = answer ? parseInt(answer, 10) : suggested;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`Invalid port: ${answer}`);
    process.exit(1);
  }
  return parsed;
}

function printOutcome(written: { dataDir: string; uiPort: number }): void {
  console.log("");
  console.log("Wrote config:");
  console.log(`  ${configPath()}`);
  console.log("");
  console.log(`  dataDir: ${written.dataDir}`);
  console.log(`  uiPort:  ${written.uiPort}`);
  console.log(`  schema:  v${CONFIG_SCHEMA_VERSION}`);
  console.log("");
}

// Platform-specific: offer to (re)install the Windows Desktop shortcut.
// This makes `npm run setup` the single command that rewires everything
// after a repo move, instead of a separate install.ps1 step.
async function maybeInstallShortcut(rl: readline.Interface): Promise<void> {
  if (process.platform !== "win32") {
    console.log("Launch the UI any time with:  npx contexts-mcp-ui");
    console.log("");
    return;
  }
  const answer = (
    await prompt(rl, "Install Desktop shortcut 'Contexts.lnk' (overwrites if it exists)? [Y/n] ")
  ).trim().toLowerCase();
  if (answer !== "" && !answer.startsWith("y")) return;

  const installPs1 = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "install.ps1",
  );
  if (!fs.existsSync(installPs1)) {
    console.error(`Shortcut installer not found at ${installPs1}`);
    console.log("");
    return;
  }
  const result = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", installPs1, "-SkipSetup"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error("Shortcut install returned non-zero — skipping.");
  }
  console.log("");
}

function printNextSteps(uiPort: number): void {
  console.log("Next steps:");
  console.log("  1. Register the MCP server with Claude Code:");
  console.log(`       claude mcp add contexts-mcp -- node ${repoEntry()}`);
  console.log("  2. Start the web UI (optional):");
  console.log("       npm run ui     # then open http://localhost:" + uiPort);
  console.log("");
  console.log("Re-run this any time with:  npm run setup");
  console.log("");
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const existing = readRawConfig();
    printIntro(existing, process.env.CONTEXTS_DATA_DIR?.trim());

    const dataDir = await promptDataDir(rl, existing);
    const uiPort = await promptPort(rl, existing);

    fs.mkdirSync(dataDir, { recursive: true });
    const written = writeConfig({ dataDir, uiPort });

    printOutcome(written);
    await maybeInstallShortcut(rl);
    printNextSteps(written.uiPort);
  } finally {
    rl.close();
  }
}

function repoEntry(): string {
  // dist/setup.js → dist/index.js in the same folder.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "index.js");
  } catch {
    return "dist/index.js";
  }
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
