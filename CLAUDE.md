# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`contexts-mcp` — a local MCP server for managing persistent markdown context files across Claude Code sessions. Stores documents as markdown with YAML frontmatter in `contexts-data/`, organized into named context folders.

## Build

```
npm install && npm run build
```

## Architecture

- `src/index.ts` — MCP server entry point (stdio transport, low-level `Server` API)
- `src/types.ts` — Zod schemas for tool inputs, TypeScript interfaces
- `src/storage.ts` — All filesystem operations for contexts and documents (only module touching disk)
- `src/search.ts` — Full-text search across documents
- `contexts-data/` — Storage directory for context folders and markdown files

## Key Patterns

- Documents are markdown with YAML frontmatter (parsed with `gray-matter`)
- Context and document names must match `/^[a-zA-Z0-9_-]+$/`
- The `.md` extension is added/stripped internally — tool callers never include it
- All diagnostic logging goes to stderr (stdout is the MCP JSON-RPC transport)
- Storage path is configurable via `CONTEXTS_DATA_DIR` env var
