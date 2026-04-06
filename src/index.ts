#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  ListContextsArgsSchema,
  CreateContextArgsSchema,
  DeleteContextArgsSchema,
  ListDocumentsArgsSchema,
  GetDocumentArgsSchema,
  CreateDocumentArgsSchema,
  UpdateDocumentArgsSchema,
  AppendToDocumentArgsSchema,
  SearchContextsArgsSchema,
} from "./types.js";
import * as storage from "./storage.js";
import { searchContexts } from "./search.js";

const server = new Server(
  { name: "contexts-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_contexts",
        description:
          "List all available context folders. Returns an array of context names.",
        inputSchema: zodToJsonSchema(ListContextsArgsSchema),
      },
      {
        name: "create_context",
        description:
          "Create a new named context folder for organizing related documents. Name must be alphanumeric with hyphens/underscores.",
        inputSchema: zodToJsonSchema(CreateContextArgsSchema),
      },
      {
        name: "delete_context",
        description:
          "Delete a context folder and all documents it contains. This is destructive and cannot be undone.",
        inputSchema: zodToJsonSchema(DeleteContextArgsSchema),
      },
      {
        name: "list_documents",
        description:
          "List all documents in a context folder with their metadata (title, tags, created/updated timestamps).",
        inputSchema: zodToJsonSchema(ListDocumentsArgsSchema),
      },
      {
        name: "get_document",
        description:
          "Read a specific document's full content and metadata from a context. Returns the YAML frontmatter and markdown body.",
        inputSchema: zodToJsonSchema(GetDocumentArgsSchema),
      },
      {
        name: "create_document",
        description:
          "Create a new markdown document in a context with title, tags, and content. Automatically adds YAML frontmatter with timestamps.",
        inputSchema: zodToJsonSchema(CreateDocumentArgsSchema),
      },
      {
        name: "update_document",
        description:
          "Update an existing document's title, tags, and/or content. Only provided fields are changed. Automatically updates the 'updated' timestamp.",
        inputSchema: zodToJsonSchema(UpdateDocumentArgsSchema),
      },
      {
        name: "append_to_document",
        description:
          "Append additional markdown content to an existing document. Useful for enriching documents over time across sessions. Automatically updates the 'updated' timestamp.",
        inputSchema: zodToJsonSchema(AppendToDocumentArgsSchema),
      },
      {
        name: "search_contexts",
        description:
          "Full-text search across all contexts or within a specific context. Optionally filter by tags. Returns matching documents with relevant line snippets.",
        inputSchema: zodToJsonSchema(SearchContextsArgsSchema),
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "list_contexts": {
        const contexts = await storage.listContexts();
        return {
          content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }],
        };
      }

      case "create_context": {
        const parsed = CreateContextArgsSchema.parse(args);
        await storage.createContext(parsed.name);
        return {
          content: [
            { type: "text", text: `Context '${parsed.name}' created.` },
          ],
        };
      }

      case "delete_context": {
        const parsed = DeleteContextArgsSchema.parse(args);
        await storage.deleteContext(parsed.name);
        return {
          content: [
            { type: "text", text: `Context '${parsed.name}' deleted.` },
          ],
        };
      }

      case "list_documents": {
        const parsed = ListDocumentsArgsSchema.parse(args);
        const docs = await storage.listDocuments(parsed.context);
        return {
          content: [{ type: "text", text: JSON.stringify(docs, null, 2) }],
        };
      }

      case "get_document": {
        const parsed = GetDocumentArgsSchema.parse(args);
        const doc = await storage.getDocument(parsed.context, parsed.document);
        const output = [
          "---",
          `title: ${JSON.stringify(doc.meta.title)}`,
          `tags: ${JSON.stringify(doc.meta.tags)}`,
          `created: ${doc.meta.created}`,
          `updated: ${doc.meta.updated}`,
          "---",
          "",
          doc.content,
        ].join("\n");
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "create_document": {
        const parsed = CreateDocumentArgsSchema.parse(args);
        await storage.createDocument(
          parsed.context,
          parsed.document,
          parsed.title,
          parsed.tags,
          parsed.content
        );
        return {
          content: [
            {
              type: "text",
              text: `Document '${parsed.document}' created in context '${parsed.context}'.`,
            },
          ],
        };
      }

      case "update_document": {
        const parsed = UpdateDocumentArgsSchema.parse(args);
        await storage.updateDocument(parsed.context, parsed.document, {
          title: parsed.title,
          tags: parsed.tags,
          content: parsed.content,
        });
        return {
          content: [
            { type: "text", text: `Document '${parsed.document}' updated.` },
          ],
        };
      }

      case "append_to_document": {
        const parsed = AppendToDocumentArgsSchema.parse(args);
        await storage.appendToDocument(
          parsed.context,
          parsed.document,
          parsed.content
        );
        return {
          content: [
            {
              type: "text",
              text: `Content appended to '${parsed.document}'.`,
            },
          ],
        };
      }

      case "search_contexts": {
        const parsed = SearchContextsArgsSchema.parse(args);
        const results = await searchContexts(
          storage.getDataDir(),
          parsed.query,
          parsed.context,
          parsed.tags
        );
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

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
