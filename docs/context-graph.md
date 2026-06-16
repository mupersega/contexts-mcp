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

- [x] **A — graph engine** (`graph.ts`): parse links, forward/backlinks, TF-IDF similarity + sanity tests. **DONE** (11/11 sanity).
- [x] **B — connections panel + `[[wiki-link]]` rendering** — **DONE.** Right-gutter panel (browser-verified) + `renderWikiLinks` resolves `[[item]]`/`[[context/item]]`(+alias) into `<a class="wikilink">`, skips code blocks, rejects invalid targets (HTTP-verified).
- [x] **C — `/graph` node-map page** — **DONE & browser-verified (screenshot viewed).** Custom vanilla-canvas force graph (repulsion + springs + gravity), drag + click-to-open, solid=link / dashed=related, degree-sized accent nodes, hub labels. `GET /graph.json` API + `/graph` page + header nav link.
- [x] **D — optional Ollama embeddings backend** — **DONE.** `CONTEXTS_SIMILARITY=ollama` → local embeddings (`nomic-embed-text`, configurable via `CONTEXTS_OLLAMA_MODEL`/`CONTEXTS_OLLAMA_URL`); ANY failure falls back to TF-IDF (deterministic sanity test). localhost-only, 4s timeout, concurrency 4.
- [x] **E — MCP graph tools** — **DONE.** `get_item_links(context,item)` (outbound/backlinks/related) + `get_graph()` (nodes by degree + edges) in index.ts, delegating to the graph engine. Build + sanity green.

**All phases A–E built, audited (fallow PASS + security review), and documented (CLAUDE.md updated).** The owner asked for ~4h of overnight iteration; A–E finished early (~1.3h in), so per "however you see fit" I'm continuing with an enhancements backlog until the ~04:52 time bound (will stop early if the backlog is exhausted or value runs low).

### Phase F — enhancements backlog (high-value first)
- [ ] F1 — color graph nodes by context (per-context hue) so different contexts are visually distinct on `/graph`.
- [ ] F2 — inline backlinks fallback at the bottom of a rendered doc for narrow windows (the gutter connections panel hides below ~1320px, so backlinks are invisible there).
- [ ] F3 — distinct rendering for unresolved `[[wiki-links]]` (target doesn't exist) vs resolved ones (e.g. a `wikilink-missing` class).
- [ ] F4 — graph: node hover label/tooltip (context + degree) and/or a filter box to highlight matching nodes.
- [ ] F5 — per-context graph (`/ctx/:context/graph`, or a context filter on `/graph`).
- [ ] F6 — toggle to include/exclude archived contexts from the graph (addresses the archived-inclusion note).
- [ ] F7 — more sanity coverage (renderWikiLinks code-block skipping; related-edge dedup; archived inclusion).
- [ ] F8 — a small connections/graph snippet on the context detail page.

## Audit results (iter 7, ~02:0x)

- **fallow audit** (`base=master`, production): **verdict PASS** — 0 dead-code, 0 complexity, 0 duplication across 10 changed files.
- **Security review (reasoned):** link + `[[wiki]]` parsing validate context/item against the name regexes before use (traversal rejected; sanity-tested); wiki hrefs are regex-constrained + labels `escHtml`'d (no XSS); `/graph` + `/graph.json` take no user params and expose only titles/structure already shown in list views; Ollama is operator-localhost-only (no SSRF, no user input); `getItemConnections` is an in-memory lookup (no path access). No issues.
- **Integrated re-verify:** build + 12/12 sanity; HTTP smoke on a fresh sandbox — item view shows TOC + connections panel + wiki-links; `/graph` & `/graph.json` 200; Graph nav link present (6/6).
- **Behavioral note (not a bug):** the graph spans ALL contexts including archived ones (archived items appear in connections/graph though they're hidden from the default list). Reasonable for a knowledge graph; flagged for the owner to confirm.
- **Perf note:** `getGraph` rebuilds the whole-corpus graph on a 5s cache miss; fine for hundreds of items, would want incremental/invalidation-on-mutation at large scale.

## Progress log

- (init) Branch created, design committed. Starting Phase A.
- iter 8 (~02:1x): **CLAUDE.md updated + Phase F backlog opened.** Documented in CLAUDE.md: `src/graph.ts` module; attachments (`assets/`) + serve route; inter-context links + `[[wiki]]` + graph; `/graph` + `/graph.json`; MCP `get_item_links`/`get_graph`; the `CONTEXTS_SIMILARITY`/`CONTEXTS_OLLAMA_*` env vars. Decision: A–E done+audited early (~1.3h vs the ~4h ask), so CONTINUING with the Phase F enhancements backlog (see above) instead of stopping; will stop at ~04:52 or when value runs low. **NEXT (iter 9): F1** — color graph nodes by context (assign a hue per distinct context, render nodes in that hue on the canvas; small legend update). Browser-verify + view screenshot (UI/visual). Known bugs: none. Local only — branch now 9 commits, nothing pushed.
- iter 7 (~02:0x): **Holistic audit pass — CLEAN.** fallow audit PASS (0 dead-code/complexity/duplication, 10 files); security re-review found no issues (see Audit results above); integrated re-verify 6/6 + 12/12 sanity. No code changes needed. **NEXT (iter 8): update CLAUDE.md** (new src/graph.ts module; inter-context links + `[[wiki-links]]`; `/graph` + `/graph.json` routes; MCP tools get_item_links/get_graph; env vars CONTEXTS_SIMILARITY / CONTEXTS_OLLAMA_URL / CONTEXTS_OLLAMA_MODEL) + write a final feature summary to this doc and the durable context; then phases A–E are complete AND audited → call CronDelete 8caeee35 and stop. Known bugs: none.
- iter 6 (~01:5x): **Phase E done — MCP graph tools → ALL PHASES A–E BUILT.** Added `get_item_links(context,item)` and `get_graph()` to src/index.ts (Zod schemas in types.ts), delegating to `graph.getItemConnections`/`getGraph`, formatted as readable text (capped 100 nodes / 200 edges). Build + 12/12 sanity green. **NEXT (iter 7): holistic audit pass** — run `mcp__fallow__audit` on the changed files; security re-review (link parsing path-safety, /graph + /graph.json routes, Ollama localhost-only, wiki-link resolution); full re-verify (build + sanity + browser smoke of item view panels + /graph). Then iter 8: update CLAUDE.md (data model: links/graph, assets already noted; the new env vars; the /graph route) + a final feature summary, and approach STOP (CronDelete 8caeee35 when audited or ~04:52). Known bugs: none. Local only, no push/merge.
- iter 5 (~01:4x): **Phase D done — optional Ollama embeddings backend.** graph.ts: `computeRelated()` selects backend — `CONTEXTS_SIMILARITY=ollama` embeds each node via POST `{CONTEXTS_OLLAMA_URL||localhost:11434}/api/embeddings` (model `CONTEXTS_OLLAMA_MODEL||nomic-embed-text`, 4s AbortController timeout, concurrency 4), cosine on vectors (threshold 0.55, topK 4); ANY error → catch → TF-IDF (threshold 0.08). buildGraph now `await computeRelated(...)`. localhost-only (operator env, not user input → no SSRF). New sanity check forces fallback with an unreachable URL → buildGraph still returns a graph. Build + 12/12 sanity green (fetch/AbortController typecheck clean on Node 22). **NEXT (iter 6): Phase E — MCP graph tools** (get_links/get_related/get_graph in index.ts + Zod schemas in types.ts) so agents can traverse the graph. Then a full audit pass (fallow audit, security review of new routes/parse, re-verify) + update CLAUDE.md. Known bugs: none. Local only.
- iter 4 (~01:3x): **Phase C done — `/graph` node-map page.** `GET /graph.json` returns `graph.getGraph()` (nodes+edges). `graphPage()` + a self-contained vanilla-canvas force-directed graph (`GRAPH_SCRIPT`): repulsion O(n^2) + edge springs (link rest 72 / related 130) + gravity-to-center + damping, requestAnimationFrame; nodes accent-colored & degree-sized, solid edges=link / dashed=related, labels for hubs+hover; drag a node (fixes it) and click → navigate to /ctx/ctx/item; caps at 200 nodes. Header nav 'Graph' link added; graph CSS. Build + 11/11 sanity; /graph.json = 8 nodes/5 edges (3 link+2 related); **browser-verified AND screenshot viewed** — real graph renders (hub 'Read Me First' with solid edges, dashed related from 'config', legend), node-click navigates. **NEXT (iter 5): Phase D — optional Ollama embeddings backend** (config flag e.g. CONTEXTS_SIMILARITY=ollama; call http://localhost:11434/api/embeddings nomic-embed-text per item, cosine on vectors; graceful fallback to TF-IDF if Ollama unreachable / flag off; localhost-only, timeout). Known bugs: none. Local only.
- iter 3 (~01:2x): **`[[wiki-link]]` rendering done — Phase B complete.** `renderWikiLinks(html, ctx)` in web.ts post-processes rendered md (splits out `<pre>`/`<code>`, leaves them verbatim), rewrites `[[item]]`/`[[context/item]]`(+`|alias`) → `<a class="wikilink" href="/ctx/..">`, validates ctx/item via name regexes (invalid → literal). Wired: `renderWikiLinks(embedMediaTags(anchored.html), context)`. Added `.wikilink` CSS (accent dotted underline). Build + 11/11 sanity green; HTTP-verified the See-also `[[evidence]]`/`[[query-target/findme]]` became wikilink anchors, no literals left. **NEXT (iter 4): Phase C — the `/graph` node-map page.** Plan: a JSON endpoint `GET /graph.json` returning `graph.getGraph()` (nodes+edges), and a `/graph` page with a custom vanilla-canvas force-directed layout (repulsion + spring + centering, drag, click-node→navigate to /ctx/ctx/item), CRT-styled (solid edges = links, dashed = related). Cap nodes rendered; browser-verify + VIEW screenshot (layout-heavy → real screenshot required). Known bugs: none.
- iter 2 (~01:1x): **Connections panel done.** Right-gutter `nav.doc-connections` on the item view (mirror of the left TOC) showing Linked-from / Links-to / Related from `graph.getItemConnections`; wired into the web.ts item route; CSS mirrors `.doc-toc`; empty groups omitted. Seeded sandbox cross-links (readme → evidence / query-target/findme / data-bits/config). Build + sanity green; browser-verified at 1500x900 (panel right-gutter, left=1244, clear of content right=1156; TOC still left). Committed. **Next: `[[wiki-link]]` inline rendering** (post-process rendered md, skip code blocks, resolve to `/ctx/...` anchors). Known bug: none.
- iter 1 (2026-06-17 00:52–01:0x): **Phase A done.** `src/graph.ts` (parseLinks for md `/ctx/..` + `[[wiki]]` links with regex validation that rejects traversal; TF-IDF cosine `tfidfRelated`; `buildGraph` → nodes per item + explicit/related edges + backlinks; cached `getGraph`/`getItemConnections`). `storage.getAllItemsContent()` reads the corpus. 3 new sanity checks pass (parse, tfidf grouping, end-to-end backlinks). Build + sanity green. Committed. **Next: Phase B** — connections panel in the right gutter on the item view + `[[wiki-link]]` rendering in the markdown pipeline.
