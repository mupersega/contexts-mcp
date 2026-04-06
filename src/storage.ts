import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { DocumentMeta, DocumentInfo } from "./types.js";

const DATA_DIR =
  process.env.CONTEXTS_DATA_DIR ||
  path.join(process.cwd(), "contexts-data");

export function getDataDir(): string {
  return DATA_DIR;
}

function resolveContextPath(contextName: string): string {
  const resolved = path.resolve(DATA_DIR, contextName);
  if (!resolved.startsWith(path.resolve(DATA_DIR))) {
    throw new Error("Invalid context name: path traversal detected");
  }
  return resolved;
}

function resolveDocumentPath(contextName: string, docName: string): string {
  const contextDir = resolveContextPath(contextName);
  const resolved = path.resolve(contextDir, `${docName}.md`);
  if (!resolved.startsWith(contextDir)) {
    throw new Error("Invalid document name: path traversal detected");
  }
  return resolved;
}

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// --- Context operations ---

export async function listContexts(): Promise<string[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function createContext(name: string): Promise<void> {
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

// --- Document operations ---

export async function listDocuments(context: string): Promise<DocumentInfo[]> {
  const dir = resolveContextPath(context);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    throw new Error(`Context '${context}' not found`);
  }

  const docs: DocumentInfo[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    const parsed = matter(raw);
    const meta = parsed.data as Partial<DocumentMeta>;
    docs.push({
      name: file.replace(/\.md$/, ""),
      title: meta.title || file.replace(/\.md$/, ""),
      tags: meta.tags || [],
      created: meta.created || "",
      updated: meta.updated || "",
    });
  }
  return docs;
}

export async function getDocument(
  context: string,
  doc: string
): Promise<{ meta: DocumentMeta; content: string }> {
  const filePath = resolveDocumentPath(context, doc);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Document '${doc}' not found in context '${context}'`);
  }
  const parsed = matter(raw);
  const meta = parsed.data as Partial<DocumentMeta>;
  return {
    meta: {
      title: meta.title || doc,
      tags: meta.tags || [],
      created: meta.created || "",
      updated: meta.updated || "",
    },
    content: parsed.content,
  };
}

export async function createDocument(
  context: string,
  doc: string,
  title: string,
  tags: string[],
  content: string
): Promise<void> {
  const dir = resolveContextPath(context);
  await fs.access(dir).catch(() => {
    throw new Error(`Context '${context}' not found`);
  });

  const filePath = resolveDocumentPath(context, doc);
  try {
    await fs.access(filePath);
    throw new Error(`Document '${doc}' already exists in context '${context}'`);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      const now = new Date().toISOString();
      const frontmatter = { title, tags, created: now, updated: now };
      const output = matter.stringify(content, frontmatter);
      await fs.writeFile(filePath, output, "utf-8");
      return;
    }
    throw err;
  }
}

export async function updateDocument(
  context: string,
  doc: string,
  updates: { title?: string; tags?: string[]; content?: string }
): Promise<void> {
  const filePath = resolveDocumentPath(context, doc);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Document '${doc}' not found in context '${context}'`);
  }

  const parsed = matter(raw);
  const meta = parsed.data as Record<string, unknown>;

  if (updates.title !== undefined) meta.title = updates.title;
  if (updates.tags !== undefined) meta.tags = updates.tags;
  meta.updated = new Date().toISOString();

  const body = updates.content !== undefined ? updates.content : parsed.content;
  const output = matter.stringify(body, meta);
  await fs.writeFile(filePath, output, "utf-8");
}

export async function appendToDocument(
  context: string,
  doc: string,
  newContent: string
): Promise<void> {
  const filePath = resolveDocumentPath(context, doc);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Document '${doc}' not found in context '${context}'`);
  }

  const parsed = matter(raw);
  const meta = parsed.data as Record<string, unknown>;
  meta.updated = new Date().toISOString();

  const body = parsed.content + "\n\n" + newContent;
  const output = matter.stringify(body, meta);
  await fs.writeFile(filePath, output, "utf-8");
}
