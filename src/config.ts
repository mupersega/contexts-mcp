import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

// Shared runtime config. One source of truth that the MCP server, the web UI,
// and the interactive setup CLI all read from — so the launcher shortcut and
// the .mcp.json-launched server can't disagree about which data dir they're
// pointing at.

export interface ContextsConfig {
  dataDir: string;
  uiPort: number;
  version: string;
}

export interface ResolvedConfig extends ContextsConfig {
  configPath: string;
  source: {
    dataDir: "env" | "config";
    uiPort: "env" | "config" | "default";
  };
}

export const CONFIG_SCHEMA_VERSION = "1";
export const DEFAULT_UI_PORT = 3141;

export class MissingDataDirError extends Error {
  constructor() {
    super(
      "No data dir configured.\n" +
        "\n" +
        "  Run: npm run setup   (or: contexts-mcp setup)\n" +
        "\n" +
        "Or set CONTEXTS_DATA_DIR in the environment (e.g. the 'env' block of .mcp.json).",
    );
    this.name = "MissingDataDirError";
  }
}

export function configPath(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "contexts-mcp", "config.json");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "contexts-mcp", "config.json");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "contexts-mcp", "config.json");
}

export function defaultDataDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "contexts-mcp", "data");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "contexts-mcp", "data");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "contexts-mcp");
}

function readConfigFile(): Partial<ContextsConfig> | null {
  const p = configPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ContextsConfig>;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

let _cached: ResolvedConfig | null = null;

export function loadConfig(): ResolvedConfig {
  if (_cached) return _cached;

  const cfg = readConfigFile();
  const envData = process.env.CONTEXTS_DATA_DIR?.trim() || "";
  const envPort = process.env.CONTEXTS_UI_PORT?.trim() || "";

  let dataDir = "";
  let dataDirSource: "env" | "config" = "config";
  if (envData) {
    dataDir = path.resolve(envData);
    dataDirSource = "env";
  } else if (cfg && typeof cfg.dataDir === "string" && cfg.dataDir.trim().length > 0) {
    dataDir = path.resolve(cfg.dataDir);
    dataDirSource = "config";
  } else {
    throw new MissingDataDirError();
  }

  let uiPort = DEFAULT_UI_PORT;
  let uiPortSource: "env" | "config" | "default" = "default";
  if (envPort) {
    const n = parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0) {
      uiPort = n;
      uiPortSource = "env";
    }
  } else if (cfg && typeof cfg.uiPort === "number" && cfg.uiPort > 0) {
    uiPort = cfg.uiPort;
    uiPortSource = "config";
  }

  _cached = {
    dataDir,
    uiPort,
    version: CONFIG_SCHEMA_VERSION,
    configPath: configPath(),
    source: { dataDir: dataDirSource, uiPort: uiPortSource },
  };
  return _cached;
}

export function writeConfig(patch: Partial<ContextsConfig>): ContextsConfig {
  const existing = readConfigFile() || {};
  const merged: ContextsConfig = {
    dataDir: patch.dataDir ?? (typeof existing.dataDir === "string" ? existing.dataDir : ""),
    uiPort: patch.uiPort ?? (typeof existing.uiPort === "number" ? existing.uiPort : DEFAULT_UI_PORT),
    version: CONFIG_SCHEMA_VERSION,
  };
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  _cached = null;
  return merged;
}

export function resetConfigCache(): void {
  _cached = null;
}

export function packageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/config.js → dist/ → repo root
    const pkg = path.resolve(here, "..", "package.json");
    const raw = fs.readFileSync(pkg, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "unknown";
  } catch {
    return "unknown";
  }
}
