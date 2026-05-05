# Pin Contexts to Top — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any number of contexts to be pinned so they float to the top of `list_contexts` (and the web UI) regardless of sort mode, with a one-click toggle in the UI and a `pinned` field on `update_context_metadata` for MCP callers.

**Architecture:** Pin state is stored as an optional boolean `pinned: true` in each context's `_context.yaml` (omitted when false). Sort logic partitions by pin state before applying the existing sort, so pins always come first across `name | recent_activity | created | updated`. Pinning takes a separate storage path (`setContextPinned`) that does NOT bump `last_activity` — pin/unpin is a presentation toggle, not work on the context. Archive still wins (archived pins are hidden by default). The existing `update_context_metadata` MCP tool gains a `pinned: boolean` field; no new MCP tools are added. The web UI gets two new endpoints (`POST /ctx/:name/pin`, `POST /ctx/:name/unpin`) that return the full `#context-list-region` fragment, a pin/unpin icon button on every card, a pin glyph next to pinned titles, and a divider between the pinned and unpinned groups (hidden when either group is empty).

**Tech Stack:** TypeScript, Node 20+, Zod, Express, htmx, gray-matter, js-yaml. No test framework — invariant checks live in `scripts/sanity.js` (custom, no-deps, runs against a tmp data dir).

---

## File Structure

**Modified:**
- `src/types.ts` — add `pinned?: boolean` to `ContextMetadata` interface; add `pinned: z.boolean().optional()` to `UpdateContextMetadataArgsSchema`.
- `src/storage.ts` — extend `normalizeContextMetadata` and `writeContextMetadata` to round-trip `pinned`; add `setContextPinned(name, pinned)` that bypasses the `last_activity` bump; teach `sortSummaries` to partition pinned-first; drop the `needMeta` optimization in `listContexts` so pin state is always loaded.
- `src/index.ts` — route a `pinned` field on `update_context_metadata` calls through `storage.setContextPinned`; update the tool description.
- `src/web.ts` — add `POST /ctx/:name/pin` and `POST /ctx/:name/unpin`; both re-render the list region with current sort/filter from query params. Refactor the list region builder so the GET and the POSTs share it.
- `src/templates.ts` — add a shared SVG pin icon; render a pin/unpin button next to Delete on each card; render the pin glyph next to the title on pinned cards; in `contextListRegionFragment`, partition into pinned/unpinned and render a divider between them (only when both groups are non-empty).
- `src/styles.ts` — add `.pin-divider`, `.pin-icon`, and `.pin-glyph` rules.
- `scripts/sanity.js` — append invariant checks for pin storage, sort partitioning, and `last_activity` non-mutation.

**Not modified (deliberate):**
- `src/search.ts` — search ranking is untouched. Pin is a list-view affordance, not a relevance signal.
- `contextMetaEditPage` in `src/templates.ts` — no pin checkbox in the metadata edit form. Pin lives on the inline icon button only, to avoid the HTML-form-checkbox-boolean ambiguity (unchecked = "leave alone" or "set to false"?).

---

## Task 1: Add `pinned` to `ContextMetadata` and round-trip it through `_context.yaml`

**Files:**
- Modify: `src/types.ts:24-35` (`ContextMetadata` interface)
- Modify: `src/storage.ts:206-233` (`normalizeContextMetadata`)
- Modify: `src/storage.ts:254-275` (`writeContextMetadata`)
- Modify: `scripts/sanity.js` (append two new checks)

- [ ] **Step 1: Write failing sanity checks**

Open `scripts/sanity.js`. After the existing checks (after the "sql extension accepted" check, before the `console.log("")` summary), append:

```javascript
  await check("pinned=true round-trips through _context.yaml", async () => {
    await storage.createContext("pin-rt");
    await storage.updateContextMetadata("pin-rt", { title: "T" });
    // Hand-craft the metadata write since setContextPinned doesn't exist yet — verify
    // the read+write path preserves an explicit pinned: true in the YAML.
    const metaPath = path.join(tmpRoot, "pin-rt", "_context.yaml");
    const existing = yaml.load(fs.readFileSync(metaPath, "utf-8")) || {};
    existing.pinned = true;
    fs.writeFileSync(metaPath, yaml.dump(existing));
    const meta = await storage.getContextMetadata("pin-rt");
    if (meta.pinned !== true) throw new Error(`expected pinned=true, got ${JSON.stringify(meta.pinned)}`);
  });

  await check("pinned=false is omitted from _context.yaml on write", async () => {
    await storage.createContext("pin-omit");
    await storage.updateContextMetadata("pin-omit", { title: "T" });
    const metaPath = path.join(tmpRoot, "pin-omit", "_context.yaml");
    const raw = fs.readFileSync(metaPath, "utf-8");
    if (raw.includes("pinned:")) throw new Error("pinned key should not appear when false");
  });
```

- [ ] **Step 2: Build and run sanity to confirm the new checks fail**

```bash
cd D:/contexts-mcp
npm run build && npm run sanity
```

Expected: both new checks FAIL. The first fails because `getContextMetadata` doesn't surface `pinned` (the `ContextMetadata` interface doesn't have the field, and the normalizer drops unknown keys). The second may pass coincidentally (the writer doesn't write `pinned` because no caller sets it yet) — that's fine; it's the regression guard for Task 1's writer change.

- [ ] **Step 3: Add `pinned` to the `ContextMetadata` interface**

In `src/types.ts`, edit the `ContextMetadata` interface (around lines 24-35) to add the field after `last_activity`:

```typescript
export interface ContextMetadata {
  title?: string;
  description?: string;
  status?: string;
  tags: string[];
  links: ContextLink[];
  created: string;
  updated: string;
  // ISO timestamp of the last item-level mutation (create/update/append/delete).
  // Bumped by storage automatically; callers never set this directly.
  last_activity?: string;
  // True when the context is pinned to the top of list_contexts. Omitted (rather
  // than written as `false`) when not pinned, so old _context.yaml files stay
  // clean. Set via storage.setContextPinned, NOT via updateContextMetadata —
  // pinning intentionally skips the last_activity bump.
  pinned?: boolean;
}
```

- [ ] **Step 4: Teach the YAML normalizer to read `pinned`**

In `src/storage.ts`, edit `normalizeContextMetadata` (around lines 206-233). After the `last_activity` block, add:

```typescript
  if (r.pinned === true) meta.pinned = true;
```

Place it as the last assignment in the function, before `return meta;`. Note: only literal `true` is accepted; any other value (string `"yes"`, number `1`, `false`, missing) yields an unset `pinned` field — keeps the normalizer strict.

- [ ] **Step 5: Teach the YAML writer to emit `pinned: true` and omit it otherwise**

In `src/storage.ts`, edit `writeContextMetadata` (around lines 254-275). After the `last_activity` block, add:

```typescript
  if (meta.pinned === true) ordered.pinned = true;
```

Place it as the last `ordered.X = ...` assignment, before the `yaml.dump` call. Omitting the field (vs writing `pinned: false`) keeps existing `_context.yaml` files unchanged when nothing is pinned.

- [ ] **Step 6: Build and run sanity — both new checks should pass**

```bash
npm run build && npm run sanity
```

Expected: all checks pass, including the two new ones. Existing checks still pass (no behavior change for unpinned contexts).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/storage.ts scripts/sanity.js
git commit -m "feat: add pinned field to context metadata"
```

---

## Task 2: Add `setContextPinned` — pin/unpin without bumping `last_activity`

**Files:**
- Modify: `src/storage.ts` (add new exported function after `updateContextMetadata`)
- Modify: `scripts/sanity.js` (append one new check)

- [ ] **Step 1: Write failing sanity check**

In `scripts/sanity.js`, append after the previous Task 1 checks:

```javascript
  await check("setContextPinned does NOT bump last_activity", async () => {
    await storage.createContext("pin-no-bump");
    await storage.createItem("pin-no-bump", "seed", "md", { content: "x" });
    const before = (await storage.getContextMetadata("pin-no-bump")).last_activity;
    if (!before) throw new Error("seed item should have set last_activity");
    await new Promise((r) => setTimeout(r, 25));
    await storage.setContextPinned("pin-no-bump", true);
    const after = (await storage.getContextMetadata("pin-no-bump")).last_activity;
    if (after !== before) {
      throw new Error(`last_activity changed from ${before} to ${after} — pin should not bump it`);
    }
    const meta = await storage.getContextMetadata("pin-no-bump");
    if (meta.pinned !== true) throw new Error("pinned should be true after setContextPinned(true)");
  });

  await check("setContextPinned(false) clears the field", async () => {
    await storage.createContext("pin-clear");
    await storage.setContextPinned("pin-clear", true);
    await storage.setContextPinned("pin-clear", false);
    const meta = await storage.getContextMetadata("pin-clear");
    if (meta.pinned === true) throw new Error("pinned should be unset after setContextPinned(false)");
    const raw = fs.readFileSync(path.join(tmpRoot, "pin-clear", "_context.yaml"), "utf-8");
    if (raw.includes("pinned:")) throw new Error("pinned key should not appear in YAML after unpin");
  });

  await check("setContextPinned errors when the context does not exist", async () => {
    let threw = false;
    try {
      await storage.setContextPinned("does-not-exist", true);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("expected setContextPinned to throw for missing context");
  });
```

- [ ] **Step 2: Run sanity — confirm the three new checks fail**

```bash
npm run build && npm run sanity
```

Expected: all three new checks FAIL with `storage.setContextPinned is not a function` (or similar — the function doesn't exist yet).

- [ ] **Step 3: Implement `setContextPinned`**

In `src/storage.ts`, after the `updateContextMetadata` function (around line 298), add:

```typescript
// Toggle the `pinned` flag on a context's metadata WITHOUT bumping
// `last_activity`. Pin/unpin is a presentation toggle, not work on the
// context — a recently-pinned context should not appear "recently active".
// Mirrors writeContextMetadata's invariants: errors if the context dir is
// missing; preserves all other fields verbatim.
export async function setContextPinned(
  name: string,
  pinned: boolean
): Promise<ContextMetadata> {
  const existing = await getContextMetadata(name);
  const merged: ContextMetadata = {
    ...existing,
    // Only true is persisted; false unsets the field so the YAML stays clean.
    pinned: pinned ? true : undefined,
  };
  // Preserve created/updated/last_activity unchanged. writeContextMetadata only
  // writes them if truthy, so pass them through.
  await writeContextMetadata(name, merged);
  return merged;
}
```

Note: this calls `writeContextMetadata`, which calls `fs.access(resolveContextPath(name))` and throws if the context dir is missing — that satisfies the "errors when context does not exist" check.

- [ ] **Step 4: Run sanity — all three new checks should pass**

```bash
npm run build && npm run sanity
```

Expected: all checks pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts scripts/sanity.js
git commit -m "feat: add setContextPinned that skips last_activity bump"
```

---

## Task 3: Sort pins to the top in all sort modes

**Files:**
- Modify: `src/storage.ts:316-345` (`sortSummaries` and `listContexts`'s `needMeta` logic)
- Modify: `scripts/sanity.js` (append three new checks)

- [ ] **Step 1: Write failing sanity checks**

In `scripts/sanity.js`, append after the previous Task 2 checks:

```javascript
  await check("pinned context floats to top of sort=name", async () => {
    await storage.createContext("zzz-pinned");
    await storage.createContext("aaa-unpinned");
    await storage.createContext("bbb-unpinned");
    await storage.setContextPinned("zzz-pinned", true);
    const list = await storage.listContexts({ includeMetadata: true, sort: "name" });
    const names = list.map((c) => c.name);
    // The pinned "zzz-pinned" must come before any unpinned context, even though
    // alphabetically it would sort last.
    const idxPin = names.indexOf("zzz-pinned");
    const idxAaa = names.indexOf("aaa-unpinned");
    const idxBbb = names.indexOf("bbb-unpinned");
    if (idxPin === -1 || idxAaa === -1 || idxBbb === -1) throw new Error("contexts missing");
    if (idxPin > idxAaa || idxPin > idxBbb) {
      throw new Error(`pinned should be first; got [${names.join(", ")}]`);
    }
    // Within the unpinned group, alphabetical still holds.
    if (idxAaa > idxBbb) throw new Error("unpinned group must remain alphabetical");
  });

  await check("pinned context floats to top of sort=recent_activity", async () => {
    await storage.createContext("recent-pinned");
    await storage.createContext("recent-active");
    await storage.createItem("recent-pinned", "old", "md", { content: "x" });
    await new Promise((r) => setTimeout(r, 25));
    await storage.createItem("recent-active", "new", "md", { content: "y" });
    // recent-active was touched last, so without pinning it would be first.
    await storage.setContextPinned("recent-pinned", true);
    const list = await storage.listContexts({
      includeMetadata: true,
      sort: "recent_activity",
    });
    const idxPin = list.findIndex((c) => c.name === "recent-pinned");
    const idxAct = list.findIndex((c) => c.name === "recent-active");
    if (idxPin === -1 || idxAct === -1) throw new Error("contexts missing");
    if (idxPin > idxAct) {
      throw new Error(`pinned should beat recent_activity; got pin=${idxPin}, active=${idxAct}`);
    }
  });

  await check("archived+pinned hidden by default; floats when include_archived=true", async () => {
    await storage.createContext("arch-pin");
    await storage.createContext("plain");
    await storage.setContextPinned("arch-pin", true);
    await storage.updateContextMetadata("arch-pin", { status: "archived" });

    const def = await storage.listContexts({ includeMetadata: true });
    if (def.find((c) => c.name === "arch-pin")) {
      throw new Error("archived+pinned context should be hidden by default");
    }

    const all = await storage.listContexts({ includeMetadata: true, includeArchived: true });
    const idxPin = all.findIndex((c) => c.name === "arch-pin");
    const idxPlain = all.findIndex((c) => c.name === "plain");
    if (idxPin === -1 || idxPlain === -1) throw new Error("contexts missing in include_archived list");
    if (idxPin > idxPlain) {
      throw new Error(`archived+pinned should still float when shown; got pin=${idxPin}, plain=${idxPlain}`);
    }
  });
```

- [ ] **Step 2: Run sanity — confirm all three new checks fail**

```bash
npm run build && npm run sanity
```

Expected: the three new checks FAIL — pins don't float yet because `sortSummaries` doesn't know about them.

- [ ] **Step 3: Update `sortSummaries` to partition pinned-first**

In `src/storage.ts`, replace `sortSummaries` (around lines 326-345) with:

```typescript
function sortSummaries(
  summaries: ContextSummary[],
  sort: NonNullable<ListContextsOptions["sort"]>
): void {
  // Pinned-first across every sort mode. Within each pin group, apply the same
  // comparator. We cannot precompute pin partitions because Array.sort gets a
  // single comparator — instead, the pin difference is the primary key.
  const pinKey = (s: ContextSummary): number =>
    s.metadata?.pinned === true ? 1 : 0;

  if (sort === "name") {
    summaries.sort((a, b) => {
      const dp = pinKey(b) - pinKey(a);
      if (dp !== 0) return dp;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return;
  }
  // Time-based sorts: most-recent-first; missing values sink within group.
  const key: keyof ContextMetadata =
    sort === "recent_activity" ? "last_activity" : sort;
  summaries.sort((a, b) => {
    const dp = pinKey(b) - pinKey(a);
    if (dp !== 0) return dp;
    const av = (a.metadata?.[key] as string | undefined) || "";
    const bv = (b.metadata?.[key] as string | undefined) || "";
    if (av === bv) return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (!av) return 1;
    if (!bv) return -1;
    return av < bv ? 1 : -1;
  });
}
```

- [ ] **Step 4: Drop the `needMeta` optimization in `listContexts`**

In `src/storage.ts`, in `listContexts` (around lines 347-385), pin partitioning requires reading `pinned` from each context's metadata, so the optimization that skipped metadata loads in the bare-name path no longer holds. Replace the `needMeta` line and the conditional load with an unconditional load.

Old (around lines 354-368):

```typescript
  const sort = options.sort || "name";
  const includeArchived = options.includeArchived === true;
  // Any non-name sort, or an archived filter, requires metadata reads.
  const needMeta =
    options.includeMetadata === true || sort !== "name" || !includeArchived;

  await ensureDataDir();
  const entries = await fs.readdir(dataDir(), { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const summaries: ContextSummary[] = [];
  for (const name of names) {
    if (!needMeta) {
      summaries.push({ name });
      continue;
    }
    let metadata: ContextMetadata;
    try {
      metadata = await getContextMetadata(name);
    } catch {
      metadata = defaultContextMetadata();
    }
    if (!includeArchived && isArchived(metadata)) continue;
    summaries.push({ name, metadata });
  }
```

Replace with:

```typescript
  const sort = options.sort || "name";
  const includeArchived = options.includeArchived === true;

  await ensureDataDir();
  const entries = await fs.readdir(dataDir(), { withFileTypes: true });
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  // Always load metadata: pin state is metadata, and pin-floating applies to
  // every list_contexts call (with or without include_metadata=true).
  const summaries: ContextSummary[] = [];
  for (const name of names) {
    let metadata: ContextMetadata;
    try {
      metadata = await getContextMetadata(name);
    } catch {
      metadata = defaultContextMetadata();
    }
    if (!includeArchived && isArchived(metadata)) continue;
    summaries.push({ name, metadata });
  }
```

The final block (around lines 379-384) that strips metadata when `includeMetadata !== true` stays as-is — it now operates on summaries that always have metadata loaded.

- [ ] **Step 5: Run sanity — all checks should pass**

```bash
npm run build && npm run sanity
```

Expected: all sanity checks pass, including the three new ones AND the existing `sort=recent_activity` check.

- [ ] **Step 6: Commit**

```bash
git add src/storage.ts scripts/sanity.js
git commit -m "feat: pin contexts always float to top of list_contexts"
```

---

## Task 4: Plumb `pinned` through the `update_context_metadata` MCP tool

**Files:**
- Modify: `src/types.ts:137-150` (`UpdateContextMetadataArgsSchema`)
- Modify: `src/index.ts:251-262` (`update_context_metadata` handler)

This task is plumbing-only and has no new sanity check — Task 2 already covers `setContextPinned`, and the MCP handler is a thin wrapper. We rely on `npm run build` for type-checking and on a one-line manual test at the end.

- [ ] **Step 1: Add `pinned` to `UpdateContextMetadataArgsSchema`**

In `src/types.ts`, edit `UpdateContextMetadataArgsSchema` (around lines 137-150):

```typescript
export const UpdateContextMetadataArgsSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z
    .string()
    .optional()
    .describe("Free-form working status (e.g. pending, in-progress, pr, done, archived)."),
  tags: z.array(z.string()).optional(),
  links: z
    .array(ContextLinkSchema)
    .optional()
    .describe("Array of {label, url} — e.g. Jira ticket, PR, design doc."),
  pinned: z
    .boolean()
    .optional()
    .describe("Pin to the top of list_contexts. true to pin, false to unpin. Pin/unpin does NOT bump last_activity."),
});
```

- [ ] **Step 2: Update the handler to route `pinned` separately**

In `src/index.ts`, edit the `update_context_metadata` handler (around lines 251-262):

```typescript
server.registerTool(
  "update_context_metadata",
  {
    description: "Patch a context's metadata. Only fields you pass are changed. Set status='archived' to archive. Set pinned=true to pin to the top, pinned=false to unpin.",
    inputSchema: UpdateContextMetadataArgsSchema.shape,
  },
  async (args) => {
    const { name, pinned, ...patch } = args;

    // Pin first (separate path — does NOT bump last_activity). It's safe to
    // run before the other-fields write because both touch the same YAML
    // file and writeContextMetadata is atomic; the second write just sees
    // the freshly-pinned state in `existing`.
    if (pinned !== undefined) {
      await storage.setContextPinned(name, pinned);
    }

    // Only call updateContextMetadata if the caller actually patched something
    // other than `pinned`. Otherwise we'd bump last_activity for nothing.
    const hasOtherFields =
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.status !== undefined ||
      patch.tags !== undefined ||
      patch.links !== undefined;

    let metadata = await storage.getContextMetadata(name);
    if (hasOtherFields) {
      metadata = await storage.updateContextMetadata(name, patch);
    }
    return json({ name, metadata });
  }
);
```

- [ ] **Step 3: Build to confirm types compile**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 4: Run sanity to confirm no regressions**

```bash
npm run sanity
```

Expected: all checks still pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat: update_context_metadata accepts pinned field"
```

---

## Task 5: Web pin/unpin endpoints + shared list-region renderer

**Files:**
- Modify: `src/web.ts` (refactor `/` handler; add two new POST routes)

This task adds the wire endpoints and refactors the list-region rendering so the GET handler and the new POSTs share one path. No sanity check — the routes are exercised manually via the dev UI in Task 6.

- [ ] **Step 1: Extract a shared list-region renderer**

In `src/web.ts`, add a private helper above the `app.get("/", ...)` handler. This consolidates the logic currently inline in the GET handler (filter the catalog, compute statuses/archived count, partition for filter) so the pin/unpin POSTs can reuse it.

Insert after line 92 (after `parseTags`), before the comment `// --- Context routes ---`:

```typescript
// Read the catalog with metadata + archived included, compute the visible
// subset based on sort/status/showArchived, and return everything the
// list-region template needs. Shared by GET /, POST /ctx/:name/pin, and
// POST /ctx/:name/unpin.
async function buildListRegionState(query: Record<string, unknown>) {
  const sort = parseSort(query.sort);
  const showArchived = parseTruthy(query.show_archived);
  const statusFilter = parseStatus(query.status);

  const all = await storage.listContexts({
    includeMetadata: true,
    includeArchived: true,
    sort,
  });

  const distinctStatuses = Array.from(
    new Set(
      all
        .map((c) => c.metadata?.status)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    )
  ).sort();
  const archivedCount = all.filter((c) => c.metadata?.status === "archived").length;

  let visible: typeof all;
  if (statusFilter) {
    visible = all.filter((c) => c.metadata?.status === statusFilter);
  } else if (showArchived) {
    visible = all;
  } else {
    visible = all.filter((c) => c.metadata?.status !== "archived");
  }

  const controls = { sort, showArchived, archivedCount, distinctStatuses, statusFilter };
  return { visible, controls };
}
```

- [ ] **Step 2: Replace the GET handler body to use the helper**

In `src/web.ts`, replace `app.get("/", ...)` (around lines 96-135) with:

```typescript
app.get("/", async (req, res) => {
  const { visible, controls } = await buildListRegionState(req.query);
  if (req.get("HX-Request") === "true") {
    res.send(contextListRegionFragment(visible, controls));
    return;
  }
  res.send(contextListPage(visible, controls));
});
```

- [ ] **Step 3: Add the pin and unpin POST routes**

In `src/web.ts`, after the existing `app.delete("/ctx/:name", ...)` handler (around line 160), add:

```typescript
// Pin/unpin endpoints — both return the full #context-list-region fragment so
// the card moves to its new position immediately and the divider re-renders.
// Sort/status/show_archived are read from query params on the POST URL; the
// pin button's hx-post URL must include them so the response renders the same
// view the user is currently looking at.
app.post("/ctx/:name/pin", async (req, res) => {
  try {
    await storage.setContextPinned(req.params.name, true);
    const { visible, controls } = await buildListRegionState(req.query);
    res.send(contextListRegionFragment(visible, controls));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});

app.post("/ctx/:name/unpin", async (req, res) => {
  try {
    await storage.setContextPinned(req.params.name, false);
    const { visible, controls } = await buildListRegionState(req.query);
    res.send(contextListRegionFragment(visible, controls));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<div class="flash flash-error">${escHtml(msg)}</div>`);
  }
});
```

- [ ] **Step 4: Build to confirm everything compiles**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 5: Run sanity to confirm storage-level invariants still hold**

```bash
npm run sanity
```

Expected: all checks pass.

- [ ] **Step 6: Commit**

```bash
git add src/web.ts
git commit -m "feat: add pin/unpin web routes with shared list-region renderer"
```

---

## Task 6: Templates — pin button, pin glyph, divider

**Files:**
- Modify: `src/templates.ts` (add SVG icon constant; modify `renderContextCardBody`; modify `contextListRegionFragment`; minor edit to `contextCardFragment`)
- Modify: `src/styles.ts` (append rules for `.pin-divider`, `.pin-icon`, `.pin-glyph`)

- [ ] **Step 1: Add the shared SVG pin icon constant**

In `src/templates.ts`, near the top of the file (after the `tags` and `contextTagChips` helpers, before `statusBadge`, around line 22), add:

```typescript
// Shared pin SVG — used both for the per-card pin/unpin button and the small
// "this is pinned" glyph rendered next to the title. Inline so it inherits
// `currentColor` and stays consistent with the existing terminal-aesthetic
// SVGs in the header.
const PIN_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.5 1 L11 2.5 L8 5.5 L11.5 9 L8.5 9.5 L7 12 L5 10 L2.5 12.5 L2 12 L4.5 9.5 L2.5 7.5 L3 6.5 L6.5 7 L9.5 1 Z" fill="currentColor"/></svg>`;
```

- [ ] **Step 2: Update `renderContextCardBody` to render the pin button + title glyph**

In `src/templates.ts`, replace `renderContextCardBody` (around lines 366-397) with:

```typescript
function renderContextCardBody(summary: ContextSummary, queryString: string = ""): string {
  const meta = summary.metadata;
  const title = displayContextTitle(summary);
  const slug = summary.name;
  const showSlug = title !== slug;
  const isPinned = meta?.pinned === true;
  const description = meta?.description
    ? `<div class="ctx-desc" style="margin-top:0.35rem; font-size:0.8rem; color:var(--text-muted); font-style:italic;">${esc(meta.description)}</div>`
    : "";
  const status = statusBadge(meta?.status);
  const ctxTags = meta?.tags && meta.tags.length ? contextTagChips(meta.tags) : "";
  const statusRow =
    status || ctxTags
      ? `<div style="margin-top:0.5rem;">${status}${ctxTags}</div>`
      : "";
  const links = meta?.links ? linksRow(meta.links) : "";

  const titleGlyph = isPinned
    ? `<span class="pin-glyph" aria-label="pinned" title="pinned">${PIN_SVG}</span>`
    : "";
  // The pin button posts to /pin or /unpin and replaces the whole list region
  // (so the card moves position and the divider re-renders). Carrying the
  // current sort/filter via the query string keeps the user's view stable.
  const pinUrl = `/ctx/${esc(slug)}/${isPinned ? "unpin" : "pin"}${queryString}`;
  const pinLabel = isPinned ? "Unpin" : "Pin";
  const pinBtn = `<button class="btn btn-sm pin-btn${isPinned ? " is-pinned" : ""}"
        hx-post="${pinUrl}"
        hx-target="#context-list-region"
        hx-swap="outerHTML"
        title="${pinLabel}"
        aria-label="${pinLabel}">${PIN_SVG}</button>`;

  return `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="flex:1; min-width:0;">
        <h3>${titleGlyph}<a href="/ctx/${esc(slug)}">${esc(title)}</a></h3>
        ${showSlug ? `<div class="meta">${esc(slug)}</div>` : ""}
        ${description}
        ${statusRow}
        ${links}
      </div>
      <div class="card-actions">
        ${pinBtn}
        <button class="btn btn-danger btn-sm"
          hx-delete="/ctx/${esc(slug)}"
          hx-target="#ctx-${esc(slug)}"
          hx-swap="outerHTML"
          hx-confirm="Delete context '${esc(slug)}' and all its items?">Delete</button>
      </div>
    </div>`;
}
```

- [ ] **Step 3: Update `contextListRegionFragment` to partition + divider**

In `src/templates.ts`, replace `contextListRegionFragment` (around lines 433-529) with:

```typescript
export function contextListRegionFragment(
  contexts: ContextSummary[],
  controls: ContextListControls
): string {
  const emptyMessage = controls.statusFilter
    ? `No contexts with status "${esc(controls.statusFilter)}".`
    : `No contexts yet. Create one below.`;

  // Carry the current sort/status/show_archived on every pin/unpin POST so
  // the response renders the same view the user is currently looking at.
  // The pinned-vs-unpinned partition is for rendering only — `contexts` is
  // already pinned-first courtesy of storage.sortSummaries.
  const queryParts: string[] = [`sort=${esc(controls.sort)}`];
  if (controls.statusFilter) queryParts.push(`status=${encodeURIComponent(controls.statusFilter)}`);
  if (controls.showArchived) queryParts.push(`show_archived=1`);
  const cardQuery = `?${queryParts.join("&")}`;

  const pinned = contexts.filter((c) => c.metadata?.pinned === true);
  const unpinned = contexts.filter((c) => c.metadata?.pinned !== true);

  const renderCard = (c: ContextSummary) =>
    `<div class="card${c.metadata?.pinned ? " card-pinned" : ""}" id="ctx-${esc(c.name)}">${renderContextCardBody(c, cardQuery)}</div>`;

  // Divider only when both groups are non-empty. If everything is pinned, or
  // nothing is, there's no separation to draw.
  let list: string;
  if (contexts.length === 0) {
    list = `<div class="empty">${emptyMessage}</div>`;
  } else if (pinned.length > 0 && unpinned.length > 0) {
    list = `${pinned.map(renderCard).join("")}<hr class="pin-divider" aria-label="end of pinned contexts">${unpinned.map(renderCard).join("")}`;
  } else {
    list = contexts.map(renderCard).join("");
  }

  const sortOptions: Array<{ v: ContextListControls["sort"]; label: string }> = [
    { v: "name", label: "name" },
    { v: "recent_activity", label: "recent" },
    { v: "updated", label: "updated" },
    { v: "created", label: "created" },
  ];
  const listHref = (p: { sort: string; status?: string; showArchived: boolean }) => {
    const parts: string[] = [`sort=${esc(p.sort)}`];
    if (p.status) parts.push(`status=${encodeURIComponent(p.status)}`);
    if (p.showArchived) parts.push(`show_archived=1`);
    return `/?${parts.join("&")}`;
  };
  const swapAttrs = `hx-target="#context-list-region" hx-swap="outerHTML" hx-push-url="true"`;
  const tab = (active: boolean, href: string, label: string) =>
    `<a class="sort-tab${active ? " active" : ""}" href="${href}" hx-get="${href}" ${swapAttrs}>${label}</a>`;

  const sortTabs = sortOptions
    .map((o) =>
      tab(
        o.v === controls.sort,
        listHref({ sort: o.v, status: controls.statusFilter, showArchived: controls.showArchived }),
        o.label
      )
    )
    .join("");

  const statusFilterRow = controls.distinctStatuses.length
    ? `
        <span class="list-divider" aria-hidden="true"></span>
        <span class="list-label">status</span>
        ${tab(
          !controls.statusFilter,
          listHref({ sort: controls.sort, showArchived: controls.showArchived }),
          "all"
        )}
        ${controls.distinctStatuses
          .map((s) =>
            tab(
              s === controls.statusFilter,
              listHref({ sort: controls.sort, status: s, showArchived: controls.showArchived }),
              esc(s)
            )
          )
          .join("")}`
    : "";

  const archivedToggleHref = listHref({
    sort: controls.sort,
    showArchived: !controls.showArchived,
  });
  const showArchivedChip =
    !controls.statusFilter && (controls.archivedCount > 0 || controls.showArchived);
  const archivedChip = showArchivedChip
    ? `<a class="chip" href="${archivedToggleHref}" hx-get="${archivedToggleHref}" ${swapAttrs}>${
        controls.showArchived ? "hide archived" : `archived (${controls.archivedCount})`
      }</a>`
    : "";

  return `
    <div id="context-list-region">
      <div class="list-controls">
        <span class="list-label">sort by</span>
        ${sortTabs}${statusFilterRow}
        ${archivedChip}
      </div>
      <div id="context-list" style="margin-top:1rem;">${list}</div>
    </div>`;
}
```

- [ ] **Step 4: Update `contextCardFragment` to keep the create-new-context flow consistent**

In `src/templates.ts`, replace `contextCardFragment` (around lines 531-534) with:

```typescript
export function contextCardFragment(summary: ContextSummary): string {
  // New-card append after POST /ctx never has a known sort/filter, so the pin
  // button posts without query params; htmx will swap the full region anyway,
  // and the server rebuilds state from defaults.
  return `
    <div class="card${summary.metadata?.pinned ? " card-pinned" : ""}" id="ctx-${esc(summary.name)}">${renderContextCardBody(summary, "")}</div>`;
}
```

- [ ] **Step 5: Add styles for `.pin-divider`, `.pin-glyph`, `.pin-btn`, `.card-actions`**

In `src/styles.ts`, append the following rules at the bottom of the styles string (just before the closing backtick around line 793):

```css
    .card-actions { display: flex; gap: 0.4rem; align-items: flex-start; flex-shrink: 0; }
    .pin-btn { padding: 0.3rem 0.45rem; line-height: 1; color: var(--text-muted); }
    .pin-btn svg { width: 14px; height: 14px; vertical-align: middle; }
    .pin-btn:hover { color: var(--accent); }
    .pin-btn.is-pinned { color: var(--accent); }
    .pin-glyph { display: inline-block; margin-right: 0.4rem; color: var(--accent); vertical-align: middle; }
    .pin-glyph svg { width: 12px; height: 12px; vertical-align: middle; }
    .pin-divider {
      border: none;
      border-top: 1px dashed var(--border-heavy);
      margin: 1rem 0;
      opacity: 0.6;
    }
    .card-pinned { border-left: 2px solid var(--accent-line-hover); }
```

- [ ] **Step 6: Build to confirm everything compiles**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 7: Run sanity to confirm storage didn't regress**

```bash
npm run sanity
```

Expected: all checks pass.

- [ ] **Step 8: Manual smoke test**

Start the web UI:

```bash
npm run ui
```

Open http://localhost:3141 in a browser. Verify all of the following:

1. **Pin button is visible** on every context card next to Delete.
2. **Click pin** on one context. The list re-renders, the pinned context jumps to the top, the pin button on that card now shows the active state (accent color + `is-pinned` class), and a small pin glyph appears next to the title.
3. **A dashed divider appears** between the pinned context and the rest of the list.
4. **Click pin** on a second context. Both pinned cards group at the top, separated from the unpinned group by the divider. Within the pinned group, the alphabetical order still holds.
5. **Click the same pin button again** (now showing as pinned). The card returns to its sorted alphabetical position, divider disappears if no other contexts are pinned.
6. **Switch sort to "recent"**. Pinned contexts still float at the top.
7. **Apply a status filter** (if any contexts have a status set). Pinned contexts NOT matching the filter disappear from view (filter wins). Pinned contexts that DO match still float in the filtered group.
8. **Pin a context, then archive it via the metadata edit page.** Without `show_archived`, the card disappears (archive wins). Click "archived (1)" to opt in — it reappears at the top.

Stop the UI when done (Ctrl-C, or click "× Shutdown" in the footer).

- [ ] **Step 9: Commit**

```bash
git add src/templates.ts src/styles.ts
git commit -m "feat: pin button, pin glyph, and pinned/unpinned divider in web UI"
```

---

## Task 7: README touch + final verification

**Files:**
- Modify: `README.md` (add a one-line mention of pinning to whatever feature list / capabilities section exists)

- [ ] **Step 1: Read the README to find the right insertion point**

```bash
cat README.md | head -100
```

Look for a section listing features (e.g. "Features", "What it does", a bullet list near the top, or a tool reference for `update_context_metadata`). Pinning is a capability worth surfacing alongside archiving in whichever section already mentions context metadata or status. If no obvious section exists, add a short "Pinning" subsection.

- [ ] **Step 2: Add the README mention**

The exact edit depends on the README's structure, but the content should be roughly:

> **Pinning.** Set `pinned: true` on a context (via `update_context_metadata` or the pin button in the web UI) to float it to the top of `list_contexts` regardless of sort. Pin/unpin does not bump `last_activity` — it's a presentation toggle, not work on the context. Archived contexts stay hidden by default even when pinned.

Adapt the formatting (heading level, bullet vs paragraph) to whatever the README already uses.

- [ ] **Step 3: Final full verification**

```bash
npm run build && npm run sanity
```

Expected: clean build, all sanity checks pass (including the Task 1, 2, 3 additions).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: mention context pinning in README"
```

---

## Self-review checklist (informational)

The following spec requirements map to tasks:

| Spec point | Covered by |
|------------|------------|
| Multiple unordered pins | Task 1 (boolean), Task 3 (sort partition) |
| `pinned` field in `_context.yaml` | Task 1 |
| Boolean — omitted when false | Task 1 (writer skips false) |
| Pins float in all sort modes | Task 3 |
| Archive wins over pin | Task 3 (sanity check) |
| Filter wins (web UI) | Task 5 (filter applied AFTER storage sort) |
| Search untouched | (no changes to `src/search.ts` — intentional) |
| `list_contexts` floats pins regardless of `include_metadata` | Task 3 (always-load metadata; partition in sortSummaries) |
| `update_context_metadata` accepts `pinned` | Task 4 |
| No new MCP tools | Task 4 (extends existing) |
| Pinning skips `last_activity` bump | Task 2 (`setContextPinned`) |
| Pin button on every card | Task 6 |
| Pin glyph next to title on pinned cards | Task 6 |
| Divider between pinned and unpinned groups | Task 6 |
| Divider hidden when either group empty | Task 6 |
| Two endpoints (`/pin`, `/unpin`) | Task 5 |
| Full region swap on pin click | Task 5 + Task 6 |
| SVG icon shared between button and glyph | Task 6 (`PIN_SVG` constant) |
| No pin checkbox in metadata edit form | (no change to `contextMetaEditPage` — intentional) |
