import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import yaml from "js-yaml";
import { loadConfig, packageVersion } from "./config.js";
import {
  CONTEXT_META_FILENAME,
  CONTEXT_NAME_REGEX,
  ContextLink,
  ContextMetadata,
  ContextSummary,
  ITEM_EXTENSIONS,
  ITEM_NAME_REGEX,
  Item,
  ItemExtension,
  ItemFrontmatter,
  ItemInfo,
} from "./types.js";

// Lazy + memoized — avoids throwing MissingDataDirError at module load time so
// unit tests and the setup CLI can import storage without a config present.
let _cachedDataDir: string | null = null;
function dataDir(): string {
  if (_cachedDataDir) return _cachedDataDir;
  _cachedDataDir = loadConfig().dataDir;
  return _cachedDataDir;
}

export function getDataDir(): string {
  return dataDir();
}

// Test / setup CLI hook — storage queries loadConfig() once, so if the config
// file is rewritten after startup we need a way to bust the cache.
export function resetDataDirCache(): void {
  _cachedDataDir = null;
}

export const VERSION_STAMP_FILENAME = ".contexts-mcp-version";

// --- Atomic write ---

// tmp+rename guards against partial writes corrupting _context.yaml or an item
// file if the process is killed mid-write. On POSIX rename is atomic; on NTFS
// it's atomic within the same volume, which is the case here since tmp sits
// next to the target.
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// --- Path safety ---

// Reject any resolved path that escapes the base via `..`, absolute roots, or
// sibling-directory prefix matches (e.g. contexts-data-evil next to contexts-data).
function assertWithin(base: string, resolved: string, label: string): void {
  const rel = path.relative(base, resolved);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`Invalid ${label}: path traversal detected`);
  }
}

function resolveContextPath(contextName: string): string {
  const baseResolved = path.resolve(dataDir());
  const resolved = path.resolve(baseResolved, contextName);
  assertWithin(baseResolved, resolved, "context name");
  return resolved;
}

function resolveItemPath(
  contextName: string,
  base: string,
  ext: ItemExtension
): string {
  const contextDir = resolveContextPath(contextName);
  const resolved = path.resolve(contextDir, `${base}.${ext}`);
  assertWithin(contextDir, resolved, "item name");
  return resolved;
}

// Sibling dotfile holding the previous version of an item. Dotfile prefix means
// splitItemFilename() (and therefore listings, search, the UI, and zip export)
// excludes it automatically — no extra filtering needed.
function backupPathFor(itemPath: string): string {
  const dir = path.dirname(itemPath);
  const filename = path.basename(itemPath);
  return path.resolve(dir, `.${filename}.bak`);
}

// Atomically rotate the current item file into its backup slot, overwriting any
// prior backup. fs.rename is atomic on POSIX and on NTFS within a volume; we
// always rename within the same context dir, so this is safe on both.
// No-op if the source file does not exist (caller may be writing a new file).
async function snapshotItem(itemPath: string): Promise<void> {
  const backupPath = backupPathFor(itemPath);
  try {
    await fs.rename(itemPath, backupPath);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw err;
  }
}

function resolveContextMetaPath(contextName: string): string {
  const contextDir = resolveContextPath(contextName);
  const resolved = path.resolve(contextDir, CONTEXT_META_FILENAME);
  assertWithin(contextDir, resolved, "context metadata path");
  return resolved;
}

// --- Extension helpers ---

function isSupportedExtension(ext: string): ext is ItemExtension {
  return (ITEM_EXTENSIONS as readonly string[]).includes(ext);
}

interface ParsedItemFilename {
  base: string;
  ext: ItemExtension;
}

// Returns null for unsupported files and for the reserved _context.yaml.
function splitItemFilename(filename: string): ParsedItemFilename | null {
  if (filename === CONTEXT_META_FILENAME) return null;
  if (filename === VERSION_STAMP_FILENAME) return null;
  if (filename.startsWith(".")) return null;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const base = filename.slice(0, dotIdx);
  const ext = filename.slice(dotIdx + 1);
  if (!isSupportedExtension(ext)) return null;
  if (!ITEM_NAME_REGEX.test(base)) return null;
  return { base, ext };
}

export function contentTypeFor(ext: ItemExtension): string {
  switch (ext) {
    case "md":
      return "text/markdown; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "yaml":
    case "yml":
      return "application/yaml; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "sql":
      return "application/sql; charset=utf-8";
    case "txt":
    default:
      return "text/plain; charset=utf-8";
  }
}

// --- Init ---

export async function ensureDataDir(): Promise<void> {
  const dd = dataDir();
  await fs.mkdir(dd, { recursive: true });

  // Stamp the data dir with the server version on first write. Future versions
  // can read this to decide whether to migrate or refuse to start. Today we
  // just ensure the stamp exists — no migration logic yet.
  const stampPath = path.join(dd, VERSION_STAMP_FILENAME);
  try {
    const existing = await fs.readFile(stampPath, "utf-8");
    if (!existing.trim()) {
      await writeFileAtomic(stampPath, `${packageVersion()}\n`);
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      await writeFileAtomic(stampPath, `${packageVersion()}\n`);
    } else {
      throw err;
    }
  }
}

// --- Context metadata ---

function defaultContextMetadata(): ContextMetadata {
  return {
    tags: [],
    links: [],
    created: "",
    updated: "",
  };
}

function normalizeContextMetadata(raw: unknown): ContextMetadata {
  const meta = defaultContextMetadata();
  if (!raw || typeof raw !== "object") return meta;
  const r = raw as Record<string, unknown>;

  if (typeof r.title === "string") meta.title = r.title;
  if (typeof r.description === "string") meta.description = r.description;
  if (typeof r.status === "string") meta.status = r.status;
  if (Array.isArray(r.tags)) {
    meta.tags = r.tags.filter((t): t is string => typeof t === "string");
  }
  if (Array.isArray(r.links)) {
    meta.links = r.links
      .filter(
        (l): l is ContextLink =>
          !!l &&
          typeof l === "object" &&
          typeof (l as ContextLink).label === "string" &&
          typeof (l as ContextLink).url === "string"
      )
      .map((l) => ({ label: l.label, url: l.url }));
  }
  if (typeof r.created === "string") meta.created = r.created;
  if (typeof r.updated === "string") meta.updated = r.updated;
  if (typeof r.last_activity === "string") meta.last_activity = r.last_activity;

  return meta;
}

export async function getContextMetadata(name: string): Promise<ContextMetadata> {
  const metaPath = resolveContextMetaPath(name);
  let raw: string;
  try {
    raw = await fs.readFile(metaPath, "utf-8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return defaultContextMetadata();
    }
    throw err;
  }
  const parsed = yaml.load(raw);
  return normalizeContextMetadata(parsed);
}

async function writeContextMetadata(
  name: string,
  meta: ContextMetadata
): Promise<void> {
  const metaPath = resolveContextMetaPath(name);
  await fs.access(resolveContextPath(name)).catch(() => {
    throw new Error(`Context '${name}' not found`);
  });

  const ordered: Record<string, unknown> = {};
  if (meta.title !== undefined) ordered.title = meta.title;
  if (meta.description !== undefined) ordered.description = meta.description;
  if (meta.status !== undefined) ordered.status = meta.status;
  ordered.tags = meta.tags;
  ordered.links = meta.links;
  if (meta.created) ordered.created = meta.created;
  if (meta.updated) ordered.updated = meta.updated;
  if (meta.last_activity) ordered.last_activity = meta.last_activity;

  const out = yaml.dump(ordered, { sortKeys: false, lineWidth: 100, noRefs: true });
  await writeFileAtomic(metaPath, out);
}

export async function updateContextMetadata(
  name: string,
  patch: Partial<Omit<ContextMetadata, "created" | "updated" | "last_activity">>
): Promise<ContextMetadata> {
  const existing = await getContextMetadata(name);
  const now = new Date().toISOString();

  const merged: ContextMetadata = {
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.links !== undefined ? { links: patch.links } : {}),
    created: existing.created || now,
    updated: now,
    last_activity: now,
  };

  await writeContextMetadata(name, merged);
  return merged;
}

// Bump last_activity on any item mutation. Idempotent against missing
// _context.yaml — creates a minimal metadata file on first touch.
async function touchContext(name: string): Promise<void> {
  const existing = await getContextMetadata(name);
  const now = new Date().toISOString();
  const merged: ContextMetadata = {
    ...existing,
    created: existing.created || now,
    updated: existing.updated || now,
    last_activity: now,
  };
  await writeContextMetadata(name, merged);
}

// --- Context operations ---

export interface ListContextsOptions {
  includeMetadata?: boolean;
  sort?: "name" | "recent_activity" | "created" | "updated";
  includeArchived?: boolean;
}

function isArchived(meta: ContextMetadata | undefined): boolean {
  return !!meta && meta.status === "archived";
}

function sortSummaries(
  summaries: ContextSummary[],
  sort: NonNullable<ListContextsOptions["sort"]>
): void {
  if (sort === "name") {
    summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return;
  }
  // For time-based sorts, most-recent-first. Missing values sink.
  const key: keyof ContextMetadata =
    sort === "recent_activity" ? "last_activity" : sort;
  summaries.sort((a, b) => {
    const av = (a.metadata?.[key] as string | undefined) || "";
    const bv = (b.metadata?.[key] as string | undefined) || "";
    if (av === bv) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av < bv ? 1 : -1;
  });
}

export async function listContexts(
  opts: ListContextsOptions | boolean = {}
): Promise<ContextSummary[]> {
  // Back-compat: legacy signature is listContexts(includeMetadata: boolean)
  const options: ListContextsOptions =
    typeof opts === "boolean" ? { includeMetadata: opts } : opts;
  const sort = options.sort || "name";
  const includeArchived = options.includeArchived === true;
  // Any non-name sort, or an archived filter, requires metadata reads.
  const needMeta =
    options.includeMetadata === true || sort !== "name" || !includeArchived;

  await ensureDataDir();
  const entries = await fs.readdir(dataDir(), { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const summaries: ContextSummary[] = [];
  for (const name of names) {
    if (!needMeta) {
      summaries.push({ name });
      continue;
    }
    let metadata: ContextMetadata;
    try {
      metadata = await getContextMetadata(name);
    } catch {
      metadata = defaultContextMetadata();
    }
    if (!includeArchived && isArchived(metadata)) continue;
    summaries.push({ name, metadata });
  }

  sortSummaries(summaries, sort);

  if (options.includeMetadata !== true) {
    return summaries.map((s) => ({ name: s.name }));
  }
  return summaries;
}

export async function createContext(name: string): Promise<void> {
  if (!CONTEXT_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid context name '${name}': must be alphanumeric with hyphens/underscores only`
    );
  }
  const dir = resolveContextPath(name);
  try {
    await fs.access(dir);
    throw new Error(`Context '${name}' already exists`);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(dir, { recursive: true });
      await touchContext(name);
      return;
    }
    throw err;
  }
}

export async function deleteContext(name: string): Promise<void> {
  const dir = resolveContextPath(name);
  await fs.access(dir);
  await fs.rm(dir, { recursive: true, force: true });
}

// --- Item operations ---

// Resolve which file on disk a (context, base) refers to. Prefer markdown when
// ambiguous (backward compat with existing contexts).
async function findItemExtension(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<ItemExtension> {
  const dir = resolveContextPath(context);

  if (preferred) {
    const filePath = resolveItemPath(context, base, preferred);
    try {
      await fs.access(filePath);
      return preferred;
    } catch {
      throw new Error(
        `Item '${base}.${preferred}' not found in context '${context}'`
      );
    }
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`Context '${context}' not found`);
  }

  const found: ItemExtension[] = [];
  for (const ext of ITEM_EXTENSIONS) {
    if (entries.includes(`${base}.${ext}`)) {
      found.push(ext);
    }
  }

  if (found.length === 0) {
    throw new Error(`Item '${base}' not found in context '${context}'`);
  }

  return found.includes("md") ? "md" : found[0];
}

function statCreatedISO(stat: { birthtime: Date; ctime: Date }): string {
  const bt = stat.birthtime;
  if (bt && bt.getTime() > 0) return bt.toISOString();
  return stat.ctime.toISOString();
}

export async function listItems(context: string): Promise<ItemInfo[]> {
  const dir = resolveContextPath(context);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`Context '${context}' not found`);
  }

  const items: ItemInfo[] = [];
  for (const entry of entries) {
    const parsed = splitItemFilename(entry);
    if (!parsed) continue;

    const filePath = path.join(dir, entry);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;

    if (parsed.ext === "md") {
      const raw = await fs.readFile(filePath, "utf-8");
      const fm = matter(raw);
      const data = fm.data as Partial<ItemFrontmatter>;
      items.push({
        name: parsed.base,
        extension: parsed.ext,
        title: data.title || parsed.base,
        tags: Array.isArray(data.tags) ? data.tags : [],
        created: data.created || statCreatedISO(stat),
        updated: data.updated || stat.mtime.toISOString(),
        size: stat.size,
      });
    } else {
      items.push({
        name: parsed.base,
        extension: parsed.ext,
        title: parsed.base,
        tags: [],
        created: statCreatedISO(stat),
        updated: stat.mtime.toISOString(),
        size: stat.size,
      });
    }
  }

  items.sort((a, b) => {
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return items;
}

export async function getItem(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<Item> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);
  const [raw, stat] = await Promise.all([
    fs.readFile(filePath, "utf-8"),
    fs.stat(filePath),
  ]);

  if (ext === "md") {
    const fm = matter(raw);
    const data = fm.data as Partial<ItemFrontmatter>;
    return {
      name: base,
      extension: ext,
      content: fm.content,
      frontmatter: {
        title: data.title || base,
        tags: Array.isArray(data.tags) ? data.tags : [],
        created: data.created || statCreatedISO(stat),
        updated: data.updated || stat.mtime.toISOString(),
      },
      size: stat.size,
      created: data.created || statCreatedISO(stat),
      updated: data.updated || stat.mtime.toISOString(),
    };
  }

  return {
    name: base,
    extension: ext,
    content: raw,
    size: stat.size,
    created: statCreatedISO(stat),
    updated: stat.mtime.toISOString(),
  };
}

export interface RawItem {
  name: string;
  extension: ItemExtension;
  filename: string;
  contentType: string;
  content: string;
  size: number;
}

// Full, byte-for-byte content of an item as stored on disk — including YAML
// frontmatter for markdown. Distinct from getItem(), which strips frontmatter
// from md and returns it as a separate field. Used by the UI's Download button
// and by `get_item` when called with raw=true.
export async function getItemRaw(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<RawItem> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);
  const [raw, stat] = await Promise.all([
    fs.readFile(filePath, "utf-8"),
    fs.stat(filePath),
  ]);
  return {
    name: base,
    extension: ext,
    filename: `${base}.${ext}`,
    contentType: contentTypeFor(ext),
    content: raw,
    size: stat.size,
  };
}

export async function createItem(
  context: string,
  base: string,
  ext: ItemExtension,
  opts: { title?: string; tags?: string[]; content?: string } = {}
): Promise<void> {
  if (!ITEM_NAME_REGEX.test(base)) {
    throw new Error(
      `Invalid item name '${base}': must start with alphanumeric, letters/digits/hyphens/underscores only`
    );
  }
  if (`${base}.${ext}` === CONTEXT_META_FILENAME) {
    throw new Error(`Reserved filename: '${CONTEXT_META_FILENAME}'`);
  }

  const dir = resolveContextPath(context);
  await fs.access(dir).catch(() => {
    throw new Error(`Context '${context}' not found`);
  });

  const filePath = resolveItemPath(context, base, ext);
  try {
    await fs.access(filePath);
    throw new Error(
      `Item '${base}.${ext}' already exists in context '${context}'`
    );
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      if (ext === "md") {
        const now = new Date().toISOString();
        const frontmatter = {
          title: opts.title || base,
          tags: opts.tags || [],
          created: now,
          updated: now,
        };
        const output = matter.stringify(opts.content || "", frontmatter);
        await writeFileAtomic(filePath, output);
      } else {
        await writeFileAtomic(filePath, opts.content || "");
      }
      await touchContext(context);
      return;
    }
    throw err;
  }
}

export async function updateItem(
  context: string,
  base: string,
  updates: {
    extension?: ItemExtension;
    title?: string;
    tags?: string[];
    content?: string;
  }
): Promise<void> {
  const ext = await findItemExtension(context, base, updates.extension);
  const filePath = resolveItemPath(context, base, ext);

  if (ext === "md") {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const meta = parsed.data as Record<string, unknown>;

    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.tags !== undefined) meta.tags = updates.tags;
    meta.updated = new Date().toISOString();
    if (!meta.created) meta.created = meta.updated;

    const body = updates.content !== undefined ? updates.content : parsed.content;
    const output = matter.stringify(body, meta);
    await snapshotItem(filePath);
    await writeFileAtomic(filePath, output);
    await touchContext(context);
    return;
  }

  if (updates.title !== undefined || updates.tags !== undefined) {
    throw new Error(
      `title/tags are not supported on non-markdown items (kind: ${ext})`
    );
  }
  if (updates.content === undefined) {
    throw new Error(`No content provided to update '${base}.${ext}'`);
  }
  await snapshotItem(filePath);
  await writeFileAtomic(filePath, updates.content);
  await touchContext(context);
}

export async function appendToItem(
  context: string,
  base: string,
  newContent: string,
  preferred?: ItemExtension
): Promise<void> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);

  if (ext === "json" || ext === "yaml" || ext === "yml") {
    throw new Error(
      `Cannot append to structured data item (kind: ${ext}). Use update instead.`
    );
  }

  if (ext === "md") {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const meta = parsed.data as Record<string, unknown>;
    meta.updated = new Date().toISOString();
    if (!meta.created) meta.created = meta.updated;

    const body = parsed.content + "\n\n" + newContent;
    const output = matter.stringify(body, meta);
    await snapshotItem(filePath);
    await writeFileAtomic(filePath, output);
    await touchContext(context);
    return;
  }

  const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await snapshotItem(filePath);
  await writeFileAtomic(filePath, existing + sep + newContent);
  await touchContext(context);
}

export async function deleteItem(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<void> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);
  await fs.rm(filePath);
  await touchContext(context).catch(() => {
    // If _context.yaml write fails after item delete, don't fail the delete.
  });
}

// One-shot revert: swap the current item with its `.foo.md.bak` snapshot.
// The revert itself is not snapshotted, so you cannot un-revert.
export async function revertItem(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<{ name: string; extension: ItemExtension }> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);
  const backupPath = backupPathFor(filePath);

  try {
    await fs.access(backupPath);
  } catch {
    throw new Error(
      `No previous version available for '${base}.${ext}' in context '${context}'`
    );
  }

  await fs.rename(backupPath, filePath);
  await touchContext(context);
  return { name: base, extension: ext };
}

export async function hasBackup(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<boolean> {
  let ext: ItemExtension;
  try {
    ext = await findItemExtension(context, base, preferred);
  } catch {
    return false;
  }
  const filePath = resolveItemPath(context, base, ext);
  const backupPath = backupPathFor(filePath);
  try {
    await fs.access(backupPath);
    return true;
  } catch {
    return false;
  }
}

// --- Diagnostics ---

export interface Diagnostics {
  dataDir: string;
  configPath: string;
  version: string;
  contextCount: number;
  archivedCount: number;
  itemCount: number;
  totalBytes: number;
  lastScanMs: number;
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const cfg = loadConfig();
  const start = Date.now();
  await ensureDataDir();
  const entries = await fs.readdir(cfg.dataDir, { withFileTypes: true });
  const ctxNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  let archivedCount = 0;
  let itemCount = 0;
  let totalBytes = 0;

  for (const name of ctxNames) {
    let meta: ContextMetadata | null = null;
    try {
      meta = await getContextMetadata(name);
    } catch {
      meta = null;
    }
    if (isArchived(meta || undefined)) archivedCount += 1;

    let ents: string[];
    try {
      ents = await fs.readdir(path.join(cfg.dataDir, name));
    } catch {
      continue;
    }
    for (const ent of ents) {
      const parsed = splitItemFilename(ent);
      if (!parsed) continue;
      const st = await fs.stat(path.join(cfg.dataDir, name, ent)).catch(() => null);
      if (!st || !st.isFile()) continue;
      itemCount += 1;
      totalBytes += st.size;
    }
  }

  return {
    dataDir: cfg.dataDir,
    configPath: cfg.configPath,
    version: packageVersion(),
    contextCount: ctxNames.length,
    archivedCount,
    itemCount,
    totalBytes,
    lastScanMs: Date.now() - start,
  };
}

// --- Re-exports for convenience ---

export { findItemExtension, isSupportedExtension, splitItemFilename };
