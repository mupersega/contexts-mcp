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
  SearchContextsArgsSchema,
} from "./types.js";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";

const server = new McpServer(
  { name: "contexts-mcp", version: "2.0.0" },
  {
    capabilities: { tools: {} },
    instructions: [
      "Persistent context folders for Claude Code sessions. A context is a folder holding items in any text format: md (default), txt, json, yaml, yml, csv. Markdown items carry frontmatter (title, tags, timestamps); other kinds have only filesystem metadata. Contexts themselves can carry optional metadata (title, description, free-form status, tags, links) — good for both knowledge-base topics and unit-of-work folders.",
      "",
      "How to use this server:",
      "- When the user asks about a topic that may already be logged, call search_contexts first before answering from scratch.",
      "- When capturing a new finding, prefer append_to_item onto an existing topical context over creating a new one — contexts work best as growing logs.",
      "- When exploring what's saved, call list_contexts with include_metadata=true so titles/status/tags are visible in one shot.",
      "- Markdown is the right default for notes and prose. Only use json/yaml/csv when the payload is structurally meaningful (and note that append_to_item is disabled for those kinds — use update_item to replace).",
    ].join("\n"),
  }
);

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));

server.registerTool(
  "list_contexts",
  {
    description:
      "List all context folders. Pass include_metadata=true to also return each context's title, description, status, tags, and links (slower, since it reads metadata for every context — but use it when you want a map of what topics exist before deciding where to write).",
    inputSchema: ListContextsArgsSchema.shape,
  },
  async (args) => {
    const summaries = await storage.listContexts(args.include_metadata);
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
      "Read a context's metadata: title, description, status, tags, and links. Returns empty defaults for contexts that have no metadata set yet.",
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
      "Set or update a context's metadata. Only the fields you pass are changed; everything else is preserved. Use this to track unit-of-work state (status, links to tickets/PRs) or to give any context a human-readable title and description.",
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
      "List all items in a context folder. Items may be markdown, txt, json, yaml, yml, or csv. Markdown items carry title/tags from YAML frontmatter; other kinds have only filesystem metadata.",
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
  "create_item",
  {
    description:
      "Create a new item in a context. Extension defaults to 'md' — pass one of (md, txt, json, yaml, yml, csv) to override. For markdown, also pass title and tags — they go into the YAML frontmatter. For other kinds, just pass content.",
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
      "Append content to an existing item. Supported for markdown, txt, and csv. Errors for structured-data kinds (json/yaml/yml) — use update_item for those.",
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
  "search_contexts",
  {
    description:
      "Full-text search across all text items in all contexts. Pass just 'query' for a broad search; all filters are optional. Narrow with 'context' (one folder), 'tags' (per-item markdown tags), or 'context_status' / 'context_tags' (context-level metadata).",
    inputSchema: SearchContextsArgsSchema.shape,
  },
  async (args) => {
    const results = await searchContexts(storage.getDataDir(), args.query, {
      contextFilter: args.context,
      tagFilter: args.tags,
      contextStatus: args.context_status,
      contextTagFilter: args.context_tags,
    });
    return json(results);
  }
);

async function main() {
  await storage.ensureDataDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Contexts MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
