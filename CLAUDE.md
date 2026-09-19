# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`contexts-mcp` — a local MCP server (plus optional web UI) for managing persistent context folders across Claude Code sessions. Each context is a folder that can hold items in any of several text formats (md, txt, json, yaml, yml, csv, sql) and an optional `_context.yaml` metadata file.

## Commands

- `npm install && npm run build` — compile TypeScript to `dist/`
- `npm run setup` — interactive CLI; writes platform config file (dataDir, UI port)
- `npm run ui` — start the optional web UI (default port 3141)
- `npm test` — build, then `node --test test/*.test.js`: storage + graph invariants, protocol-level tests (spawns the server, drives it with the official client in both protocol eras), and perf budgets. All against a temp dataDir.
- `npm run scale` — synthetic large-corpus probe (`N=` contexts, `K=` items each, `FULL=1` to also time the exact rebuild): corpus read, cold and incremental graph builds, search. The check for anything that must scale with corpus size.
- `npm run bench:mcp` — end-to-end stdio benchmark: latency and payload bytes/tokens per tool. `BENCH_CORPUS=<dir>` for a copy of a real corpus, `BENCH_OUT=<json>` to save for diffing. Run before and after any change that touches a tool's output or the read/write path.

## Architecture

- `src/index.ts` — MCP server entry point. SDK v2 (`@modelcontextprotocol/server`, zod 4): `buildServer()` registers the tools; `serveStdio(() => buildServer())` serves both the 2026-07-28 protocol (server/discover, per-request `_meta`, cache hints) and the legacy 2025 `initialize` handshake. Tool outputs are plain text or compact JSON, never indented JSON.
- `src/config.ts` — config file resolution; env vars override file (`CONTEXTS_DATA_DIR`, `CONTEXTS_UI_PORT`)
- `src/setup.ts` — interactive setup CLI (`npm run setup` / `contexts-mcp-setup`)
- `src/types.ts` — Zod schemas for tool inputs, TypeScript interfaces, constants (`ITEM_EXTENSIONS`, name regexes, reserved filenames)
- `src/storage.ts` — All filesystem operations for contexts, items, and context metadata (only module touching disk)
- `src/search.ts` — Full-text search across items (all supported kinds), ranked and capped. Reads from `storage.getCorpus()`, the mtime-keyed in-memory corpus cache (one stat per item per call; only changed files are re-read), which the graph build shares. Context metadata is cached the same way in `getContextMetadata`.
- `src/graph.ts` — The context graph: link parsing (markdown `/ctx/..` links + `[[wiki]]` links), backlinks, and TF-IDF / optional Ollama similarity. Pure functions (`parseLinks`, `tokenize`, `tfidfRelated`) are unit-tested in `test/graph.test.js`; `buildGraph`/`getGraph` read the corpus via `storage`. `getGraph` is stale-while-revalidate: after a write it serves the existing graph and schedules one debounced background rebuild (single-flight), so no read ever waits on a build. `whenFresh()` awaits convergence (tests). Two build modes: `auto` (every automatic rebuild) is incremental end to end: only items whose size/mtime changed are re-tokenized (persisted per-document index, `.graph-index.json`, which also stores each item's neighbour list), and only those items are re-scored against the in-memory pruned state (top 100 terms per doc, inverted index, terms in >20% of docs skipped); their neighbour lists and the lists of the docs they touch are patched in place. When more than 10% of the corpus (or 50 items) changed at once, or nothing is indexed yet, it runs one pruned full pass instead, which also resets IDF drift. `full` (manual only: `rebuild_graph` tool, or the button on `/graph`) drops every cache and runs the exact all-pairs `tfidfRelated`. Measured with `npm run scale`: an incremental rebuild after one edit is ~80 ms at 2,000 items and ~190 ms at 6,000 (most of it rewriting the index file); the pruned full pass is a few seconds at those sizes; the exact pass is minutes. Build stats (`pass`, `reindexed`, `rescored`) are returned by `rebuild_graph` and shown on `/graph`.
- `src/web.ts` + `src/templates.ts` — Optional Express/HTMX web UI (CRT/terminal aesthetic, port 3141). Also serves attachments (`/ctx/:context/assets/:file`) and the graph (`/graph` page + `/graph.json` API).
- `contexts-data/` — Default storage directory for context folders (override via config file or `CONTEXTS_DATA_DIR`)

## Data model

- A **context** is a folder inside `contexts-data/`.
- A context may contain any number of **items**. An item is a single file with one of the whitelisted extensions: `md`, `txt`, `json`, `yaml`, `yml`, `csv`, `sql`.
- A context may also contain a reserved `_context.yaml` metadata file with optional fields: `title`, `description`, `status`, `tags`, `links` (`[{label, url}]`), `created`, `updated`. `_context.yaml` is never exposed as an item.
- **Markdown items** carry YAML frontmatter (`title`, `tags`, `created`, `updated`) parsed by `gray-matter`.
- **Non-markdown items** have only filesystem-derived metadata (name, extension, size, ctime/mtime). No title or tags. If you want rich metadata on a non-md payload, put a companion `.md` in the same context.
- A context may also contain a reserved `assets/` subfolder holding **binary attachments** (png/jpg/webp/mp4/webm/mp3/wav/pdf…). Added via the `add_attachment` MCP tool (copies a local file in); served at `/ctx/:context/assets/:file`; referenced from markdown with `![alt](assets/file.png)` (video/webm auto-render as `<video>`). Never exposed as items.
- A markdown item with `view: exhibit` frontmatter renders in the web UI as an **exhibit**: the first ```exhibit fence (JSON — figures with point `at`/region `rect` pins, notes, item chips, edges) drawn as an annotated pan/zoom canvas. Layout is deterministic (seeded from the fence text; no positions stored) and declaration order doubles as a built-in step-through presentation (`?step=N`, `?play=<ms>` auto-advance with an `exhibit-play-done` completion signal, `?kiosk=1` chrome-free, `?doc=1` document fallback). The authoring reference is served by the system itself: `get_guide({ name: 'exhibit' })`. Geometry and presentation invariants are asserted end-to-end by `npm run exhibit-check` (real headless Chrome via raw CDP; skips loudly without Chrome).
- **Inter-context links** form a graph: markdown links to `/ctx/<context>/<item>` and `[[<context>/<item>]]` / `[[<item>]]` wiki-links are edges; `graph.ts` adds backlinks and TF-IDF (or optional Ollama) "related" edges. Surfaced as the right-gutter connections panel on item views, the `/graph` node-map page, and the `get_item_links` / `get_graph` MCP tools.

## Key patterns

- Context names must match `/^[a-zA-Z0-9_-]+$/`.
- Item base names must match `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` (must start with alphanumeric to block reserved underscore-prefixed names).
- Extensions are validated at the Zod boundary and in storage when listing directory entries (defense in depth).
- Tool callers pass item names without extensions. When two items share a base name, pass `extension` to disambiguate; otherwise storage prefers `md`.
- `append_to_item` throws for `json`/`yaml`/`yml` — silently corrupting structured data is worse than erroring. Use `update_item` to replace the full content.
- Every `update_item`/`append_to_item`/`edit_item` snapshots the prior file to a sibling `.{name}.{ext}.bak` (one-shot). `revert_item` swaps backup ↔ live. Don't write `.bak` files yourself.
- Payload discipline: Claude Code truncates a single MCP result over ~25k tokens and warns at ~10k. `get_item` cuts unpaged reads at 60 KB with a continuation note (`offset`/`limit` page by line); `search_contexts` ranks and caps (`limit`, `lines_per_item`, ~200-char line windows); listings are one line per entry. Keep new tool outputs in that spirit, and check `npm run bench:mcp` bytes/tokens columns.
- `edit_item` is the intended way to change part of an item (exact `old_string` to `new_string`, must be unique unless `replace_all`); `update_item` rewrites the whole body and costs the model the whole item in output tokens.
- Parse markdown with `storage.parseMarkdown()` (gray-matter with an explicit options object). Bare `matter(raw)` memoizes every distinct input forever.
- Config file lives at platform-standard paths: `%APPDATA%/contexts-mcp/config.json` (Windows), `~/Library/Application Support/contexts-mcp/config.json` (macOS), `$XDG_CONFIG_HOME/contexts-mcp/config.json` (Linux). Env vars (`CONTEXTS_DATA_DIR`, `CONTEXTS_UI_PORT`) override the file at runtime.
- The graph's "related" edges use zero-dependency TF-IDF by default. Set `CONTEXTS_SIMILARITY=ollama` (optionally `CONTEXTS_OLLAMA_URL`, default `http://localhost:11434`, and `CONTEXTS_OLLAMA_MODEL`, default `nomic-embed-text`) to use local Ollama embeddings instead — any failure falls back to TF-IDF, so it is always safe. The Ollama endpoint is operator-configured (never user input) — no SSRF surface.
- All diagnostic logging goes to stderr (stdout is the MCP JSON-RPC transport).
- `_context.yaml` is parsed/written with `js-yaml`; item markdown frontmatter uses `gray-matter`.
