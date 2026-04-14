# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`contexts-mcp` — a local MCP server (plus optional web UI) for managing persistent context folders across Claude Code sessions. Each context is a folder that can hold items in any of several text formats (md, txt, json, yaml, yml, csv) and an optional `_context.yaml` metadata file.

## Build

```
npm install && npm run build
```

## Architecture

- `src/index.ts` — MCP server entry point (stdio transport, low-level `Server` API)
- `src/types.ts` — Zod schemas for tool inputs, TypeScript interfaces, constants (`ITEM_EXTENSIONS`, name regexes, reserved filenames)
- `src/storage.ts` — All filesystem operations for contexts, items, and context metadata (only module touching disk)
- `src/search.ts` — Full-text search across items (all supported kinds)
- `src/web.ts` + `src/templates.ts` — Optional Express/HTMX web UI (CRT/terminal aesthetic, port 3141)
- `contexts-data/` — Storage directory for context folders

## Data model

- A **context** is a folder inside `contexts-data/`.
- A context may contain any number of **items**. An item is a single file with one of the whitelisted extensions: `md`, `txt`, `json`, `yaml`, `yml`, `csv`.
- A context may also contain a reserved `_context.yaml` metadata file with optional fields: `title`, `description`, `status`, `tags`, `links` (`[{label, url}]`), `created`, `updated`. `_context.yaml` is never exposed as an item.
- **Markdown items** carry YAML frontmatter (`title`, `tags`, `created`, `updated`) parsed by `gray-matter`.
- **Non-markdown items** have only filesystem-derived metadata (name, extension, size, ctime/mtime). No title or tags. If you want rich metadata on a non-md payload, put a companion `.md` in the same context.

## Key patterns

- Context names must match `/^[a-zA-Z0-9_-]+$/`.
- Item base names must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` (must start with alphanumeric to block reserved underscore-prefixed names).
- Extensions are validated at the Zod boundary and in storage when listing directory entries (defense in depth).
- Tool callers pass item names without extensions. When two items share a base name, pass `extension` to disambiguate; otherwise storage prefers `md`.
- `append_to_item` throws for `json`/`yaml`/`yml` — silently corrupting structured data is worse than erroring. Use `update_item` to replace the full content.
- All diagnostic logging goes to stderr (stdout is the MCP JSON-RPC transport).
- Storage path is configurable via `CONTEXTS_DATA_DIR` env var. Web UI port via `CONTEXTS_UI_PORT` (default 3141).
- `_context.yaml` is parsed/written with `js-yaml`; item markdown frontmatter uses `gray-matter`.
