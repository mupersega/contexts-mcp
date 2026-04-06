import { z } from "zod";

// --- Document metadata stored in YAML frontmatter ---

export interface DocumentMeta {
  title: string;
  tags: string[];
  created: string;
  updated: string;
}

export interface DocumentInfo {
  name: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
}

// --- Zod schemas for tool inputs ---

const namePattern = /^[a-zA-Z0-9_-]+$/;

export const ListContextsArgsSchema = z.object({});

export const CreateContextArgsSchema = z.object({
  name: z
    .string()
    .regex(namePattern, "Must be alphanumeric with hyphens/underscores only")
    .describe("Name of the context folder to create"),
});

export const DeleteContextArgsSchema = z.object({
  name: z.string().describe("Name of the context folder to delete"),
});

export const ListDocumentsArgsSchema = z.object({
  context: z.string().describe("Name of the context folder"),
});

export const GetDocumentArgsSchema = z.object({
  context: z.string().describe("Name of the context folder"),
  document: z.string().describe("Document filename (without .md extension)"),
});

export const CreateDocumentArgsSchema = z.object({
  context: z.string().describe("Name of the context folder"),
  document: z
    .string()
    .regex(namePattern, "Must be alphanumeric with hyphens/underscores only")
    .describe("Document filename (without .md extension)"),
  title: z.string().describe("Document title for frontmatter"),
  tags: z.array(z.string()).default([]).describe("Tags for categorization"),
  content: z.string().describe("Markdown content body"),
});

export const UpdateDocumentArgsSchema = z.object({
  context: z.string().describe("Name of the context folder"),
  document: z.string().describe("Document filename (without .md extension)"),
  title: z.string().optional().describe("New title (if updating)"),
  tags: z.array(z.string()).optional().describe("New tags (if updating)"),
  content: z.string().optional().describe("New content body (replaces existing)"),
});

export const AppendToDocumentArgsSchema = z.object({
  context: z.string().describe("Name of the context folder"),
  document: z.string().describe("Document filename (without .md extension)"),
  content: z.string().describe("Markdown content to append"),
});

export const SearchContextsArgsSchema = z.object({
  query: z.string().describe("Search query string"),
  context: z
    .string()
    .optional()
    .describe("Limit search to a specific context folder"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter by tags"),
});
