import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import yaml from "js-yaml";
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

const DATA_DIR =
  process.env.CONTEXTS_DATA_DIR ||
  path.join(process.cwd(), "contexts-data");

export function getDataDir(): string {
  return DATA_DIR;
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
  const baseResolved = path.resolve(DATA_DIR);
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
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const base = filename.slice(0, dotIdx);
  const ext = filename.slice(dotIdx + 1);
  if (!isSupportedExtension(ext)) return null;
  if (!ITEM_NAME_REGEX.test(base)) return null;
  return { base, ext };
}

// --- Init ---

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
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
  // Make sure the context directory exists — fail loudly if not.
  await fs.access(resolveContextPath(name)).catch(() => {
    throw new Error(`Context '${name}' not found`);
  });

  // Consistent key order when writing.
  const ordered: Record<string, unknown> = {};
  if (meta.title !== undefined) ordered.title = meta.title;
  if (meta.description !== undefined) ordered.description = meta.description;
  if (meta.status !== undefined) ordered.status = meta.status;
  ordered.tags = meta.tags;
  ordered.links = meta.links;
  if (meta.created) ordered.created = meta.created;
  if (meta.updated) ordered.updated = meta.updated;

  const out = yaml.dump(ordered, { sortKeys: false, lineWidth: 100, noRefs: true });
  await fs.writeFile(metaPath, out, "utf-8");
}

export async function updateContextMetadata(
  name: string,
  patch: Partial<Omit<ContextMetadata, "created" | "updated">>
): Promise<ContextMetadata> {
  const existing = await getContextMetadata(name);
  const now = new Date().toISOString();

  const merged: ContextMetadata = {
    ...existing,
    // Only patch keys that were explicitly provided.
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.links !== undefined ? { links: patch.links } : {}),
    created: existing.created || now,
    updated: now,
  };

  await writeContextMetadata(name, merged);
  return merged;
}

// --- Context operations ---

export async function listContexts(
  includeMetadata = false
): Promise<ContextSummary[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (!includeMetadata) {
    return names.map((name) => ({ name }));
  }

  const summaries: ContextSummary[] = [];
  for (const name of names) {
    try {
      const metadata = await getContextMetadata(name);
      summaries.push({ name, metadata });
    } catch {
      summaries.push({ name, metadata: defaultContextMetadata() });
    }
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

  // Prefer md, otherwise first hit in ITEM_EXTENSIONS order.
  return found.includes("md") ? "md" : found[0];
}

// Windows reports birthtime reliably; elsewhere we fall back to ctime if zero.
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
    if (!parsed) continue; // skips _context.yaml and unsupported files

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

  // Updated desc, then name asc.
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
  // Defense in depth against reserved filename even though the regex blocks leading underscore.
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
        await fs.writeFile(filePath, output, "utf-8");
      } else {
        // Non-md: ignore title/tags.
        await fs.writeFile(filePath, opts.content || "", "utf-8");
      }
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
    await fs.writeFile(filePath, output, "utf-8");
    return;
  }

  // Non-markdown: content is the only updatable field.
  if (updates.title !== undefined || updates.tags !== undefined) {
    throw new Error(
      `title/tags are not supported on non-markdown items (kind: ${ext})`
    );
  }
  if (updates.content === undefined) {
    throw new Error(`No content provided to update '${base}.${ext}'`);
  }
  await fs.writeFile(filePath, updates.content, "utf-8");
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
    await fs.writeFile(filePath, output, "utf-8");
    return;
  }

  // txt / csv: simple textual append.
  const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  await fs.writeFile(filePath, existing + sep + newContent, "utf-8");
}

export async function deleteItem(
  context: string,
  base: string,
  preferred?: ItemExtension
): Promise<void> {
  const ext = await findItemExtension(context, base, preferred);
  const filePath = resolveItemPath(context, base, ext);
  // resolveItemPath can never produce the _context.yaml path (it always
  // appends a whitelisted extension), so this is safe against accidental
  // deletion of the metadata file.
  await fs.rm(filePath);
}

// --- Re-exports for convenience ---

export { findItemExtension, isSupportedExtension, splitItemFilename };
