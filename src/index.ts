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
  CreateItemArgsSchema,
  UpdateItemArgsSchema,
  AppendToItemArgsSchema,
  DeleteItemArgsSchema,
  RevertItemArgsSchema,
  SearchContextsArgsSchema,
  ContextDiagnoseArgsSchema,
  GetGuideArgsSchema,
} from "./types.js";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";
import { loadConfig, MissingDataDirError, packageVersion } from "./config.js";

const server = new McpServer(
  { name: "contexts-mcp", version: packageVersion() },
  {
    capabilities: { tools: {} },
    instructions:
      "Persistent context folders for Claude Code sessions. A context is a folder holding items in md (default), txt, json, yaml, yml, csv, or sql. Markdown items carry frontmatter (title, tags, timestamps); other kinds carry only filesystem metadata. Contexts themselves can carry optional metadata (title, description, free-form status, tags, links). Prefer search_contexts before answering topics that may already be logged, and prefer append_to_item on an existing item over creating parallel items. Markdown supports mermaid fences (```mermaid) that render as SVG diagrams in the optional web UI — prefer them over hand-drawn ASCII art; call get_guide({ name: 'mermaid' }) for syntax.",
  }
);

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));

const MIGRATION_GUIDE = `# Migrating existing markdown into contexts-mcp

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

const MERMAID_GUIDE = `# Diagrams in contexts-mcp (mermaid)

Markdown items are rendered by the optional web UI (port 3141). Fenced code blocks tagged \`mermaid\` are converted to SVG diagrams client-side; everything else stays a plain code block.

**When to reach for it:** flow, sequence, state, class, or ER diagrams that would otherwise be ASCII art. Mermaid is more compact, easier to edit, and renders as a real picture for the human reading the context later.

**Fence it correctly.** The language must be exactly \`mermaid\`. \`mmd\`, uppercase variants, or an unlabeled fence will render as a code block, not a diagram.

## Flowchart

\`\`\`mermaid
flowchart TD
  A[User] --> B{Signed in?}
  B -- yes --> C[Dashboard]
  B -- no --> D[Login]
  D --> A
\`\`\`

Directions: \`TD\` (top-down), \`LR\` (left-right), \`BT\`, \`RL\`. Node shapes: \`[rect]\`, \`(round)\`, \`([stadium])\`, \`{diamond}\`, \`((circle))\`.

## Sequence

\`\`\`mermaid
sequenceDiagram
  participant Browser
  participant Frontend
  participant Backend
  participant SSO as EVE SSO
  Browser->>Frontend: click login
  Frontend->>Frontend: PKCE verifier + state
  Frontend->>SSO: redirect login.eveonline.com
  SSO-->>Browser: redirect w/ ?code
  Browser->>Frontend: /callback
  Frontend->>Backend: POST /api/auth/eve-callback
  Backend->>SSO: exchange code
  SSO-->>Backend: {access, refresh}
  Backend-->>Frontend: {app JWT, account}
\`\`\`

Arrows: \`->>\` solid, \`-->>\` dashed, \`-x\` crossed (failed). \`Note over X,Y: text\` for annotations.

## State

\`\`\`mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review: submit
  Review --> Published: approve
  Review --> Draft: reject
  Published --> [*]
\`\`\`

## Entity relationship

\`\`\`mermaid
erDiagram
  ACCOUNT ||--o{ SESSION : has
  ACCOUNT {
    uuid id PK
    string email
  }
  SESSION {
    uuid id PK
    uuid account_id FK
    timestamp expires_at
  }
\`\`\`

Cardinality: \`||--o{\` one-to-many, \`||--||\` one-to-one, \`}o--o{\` many-to-many.

## Class

\`\`\`mermaid
classDiagram
  class Storage {
    +getItem(context, name) Item
    +createItem(context, name, opts)
  }
  class Item {
    +name: string
    +extension: string
    +content: string
  }
  Storage --> Item : returns
\`\`\`

## Tips

- Keep node labels short. Long labels wrap poorly and blow out the layout.
- Indent inside the fence for readability — mermaid is whitespace-tolerant.
- One diagram per fence. Multiple diagrams in one fence error out.
- \`%% text\` is a mermaid comment inside the fence.
- If a diagram renders as raw text in the web UI, check: (a) the fence language is exactly \`mermaid\`, (b) the syntax parses at https://mermaid.live, (c) no raw \`<\` or \`>\` in labels (escape or quote them).
`;

const GUIDES: Record<string, string> = {
  migration: MIGRATION_GUIDE,
  mermaid: MERMAID_GUIDE,
};

server.registerTool(
  "list_contexts",
  {
    description: "List context folders. Opt into metadata and custom sort via params.",
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
    description: "Create a new context folder.",
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
    description: "Delete a context folder and all its items. Destructive.",
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
    description: "Read a context's metadata (title, description, status, tags, links, last_activity).",
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
    description: "Patch a context's metadata. Only fields you pass are changed. Set status='archived' to archive.",
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
    description: "List items in a context folder.",
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
    description: "Read an item. Default: parsed frontmatter + body for md, raw text otherwise. Pass raw=true for byte-for-byte contents as JSON.",
    inputSchema: GetItemArgsSchema.shape,
  },
  async (args) => {
    if (args.raw) {
      const raw = await storage.getItemRaw(args.context, args.item, args.extension);
      return json(raw);
    }

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
  "create_item",
  {
    description: "Create an item in a context. Extension defaults to md. For md, title/tags go into frontmatter.",
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
    description: "Update an item. For md, title/tags/content may all change; for others, content only.",
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
    description: "Append content to an item. Errors for json/yaml/yml — use update_item for those.",
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
    description: "Delete an item from a context. Destructive.",
    inputSchema: DeleteItemArgsSchema.shape,
  },
  async (args) => {
    await storage.deleteItem(args.context, args.item, args.extension);
    return text(`Item '${args.item}' deleted.`);
  }
);

server.registerTool(
  "revert_item",
  {
    description: "Restore the previous version of an item from its automatic snapshot. Each update_item or append_to_item call rotates the prior content into a single backup slot; revert swaps that snapshot back into place. One-shot — the revert itself is not snapshotted. Errors if no snapshot exists.",
    inputSchema: RevertItemArgsSchema.shape,
  },
  async (args) => {
    const reverted = await storage.revertItem(args.context, args.item, args.extension);
    return text(`Item '${reverted.name}.${reverted.extension}' reverted to previous version.`);
  }
);

server.registerTool(
  "context_diagnose",
  {
    description: "Server diagnostics: data dir, config path, version, counts, total bytes, scan wall-clock.",
    inputSchema: ContextDiagnoseArgsSchema.shape,
  },
  async () => {
    const diag = await storage.getDiagnostics();
    return json(diag);
  }
);

server.registerTool(
  "get_guide",
  {
    description: "Return a built-in guide. Available: 'migration' (importing existing markdown corpora), 'mermaid' (writing diagrams that render as SVG in the web UI).",
    inputSchema: GetGuideArgsSchema.shape,
  },
  async (args) => text(GUIDES[args.name])
);

server.registerTool(
  "search_contexts",
  {
    description: "Full-text search across all items. All filters optional — pass just 'query' for a broad search.",
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
