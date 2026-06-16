# Inter-context linking & the context graph (design + progress)

> Status: **in progress on `feat/context-graph` (local branch — do NOT push/merge without review).**
> Exploratory. Built overnight while the owner was away. Heavily audited; not production-blessed.

## Goal

Make the pile of context items navigable as a connected knowledge graph, three ways:

1. **Explicit links** — an item references another (markdown link to an internal URL, or a `[[context/item]]` wiki-link). Compute **backlinks**.
2. **Node map** — a force-directed graph view (custom canvas, CRT-styled — *not* an Obsidian clone) plus a right-gutter "connections" panel on the item view.
3. **Semantic links** — surface items that cover similar topics ("both talk about the database"), even without an explicit link.

## Key decisions (made autonomously; owner was away)

- **Semantic backend = TF-IDF first, Ollama optional.** TF-IDF cosine similarity is pure JS, offline, deterministic, zero-dep, and catches topical overlap well. An **Ollama embeddings backend** (`/api/embeddings`, e.g. `nomic-embed-text`) is added behind a config flag with **graceful fallback to TF-IDF** if Ollama is unreachable. Rationale: the feature must work out of the box; Ollama makes it *better*, not *required*.
- **Graph viz = custom vanilla canvas force-directed graph.** No library (consistent with the no-bundler SSR app; matches the terminal aesthetic; "our own thing"). Loaded only on the graph page.
- **Layout = use the gutters.** Left gutter already holds the TOC; the right gutter gets the **connections panel** (outbound / backlinks / related). A dedicated `/graph` page holds the full map.
- **Link syntax.** Standard markdown links to `/ctx/<context>` and `/ctx/<context>/<item>` are detected as edges. Plus `[[item]]` (same context) and `[[context/item]]` (cross) wiki-links, rendered as resolved links and counted as edges. (`[[ ]]` is a broad convention — MediaWiki/Roam/etc. — not an Obsidian copy.)
- **Edge kinds.** Explicit links = solid edges. Semantic "related" = dashed/weaker edges, capped at top-K per item.

## Safety / audit focus

- **Path safety:** resolving `[[context/item]]` and any graph API input MUST go through the existing validated storage paths (`assertWithin`, name regexes). No traversal. A wiki-link is a *reference*, never a filesystem path the user controls directly.
- **New routes** validate context/item names like every other route.
- **Ollama** is called at `http://localhost:11434` only (no user-supplied host) — no SSRF surface. Timeout + fallback on any failure.
- **Performance:** building the graph reads all items. Cache the parsed graph; cap corpus work; recompute on mutation (or TTL). Cap node/edge counts rendered.
- Audits: `npm run sanity` (graph unit tests), `fallow audit` on changed files, a security pass, and real-browser verification of the panel + canvas graph.

## Architecture

- `src/graph.ts` (new): `parseLinks(content)`, `buildGraph()`, TF-IDF `similarity()`, pluggable embedding backend. Pure logic; storage reads via `storage.ts`.
- `src/storage.ts`: helper(s) to enumerate all items + content for the graph (reuse `listContexts`/`listItems`/`getItem`).
- `src/web.ts`: `/graph` page + a JSON graph API + a per-item connections fragment; wiki-link + link-edge detection folded into the markdown render pipeline (alongside `anchorHeadings`/`embedMediaTags`).
- `src/templates.ts`: connections panel (right gutter), graph page shell + canvas script.
- `src/index.ts`: MCP tools — `get_links(context,item)`, `get_related(...)`, `get_graph()`.

## Phases

- [ ] **A — graph engine** (`graph.ts`): parse links, forward/backlinks, TF-IDF similarity + sanity tests.
- [ ] **B — connections panel** (right gutter) + `[[wiki-link]]` rendering.
- [ ] **C — `/graph` node-map page** (custom canvas), browser-verified.
- [ ] **D — optional Ollama embeddings backend** (flagged, fallback-safe).
- [ ] **E — MCP tools** for agents to traverse the graph.

## Progress log

- (init) Branch created, design committed. Starting Phase A.
