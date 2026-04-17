---
title: Install & dynamic-pathing improvements — notes from a rough first setup
tags:
  - install
  - pathing
  - ux
  - dx
  - observability
  - migration
created: '2026-04-15T02:46:41.065Z'
updated: '2026-04-15T09:18:47.612Z'
---
Feedback captured during a bumpy migration from a ticket-based predecessor MCP to contexts-mcp on Windows. Ordered roughly by impact.

## 1. The cwd-relative data dir default is the single biggest trap

Default `CONTEXTS_DATA_DIR=./contexts-data` sounds harmless but explodes in practice. Claude Code launches the MCP from whatever its current working directory is, which on a developer box is usually inside a project repo. Result: on a fresh install with no env var set, context data lands *inside the user's project*. I ended up with 44 ticket folders inside `C:/projects/payadvantage/contexts-data/` before I realised what had happened.

### Ideas
- **Refuse to start without an explicit data dir.** If `CONTEXTS_DATA_DIR` is unset, error with a short "set CONTEXTS_DATA_DIR or pass `--data-dir`" message. No silent cwd default.
- **Or**: default to a predictable OS-appropriate location — `%LOCALAPPDATA%/contexts-mcp/data` on Windows, `~/Library/Application Support/contexts-mcp` on macOS, `$XDG_DATA_HOME/contexts-mcp` on Linux. Never cwd.
- **On startup, log the resolved absolute data dir to stderr** (the README already notes stderr is for diagnostics). That one-line "Using data dir: C:/foo/bar" would have saved an hour.

## 2. Installer-created shortcuts hard-wire the install path

`scripts/install.ps1` creates `%USERPROFILE%\Desktop\Contexts.lnk` and a Startup shortcut with `WorkingDirectory` and `Arguments` pointing at the install location (e.g. `C:/projects/contexts-mcp/`). If the user later moves the install — which I had to — those shortcuts silently break. No error, no hint, UI just doesn't come up at next login.

### Ideas
- **Ship an `uninstall.ps1` that updates (not just deletes) shortcuts** when it detects a reinstall at a different path.
- **Have the shortcut target a stable entrypoint** — e.g. an npm global bin `contexts-mcp-ui` — instead of an absolute `wscript ...vbs` path. Then "moving the install" is just re-running install.
- **Print the intended shortcut target paths at end of install** so the user can eyeball them.

## 3. The vbs launcher ignores `CONTEXTS_DATA_DIR`

`scripts/contexts-ui.vbs` sets `CurrentDirectory = projectDir` and runs `node dist\web.js`. If the user set `CONTEXTS_DATA_DIR` in their `.mcp.json` env block (because the README tells them to), the UI launched via the shortcut will *not* see that value — it only applies when Claude Code spawns the server. Result: the UI reads a completely different (empty) data dir. I lost a good chunk of time to this.

### Ideas
- **Resolve data dir via a config file** (e.g. `~/.contexts-mcp/config.json`) that *both* the MCP-launched server and the UI-launched server read. Env var can still win as an override, but the config file is the shared source of truth.
- **Have the vbs read a `%USERPROFILE%\.contexts-mcp\env` file** and `SetEnv` before launching node.
- **At minimum: document this very explicitly in the README**, ideally with a "UI and MCP must agree on data dir" box at the top of the Env Vars section.

## 4. No "where am I pointing?" diagnostic

When the UI silently showed empty folders (because the data had moved but the server was still pointing at old cwd-relative path), there was no easy way to answer "what data dir is this process actually reading?". I fell back to process listings and `lsof`-equivalents.

### Ideas
- **`GET /health` or `/diagnose` on the web server** returning `{ dataDir, contextCount, itemCount, version }`. Make it a small JSON blob shown in a collapsible "About" section of the UI footer.
- **A `context_diagnose` MCP tool** that returns the same info. Cheap to add, huge for debugging — saves me asking "are we talking to the same instance you think we are?".
- **Surface resolved dataDir in the UI chrome** — small monospace path somewhere unobtrusive. Confidence-building and debugging gold.

## 5. Migration tooling: the brief is nice, a CLI would be better

`context_migration_brief` is well written. But when I had 44 folders to import with markdown + attachments + computed titles + `_context.yaml` generation, I ended up writing ~150 lines of Node from scratch to parse YAML frontmatter, normalise filenames, generate metadata. The brief gave me the *rules* but not the *tool*.

### Ideas
- **`contexts-mcp import <dir>` CLI subcommand** that takes a directory of markdown+attachments and does sensible defaults: one context per subfolder, `<ticket>.md` becomes `overview.md`, other files become items with filename normalisation (`.` → `-`, unsupported ext → `txt`), derives title from H1 / first Summary paragraph, sets `_context.yaml` from any source frontmatter.
- Even a **`--dry-run`** mode that prints "would create N contexts and M items, Y renames" would catch half the gotchas.
- The filename regex (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`, no dots in base, fixed extension set) is aggressive — migrations from any system with "real" filenames will need normalisation. Ship that normaliser.

## 6. External FS changes are silently destructive

During my migration I moved the data folder with the server and the web UI still running. When I brought them back up, the folders existed but their contents were gone. I can't prove what happened but the symptom pattern (folders kept, files missing) suggests the still-running process cleaned up or rewrote on shutdown after losing track of its storage.

### Ideas
- **File watcher or inode-check on startup.** If the data dir has changed under the server's feet (moved/recreated), log it and refuse to auto-delete or re-sync anything.
- **On graceful shutdown (the `/shutdown` POST), never write to the data dir.** Make shutdown purely release-the-port.
- **Atomic writes with a `.tmp` sidecar** for any metadata file (`_context.yaml`) — current behaviour during a partial write would corrupt the yaml.

## 7. Unsupported extensions force awkward renames

Enum-restricting items to `md/txt/json/yaml/yml/csv` is reasonable for a text DB, but it made migrating a `.sql` file awkward — I stored it as `testing-queries-sql.txt` to preserve the type hint in the name. A CSV or SQL dump next to a context is a pretty natural use case.

### Ideas
- **Add `sql` to the enum** — it's just text.
- **Or: allow a `raw` / `bin` kind** with arbitrary extension stored verbatim, no frontmatter, no indexing, just file-in-context. Docs can say "use `md` by default, only reach for `raw` when you need to attach an oddly-typed artefact".

## 8. Permissions story for Claude Code sub-agents

Not strictly a contexts-mcp issue, but adjacent: sub-agents launched via `Agent(...)` in Claude Code get *more restrictive* default permissions than the main session. The write MCP tools (`create_context`, `create_item`, `update_context_metadata`) were auto-denied in sub-agents even after being approved in the main session. Two sub-agents burned through their budget just discovering this.

### Ideas
- **A `docs/claude-code-setup.md` page** in the repo that lists the exact `permissions.allow[]` entries to add to `~/.claude/settings.json` for frictionless sub-agent usage. Example:
  ```json
  "permissions": { "allow": [
    "mcp__contexts-mcp__create_context",
    "mcp__contexts-mcp__create_item",
    "mcp__contexts-mcp__update_context_metadata",
    "mcp__contexts-mcp__append_to_item"
  ]}
  ```
- **Skill YAML with `allowed-tools`** (the README already shows this for `persist-to-contexts`) — good pattern, worth flagging more loudly as "this is the easiest way to use the server from inside Claude".

## 9. Cross-platform install convenience is Windows-only

`install.ps1`, `contexts-ui.vbs`, desktop/startup shortcut creation — all Windows. A macOS/Linux developer picking up the tool gets `npm install && npm run build && npm run ui` and no convenience layer.

### Ideas
- **A tiny cross-platform wrapper**: ship `bin/contexts-mcp-ui` as a Node shebang script that does the "is it running on 3141? if not, start it; then open the browser" dance the vbs does. Works everywhere Node works.
- **Optional LaunchAgent (macOS) + systemd user unit (Linux) templates** for auto-start parity with the Windows Startup shortcut.

## 10. Small polish

- **Single bundled `dist/` artifact** via esbuild / ncc. 105 npm packages in `node_modules` for a relatively small MCP is a lot to drag around, and matters if you ever want to distribute this as a standalone exe.
- **Versioned data dir** — stamp a `.contexts-mcp-version` file at the root of the data dir on first write. Future server versions can do migrations or refuse to start against incompatible data.
- **Make the `_context.yaml` generator strip noisy auto-managed fields** when re-serialising (the `created`/`updated` from source frontmatter got carried into `overview.md`'s preserved frontmatter and then a second set got added by the server — minor cosmetic).
- **README "five-minute setup" section** up top: `npm i && build && setx CONTEXTS_DATA_DIR … && register with claude mcp add`. Right now the README is well-structured but the happy path is spread across several sections and easy to miss pieces of.

## 11. Reference: what actually happened in this session

For the maintainer's postmortem value:

1. MCP server launched by Claude Code with cwd = `C:/projects/payadvantage` → data wrote to `./contexts-data` = inside the repo.
2. `.mcp.json` initially had no `env` block, so no `CONTEXTS_DATA_DIR`.
3. Moved data to `C:/contexts-data`, moved server to `C:/tools/contexts-mcp`, updated `.mcp.json` with `env: { CONTEXTS_DATA_DIR }`. Desktop + Startup shortcuts silently broken (still pointed at old install path).
4. Shut down web UI via the `/shutdown` POST (worked well — nice touch).
5. On next bring-up the context folders were present but empty — contents lost somewhere between the move and the shutdown, not fully diagnosed.
6. Re-ran a custom migration script to repopulate.

None of these steps are blocking — they're all navigable — but they cost real time, and a newcomer trying the tool cold could plausibly bounce off.




## 12. Context ordering: "recently active" beats alphabetical

`list_contexts` and (I'm assuming) the web UI both order contexts alphabetically. For a growing corpus that's actively worked on, alphabetical is the wrong default — the contexts you touched yesterday sink below `AGENTS-*` and `CHUNKER-V1V2` forever. You scan 40+ rows to find the one you wrote to this morning.

### Ideas
- **A `sort` parameter on `list_contexts`**: `name | recent_activity | created | updated`. `recent_activity` = max(mtime) across all items in the context (including `_context.yaml`). Default could stay `name` to avoid surprising existing callers, or flip to `recent_activity` if you're willing to make a breaking change — it's the answer a human almost always wants.
- **Mirror the same control in the UI** with a small "Sort by: name ▾ / recent ▾ / status ▾" affordance in the header. Optional filter-by-status dropdown pairs naturally with it.
- **Track `last_activity` in `_context.yaml`** as a derived field so callers don't have to stat every item on every list. Update it on any `create_item` / `update_item` / `append_to_item` / metadata write. Cheap, and makes the sort a single read per context.
- **Bonus**: expose a `recent_activity` timestamp in the `list_contexts(include_metadata: true)` response even if you don't change the default sort, so clients can sort themselves.




## 13. UI: no way to copy or download an item

Once an item is in a context, the only way to get the raw content back out — verbatim, with original formatting — is to open the file on disk. From the web UI there's no "copy content" button, no "download as file", and no raw view. For markdown that's annoying; for a JSON attachment (a Postman collection, a test fixture) it's a genuine blocker — you're looking at rendered markdown or a preview, not the shippable file.

### Ideas
- **Per-item "Copy" button** (copies the raw text content — for md, the body *without* the YAML frontmatter unless you hold a modifier key; for non-md, the raw payload). One click, no permission prompts.
- **Per-item "Download" button** that streams the file with its original filename and a correct `Content-Type` header (`text/markdown`, `application/json`, `text/csv`, etc.). No transformation.
- **A "raw" view toggle** per item — show the plain text (with frontmatter for md) in a monospace block, not rendered. Useful for eyeballing exact content before copying.
- **Context-level "Download all as .zip"** — for handing a whole topic's worth of notes + attachments to someone who doesn't have the MCP running. Cheap with something like `archiver` in Node; huge for sharing.
- **On the MCP side** a matching `get_item_raw` that returns `{ content, filename, contentType }` would let any client (UI, CLI, other MCP) implement the same feature consistently.

Small thing, but it's the difference between "contexts are where my stuff *lives*" and "contexts are where my stuff is *trapped*".




## 14. Scale: load, lifecycle, and the no-pagination constraint

Today I imported 44 contexts in one go — fine. But thinking forward: at 100, 500, 1000 contexts with accumulating items, what breaks first, and what's the plan to keep the UX sharp without resorting to pagination?

### Where the load lives today
- `list_contexts(include_metadata: true)` reads every `_context.yaml` — O(n) on every call.
- `search_contexts` reads every text item in every context — O(total bytes) on every call.
- `list_items` stats every file in a context — O(items-per-context).

At 44 contexts all of this is imperceptible. At 1000 contexts with 5 items each, `include_metadata` is 1000 yaml reads per UI refresh, and search is scanning tens of MB every keystroke if it's live.

### The constraint
**Pagination is the wrong answer here and should be delayed as long as possible.** The whole point of this tool is "everything I know, at a glance". The moment you hide contexts behind "Load more", the hit rate on the tool drops because users can't scan-and-recognise. Pagination is the refuge of apps that gave up on curating their surface area.

### Better levers to pull first

- **Lifecycle / archival as the primary pressure valve.** A context's `status` is already free-form. Bless a convention: `archived` contexts are omitted from default `list_contexts` results unless `include_archived: true` is passed. Same for search. Now the "working set" stays small even if the archive grows unbounded. UI gets an "Archive" toggle in the metadata sidebar and an "Archived (147)" chip in the header.
- **Auto-archive suggestions, not auto-archive itself.** On server startup (or on a timer), flag contexts whose `last_activity` is > N days old *and* `status == done` — surface a dismissable banner in the UI: "12 contexts haven't been touched in 90+ days. Archive them?". Never auto-archive without consent, but make it one click to sweep.
- **A derived index cached at the data-dir root.** `_index.json` holding `{ name, title, status, tags, last_activity, item_count, total_size }` per context, rebuilt on any write. `list_contexts(include_metadata: true)` then reads one file instead of n. Invalidation is cheap because every write already goes through the server. Search can maintain its own token/bigram index in the same file if you want to get fancy.
- **Search result streaming / progressive reveal.** If `search_contexts` must walk n contexts, stream results as contexts finish rather than buffering the whole response. The UI feels instant even when the full scan is slow.
- **Let archival itself be cheap and reversible.** Archiving is just a status change — no move, no rename, no data hidden from the filesystem. One-key unarchive from the UI.
- **Surface scale stats in the diagnose endpoint** (see section 4). `{ contextCount, archivedCount, itemCount, totalBytes, lastScanMs }` so you can actually see the trend and not guess when the pressure starts mattering.

### What I'd explicitly *not* do

- No pagination in `list_contexts`, `list_items`, or the UI grid for as long as possible. Archival + filter + index make this unnecessary until low thousands.
- No automatic deletion. Ever. The tool's value depends on "I can trust it remembers".
- No TTLs or stale-data expiry. Same reason.

### Rule of thumb for when this actually starts hurting

If `list_contexts(include_metadata: true)` crosses ~100ms or search crosses ~500ms in real usage, the index approach is overdue. Both are easy to measure with the diagnose endpoint. Until then, the current approach is fine and the archival knob is enough.




## 15. Dark mode is too dark — eye strain after a short session

Light mode is in a great spot now — readable, not too clinical, leave it alone. Dark mode is the opposite extreme: it's *very* black, with high-contrast text on a near-pure-black background, and it gets uncomfortable to read for more than a few minutes.

### What's likely going on
- Background is at or near `#000` instead of an off-black like `#0d1117` (GitHub) / `#1a1b26` (Tokyo Night) / `#1e1e2e` (Catppuccin Mocha).
- Foreground text is probably at or near `#fff`, giving the maximum-possible contrast ratio. Sounds good on paper; in practice it sears the retina against pure black, especially for long-form reading.
- The CRT/terminal aesthetic likely leans into the high-contrast look intentionally — but reading 5KB of markdown is not the same as reading a status line.

### Suggested pass
- **Lift the background.** Try `#16181d` to `#1c1f26` range. Anything below `#10` is too far.
- **Drop the foreground.** Body text around `#c9d1d9` / `#cdd6f4` rather than `#ffffff`. Keep `#fff` for headings or active selection only.
- **Aim for a contrast ratio of ~10–13:1**, not ~21:1. Still well above WCAG AA (4.5:1) for body text, but kinder on a long read.
- **Soften accents.** Whatever the link/highlight colour is, desaturate it ~20% — pure-saturation greens/cyans on near-black are the other half of the eye-strain story.
- **Keep the CRT/terminal vibe** in chrome (footer, status bar, button styles) but treat the *content area* — the markdown body where people actually read — as a long-form reading surface. Two slightly different background tones is fine and signals "you can rest your eyes here".
- Optional: a **"low-contrast" sub-mode** for dark, gated by a small toggle. Same palette, just compressed range. Cheap to add and people self-select.

Light mode passed the "I want to keep using this" test; dark mode hasn't yet. A short pass on the two background/foreground values would close most of the gap.




## 16. README clone command assumes SSH

The README's install section starts with:

```bash
git clone git@github.com:mupersega/contexts-mcp.git
```

That's the SSH URL, which only works for users who've set up an SSH key on their GitHub account. A fresh developer following the README will hit `Permission denied (publickey)` and bounce. I had to substitute the HTTPS URL to get past it.

### Fix
Change the README to default to HTTPS:

```bash
git clone https://github.com/mupersega/contexts-mcp.git
```

HTTPS works out-of-the-box for everyone (including read-only clones without credentials) and is the standard "getting started" default on GitHub itself. SSH can be mentioned as an alternative one-liner for contributors, but it shouldn't be the first command in the install flow.




## 17. Tests — probably not a full suite, but a perf smoke test is earning its keep

Today there's no test harness. For a tool this size a full unit-test suite is overkill and would outweigh the value, and I think the maintainer's instinct to skip it is correct. What I *would* add is a single benchmark/smoke script because write performance is visibly slower than I'd expect.

### The observation
`create_item` / `update_item` / `create_context` felt sluggish even for small payloads in my 44-ticket migration. Fast enough that I didn't debug it, slow enough that I noticed. When I later bypassed the MCP and wrote directly to the filesystem (via a one-off Node script), the same 44 contexts + 27 attachments landed almost instantly. The gap suggests the server is doing more per write than the payload size warrants.

### Likely culprits (without having read the code)
- **Re-reading and re-serialising `_context.yaml` on every item write** to bump a timestamp. If so, a single `create_context + 6 items + metadata update` = 7+ reads and 7+ writes of that yaml.
- **YAML parse/serialise round-trip on every markdown frontmatter edit** — cheap individually, expensive in aggregate.
- **Per-write `fsync`** (or the Windows equivalent). Safe for durability, brutal for throughput.
- **No in-process cache** of parsed `_context.yaml` / item frontmatter, so the same file is re-parsed per call.

### What to add

**A `scripts/bench.js` one-shot** that does something like:

```js
// Create N contexts each with K markdown items, measure each stage.
// Print: createContext p50/p95/p99, createItem p50/p95/p99, updateContextMetadata p50/p95/p99.
// Run against a throwaway data dir.
```

This is maybe 60 lines of code and gives you a repeatable number. Any future optimisation (batched writes, metadata caching, skipping redundant writes) can be measured against it. Baseline now would probably show the write path is the problem, not search or list.

**A handful of invariant tests disguised as sanity checks** — no framework, just `node scripts/sanity.js`. Things like:

- Create a context, add an item, delete the item, create an item with the *same* base name — it should succeed (no stale handle / leftover index).
- Write a context with tags `['a', 'b']`, update with tags `['c']` — final state is `['c']`, not the union.
- After `/shutdown` POST, re-read the data dir — every `_context.yaml` should parse and match what was written. (This would have caught the empty-folders-after-shutdown behaviour I hit earlier in the session.)

These are the kind of "if this breaks, the tool is quietly wrong" checks that are cheap to write and catch the long-tail bugs that actual users stumble into.

### What *not* to add

Don't stand up Jest/Vitest/etc. for this. Framework overhead + config + watchers + a `test/` directory convention — the tool's whole vibe is "minimal, understandable, hack-on-it-in-an-afternoon". Keep it to plain Node scripts under `scripts/`. If they grow past ~300 LOC total, then reconsider.
