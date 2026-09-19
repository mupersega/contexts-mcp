#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

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
  EditItemArgsSchema,
  GetGuideArgsSchema,
  AddAttachmentArgsSchema,
  ListAttachmentsArgsSchema,
  DeleteAttachmentArgsSchema,
  GetItemLinksArgsSchema,
  GetGraphArgsSchema,
  RebuildGraphArgsSchema,
} from "./types.js";
import * as storage from "./storage.js";
import * as graph from "./graph.js";
import { searchContexts, SearchResult } from "./search.js";
import { loadConfig, MissingDataDirError, packageVersion } from "./config.js";

const INSTRUCTIONS =
  "Persistent context folders for Claude Code sessions. A context is a folder holding items in md (default), txt, json, yaml, yml, csv, or sql. Markdown items carry frontmatter (title, tags, timestamps); other kinds carry only filesystem metadata. Contexts themselves can carry optional metadata (title, description, free-form status, tags, links). Prefer search_contexts before answering topics that may already be logged, and prefer append_to_item on an existing item over creating parallel items. To change part of an existing item use edit_item (exact old_string -> new_string) rather than update_item, which rewrites the whole body. Large items are paged: get_item accepts offset/limit (lines). Items also form a graph: use search_contexts to find an entry point, then expand from it — get_item already appends a Connections footer, and get_item_links gives the full set of linked, back-linked, and related items. Backlinks in particular surface references that keyword search misses. Markdown supports mermaid fences (```mermaid) that render as SVG diagrams in the optional web UI — prefer them over hand-drawn ASCII art; call get_guide({ name: 'mermaid' }) for syntax. Markdown items with `view: exhibit` frontmatter render as exhibits — screenshots annotated with claims, built for presenting findings that map onto images (QA evidence, design review); agents are the intended authors. Call get_guide({ name: 'exhibit' }) for the fence schema, grouping, presentation mode, and recordable walkthrough URLs.";

// Tool-result payload budget for a single get_item without an explicit limit.
// Claude Code warns at ~10k tokens per MCP result and hard-truncates at ~25k;
// 60 KB (~15k tokens) keeps whole reads under the cap while still returning
// most items in one call. Anything bigger is cut at a line boundary with a
// note that says exactly how to continue.
const DEFAULT_MAX_ITEM_BYTES = 60_000;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
// Compact JSON: the reader is a model, and 2-space indentation is ~25% more
// tokens for no information.
const json = (value: unknown) => text(JSON.stringify(value));

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MUTATING = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const fmtDate = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

// Page a body by lines. Without offset/limit the whole body is returned unless
// it exceeds maxBytes, in which case it is cut at a line boundary. The header
// line goes first so it survives any downstream truncation.
export function pageLines(
  body: string,
  offset: number | undefined,
  limit: number | undefined,
  maxBytes = DEFAULT_MAX_ITEM_BYTES
): { text: string; header: string | null } {
  const lines = body.split("\n");
  // A trailing newline is not an extra (empty) line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  const requested = Math.max((offset ?? 1) - 1, 0);
  if (requested >= total) {
    // Paging past the end must say so — clamping to the last line returns
    // plausible-looking content for the wrong lines.
    return { text: "", header: `[offset ${offset} is beyond the end of the item (${total} lines)]` };
  }
  const start = requested;
  let end: number;
  if (limit !== undefined) {
    end = Math.min(total, start + limit);
  } else {
    end = total;
    let bytes = 0;
    for (let i = start; i < total; i++) {
      bytes += Buffer.byteLength(lines[i], "utf8") + 1;
      if (bytes > maxBytes && i > start) {
        end = i;
        break;
      }
    }
  }
  const slice = lines.slice(start, end).join("\n");
  if (start === 0 && end === total) return { text: slice, header: null };
  const next = end < total ? `; continue with offset=${end + 1}` : "; end of item";
  const why = limit === undefined && end < total ? ` (${fmtSize(maxBytes)} cap)` : "";
  return { text: slice, header: `[lines ${start + 1}-${end} of ${total}${why}${next}]` };
}

function formatSearch(query: string, results: SearchResult[], total: number): string {
  if (results.length === 0) return `No matches for "${query}".`;
  const out: string[] = [];
  for (const r of results) {
    const tags = r.tags.length ? ` [${r.tags.join(", ")}]` : "";
    const ext = r.extension === "md" ? "" : ` (${r.extension})`;
    const more = r.matchCount > r.matches.length ? ` (+${r.matchCount - r.matches.length} more lines)` : "";
    out.push(`${r.context}/${r.item}${ext} — ${r.title}${tags}${more}`);
    for (const line of r.matches) out.push(`    ${line}`);
  }
  const footer =
    total > results.length
      ? `\n${results.length} of ${total} matching items shown (best first). Narrow with context=/tags=, or raise limit.`
      : `\n${total} matching item${total === 1 ? "" : "s"}.`;
  return out.join("\n") + footer;
}

// A compact, token-light connections block appended to get_item reads so an
// agent discovers the graph in its normal search -> read loop instead of having
// to know to call get_item_links. Backlinks especially surface references that
// keyword search won't. Omitted entirely when an item has no connections, and a
// graph hiccup never breaks a plain read. Cheap now that getGraph is cached.
async function connectionsFooter(context: string, item: string): Promise<string> {
  let c: Awaited<ReturnType<typeof graph.getItemConnections>>;
  try {
    c = await graph.getItemConnections(context, item);
  } catch {
    return "";
  }
  if (!c.outbound.length && !c.backlinks.length && !c.related.length) return "";
  const cap = (refs: { context: string; item: string }[], n: number): string => {
    const shown = refs.slice(0, n).map((r) => `${r.context}/${r.item}`);
    const extra = refs.length - shown.length;
    return shown.join(", ") + (extra > 0 ? `, +${extra} more` : "");
  };
  const out: string[] = [];
  if (c.outbound.length) out.push(`Links to:    ${cap(c.outbound, 8)}`);
  if (c.backlinks.length) out.push(`Linked from: ${cap(c.backlinks, 8)}`);
  if (c.related.length) {
    const rel = c.related
      .slice(0, 5)
      .map((r) => `${r.context}/${r.item} (${Math.round(r.score * 100) / 100})`);
    const extra = c.related.length - rel.length;
    out.push(`Related:     ${rel.join(", ")}${extra > 0 ? `, +${extra} more` : ""}`);
  }
  return `\n\n--- Connections ---\n${out.join("\n")}\n(get_item_links for the full set)`;
}

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


// The exhibit guide is the system's own documentation for agents: everything
// needed to author and drive an exhibit arrives through get_guide —
// no external skill or README required.
const EXHIBIT_GUIDE = `# Exhibits (view: exhibit)

A markdown item whose frontmatter has \`view: exhibit\` renders in the web UI
as an exhibit: a pannable canvas of screenshots with drawn annotations, instead
of a top-to-bottom document. Use one whenever findings map onto images — QA
evidence, design review, before/after comparisons. Exhibits are FOR AGENTS to
author: the file is plain text, and writing it in argument order also writes the
presentation.

## Authoring

The item body is ordinary markdown; the FIRST \`\`\`exhibit fence is the exhibit's
declaration (JSON). Everything else in the body is shown only in ?doc=1 mode.

\`\`\`exhibit
{
  "nodes": [
    { "id": "shot-a", "type": "figure", "src": "assets/checkout.png",
      "caption": "Checkout after the fix",
      "pins": [
        { "at": [0.62, 0.18], "text": "tax line no longer doubles" },
        { "rect": [0.40, 0.62, 0.20, 0.11], "text": "button de-glossed" }
      ] },
    { "id": "finding", "type": "item", "link": "qa-round-3/finding-12" },
    { "id": "memo", "type": "note", "text": "all checkout regressions land here" }
  ],
  "edges": [ { "from": "finding", "to": "shot-a#2", "label": "resolved" } ]
}
\`\`\`

- figure: \`src\` is a path into this context's assets/ (add images with
  add_attachment). \`pins\` anchor claims to the image: \`at: [x, y]\` marks a
  point, \`rect: [x, y, w, h]\` outlines a region (a button, a heading) — all
  coordinates normalized 0-1 relative to the image. Use rect ONLY when the
  region's position is known or verified (you produced or measured the
  screenshot); a misplaced box is worse than no box. When unsure, use a point
  pin — it is forgiving. Write each pin's \`text\` as
  a standalone claim; the exhibit is a claims graph that happens to render
  spatially.
- item: \`link\` is a wiki target ("item" in this context, or "ctx/item");
  renders as a clickable chip. note: free-text card.
- edges: \`from\`/\`to\` reference a node id, or \`id#pin\` (pin ids default to
  "1", "2", ... in declaration order). Optional \`label\`.
- Layout is automatic and deterministic (same file, same arrangement) — never
  write positions. Figures with 6+ pins collapse to a numbered legend.
- group: any node may carry \`"group": "<id>"\` — nodes sharing a group settle
  together inside a faint titled region, and the regions pack against each
  other (optional top-level \`"groups": {"<id>": {"title": "..."}}\` names
  them). ONE level only, no nesting. Use a group per study/screen/topic; keep
  cross-cutting notes ungrouped so they sit between the regions they discuss.

## Order is the presentation

Declaration order of nodes (and each figure's pins) IS the step order of the
exhibit's built-in presentation mode. Write the fence in the order the argument
should unfold; the overview is the final step.

## URLs (for driving or recording a walkthrough)

- /ctx/<context>/<item> — the exhibit. ?doc=1 — same item as a document.
- ?step=N — enter presentation at step N (deep-linkable).
- ?step=1&play=<ms>&kiosk=1 — auto-advance every <ms> milliseconds, page
  chrome hidden: the recordable URL. On reaching the overview the page sets
  window.__exhibitPlayDone = true and dispatches "exhibit-play-done". Any user
  input cancels auto-play. Layout is deterministic, so every run frames
  identically.
`;

const GUIDES: Record<string, string> = {
  migration: MIGRATION_GUIDE,
  mermaid: MERMAID_GUIDE,
  exhibit: EXHIBIT_GUIDE,
};

// One factory serves both protocol eras: serveStdio pins one instance per
// connection after the opening exchange decides whether the client speaks
// 2026-07-28 (server/discover, per-request _meta) or the 2025 initialize
// handshake. Registration order is the tools/list order — keep it stable so
// hosts can cache the list (and prompt caches hit).
export function buildServer(): McpServer {
const server = new McpServer(
  { name: "contexts-mcp", version: packageVersion() },
  {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
    // tools/list never changes for a running process; let 2026-era hosts cache it.
    cacheHints: { "tools/list": { ttlMs: 3_600_000, cacheScope: "private" } },
  }
);

server.registerTool(
  "list_contexts",
  {
    description: "List context folders, one per line. include_metadata adds status, title, tags, last activity and description.",
    inputSchema: ListContextsArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    const all = await storage.listContexts({
      includeMetadata: args.include_metadata,
      sort: args.sort,
      includeArchived: args.include_archived,
    });
    const summaries = all.slice(0, args.limit);
    const more =
      all.length > summaries.length
        ? `\n${summaries.length} of ${all.length} contexts shown; raise limit or change sort.`
        : "";
    if (!args.include_metadata) return text((summaries.map((s) => s.name).join("\n") || "(no contexts)") + more);
    const lines = summaries.map((c) => {
      const m = c.metadata;
      const head = [c.name, m?.status ? `[${m.status}]` : "", m?.title ? `— ${m.title}` : ""].filter(Boolean).join(" ");
      const bits: string[] = [];
      if (m?.tags?.length) bits.push(`tags: ${m.tags.join(", ")}`);
      if (m?.last_activity) bits.push(`active ${fmtDate(m.last_activity)}`);
      if (m?.links?.length) bits.push(m.links.map((l) => `${l.label}: ${l.url}`).join(" | "));
      const desc = m?.description ? `\n    ${m.description}` : "";
      return `${head}${bits.length ? `  (${bits.join("; ")})` : ""}${desc}`;
    });
    return text((lines.join("\n") || "(no contexts)") + more);
  }
);

server.registerTool(
  "create_context",
  {
    description: "Create a new context folder.",
    inputSchema: CreateContextArgsSchema,
    annotations: MUTATING,
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
    inputSchema: DeleteContextArgsSchema,
    annotations: DESTRUCTIVE,
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
    inputSchema: GetContextArgsSchema,
    annotations: READ_ONLY,
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
    inputSchema: UpdateContextMetadataArgsSchema,
    annotations: MUTATING,
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
    description: "List items in a context folder (most recently updated first): name, size, updated, title, tags.",
    inputSchema: ListItemsArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    const items = await storage.listItems(args.context);
    if (!items.length) return text(`No items in '${args.context}'.`);
    const lines = items.map((i) => {
      const tags = i.tags.length ? ` [${i.tags.join(", ")}]` : "";
      return `${i.name}.${i.extension}  ${fmtSize(i.size).padStart(8)}  ${fmtDate(i.updated)}  ${i.title}${tags}`;
    });
    return text(`name  size  updated  title [tags]\n${lines.join("\n")}`);
  }
);

server.registerTool(
  "get_item",
  {
    description: "Read an item: frontmatter + body for md, raw text otherwise, then a compact Connections footer (links/backlinks/related) when it has any. Large items are cut at ~60 KB with a note; page with offset/limit (1-based lines). raw=true returns byte-for-byte contents as JSON (no footer, no paging).",
    inputSchema: GetItemArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    if (args.raw) {
      const raw = await storage.getItemRaw(args.context, args.item, args.extension);
      return json(raw);
    }

    const item = await storage.getItem(args.context, args.item, args.extension);
    const footer = await connectionsFooter(args.context, item.name);
    const page = pageLines(item.content, args.offset, args.limit);
    const pageNote = page.header ? `${page.header}\n` : "";

    if (item.extension === "md" && item.frontmatter) {
      const fm = item.frontmatter;
      const output = [
        "---",
        `title: ${JSON.stringify(fm.title)}`,
        `tags: ${JSON.stringify(fm.tags)}`,
        `created: ${fm.created}`,
        `updated: ${fm.updated}`,
        "---",
        pageNote,
        page.text,
      ].join("\n");
      return text(output + footer);
    }

    const header = `[${item.extension.toUpperCase()}] ${item.name}.${item.extension} (${fmtSize(item.size)}, updated ${fmtDate(item.updated)})`;
    return text(`${header}\n${pageNote}\n${page.text}${footer}`);
  }
);

server.registerTool(
  "create_item",
  {
    description: "Create an item in a context. Extension defaults to md. For md, title/tags go into frontmatter.",
    inputSchema: CreateItemArgsSchema,
    annotations: MUTATING,
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
    description: "Replace an item's whole content (and title/tags for md). For partial changes prefer edit_item, which costs only the changed text.",
    inputSchema: UpdateItemArgsSchema,
    annotations: MUTATING,
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
    inputSchema: AppendToItemArgsSchema,
    annotations: MUTATING,
  },
  async (args) => {
    await storage.appendToItem(args.context, args.item, args.content, args.extension);
    return text(`Content appended to '${args.item}'.`);
  }
);

server.registerTool(
  "edit_item",
  {
    description:
      "Replace an exact substring of an item (old_string -> new_string). The cheap way to change part of an item: send only the text that changes, not the whole body. old_string must occur exactly once (include surrounding lines to disambiguate) unless replace_all=true. For md, matches against the body only; frontmatter is preserved. Snapshots for revert_item like update_item.",
    inputSchema: EditItemArgsSchema,
    annotations: MUTATING,
  },
  async (args) => {
    const r = await storage.editItem(args.context, args.item, args.old_string, args.new_string, {
      extension: args.extension,
      replaceAll: args.replace_all,
    });
    return text(`Item '${r.name}.${r.extension}' edited (${r.replacements} replacement${r.replacements === 1 ? "" : "s"}).`);
  }
);

server.registerTool(
  "add_attachment",
  {
    description:
      "Copy a local file (image/video/audio/pdf) into a context's assets/ folder as an attachment, then reference it from markdown with ![alt](assets/<filename>). Ideal for an agent saving screenshots, webm recordings, or reports into a durable context.",
    inputSchema: AddAttachmentArgsSchema,
    annotations: MUTATING,
  },
  async (args) => {
    const info = await storage.addAttachment(args.context, args.source_path, args.name);
    return text(
      `Attachment '${info.filename}' added to '${args.context}' (${info.size} bytes).\n` +
        `Embed in a markdown item: ![${info.filename}](assets/${info.filename})`
    );
  }
);

server.registerTool(
  "list_attachments",
  {
    description: "List the attachments stored in a context's assets/ folder.",
    inputSchema: ListAttachmentsArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    const list = await storage.listAttachments(args.context);
    if (!list.length) return text(`No attachments in '${args.context}'.`);
    return text(
      list.map((a) => `${a.filename}  (${a.size} bytes, updated ${a.updated})`).join("\n")
    );
  }
);

server.registerTool(
  "delete_attachment",
  {
    description: "Delete an attachment from a context's assets/ folder. Destructive.",
    inputSchema: DeleteAttachmentArgsSchema,
    annotations: DESTRUCTIVE,
  },
  async (args) => {
    await storage.deleteAttachment(args.context, args.filename);
    return text(`Attachment '${args.filename}' deleted from '${args.context}'.`);
  }
);

server.registerTool(
  "get_item_links",
  {
    description:
      "Expand context around an item via the graph: its outbound links, backlinks (what references it — keyword search won't surface these), and semantically-related items. Reach for this after search_contexts lands you on a relevant item, to pull in the directly-connected context a keyword match alone would miss.",
    inputSchema: GetItemLinksArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    const c = await graph.getItemConnections(args.context, args.item);
    const line = (r: { context: string; item: string; title: string; score?: number }) =>
      `  - ${r.context}/${r.item}${typeof r.score === "number" ? ` (${Math.round(r.score * 100) / 100})` : ""} — ${r.title}`;
    const fmt = (refs: { context: string; item: string; title: string; score?: number }[]) =>
      refs.length ? refs.map(line).join("\n") : "  (none)";
    return text(
      `Connections for ${args.context}/${args.item}:\n\n` +
        `Links to:\n${fmt(c.outbound)}\n\n` +
        `Linked from:\n${fmt(c.backlinks)}\n\n` +
        `Related:\n${fmt(c.related)}`
    );
  }
);

server.registerTool(
  "get_graph",
  {
    description:
      "Summarize the whole context graph — items as nodes (with connection degree) and the link/related edges between them.",
    inputSchema: GetGraphArgsSchema,
    annotations: READ_ONLY,
  },
  async () => {
    const g = await graph.getGraph();
    const linkCount = g.edges.filter((e) => e.kind === "link").length;
    const nodes = g.nodes.slice().sort((a, b) => b.degree - a.degree);
    const nodeLines = nodes
      .slice(0, 100)
      .map((n) => `  - ${n.id} (deg ${n.degree}) — ${n.title}`)
      .join("\n");
    const edgeLines = g.edges
      .slice(0, 200)
      .map((e) => `  ${e.source} ${e.kind === "link" ? "->" : "~"} ${e.target}`)
      .join("\n");
    return text(
      `Context graph: ${g.nodes.length} nodes, ${g.edges.length} edges (${linkCount} links, ${g.edges.length - linkCount} related).\n\n` +
        `Nodes by degree:\n${nodeLines}${g.nodes.length > 100 ? `\n  …and ${g.nodes.length - 100} more` : ""}\n\n` +
        `Edges (-> link, ~ related):\n${edgeLines}${g.edges.length > 200 ? `\n  …and ${g.edges.length - 200} more` : ""}`
    );
  }
);

server.registerTool(
  "rebuild_graph",
  {
    description:
      "Rebuild the context graph on demand. Automatic rebuilds are incremental and pruned (fast, run in the background after writes). mode='full' (default) drops every cache, re-reads everything and runs the exact all-pairs similarity for the best link quality; expect minutes on a large corpus. Returns build stats.",
    inputSchema: RebuildGraphArgsSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    const s = await graph.rebuildGraph(args.mode);
    return text(
      `Graph rebuilt (${s.mode}, ${s.pass}, ${s.similarity}) in ${(s.ms / 1000).toFixed(1)}s: ${s.nodes} nodes, ${s.edges} edges, ${s.reindexed} items re-indexed, ${s.rescored} re-scored.`
    );
  }
);

server.registerTool(
  "delete_item",
  {
    description: "Delete an item from a context. Destructive.",
    inputSchema: DeleteItemArgsSchema,
    annotations: DESTRUCTIVE,
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
    inputSchema: RevertItemArgsSchema,
    annotations: MUTATING,
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
    inputSchema: ContextDiagnoseArgsSchema,
    annotations: READ_ONLY,
  },
  async () => {
    const diag = await storage.getDiagnostics();
    return json(diag);
  }
);

server.registerTool(
  "get_guide",
  {
    description: "Return a built-in guide. Available: 'migration' (importing existing markdown corpora), 'mermaid' (writing diagrams that render as SVG in the web UI), 'exhibit' (authoring exhibits: view: exhibit items that render screenshots with drawn annotations, grouping, presentation mode, recordable walkthrough URLs).",
    inputSchema: GetGuideArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => text(GUIDES[args.name])
);

server.registerTool(
  "search_contexts",
  {
    description: "Case-insensitive full-text search across items, best matches first (title and tag hits rank above body hits). Returns context/item, title, tags and a few trimmed matching lines per item. Default limit 20; all filters optional.",
    inputSchema: SearchContextsArgsSchema,
    annotations: READ_ONLY,
  },
  async (args) => {
    const results = await searchContexts(storage.getDataDir(), args.query, {
      contextFilter: args.context,
      tagFilter: args.tags,
      contextStatus: args.context_status,
      contextTagFilter: args.context_tags,
      includeArchived: args.include_archived,
      limit: args.limit,
      linesPerItem: args.lines_per_item,
    });
    return text(formatSearch(args.query, results.results, results.total));
  }
);

return server;
}

async function main(): Promise<void> {
  try {
    const cfg = loadConfig();
    console.error(`[contexts-mcp] version:   ${packageVersion()}`);
    console.error(`[contexts-mcp] data dir:  ${cfg.dataDir} (from ${cfg.source.dataDir})`);
    console.error(`[contexts-mcp] config:    ${cfg.configPath}`);
  } catch (err) {
    if (err instanceof MissingDataDirError) {
      console.error("[contexts-mcp] startup failed — no data dir configured.");
      console.error("");
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  try {
    // Await: the server must not accept tool calls before the data dir exists.
    await storage.ensureDataDir();
  } catch (err) {
    console.error("[contexts-mcp] Fatal:", err);
    process.exit(1);
  }

  serveStdio(() => buildServer(), {
    onerror: (err) => console.error("[contexts-mcp] transport error:", err.message),
  });
  console.error("[contexts-mcp] MCP server running on stdio");
}

void main();
