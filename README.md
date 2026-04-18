# contexts-mcp

A local MCP server (with optional web UI) for **persistent context folders** shared across Claude Code sessions. Each context is a folder; each context holds items as markdown, txt, json, yaml, yml, csv, or sql. Markdown items carry YAML frontmatter (title, tags, timestamps); other kinds carry only filesystem metadata. Contexts themselves can carry metadata (title, description, free-form status, tags, links) — useful for both knowledge-base topics and unit-of-work folders.

Storage is plain files on disk under a single data directory, so contexts are easy to inspect, back up, or sync with any tool you already use.

**Contents**

- [One command you actually need to remember](#one-command-you-actually-need-to-remember)
- [First-time setup](#first-time-setup)
- [How it resolves configuration](#how-it-resolves-configuration)
  - [Pointing the MCP at a different data dir](#pointing-the-mcp-at-a-different-data-dir)
- [Web UI (optional)](#web-ui-optional)
  - [Windows convenience (optional)](#windows-convenience-optional)
- [Data model — quick reference](#data-model--quick-reference)
- [MCP tools](#mcp-tools)
- [Automation: keep contexts updated without thinking about it](#automation-keep-contexts-updated-without-thinking-about-it)
  - [Option A — a Skill (recommended default)](#option-a--a-skill-recommended-default)
  - [Option B — a Stop hook (for deterministic end-of-turn reminders)](#option-b--a-stop-hook-for-deterministic-end-of-turn-reminders)
- [Development](#development)

---

## One command you actually need to remember

**`npm run setup`**

That's it. It rebuilds `dist/`, prompts for data dir + UI port, and (on Windows) refreshes the Desktop shortcut. Safe to re-run any time — after moving the install, after changing your data dir, whenever something looks wrong.

| Want to… | Command |
|---|---|
| Install, reconfigure, or recover | `npm run setup` |
| Start the UI | `npm run ui` *or* `npx contexts-mcp-ui` |
| Confirm things are wired up | `npm run sanity` |
| See "what am I pointing at?" | open the UI → footer **About**, or call `context_diagnose` |

## First-time setup

```bash
git clone https://github.com/mupersega/contexts-mcp.git
cd contexts-mcp
npm install
npm run setup
claude mcp add contexts-mcp -- node /absolute/path/to/contexts-mcp/dist/index.js
```

Restart Claude Code. Tools prefixed `mcp__contexts-mcp__` should now be available.

`npm run setup` is interactive — it prompts for your data directory (defaulting to an OS-appropriate location) and UI port, then writes a shared config file. The MCP server and the web UI both read from that config, so they always agree on where data lives.

> Contributors can swap the first command for `git@github.com:mupersega/contexts-mcp.git` (SSH). HTTPS is the default here because it works out of the box without a GitHub key.

---

## How it resolves configuration

Config priority, highest first:

1. `CONTEXTS_DATA_DIR` / `CONTEXTS_UI_PORT` in the environment
2. The config file written by `npm run setup`:
   - Windows: `%APPDATA%\contexts-mcp\config.json`
   - macOS: `~/Library/Application Support/contexts-mcp/config.json`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/contexts-mcp/config.json`
3. Otherwise the server **refuses to start** with a clear message pointing you at `npm run setup`. There is no silent fallback to `./contexts-data` in the current working directory.

Both the MCP server and the UI log the resolved data dir to stderr at startup:

```
[contexts-mcp] version:   2.1.0
[contexts-mcp] data dir:  /Users/you/Library/Application Support/contexts-mcp/data (from config)
[contexts-mcp] config:    /Users/you/Library/Application Support/contexts-mcp/config.json
```

To confirm at runtime, call `context_diagnose` or visit the UI and expand the **About** panel in the footer.

### Pointing the MCP at a different data dir

If you want a project-specific data dir, override via the `env` block in `.mcp.json`:

```json
{
  "mcpServers": {
    "contexts-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/contexts-mcp/dist/index.js"],
      "env": { "CONTEXTS_DATA_DIR": "/absolute/path/to/my-contexts" }
    }
  }
}
```

The env var wins over the config file. The UI, however, reads only the config file and its own environment — keep them in sync, or run the UI in the same shell where you've set `CONTEXTS_DATA_DIR`.

---

## Web UI (optional)

A CRT/terminal-styled browser view over the same data.

```bash
npm run ui        # then open http://localhost:3141
```

Once built and configured, you can also use the cross-platform launcher:

```bash
npx contexts-mcp-ui   # starts the UI if it isn't running, opens the browser
```

Stop the server with the **Shutdown** button in the footer — it POSTs to `/shutdown` and the process exits cleanly, releasing the port. **Shutdown performs zero writes to the data dir** — it is release-the-port only.

Per-item actions on the UI:

- **Copy** — copies the raw content. Hold Alt on markdown items to include the YAML frontmatter.
- **Download** — streams the file verbatim with its original filename and correct `Content-Type`.
- **Raw** — toggles a rendered/raw view (useful for eyeballing frontmatter before copying).
- Context-level **Download .zip** from the context page.

The small palette icon in the top-right opens `/theme` — a theme lab with six knobs (accent, palette, corners, chrome, motion, complement), six named presets, and a **Scramble** randomizer. Choices persist per browser in `localStorage`.

### Windows convenience (optional)

`npm run setup` already offers to create/refresh the Desktop shortcut. If you want just the shortcut step without the config prompts (e.g. after moving the install), call `install.ps1` directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipSetup
```

Add `-AutoStart` (to either command) for an additional Startup-folder shortcut that auto-runs the UI at Windows login.

To remove the shortcuts later:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
```

---

## Data model — quick reference

- **Context** = a folder inside your data dir. Name matches `^[a-zA-Z0-9_-]+$`.
- **Item** = one file inside a context. Base name matches `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. Extension is one of `md`, `txt`, `json`, `yaml`, `yml`, `csv`, `sql`.
- **Markdown items** carry YAML frontmatter with `title`, `tags`, `created`, `updated`.
- **Non-markdown items** have only filesystem metadata. Want rich metadata on a JSON/CSV/SQL payload? Drop a companion `.md` in the same context.
- **Context metadata** lives in an optional `_context.yaml` at the context root: `title`, `description`, `status`, `tags`, `links: [{label, url}]`, `created`, `updated`, `last_activity`. Never exposed as an item. `last_activity` is managed automatically — don't set it manually.
- **Archival convention**: `status: 'archived'` makes a context invisible to default `list_contexts` / `search_contexts`. Pass `include_archived: true` (or toggle it in the UI) to see them.
- **Data-dir version stamp**: `.contexts-mcp-version` at the data-dir root tracks the schema version. Future server versions can use this for migrations.

## MCP tools

All tools the server exposes:

- `list_contexts` — list all contexts. `include_metadata=true` also returns title/description/status/tags/links/last_activity. `sort` accepts `name | recent_activity | created | updated` (default `name`). `include_archived=true` to include archived contexts.
- `create_context` — create a new named context folder.
- `delete_context` — delete a context and everything inside it (destructive).
- `get_context` — read a context's metadata.
- `update_context_metadata` — patch a context's metadata (only passed fields change). Set `status: 'archived'` to archive.
- `list_items` — list items in a context.
- `get_item` — read an item's parsed content (markdown returns frontmatter + body; others return raw text).
- `get_item_raw` — byte-for-byte content of an item on disk, including markdown frontmatter. Returns `{content, filename, contentType, extension, size}`.
- `create_item` — create a new item; specify extension, optionally title/tags for markdown.
- `update_item` — replace an item's content (and title/tags for markdown).
- `append_to_item` — append to an existing md/txt/csv/sql item. Errors on json/yaml/yml.
- `delete_item` — delete a single item (destructive).
- `search_contexts` — full-text search across all items, with optional filters by context, per-item tags, context status, or context tags. Archived contexts skipped unless `include_archived=true`.
- `context_diagnose` — return `{dataDir, configPath, version, contextCount, archivedCount, itemCount, totalBytes, lastScanMs}`. Cheap to call. Confirms "what data dir is this process actually reading?" when things look wrong.
- `context_migration_brief` — returns a markdown guide covering formats, naming rules, frontmatter shape, and a recommended workflow for importing existing notes.

---

## Automation: keep contexts updated without thinking about it

You can invoke these tools manually any time, but the real win is letting Claude Code call them on your behalf. See [`docs/claude-code-setup.md`](docs/claude-code-setup.md) for the exact `permissions.allow[]` block that preapproves the write tools so Claude (including sub-agents) doesn't hit a permission prompt on every call.

### Option A — a Skill (recommended default)

Skills are the right fit when you want Claude to **decide** whether something is worth saving. Create `~/.claude/skills/persist-to-contexts/SKILL.md`:

```markdown
---
name: persist-to-contexts
description: Save findings, patterns, decisions, or reusable knowledge to a persistent contexts-mcp context. Use whenever the conversation surfaces something the user might want to look up later — debugging solutions, API quirks, architectural decisions, domain knowledge.
allowed-tools:
  - mcp__contexts-mcp__list_contexts
  - mcp__contexts-mcp__search_contexts
  - mcp__contexts-mcp__create_context
  - mcp__contexts-mcp__create_item
  - mcp__contexts-mcp__append_to_item
---

## Save to contexts-mcp

When something worth remembering surfaces in this conversation:

1. Call `list_contexts` with `sort: "recent_activity"` and `include_metadata: true` to see what's recent.
2. Call `search_contexts` for a phrase — you may find an existing item to append to rather than duplicate.
3. Otherwise, pick or create a context folder by topic and `create_item`.
4. Prefer appending to existing items over creating many near-duplicates — contexts work best as growing, dated logs.
```

### Option B — a Stop hook (for deterministic end-of-turn reminders)

If you'd rather have Claude _always_ reflect at the end of a turn, wire up a `Stop` hook in `.claude/settings.json` (project) or `~/.claude/settings.json` (user):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Reminder: if anything worth keeping surfaced this turn, persist it via mcp__contexts-mcp__append_to_item.'"
          }
        ]
      }
    ]
  }
}
```

See the [Claude Code hooks docs](https://docs.claude.com/en/docs/claude-code/hooks) for the full event list and JSON shapes. Skill + hook compose fine — hook as reminder, skill for the capture.

---

## Development

```bash
npm run watch    # tsc --watch
npm run start    # node dist/index.js (stdio; for direct testing)
npm run ui       # node dist/web.js (browser UI)
npm run setup    # reconfigure data dir / UI port
npm run sanity   # invariant checks — ~1s, catches quiet wrongness
npm run bench    # write-path benchmark — baselines createItem / list p50/p95/p99
```

`scripts/sanity.js` and `scripts/bench.js` both run against a throwaway data dir under `$TMPDIR`. They don't touch your configured `dataDir`.

Diagnostics go to stderr; stdout is reserved for the MCP JSON-RPC transport.
