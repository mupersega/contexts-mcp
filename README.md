# contexts-mcp

A local MCP server (with optional web UI) for **persistent context folders** shared across Claude Code sessions. Each context is a folder; each context holds items as markdown, txt, json, yaml, yml, or csv. Markdown items carry YAML frontmatter (title, tags, timestamps); other kinds carry only filesystem metadata. Contexts themselves can carry metadata (title, description, free-form status, tags, links) — useful for both knowledge-base topics and unit-of-work folders.

Storage is plain files on disk under a single data directory, so contexts are easy to inspect, back up, or sync with any tool you already use.

---

## Install & build

```bash
git clone git@github.com:mupersega/contexts-mcp.git
cd contexts-mcp
npm install
npm run build
```

That produces `dist/index.js` (the MCP server) and `dist/web.js` (the web UI).

## Register with Claude Code

Point Claude Code at the built server. The simplest route is the `claude mcp add` CLI:

```bash
claude mcp add contexts-mcp -- node /absolute/path/to/contexts-mcp/dist/index.js
```

That writes an entry like this into your project's `.mcp.json` (or `~/.claude/mcp.json` for user scope):

```json
{
  "mcpServers": {
    "contexts-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/contexts-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code. You should see tools prefixed with `mcp__contexts-mcp__` available.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `CONTEXTS_DATA_DIR` | `./contexts-data` (relative to cwd) | Where contexts are stored. **Use an absolute path** so the location doesn't shift with whatever directory Claude Code launches from. |
| `CONTEXTS_UI_PORT` | `3141` | Port for the optional web UI. |

Pass env vars through in your MCP registration if you want a custom data dir:

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

## Web UI (optional)

A CRT/terminal-styled browser view over the same data:

```bash
npm run ui
# then open http://localhost:3141
```

Windows-only convenience helpers (optional): `scripts/install.ps1` installs a Start Menu shortcut; `scripts/contexts-ui.vbs` launches the UI without a console window.

## Data model — quick reference

- **Context** = a folder inside your data dir. Name matches `^[a-zA-Z0-9_-]+$`.
- **Item** = one file inside a context. Base name matches `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. Extension is one of `md`, `txt`, `json`, `yaml`, `yml`, `csv`.
- **Markdown items** carry YAML frontmatter with `title`, `tags`, `created`, `updated`.
- **Non-markdown items** have only filesystem metadata. Want rich metadata on a JSON/CSV payload? Drop a companion `.md` in the same context.
- **Context metadata** lives in an optional `_context.yaml` at the context root: `title`, `description`, `status`, `tags`, `links: [{label, url}]`, `created`, `updated`. Never exposed as an item.

## MCP tools

All 12 tools the server exposes:

- `list_contexts` — list all context folders; `include_metadata=true` also returns each context's title/description/status/tags/links.
- `create_context` — create a new named context folder.
- `delete_context` — delete a context and everything inside it (destructive).
- `get_context` — read a context's metadata.
- `update_context_metadata` — patch a context's metadata (only passed fields change).
- `list_items` — list items in a context.
- `get_item` — read an item's content (markdown returns frontmatter + body; others return raw text).
- `create_item` — create a new item; specify extension, optionally title/tags for markdown.
- `update_item` — replace an item's content (and title/tags for markdown).
- `append_to_item` — append to an existing md/txt/csv item. Errors on json/yaml/yml.
- `delete_item` — delete a single item (destructive).
- `search_contexts` — full-text search across all items, with optional filters by context, per-item tags, context status, or context tags.

---

## Automation: keep contexts updated without thinking about it

You can invoke these tools manually any time, but the real win is letting Claude Code call them on your behalf. Two patterns, each good for something different:

### Option A — a Skill (recommended default)

Skills are the right fit when you want Claude to **decide** whether something is worth saving. Create `~/.claude/skills/persist-to-contexts/SKILL.md`:

```markdown
---
name: persist-to-contexts
description: Save findings, patterns, decisions, or reusable knowledge to a persistent contexts-mcp context. Use whenever the conversation surfaces something the user might want to look up later — debugging solutions, API quirks, architectural decisions, domain knowledge.
allowed-tools:
  - mcp__contexts-mcp__list_contexts
  - mcp__contexts-mcp__create_context
  - mcp__contexts-mcp__create_item
  - mcp__contexts-mcp__append_to_item
---

## Save to contexts-mcp

When something worth remembering surfaces in this conversation:

1. Pick or create a context folder by topic (e.g. `golang-patterns`, `postgres-gotchas`, `project-auth-rewrite`). Use `list_contexts` to see what already exists.
2. Pick a short item base name (no spaces, no special chars). Examples: `error-handling`, `uuid-collation-bug`, `decisions`.
3. Append the finding as markdown via `append_to_item`, or `create_item` if the item doesn't exist yet. Prefix with a date if it's a dated note.

Prefer appending to existing items over creating many near-duplicates — contexts work best as growing, dated logs.
```

Claude reads `description` to decide when to invoke the skill. Front-load it with the kinds of moments you want to trigger on. `allowed-tools` preapproves the MCP calls so there's no permission prompt mid-flow.

### Option B — a Stop hook (for deterministic end-of-turn reminders)

If you'd rather have Claude _always_ reflect at the end of a turn, wire up a `Stop` hook in `.claude/settings.json` (project scope) or `~/.claude/settings.json` (user scope):

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

The echoed text becomes a system reminder in Claude's next turn, nudging it to save. See the [Claude Code hooks docs](https://docs.claude.com/en/docs/claude-code/hooks) for the full event list and JSON shapes.

### Which to pick

- **Skill** if "save this" is a judgment call — most knowledge capture.
- **Hook** if you want a deterministic trigger — end of every turn, every tool call, session start, etc.

They compose fine: use the hook as a reminder, let the skill do the actual capture.

---

## Development

```bash
npm run watch   # tsc --watch
npm run start   # node dist/index.js (stdio; for direct testing)
npm run ui      # node dist/web.js (browser UI)
```

Diagnostics go to stderr; stdout is reserved for the MCP JSON-RPC transport.
