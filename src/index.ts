#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  ListContextsArgsSchema,
  CreateContextArgsSchema,
  DeleteContextArgsSchema,
  GetContextArgsSchema,
  UpdateContextMetadataArgsSchema,
  ListItemsArgsSchema,
  GetItemArgsSchema,
  GetItemRawArgsSchema,
  CreateItemArgsSchema,
  UpdateItemArgsSchema,
  AppendToItemArgsSchema,
  DeleteItemArgsSchema,
  SearchContextsArgsSchema,
  ContextDiagnoseArgsSchema,
  ContextMigrationBriefArgsSchema,
} from "./types.js";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";
import { loadConfig, MissingDataDirError, packageVersion } from "./config.js";

const server = new McpServer(
  { name: "contexts-mcp", version: packageVersion() },
  {
    capabilities: { tools: {} },
    instructions: [
      "Persistent context folders for Claude Code sessions. A context is a folder holding items in any text format: md (default), txt, json, yaml, yml, csv, sql. Markdown items carry frontmatter (title, tags, timestamps); other kinds have only filesystem metadata. Contexts themselves can carry optional metadata (title, description, free-form status, tags, links) — good for both knowledge-base topics and unit-of-work folders.",
      "",
      "How to use this server:",
      "- When the user asks about a topic that may already be logged, call search_contexts first before answering from scratch.",
      "- When capturing a new finding, prefer append_to_item onto an existing topical context over creating a new one — contexts work best as growing logs.",
      "- When exploring what's saved, call list_contexts with include_metadata=true so titles/status/tags are visible in one shot. Pass sort='recent_activity' when you want the recently-touched contexts first.",
      "- Contexts with status='archived' are filtered out of list/search by default — pass include_archived=true to include them.",
      "- Markdown is the right default for notes and prose. Only use json/yaml/csv/sql when the payload is structurally meaningful (and note that append_to_item is disabled for json/yaml/yml — use update_item to replace).",
    ].join("\n"),
  }
);

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));

const MIGRATION_BRIEF = `# Migrating existing markdown into contexts-mcp

## What this system is
A **context** is a folder. An **item** is a single file inside that folder. Items can be: \`md\` (default), \`txt\`, \`json\`, \`yaml\`, \`yml\`, \`csv\`, or \`sql\`. Contexts are flat — no subfolders of items. A context may also carry its own metadata in a reserved \`_context.yaml\` file (never exposed as an item).

## Naming rules
- **Context name**: \`/^[a-zA-Z0-9_-]+$/\` — letters, digits, hyphens, underscores. Examples: \`auth-rewrite\`, \`postgres_notes\`, \`2026-q2-planning\`.
- **Item base name**: \`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/\` — must **start** with a letter or digit (blocks reserved names like \`_context\`). Pass the base name without the extension; pass \`extension\` separately.
- No spaces, dots, or slashes in either name. Rename source files before importing, or map them during migration.

## Markdown frontmatter shape
Markdown items carry YAML frontmatter:

\`\`\`yaml
---
title: Human-readable title
tags: [alpha, beta]
created: 2026-04-15T...
updated: 2026-04-15T...
---
body goes here
\`\`\`

\`title\` and \`tags\` are yours to set; \`created\`/\`updated\` are managed automatically. If your source markdown already has frontmatter with other fields, they'll be preserved but only the four above are surfaced in listings and search.

## Non-markdown items
\`txt\`, \`json\`, \`yaml\`, \`yml\`, \`csv\`, \`sql\` have **no frontmatter** — only filesystem metadata (name, size, ctime/mtime). If you want rich metadata on a structured payload, drop a companion \`.md\` next to it in the same context.

## \`_context.yaml\` (context-level metadata)
Optional per-context metadata. All fields optional:

\`\`\`yaml
title: Auth rewrite
description: Migration off the old middleware
status: in-progress    # free-form — "archived", "active", "draft", whatever
tags: [backend, auth]
links:
  - label: Tracking issue
    url: https://...
\`\`\`

\`status: archived\` is special: archived contexts are filtered out of default \`list_contexts\`/\`search_contexts\` results (opt in with \`include_archived: true\`). The server also tracks \`last_activity\` automatically — don't set it manually.

## Recommended migration workflow
1. **Survey first.** Call \`list_contexts\` with \`include_metadata: true\` to see what contexts already exist. Avoid creating parallel contexts for the same topic.
2. **Search before writing.** Before importing a file, call \`search_contexts\` on a key phrase — you may find an existing item to **append to** rather than duplicate.
3. **Group by topic, not by source directory.** One context = one coherent topic or unit of work. A folder of 30 loose notes about the same subsystem should usually become **one context with 30 items**, not 30 contexts.
4. **Use \`create_item\` per source file.** Pass the body as \`content\`; set \`title\` and \`tags\` from your source frontmatter or infer from the filename. Default extension is \`md\`.
5. **Prefer \`append_to_item\` for growth.** Contexts work best as growing logs — new findings append onto an existing item rather than creating item #7 on the same sub-topic.
6. **Set \`_context.yaml\` last.** After items land, call \`update_context_metadata\` to give the context a title, description, status, and tags.

## Gotchas
- \`append_to_item\` is **disabled** for \`json\`/\`yaml\`/\`yml\` — silently corrupting structured data is worse than erroring. Use \`update_item\` to replace the full payload.
- When two items share a base name across different extensions (\`notes.md\` and \`notes.txt\`), pass \`extension\` to disambiguate; otherwise \`md\` wins.
- Storage path resolution: the server reads from \`~/.config/contexts-mcp/config.json\` (or the OS-appropriate equivalent), written by \`contexts-mcp setup\`. \`CONTEXTS_DATA_DIR\` in the environment overrides the config file.
- File renames to fit the regex should happen in a preprocessing pass — the server rejects invalid names at the Zod boundary.

## Suggested tool sequence for a batch import
\`list_contexts\` → (for each source file) \`search_contexts\` to check for duplicates → \`create_context\` if new topic → \`create_item\` or \`append_to_item\` → \`update_context_metadata\` once items are in.
`;

server.registerTool(
  "list_contexts",
  {
    description:
      "List all context folders. Pass include_metadata=true to also return each context's title/description/status/tags/links/last_activity. Pass sort='recent_activity' (or 'created' / 'updated') to order by time (most-recent first) instead of the default alphabetical. Archived contexts (status='archived') are filtered out unless include_archived=true.",
    inputSchema: ListContextsArgsSchema.shape,
  },
  async (args) => {
    const summaries = await storage.listContexts({
      includeMetadata: args.include_metadata,
      sort: args.sort,
      includeArchived: args.include_archived,
    });
    return json(args.include_metadata ? summaries : summaries.map((s) => s.name));
  }
);

server.registerTool(
  "create_context",
  {
    description:
      "Create a new named context folder. Name must be alphanumeric with hyphens/underscores.",
    inputSchema: CreateContextArgsSchema.shape,
  },
  async (args) => {
    await storage.createContext(args.name);
    return text(`Context '${args.name}' created.`);
  }
);

server.registerTool(
  "delete_context",
  {
    description:
      "Delete a context folder and all items it contains. This is destructive and cannot be undone.",
    inputSchema: DeleteContextArgsSchema.shape,
  },
  async (args) => {
    await storage.deleteContext(args.name);
    return text(`Context '${args.name}' deleted.`);
  }
);

server.registerTool(
  "get_context",
  {
    description:
      "Read a context's metadata: title, description, status, tags, links, and last_activity. Returns empty defaults for contexts that have no metadata set yet.",
    inputSchema: GetContextArgsSchema.shape,
  },
  async (args) => {
    const metadata = await storage.getContextMetadata(args.name);
    return json({ name: args.name, metadata });
  }
);

server.registerTool(
  "update_context_metadata",
  {
    description:
      "Set or update a context's metadata. Only the fields you pass are changed; everything else is preserved. Use this to track unit-of-work state (status, links to tickets/PRs) or to give any context a human-readable title and description. Set status='archived' to archive a context — it'll be hidden from default list/search until you either clear the status or pass include_archived=true.",
    inputSchema: UpdateContextMetadataArgsSchema.shape,
  },
  async (args) => {
    const { name, ...patch } = args;
    const metadata = await storage.updateContextMetadata(name, patch);
    return json({ name, metadata });
  }
);

server.registerTool(
  "list_items",
  {
    description:
      "List all items in a context folder. Items may be markdown, txt, json, yaml, yml, csv, or sql. Markdown items carry title/tags from YAML frontmatter; other kinds have only filesystem metadata.",
    inputSchema: ListItemsArgsSchema.shape,
  },
  async (args) => {
    const items = await storage.listItems(args.context);
    return json(items);
  }
);

server.registerTool(
  "get_item",
  {
    description:
      "Read a specific item's content. Markdown items return YAML frontmatter + body; other kinds return raw text. Pass 'extension' to disambiguate when two items share a base name.",
    inputSchema: GetItemArgsSchema.shape,
  },
  async (args) => {
    const item = await storage.getItem(args.context, args.item, args.extension);

    if (item.extension === "md" && item.frontmatter) {
      const fm = item.frontmatter;
      const output = [
        "---",
        `title: ${JSON.stringify(fm.title)}`,
        `tags: ${JSON.stringify(fm.tags)}`,
        `created: ${fm.created}`,
        `updated: ${fm.updated}`,
        "---",
        "",
        item.content,
      ].join("\n");
      return text(output);
    }

    const header = `[${item.extension.toUpperCase()}] ${item.name}.${item.extension} (${item.size} bytes, updated ${item.updated})`;
    return text(`${header}\n\n${item.content}`);
  }
);

server.registerTool(
  "get_item_raw",
  {
    description:
      "Read an item's raw, byte-for-byte content as stored on disk — including YAML frontmatter for markdown. Returns {content, filename, contentType, extension, size}. Use this when you want the original file verbatim (e.g. to hand it to another tool) rather than the parsed structure get_item returns.",
    inputSchema: GetItemRawArgsSchema.shape,
  },
  async (args) => {
    const raw = await storage.getItemRaw(args.context, args.item, args.extension);
    return json(raw);
  }
);

server.registerTool(
  "create_item",
  {
    description:
      "Create a new item in a context. Extension defaults to 'md' — pass one of (md, txt, json, yaml, yml, csv, sql) to override. For markdown, also pass title and tags — they go into the YAML frontmatter. For other kinds, just pass content.",
    inputSchema: CreateItemArgsSchema.shape,
  },
  async (args) => {
    await storage.createItem(args.context, args.item, args.extension, {
      title: args.title,
      tags: args.tags,
      content: args.content,
    });
    return text(`Item '${args.item}.${args.extension}' created in context '${args.context}'.`);
  }
);

server.registerTool(
  "update_item",
  {
    description:
      "Update an existing item. For markdown: title/tags/content may all be updated. For other kinds: only content may be updated. Auto-updates the 'updated' timestamp on markdown items.",
    inputSchema: UpdateItemArgsSchema.shape,
  },
  async (args) => {
    await storage.updateItem(args.context, args.item, {
      extension: args.extension,
      title: args.title,
      tags: args.tags,
      content: args.content,
    });
    return text(`Item '${args.item}' updated.`);
  }
);

server.registerTool(
  "append_to_item",
  {
    description:
      "Append content to an existing item. Supported for markdown, txt, csv, and sql. Errors for structured-data kinds (json/yaml/yml) — use update_item for those.",
    inputSchema: AppendToItemArgsSchema.shape,
  },
  async (args) => {
    await storage.appendToItem(args.context, args.item, args.content, args.extension);
    return text(`Content appended to '${args.item}'.`);
  }
);

server.registerTool(
  "delete_item",
  {
    description:
      "Delete a specific item from a context. Destructive — cannot be undone. If two items share a base name, pass 'extension' to disambiguate.",
    inputSchema: DeleteItemArgsSchema.shape,
  },
  async (args) => {
    await storage.deleteItem(args.context, args.item, args.extension);
    return text(`Item '${args.item}' deleted.`);
  }
);

server.registerTool(
  "context_diagnose",
  {
    description:
      "Return server-side diagnostics: resolved data dir, config path, version, counts (contexts, archived contexts, items), total bytes on disk, and scan wall-clock. Cheap to call. Use this to confirm 'what data dir is this process actually reading?' when debugging, or to check whether an archival sweep would meaningfully reduce the working set.",
    inputSchema: ContextDiagnoseArgsSchema.shape,
  },
  async () => {
    const diag = await storage.getDiagnostics();
    return json(diag);
  }
);

server.registerTool(
  "context_migration_brief",
  {
    description:
      "Return a guide explaining how to migrate existing markdown (and other text files) into this contexts-mcp server. Covers supported formats, naming rules, markdown frontmatter shape, _context.yaml metadata, recommended migration workflow, and common gotchas. Call this when a user wants to import an existing corpus of notes or docs into contexts.",
    inputSchema: ContextMigrationBriefArgsSchema.shape,
  },
  async () => text(MIGRATION_BRIEF)
);

server.registerTool(
  "search_contexts",
  {
    description:
      "Full-text search across all text items in all contexts. Pass just 'query' for a broad search; all filters are optional. Narrow with 'context' (one folder), 'tags' (per-item markdown tags), or 'context_status' / 'context_tags' (context-level metadata). Archived contexts are skipped unless include_archived=true.",
    inputSchema: SearchContextsArgsSchema.shape,
  },
  async (args) => {
    const results = await searchContexts(storage.getDataDir(), args.query, {
      contextFilter: args.context,
      tagFilter: args.tags,
      contextStatus: args.context_status,
      contextTagFilter: args.context_tags,
      includeArchived: args.include_archived,
    });
    return json(results);
  }
);

async function main() {
  try {
    const cfg = loadConfig();
    console.error(`[contexts-mcp] version:   ${packageVersion()}`);
    console.error(`[contexts-mcp] data dir:  ${cfg.dataDir} (from ${cfg.source.dataDir})`);
    console.error(`[contexts-mcp] config:    ${cfg.configPath}`);
    await storage.ensureDataDir();
  } catch (err) {
    if (err instanceof MissingDataDirError) {
      console.error("[contexts-mcp] startup failed — no data dir configured.");
      console.error("");
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[contexts-mcp] MCP server running on stdio");
}

main().catch((error) => {
  console.error("[contexts-mcp] Fatal:", error);
  process.exit(1);
});
