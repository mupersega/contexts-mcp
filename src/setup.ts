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

// Read current config without going through loadConfig() — loadConfig throws
// if neither env nor file is set, but setup needs to inspect partial state.
function readRawConfig(): { dataDir?: string; uiPort?: number } {
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

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const existing = readRawConfig();
    const envDataDir = process.env.CONTEXTS_DATA_DIR?.trim();

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

    // Data dir
    const suggestedDataDir = existing.dataDir || defaultDataDir();
    const dataDirAnswer = (
      await prompt(rl, `Data directory [${suggestedDataDir}]: `)
    ).trim();
    const dataDir = path.resolve(dataDirAnswer || suggestedDataDir);

    // UI port
    const suggestedPort =
      existing.uiPort !== undefined ? existing.uiPort : DEFAULT_UI_PORT;
    const portAnswer = (await prompt(rl, `UI port [${suggestedPort}]: `)).trim();
    const parsedPort = portAnswer ? parseInt(portAnswer, 10) : suggestedPort;
    if (!Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      console.error(`Invalid port: ${portAnswer}`);
      process.exit(1);
    }

    fs.mkdirSync(dataDir, { recursive: true });
    const written = writeConfig({ dataDir, uiPort: parsedPort });

    console.log("");
    console.log("Wrote config:");
    console.log(`  ${configPath()}`);
    console.log("");
    console.log(`  dataDir: ${written.dataDir}`);
    console.log(`  uiPort:  ${written.uiPort}`);
    console.log(`  schema:  v${CONFIG_SCHEMA_VERSION}`);
    console.log("");

    // Platform-specific: offer to (re)install the Windows Desktop shortcut.
    // This makes `npm run setup` the single command that rewires everything
    // after a repo move, instead of a separate install.ps1 step.
    if (process.platform === "win32") {
      const shortcutAnswer = (
        await prompt(rl, "Install Desktop shortcut 'Contexts.lnk' (overwrites if it exists)? [Y/n] ")
      ).trim().toLowerCase();
      if (shortcutAnswer === "" || shortcutAnswer.startsWith("y")) {
        const installPs1 = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
          "scripts",
          "install.ps1",
        );
        if (fs.existsSync(installPs1)) {
          const result = spawnSync(
            "powershell",
            ["-ExecutionPolicy", "Bypass", "-File", installPs1, "-SkipSetup"],
            { stdio: "inherit" },
          );
          if (result.status !== 0) {
            console.error("Shortcut install returned non-zero — skipping.");
          }
        } else {
          console.error(`Shortcut installer not found at ${installPs1}`);
        }
        console.log("");
      }
    } else {
      console.log("Launch the UI any time with:  npx contexts-mcp-ui");
      console.log("");
    }

    console.log("Next steps:");
    console.log("  1. Register the MCP server with Claude Code:");
    console.log(`       claude mcp add contexts-mcp -- node ${repoEntry()}`);
    console.log("  2. Start the web UI (optional):");
    console.log("       npm run ui     # then open http://localhost:" + written.uiPort);
    console.log("");
    console.log("Re-run this any time with:  npm run setup");
    console.log("");
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
