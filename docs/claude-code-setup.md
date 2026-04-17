# Using contexts-mcp inside Claude Code

This guide covers the two permission patterns that make contexts-mcp pleasant to use from Claude Code — especially for **sub-agents launched via the `Agent(...)` tool**, which inherit more restrictive default permissions than the main session and will hit a permission prompt on every write if you don't preapprove the tools.

## Option A — preapprove the MCP tools in settings

Add this block to `~/.claude/settings.json` (user scope — applies everywhere) or to `<project>/.claude/settings.json` (project scope):

```json
{
  "permissions": {
    "allow": [
      "mcp__contexts-mcp__list_contexts",
      "mcp__contexts-mcp__get_context",
      "mcp__contexts-mcp__get_item",
      "mcp__contexts-mcp__get_item_raw",
      "mcp__contexts-mcp__list_items",
      "mcp__contexts-mcp__search_contexts",
      "mcp__contexts-mcp__context_diagnose",
      "mcp__contexts-mcp__context_migration_brief",
      "mcp__contexts-mcp__create_context",
      "mcp__contexts-mcp__create_item",
      "mcp__contexts-mcp__update_item",
      "mcp__contexts-mcp__append_to_item",
      "mcp__contexts-mcp__update_context_metadata"
    ]
  }
}
```

The `delete_context` and `delete_item` tools are deliberately omitted — those are destructive, worth a permission prompt every time.

Reload Claude Code for the change to take effect.

## Option B — a Skill with `allowed-tools`

If you'd rather scope the preapproval to a specific workflow, use a Skill. Skill YAML supports `allowed-tools`, which preapproves the listed tools *only while the skill is running*. Create `~/.claude/skills/persist-to-contexts/SKILL.md`:

```markdown
---
name: persist-to-contexts
description: Save findings, patterns, decisions, or reusable knowledge to a persistent contexts-mcp context. Use whenever the conversation surfaces something worth looking up later — debugging solutions, API quirks, architectural decisions, domain knowledge.
allowed-tools:
  - mcp__contexts-mcp__list_contexts
  - mcp__contexts-mcp__search_contexts
  - mcp__contexts-mcp__create_context
  - mcp__contexts-mcp__create_item
  - mcp__contexts-mcp__append_to_item
  - mcp__contexts-mcp__update_context_metadata
---

## How to save

1. Call `list_contexts` with `sort: "recent_activity"` and `include_metadata: true` to see recent topics.
2. Call `search_contexts` for a phrase that might already be logged.
3. If the topic exists, prefer `append_to_item` over a new item.
4. Otherwise: `create_context` (if it's a new topic) and `create_item`.
5. Markdown is the right default for prose; use the other kinds only for structured payloads.
```

Skills are the right call when "save this" is a judgment call — Claude reads the `description` to decide when to invoke it.

## Which to pick

| You want… | Use |
|---|---|
| Preapproval everywhere, forever | Option A (settings.json) |
| Preapproval scoped to a workflow | Option B (Skill) |
| Both | Both — they compose |

## Verifying it worked

Start a fresh Claude Code session. Run:

```
/mcp
```

You should see `contexts-mcp` listed with a tool count. Then ask Claude to save something — e.g. `"save a quick note to contexts about X"` — and there should be no permission prompt on the write tools you preapproved.

If you see prompts anyway, double-check that the tool names in `allow[]` match the Claude Code format exactly: `mcp__<server-name>__<tool-name>`.
