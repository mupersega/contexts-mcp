import { z } from "zod";

// --- Constants ---

export const ITEM_EXTENSIONS = ["md", "txt", "json", "yaml", "yml", "csv", "sql"] as const;
export type ItemExtension = (typeof ITEM_EXTENSIONS)[number];

export const CONTEXT_META_FILENAME = "_context.yaml";

// Context names: alphanumeric + hyphen/underscore (unchanged from legacy behaviour).
export const CONTEXT_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Item base names: must start with alphanumeric, blocking reserved underscore-prefixed
// names like "_context".
export const ITEM_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

// --- Context metadata ---

export interface ContextLink {
  label: string;
  url: string;
}

export interface ContextMetadata {
  title?: string;
  description?: string;
  status?: string;
  tags: string[];
  links: ContextLink[];
  created: string;
  updated: string;
  // ISO timestamp of the last item-level mutation (create/update/append/delete).
  // Bumped by storage automatically; callers never set this directly.
  last_activity?: string;
}

export interface ContextSummary {
  name: string;
  metadata?: ContextMetadata;
}

// --- Item types ---

// Rich metadata from YAML frontmatter — only meaningful for markdown items.
export interface ItemFrontmatter {
  title: string;
  tags: string[];
  created: string;
  updated: string;
}

// Listing entry; one shape for all kinds.
export interface ItemInfo {
  name: string;
  extension: ItemExtension;
  // Markdown-only (populated from frontmatter when present):
  title: string;       // falls back to the bare name for non-md items
  tags: string[];      // empty for non-md items
  created: string;     // md: frontmatter; non-md: fs.stat birthtime/ctime
  updated: string;     // md: frontmatter; non-md: fs.stat mtime
  size: number;
}

// Full read result.
export interface Item {
  name: string;
  extension: ItemExtension;
  content: string;                  // md: body (post-frontmatter); others: full raw text
  frontmatter?: ItemFrontmatter;    // present only for md
  size: number;
  created: string;
  updated: string;
}

// --- Zod schemas ---

export const ItemExtensionSchema = z.enum(ITEM_EXTENSIONS);

export const ContextLinkSchema = z.object({
  // Relative refs and ticket shortcuts are valid — don't require .url().
  label: z.string().min(1),
  url: z.string().min(1),
});

export const ContextMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).default([]),
  links: z.array(ContextLinkSchema).default([]),
  created: z.string().optional(),
  updated: z.string().optional(),
  last_activity: z.string().optional(),
});

export const ListContextsSortSchema = z.enum([
  "name",
  "recent_activity",
  "created",
  "updated",
]);
export type ListContextsSort = z.infer<typeof ListContextsSortSchema>;

// --- Tool input schemas ---

export const ListContextsArgsSchema = z.object({
  include_metadata: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include title, description, status, tags, links, last_activity per context."),
  sort: ListContextsSortSchema
    .optional()
    .default("name")
    .describe("'name' (alphabetical) or 'recent_activity' | 'created' | 'updated' (most-recent first)."),
  include_archived: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include contexts with status='archived'. Default false."),
});

export const CreateContextArgsSchema = z.object({
  name: z
    .string()
    .regex(CONTEXT_NAME_REGEX, "Must be alphanumeric with hyphens/underscores only"),
});

export const DeleteContextArgsSchema = z.object({
  name: z.string(),
});

export const GetContextArgsSchema = z.object({
  name: z.string(),
});

export const UpdateContextMetadataArgsSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z
    .string()
    .optional()
    .describe("Free-form working status (e.g. pending, in-progress, pr, done, archived)."),
  tags: z.array(z.string()).optional(),
  links: z
    .array(ContextLinkSchema)
    .optional()
    .describe("Array of {label, url} — e.g. Jira ticket, PR, design doc."),
});

export const ListItemsArgsSchema = z.object({
  context: z.string(),
});

export const GetItemArgsSchema = z.object({
  context: z.string(),
  item: z.string().describe("Item base name (without extension)."),
  extension: ItemExtensionSchema
    .optional()
    .describe("Disambiguator when two items share a base name."),
  raw: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, return byte-for-byte file contents (incl. frontmatter for md) as JSON."),
});

export const CreateItemArgsSchema = z.object({
  context: z.string(),
  item: z
    .string()
    .regex(ITEM_NAME_REGEX, "Must start with a letter or digit; letters, digits, hyphens, underscores only")
    .describe("Item base name (without extension)."),
  extension: ItemExtensionSchema.default("md"),
  title: z.string().optional().describe("Markdown frontmatter title (md only)."),
  tags: z
    .array(z.string())
    .default([])
    .describe("Markdown frontmatter tags (md only)."),
  content: z.string().default("").describe("For md, body only; for others, raw text."),
});

export const UpdateItemArgsSchema = z.object({
  context: z.string(),
  item: z.string().describe("Item base name (without extension)."),
  extension: ItemExtensionSchema.optional(),
  title: z.string().optional().describe("New title (md only)."),
  tags: z.array(z.string()).optional().describe("New tags (md only)."),
  content: z.string().optional(),
});

export const AppendToItemArgsSchema = z.object({
  context: z.string(),
  item: z.string().describe("Item base name (without extension)."),
  extension: ItemExtensionSchema.optional(),
  content: z.string(),
});

export const DeleteItemArgsSchema = z.object({
  context: z.string(),
  item: z.string().describe("Item base name (without extension)."),
  extension: ItemExtensionSchema.optional(),
});

export const SearchContextsArgsSchema = z.object({
  query: z.string(),
  context: z.string().optional().describe("Limit to a specific context folder."),
  tags: z.array(z.string()).optional().describe("Filter by per-item markdown tags."),
  context_status: z.string().optional().describe("Only search contexts whose metadata status matches."),
  context_tags: z.array(z.string()).optional().describe("Only search contexts whose metadata tags include any of these."),
  include_archived: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include archived contexts. Default false."),
});

export const ContextDiagnoseArgsSchema = z.object({});

export const GUIDE_NAMES = ["migration", "mermaid"] as const;
export const GetGuideArgsSchema = z.object({
  name: z.enum(GUIDE_NAMES),
});
