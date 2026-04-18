import { ContextMetadata, ContextSummary, ItemInfo } from "./types.js";
import { SearchResult } from "./search.js";
import { styles } from "./styles.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tags(t: string[]): string {
  return t.map((tag) => `<span class="tag">${esc(tag)}</span>`).join(" ");
}

function contextTagChips(t: string[]): string {
  return t
    .map((tag) => `<span class="tag tag-ctx">${esc(tag)}</span>`)
    .join(" ");
}

function statusBadge(status?: string): string {
  if (!status) return "";
  return `<span class="status-badge">${esc(status)}</span>`;
}

function linksRow(links: ContextMetadata["links"]): string {
  if (!links || links.length === 0) return "";
  const items = links
    .map(
      (l) =>
        `<a class="ctx-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
    )
    .join(" ");
  return `<div class="ctx-links">${items}</div>`;
}

function displayContextTitle(summary: ContextSummary): string {
  const metaTitle = summary.metadata?.title;
  return metaTitle && metaTitle.trim().length > 0 ? metaTitle : summary.name;
}

export function layout(title: string, body: string): string {
  const terminalId = Math.floor(Math.random() * 900) + 100;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark light">
  <script>
  (function() {
    var root = document.documentElement;
    try {
      var isLight = localStorage.getItem('contexts-theme') === 'light';
      if (isLight) root.setAttribute('data-theme', 'light');
      root.style.colorScheme = isLight ? 'light' : 'dark';
      var raw = localStorage.getItem('contexts-style');
      if (raw) {
        var s = JSON.parse(raw);
        ['accent', 'palette', 'corners', 'chrome', 'motion', 'complement', 'width'].forEach(function(k) {
          if (s && typeof s[k] === 'string' && s[k].length > 0) {
            root.setAttribute('data-' + k, s[k]);
          }
        });
      }
    } catch (e) {}
  })();
  </script>
  <style>html,body{background:#16181d;color:#c9d1d9;}html[data-theme="light"],html[data-theme="light"] body{background:#e8e0cc;color:#2a2824;}</style>
  <title>${esc(title)} - Contexts</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    .fonts-loading { opacity: 0; }
    .fonts-ready { opacity: 1; transition: opacity 0.15s ease-in; }
  </style>
  <script>
  document.documentElement.classList.add('fonts-loading');
  document.fonts.ready.then(function() { document.documentElement.classList.replace('fonts-loading', 'fonts-ready'); });
  </script>
  <style>${styles}</style>
</head>
<body>
  <canvas id="noise-canvas"></canvas>
  <div class="container">
    <header>
      <div class="sys-bars" id="sys-bars"><span aria-hidden="true">SYS.ACTIVE </span><span id="sys-bars-strip" aria-hidden="true">░░░░░░░░░░░░░░░░░░░░</span><a href="/theme" id="theme-lab-link" title="Theme lab" aria-label="Open theme lab"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M7.5 1.5 C3.8 1.5 1 3.9 1 7 C1 9.7 3 11.3 4.8 11.3 C5.5 11.3 5.9 10.9 6.2 10.4 C6.6 9.7 7.2 9.4 7.8 9.4 C8.6 9.4 9 9.8 9.2 10.4 C9.4 11 9.8 11.5 10.5 11.5 C12.8 11.5 15 9.5 15 6.7 C15 3.8 12 1.5 7.5 1.5 Z" fill="currentColor"/><circle cx="4.5" cy="5.5" r="1" fill="var(--bg)"/><circle cx="7.5" cy="3.8" r="1" fill="var(--bg)"/><circle cx="10.5" cy="5" r="1" fill="var(--bg)"/><circle cx="12" cy="7.5" r="1" fill="var(--bg)"/></svg></a><button type="button" id="width-toggle" popovertarget="width-popout" title="Width">W</button><div id="width-popout" popover><button type="button" data-width-set="narrow">narrow</button><button type="button" data-width-set="medium">medium</button><button type="button" data-width-set="wide">wide</button></div><button type="button" id="theme-toggle" aria-label="Toggle theme">◐</button></div>
      <h1><a href="/">Contexts</a></h1>
      <nav>
        <a href="/">All Contexts</a>
        <a href="/search">Search</a>
      </nav>
    </header>
    ${body}
    <footer class="classification-footer">
      <span id="footer-text">CONTEXT MANAGEMENT SYSTEM &mdash; TERMINAL ${terminalId} &mdash; SESSION ACTIVE</span>
      <details id="footer-about" class="footer-about">
        <summary>About</summary>
        <div id="footer-about-body">loading...</div>
      </details>
      <form hx-post="/shutdown" hx-confirm="Shut down the Contexts UI server?" hx-target="#footer-text" hx-swap="outerHTML" class="footer-shutdown">
        <button type="submit" class="btn btn-sm btn-danger">× Shutdown</button>
      </form>
    </footer>
  </div>
  <script>
  (function() {
    var c = document.getElementById('noise-canvas');
    if (!c) return;
    var ctx = c.getContext('2d');
    var w, h;
    function resize() {
      w = c.width = Math.ceil(window.innerWidth / 4);
      h = c.height = Math.ceil(window.innerHeight / 4);
    }
    resize();
    window.addEventListener('resize', resize);
    var last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (t - last < 80) return;
      last = t;
      var img = ctx.createImageData(w, h);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (Math.random() * 255) | 0;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = 10;
      }
      ctx.putImageData(img, 0, 0);
    }
    requestAnimationFrame(frame);
  })();
  (function() {
    var el = document.getElementById('sys-bars-strip');
    if (!el) return;
    var N = 20;
    // All Unicode block elements → guaranteed equal advance width in monospace,
    // so the strip never jitters even as glyphs change.
    // Only uniform-width shade blocks — ▁ etc. are NOT guaranteed equal advance
    // and caused layout shift in IBM Plex Mono. These four are safe.
    var shades = ['░', '▒', '▓', '█'];
    var threads = [];
    for (var i = 0; i < N; i++) {
      threads.push({
        v: 0,
        decay: 0.00035 + Math.random() * 0.00065,     // fade over ~1.5–4 s
        rate:  3000 + Math.random() * 15000,          // 3–18 s between pulses
        next:  Math.random() * 10000,                 // stagger first pulses
        hit:   false,
      });
    }
    var start = 0, last = 0;
    function bars(t) {
      requestAnimationFrame(bars);
      if (!start) { start = t; last = t; }
      var dt = t - last;
      if (dt < 180) return;
      last = t;
      var elapsed = t - start;
      for (var i = 0; i < N; i++) {
        var th = threads[i];
        th.v -= th.decay * dt;
        if (th.v <= 0) { th.v = 0; th.hit = false; }
        if (elapsed >= th.next) {
          th.v = 0.35 + Math.random() * 0.65;
          th.hit = Math.random() < 0.04;              // ~4% of pulses glow green → one every ~12 s
          th.next = elapsed + th.rate * (0.5 + Math.random() * 1.0);
        }
      }
      var out = '';
      for (var i = 0; i < N; i++) {
        var th = threads[i];
        var ch = shades[Math.min(3, Math.floor(th.v * 4))];
        out += th.hit && th.v > 0.01 ? '<span class="hit">' + ch + '</span>' : ch;
      }
      el.innerHTML = out;
    }
    requestAnimationFrame(bars);
  })();
  (function() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    var root = document.documentElement;
    function render() {
      var light = root.getAttribute('data-theme') === 'light';
      btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
    }
    render();
    btn.addEventListener('click', function() {
      var next = root.getAttribute('data-theme') === 'light' ? null : 'light';
      if (next) root.setAttribute('data-theme', next);
      else root.removeAttribute('data-theme');
      root.style.colorScheme = next === 'light' ? 'light' : 'dark';
      try { localStorage.setItem('contexts-theme', next || 'dark'); } catch (e) {}
      render();
    });
  })();
  (function() {
    var root = document.documentElement;
    var STYLE_KEYS = ['accent', 'palette', 'corners', 'chrome', 'motion', 'complement', 'width'];
    function applyTheme() {
      var isLight = localStorage.getItem('contexts-theme') === 'light';
      if (isLight) root.setAttribute('data-theme', 'light');
      else root.removeAttribute('data-theme');
      root.style.colorScheme = isLight ? 'light' : 'dark';
      var tb = document.getElementById('theme-toggle');
      if (tb) tb.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    }
    function applyStyle() {
      var s = null;
      try {
        var raw = localStorage.getItem('contexts-style');
        if (raw) s = JSON.parse(raw);
      } catch (e) {}
      STYLE_KEYS.forEach(function(k) {
        if (s && typeof s[k] === 'string' && s[k].length > 0) root.setAttribute('data-' + k, s[k]);
        else root.removeAttribute('data-' + k);
      });
    }
    window.addEventListener('storage', function(e) {
      if (e.storageArea && e.storageArea !== localStorage) return;
      if (e.key === null) { applyTheme(); applyStyle(); return; }
      if (e.key === 'contexts-theme') applyTheme();
      else if (e.key === 'contexts-style') applyStyle();
    });
  })();
  (function() {
    var btn = document.getElementById('width-toggle');
    var popout = document.getElementById('width-popout');
    if (!btn || !popout) return;
    var root = document.documentElement;
    var KEY = 'contexts-style';
    function current() { return root.getAttribute('data-width') || 'narrow'; }
    function markActive() {
      var w = current();
      Array.prototype.forEach.call(popout.querySelectorAll('[data-width-set]'), function(b) {
        b.classList.toggle('active', b.dataset.widthSet === w);
      });
      btn.setAttribute('aria-label', 'Width: ' + w);
      btn.title = 'Width: ' + w;
    }
    function position() {
      var rect = btn.getBoundingClientRect();
      popout.style.position = 'fixed';
      popout.style.top = (rect.bottom + 4) + 'px';
      popout.style.right = (window.innerWidth - rect.right) + 'px';
      popout.style.left = 'auto';
    }
    function setWidth(next) {
      if (next === 'narrow') root.removeAttribute('data-width');
      else root.setAttribute('data-width', next);
      try {
        var raw = localStorage.getItem(KEY);
        var s = raw ? JSON.parse(raw) : {};
        if (next === 'narrow') delete s.width;
        else s.width = next;
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch (e) {}
      markActive();
    }
    markActive();
    popout.addEventListener('toggle', function(ev) {
      if (ev.newState === 'open') { position(); markActive(); }
    });
    popout.addEventListener('click', function(ev) {
      var b = ev.target.closest && ev.target.closest('[data-width-set]');
      if (!b) return;
      setWidth(b.dataset.widthSet);
      if (popout.hidePopover) popout.hidePopover();
    });
  })();
  (function() {
    var about = document.getElementById('footer-about');
    var body = document.getElementById('footer-about-body');
    if (!about || !body) return;
    var loaded = false;
    about.addEventListener('toggle', function() {
      if (!about.open || loaded) return;
      loaded = true;
      body.className = 'footer-about-body';
      fetch('/diagnose').then(function(r){ return r.json(); }).then(function(d){
        function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        body.innerHTML =
          '<dl>' +
          '<dt>version</dt><dd>' + esc(d.version) + '</dd>' +
          '<dt>data dir</dt><dd>' + esc(d.dataDir) + '</dd>' +
          '<dt>config</dt><dd>' + esc(d.configPath) + '</dd>' +
          '<dt>contexts</dt><dd>' + d.contextCount + ' (' + d.archivedCount + ' archived)</dd>' +
          '<dt>items</dt><dd>' + d.itemCount + ' (' + (d.totalBytes/1024).toFixed(1) + ' kB)</dd>' +
          '<dt>scan</dt><dd>' + d.lastScanMs + ' ms</dd>' +
          '</dl>';
      }).catch(function(err){
        body.textContent = 'diagnose failed: ' + err.message;
      });
    });
  })();
  (function() {
    // Per-item Copy button — fetches the raw content from /raw and writes to
    // clipboard. Markdown strips YAML frontmatter unless Alt is held.
    document.addEventListener('click', function(ev) {
      var btn = ev.target.closest && ev.target.closest('[data-copy-raw]');
      if (!btn) return;
      ev.preventDefault();
      var url = btn.getAttribute('data-copy-raw');
      var ext = btn.getAttribute('data-ext');
      var withFrontmatter = ev.altKey;
      fetch(url).then(function(r){ return r.text(); }).then(function(raw) {
        var out = raw;
        if (ext === 'md' && !withFrontmatter) {
          var m = raw.match(/^---\\n[\\s\\S]*?\\n---\\n?/);
          if (m) out = raw.slice(m[0].length);
        }
        return (navigator.clipboard && navigator.clipboard.writeText)
          ? navigator.clipboard.writeText(out)
          : Promise.reject(new Error('clipboard unavailable'));
      }).then(function() {
        var original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function(){ btn.textContent = original; }, 1200);
      }).catch(function(err){
        btn.textContent = 'Copy failed';
        setTimeout(function(){ btn.textContent = 'Copy'; }, 1500);
      });
    });
  })();
  </script>
  <script>
  (function() {
    var MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    var loader = null;
    function load() {
      if (!loader) {
        loader = import(MERMAID_URL).then(function(m) {
          m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
          return m.default;
        });
      }
      return loader;
    }
    function renderAll() {
      if (!document.querySelector('.mermaid:not([data-processed])')) return;
      load().then(function(mermaid) { mermaid.run({ querySelector: '.mermaid:not([data-processed])' }); });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderAll);
    } else {
      renderAll();
    }
    document.body.addEventListener('htmx:afterSettle', function(e) {
      var target = e.target;
      if (target && target.querySelector && target.querySelector('.mermaid:not([data-processed])')) {
        renderAll();
      }
    });
  })();
  </script>
</body>
</html>`;
}

function renderContextCardBody(summary: ContextSummary): string {
  const meta = summary.metadata;
  const title = displayContextTitle(summary);
  const slug = summary.name;
  const showSlug = title !== slug;
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

  return `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="flex:1; min-width:0;">
        <h3><a href="/ctx/${esc(slug)}">${esc(title)}</a></h3>
        ${showSlug ? `<div class="meta">${esc(slug)}</div>` : ""}
        ${description}
        ${statusRow}
        ${links}
      </div>
      <button class="btn btn-danger btn-sm"
        hx-delete="/ctx/${esc(slug)}"
        hx-target="#ctx-${esc(slug)}"
        hx-swap="outerHTML"
        hx-confirm="Delete context '${esc(slug)}' and all its items?">Delete</button>
    </div>`;
}

export interface ContextListControls {
  sort: "name" | "recent_activity" | "created" | "updated";
  showArchived: boolean;
  archivedCount: number;
  // Free-form, drawn from the library. Empty when no contexts have a status.
  distinctStatuses: string[];
  // Undefined means "all" — no status filter applied.
  statusFilter?: string;
}

export function contextListPage(
  contexts: ContextSummary[],
  controls: ContextListControls
): string {
  return layout(
    "All Contexts",
    `
    <h2>Contexts</h2>
    ${contextListRegionFragment(contexts, controls)}
    <div class="card" style="margin-top:2rem;">
      <h3>New Context</h3>
      <form hx-post="/ctx" hx-target="#context-list" hx-swap="beforeend" hx-on::after-request="if(event.detail.successful) this.reset()">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" pattern="[a-zA-Z0-9_-]+" required placeholder="my-project">
        <button type="submit" class="btn btn-primary">Create</button>
      </form>
    </div>`
  );
}

// The sort tabs + archived chip + card list, wrapped in a single swap
// target. When a tab is clicked, htmx swaps this whole region so the
// active-tab class and the archived toggle's href update together with
// the reordered list — no full-page reload.
export function contextListRegionFragment(
  contexts: ContextSummary[],
  controls: ContextListControls
): string {
  const emptyMessage = controls.statusFilter
    ? `No contexts with status "${esc(controls.statusFilter)}".`
    : `No contexts yet. Create one below.`;
  const list = contexts.length
    ? contexts
        .map(
          (c) => `
      <div class="card" id="ctx-${esc(c.name)}">${renderContextCardBody(c)}</div>`
        )
        .join("")
    : `<div class="empty">${emptyMessage}</div>`;

  const sortOptions: Array<{ v: ContextListControls["sort"]; label: string }> = [
    { v: "name", label: "name" },
    { v: "recent_activity", label: "recent" },
    { v: "updated", label: "updated" },
    { v: "created", label: "created" },
  ];
  // Every URL in the region preserves the other two dimensions (sort,
  // status, showArchived) so the user can toggle one without losing the
  // others. showArchived is redundant when a specific status is selected
  // (the status filter already constrains visibility), but we carry it
  // through anyway for stickiness — clicking back to "all" restores the
  // user's archived preference.
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

  // Status filter row — only rendered when at least one context has a
  // status set. "All" clears the filter; each distinct status narrows the
  // list. Archived appears alongside other statuses when present.
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

  // The archived toggle is a view-level "include hidden" chip for the
  // default (unfiltered) listing. When a specific status is selected,
  // the status filter already determines what's visible, so the chip is
  // redundant — hide it to avoid mixed signals.
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

export function contextCardFragment(summary: ContextSummary): string {
  return `
    <div class="card" id="ctx-${esc(summary.name)}">${renderContextCardBody(summary)}</div>`;
}

export function contextMetaHeader(name: string, meta: ContextMetadata): string {
  const title = meta.title && meta.title.trim().length > 0 ? meta.title : name;
  const showSlug = title !== name;
  const description = meta.description
    ? `<div class="ctx-desc">${esc(meta.description)}</div>`
    : "";
  const status = statusBadge(meta.status);
  const ctxTags = meta.tags.length ? contextTagChips(meta.tags) : "";
  const statusRow =
    status || ctxTags
      ? `<div class="ctx-status-row">${status}${ctxTags}</div>`
      : "";
  const links = linksRow(meta.links);

  return `
    <div class="ctx-meta-header">
      <h2>${esc(title)}</h2>
      ${showSlug ? `<div class="ctx-slug">${esc(name)}</div>` : ""}
      ${statusRow}
      ${description}
      ${links}
      <div class="ctx-meta-actions">
        <a href="/ctx/${esc(name)}/meta/edit" class="btn btn-sm">Edit Metadata</a>
        <a href="/ctx/${esc(name)}.zip" class="btn btn-sm" download>Download .zip</a>
      </div>
    </div>`;
}

function itemRelDate(d: string): string {
  return d ? new Date(d).toLocaleDateString() : "never";
}

function itemCardInner(context: string, item: ItemInfo): string {
  return `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3><span class="item-kind">${item.extension.toUpperCase()}</span><a href="/ctx/${esc(context)}/${esc(item.name)}?ext=${esc(item.extension)}">${esc(item.title)}</a></h3>
          <div class="meta">${esc(item.name)}.${esc(item.extension)} &middot; updated ${esc(itemRelDate(item.updated))}</div>
          ${item.tags.length ? `<div>${tags(item.tags)}</div>` : ""}
        </div>
        <button class="btn btn-danger btn-sm"
          hx-delete="/ctx/${esc(context)}/${esc(item.name)}?ext=${esc(item.extension)}"
          hx-target="#item-${esc(item.name)}-${esc(item.extension)}"
          hx-swap="outerHTML"
          hx-confirm="Delete '${esc(item.name)}.${esc(item.extension)}'?">Delete</button>
      </div>`;
}

export function itemCardFragment(context: string, item: ItemInfo): string {
  return `
    <div class="card" id="item-${esc(item.name)}-${esc(item.extension)}">${itemCardInner(context, item)}</div>`;
}

export function itemListPage(
  context: string,
  meta: ContextMetadata,
  items: ItemInfo[]
): string {
  const list = items.length
    ? items
        .map(
          (i) => `
      <div class="card" id="item-${esc(i.name)}-${esc(i.extension)}">${itemCardInner(context, i)}</div>`
        )
        .join("")
    : `<div class="empty">No items yet. Create one below.</div>`;

  return layout(
    meta.title || context,
    `
    <div class="breadcrumb"><a href="/">Contexts</a> / <strong>${esc(context)}</strong></div>
    ${contextMetaHeader(context, meta)}
    <div id="item-list" style="margin-top:1rem;">${list}</div>
    <div class="card" style="margin-top:2rem;">
      <h3>New Item</h3>
      <form hx-post="/ctx/${esc(context)}/items" hx-target="#item-list" hx-swap="beforeend" hx-on::after-request="if(event.detail.successful) this.reset()">
        <div class="grid-2">
          <div>
            <label for="item">Name</label>
            <input type="text" id="item" name="item" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" required placeholder="architecture">
          </div>
          <div>
            <label for="extension">Kind</label>
            <select id="extension" name="extension">
              <option value="md" selected>Markdown (.md)</option>
              <option value="txt">Plain text (.txt)</option>
              <option value="json">JSON (.json)</option>
              <option value="yaml">YAML (.yaml)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="sql">SQL (.sql)</option>
            </select>
          </div>
        </div>
        <label for="title">Title <span style="color:var(--text-dim); text-transform:none;">(markdown only)</span></label>
        <input type="text" id="title" name="title" placeholder="System Architecture">
        <label for="tags">Tags, comma-separated <span style="color:var(--text-dim); text-transform:none;">(markdown only)</span></label>
        <input type="text" id="tags" name="tags" placeholder="design, architecture">
        <label for="content">Content</label>
        <textarea id="content" name="content" placeholder="# Your content here..."></textarea>
        <button type="submit" class="btn btn-primary">Create Item</button>
      </form>
    </div>`
  );
}

export function itemViewPage(
  context: string,
  name: string,
  extension: string,
  title: string,
  tagList: string[],
  created: string,
  updated: string,
  contentHtml: string,
  isMarkdown: boolean,
  rawMode: boolean = false,
): string {
  const appendSupported =
    !rawMode && (isMarkdown || extension === "txt" || extension === "csv" || extension === "sql");
  const appendForm = appendSupported
    ? `<div class="card" style="margin-top:2rem;">
      <h3>Append Content</h3>
      <form hx-post="/ctx/${esc(context)}/${esc(name)}/append?ext=${esc(extension)}" hx-target="#doc-body" hx-swap="innerHTML" hx-on::after-request="if(event.detail.successful) this.reset()">
        <textarea name="content" placeholder="Additional content to append..."></textarea>
        <button type="submit" class="btn btn-primary">Append</button>
      </form>
    </div>`
    : rawMode
      ? ""
      : `<div class="empty" style="margin-top:2rem;">Append is not supported for structured data items (.json, .yaml, .yml). Use Edit to replace the full content.</div>`;

  const showAsRaw = rawMode || !isMarkdown;
  const contentClass = showAsRaw ? "doc-content doc-content-raw" : "doc-content";

  const rawUrl = `/ctx/${esc(context)}/${esc(name)}/raw?ext=${esc(extension)}`;
  const viewUrl = `/ctx/${esc(context)}/${esc(name)}?ext=${esc(extension)}`;
  const rawToggleHref = rawMode ? viewUrl : `${viewUrl}&raw=1`;
  const rawToggleLabel = rawMode ? "Rendered" : "Raw";

  return layout(
    title,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <strong>${esc(name)}.${esc(extension)}</strong>${rawMode ? ' <span style="color:var(--text-dim);">(raw)</span>' : ""}
    </div>
    <div class="item-title-sticky">
      <div>
        <h2><span class="item-kind">${extension.toUpperCase()}</span>${esc(title)}</h2>
        <div class="meta" style="color:var(--text-muted); font-size:0.85rem;">
          ${esc(name)}.${esc(extension)}
          &middot; Created ${esc(created ? new Date(created).toLocaleDateString() : "unknown")}
          &middot; Updated ${esc(updated ? new Date(updated).toLocaleDateString() : "unknown")}
        </div>
        ${tagList.length ? `<div style="margin-top:0.5rem;">${tags(tagList)}</div>` : ""}
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm" data-copy-raw="${rawUrl}" data-ext="${esc(extension)}" title="${isMarkdown ? "Copy body (Alt = include frontmatter)" : "Copy raw content"}">Copy</button>
        <a class="btn btn-sm" href="${rawUrl}&amp;download=1">Download</a>
        <a class="btn btn-sm" href="${rawToggleHref}">${rawToggleLabel}</a>
        <a href="/ctx/${esc(context)}/${esc(name)}/edit?ext=${esc(extension)}" class="btn btn-sm">Edit</a>
      </div>
    </div>
    <div class="${contentClass}" id="doc-body">${contentHtml}</div>
    ${appendForm}`
  );
}

export function itemEditPage(
  context: string,
  name: string,
  extension: string,
  title: string,
  tagList: string[],
  content: string,
  isMarkdown: boolean
): string {
  const mdFields = isMarkdown
    ? `<div class="grid-2">
        <div>
          <label for="title">Title</label>
          <input type="text" id="title" name="title" value="${esc(title)}" required>
        </div>
        <div>
          <label for="tags">Tags (comma-separated)</label>
          <input type="text" id="tags" name="tags" value="${esc(tagList.join(", "))}">
        </div>
      </div>`
    : `<div class="meta" style="margin-bottom:0.75rem;">Kind: ${extension.toUpperCase()} &middot; title and tags are markdown-only.</div>`;

  return layout(
    `Edit ${title}`,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <a href="/ctx/${esc(context)}/${esc(name)}?ext=${esc(extension)}">${esc(name)}.${esc(extension)}</a> / <strong>Edit</strong>
    </div>
    <h2>Edit: ${esc(title)}</h2>
    <form method="POST" action="/ctx/${esc(context)}/${esc(name)}/edit?ext=${esc(extension)}" style="margin-top:1rem;">
      ${mdFields}
      <label for="content">Content</label>
      <textarea id="content" name="content" style="min-height:400px;">${esc(content)}</textarea>
      <div class="actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <a href="/ctx/${esc(context)}/${esc(name)}?ext=${esc(extension)}" class="btn">Cancel</a>
      </div>
    </form>`
  );
}

const META_LINK_ROWS = 5;

export function contextMetaEditPage(name: string, meta: ContextMetadata): string {
  const linksPadded = [
    ...meta.links,
    ...Array(Math.max(0, META_LINK_ROWS - meta.links.length)).fill({ label: "", url: "" }),
  ].slice(0, META_LINK_ROWS);

  const linkRows = linksPadded
    .map(
      (l, i) => `
      <div class="link-row">
        <input type="text" name="link_label_${i}" value="${esc(l.label)}" placeholder="Label">
        <input type="text" name="link_url_${i}" value="${esc(l.url)}" placeholder="https://...">
      </div>`
    )
    .join("");

  return layout(
    `Edit metadata: ${name}`,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(name)}">${esc(name)}</a> / <strong>Edit Metadata</strong>
    </div>
    <h2>Edit Context Metadata</h2>
    <form method="POST" action="/ctx/${esc(name)}/meta" style="margin-top:1rem;">
      <label for="title">Title</label>
      <input type="text" id="title" name="title" value="${esc(meta.title || "")}" placeholder="${esc(name)}">

      <label for="description">Description</label>
      <textarea id="description" name="description" style="min-height:80px;" placeholder="Short context description">${esc(meta.description || "")}</textarea>

      <div class="grid-2">
        <div>
          <label for="status">Status</label>
          <input type="text" id="status" name="status" value="${esc(meta.status || "")}" placeholder="pending, in-progress, pr, done...">
        </div>
        <div>
          <label for="tags">Tags (comma-separated)</label>
          <input type="text" id="tags" name="tags" value="${esc(meta.tags.join(", "))}" placeholder="ui, project">
        </div>
      </div>

      <label>Links</label>
      ${linkRows}

      <div class="actions" style="margin-top:1rem;">
        <button type="submit" class="btn btn-primary">Save</button>
        <a href="/ctx/${esc(name)}" class="btn">Cancel</a>
      </div>
    </form>`
  );
}

export function searchPage(
  results: SearchResult[] | null,
  query: string,
  contextFilter: string,
  contexts: string[],
  includeArchived: boolean = false,
): string {
  const contextOptions = contexts
    .map(
      (c) =>
        `<option value="${esc(c)}" ${c === contextFilter ? "selected" : ""}>${esc(c)}</option>`
    )
    .join("");

  const resultHtml =
    results === null
      ? ""
      : results.length
        ? results
            .map(
              (r) => `
        <div class="card">
          <h3><span class="item-kind">${r.extension.toUpperCase()}</span><a href="/ctx/${esc(r.context)}/${esc(r.item)}?ext=${esc(r.extension)}">${esc(r.title)}</a></h3>
          <div class="meta">${esc(r.context)} / ${esc(r.item)}.${esc(r.extension)}</div>
          ${r.tags.length ? `<div>${tags(r.tags)}</div>` : ""}
          ${r.matches.map((m) => `<div class="search-match">${esc(m.trim())}</div>`).join("")}
        </div>`
            )
            .join("")
        : `<div class="empty">No results for "${esc(query)}".</div>`;

  return layout(
    "Search",
    `
    <h2>Search</h2>
    <form action="/search" method="GET" style="margin-top:1rem;">
      <div class="grid-2">
        <div>
          <label for="q">Query</label>
          <input type="text" id="q" name="q" value="${esc(query)}" placeholder="Search all items..." autofocus>
        </div>
        <div>
          <label for="context">Context (optional)</label>
          <select id="context" name="context">
            <option value="">All contexts</option>
            ${contextOptions}
          </select>
        </div>
      </div>
      <label style="font-size:0.75rem; display:flex; gap:0.5rem; align-items:center; margin:0.5rem 0;">
        <input type="checkbox" name="show_archived" value="1" ${includeArchived ? "checked" : ""} style="width:auto; margin:0;">
        Include archived contexts
      </label>
      <button type="submit" class="btn btn-primary">Search</button>
    </form>
    <div style="margin-top:1.5rem;">${resultHtml}</div>`
  );
}

// --- Theme Lab ---

const KNOB_VALUES: Record<string, string[]> = {
  accent: ["phosphor", "amber", "cyan", "magenta", "red", "slate"],
  palette: ["default", "warm", "cold", "deep", "slate"],
  corners: ["sharp", "soft", "rounded", "squircle"],
  chrome: ["full", "subtle", "flat"],
  motion: ["on", "off"],
  complement: ["off", "on"],
};

const PRESETS: Array<[string, string]> = [
  ["default", "Default"],
  ["boring", "Boring"],
  ["amber", "Amber Terminal"],
  ["paper", "Paper"],
  ["arcade", "Arcade"],
  ["noir", "Noir"],
];

function knobRow(dimension: string, label: string): string {
  const buttons = KNOB_VALUES[dimension]
    .map(
      (v) =>
        `<button type="button" class="sort-tab" data-knob="${esc(dimension)}" data-value="${esc(v)}">${esc(v)}</button>`
    )
    .join("");
  return `
    <fieldset class="theme-knob">
      <legend>${esc(label)}</legend>
      <div class="knob-row">${buttons}</div>
    </fieldset>`;
}

export function themeLabPage(): string {
  return layout(
    "Theme Lab",
    `
    <h2>Theme Lab</h2>
    <p class="theme-lab-intro">Mess with the styles. Your choices save locally in this browser.</p>

    <div class="theme-preview">
      <div class="card" id="theme-preview-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="flex:1; min-width:0;">
            <h3>Preview</h3>
            <div class="meta">preview-card</div>
            <div style="margin-top:0.35rem; font-size:0.85rem; color:var(--text-muted); font-style:italic;">
              This card mirrors the rest of the UI. Toggle a knob and it changes live.
            </div>
            <div style="margin-top:0.6rem;">
              <span class="status-badge">active</span>
              <span class="tag tag-ctx">preview</span>
              <span class="tag">demo</span>
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-sm">Secondary</button>
            <button type="button" class="btn btn-sm btn-primary">Primary</button>
          </div>
        </div>
      </div>
    </div>

    <h3 class="theme-section">Presets</h3>
    <div class="theme-presets">
      ${PRESETS.map(
        ([id, label]) => `<button type="button" class="btn btn-sm" data-preset="${esc(id)}">${esc(label)}</button>`
      ).join("")}
    </div>

    <h3 class="theme-section">Knobs</h3>
    <div class="theme-knobs">
      ${knobRow("accent", "Accent")}
      ${knobRow("palette", "Palette")}
      ${knobRow("corners", "Corners")}
      ${knobRow("chrome", "Chrome")}
      ${knobRow("motion", "Motion")}
      ${knobRow("complement", "Complement")}
    </div>

    <div class="theme-actions">
      <button type="button" class="btn btn-primary" id="theme-scramble">Scramble</button>
      <button type="button" class="btn" id="theme-reset">Reset to default</button>
    </div>

    <p class="theme-footnote">Preset sets every knob at once. Scramble randomizes every knob. Keep it or scramble again.</p>

    <script>
    (function() {
      var root = document.documentElement;
      var KEY = 'contexts-style';
      var DIMENSIONS = ['accent','palette','corners','chrome','motion','complement'];
      var SCRAMBLE_WORD = 'Scramble';
      var VALUES = ${JSON.stringify(KNOB_VALUES)};
      // First value in each dimension is the implicit default (matches ship look).
      var PRESETS = {
        'default': { accent:'phosphor', palette:'default', corners:'sharp',    chrome:'full',   motion:'on',  complement:'off' },
        'boring':  { accent:'slate',    palette:'slate',   corners:'soft',     chrome:'flat',   motion:'off', complement:'off' },
        'amber':   { accent:'amber',    palette:'warm',    corners:'sharp',    chrome:'full',   motion:'on',  complement:'off' },
        'paper':   { accent:'slate',    palette:'default', corners:'rounded',  chrome:'flat',   motion:'on',  complement:'off' },
        'arcade':  { accent:'magenta',  palette:'deep',    corners:'squircle', chrome:'full',   motion:'on',  complement:'on'  },
        'noir':    { accent:'cyan',     palette:'cold',    corners:'sharp',    chrome:'subtle', motion:'on',  complement:'off' }
      };

      function readCurrent() {
        var s = {};
        DIMENSIONS.forEach(function(k) {
          s[k] = root.getAttribute('data-' + k) || VALUES[k][0];
        });
        return s;
      }
      function persist(state) {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
      }
      function reflect(state) {
        DIMENSIONS.forEach(function(dim) {
          VALUES[dim].forEach(function(v) {
            var sel = '[data-knob="' + dim + '"][data-value="' + v + '"]';
            var btn = document.querySelector(sel);
            if (btn) btn.classList.toggle('active', state[dim] === v);
          });
        });
      }
      function applyState(patch, opts) {
        var state = readCurrent();
        DIMENSIONS.forEach(function(k) { if (patch[k]) state[k] = patch[k]; });
        DIMENSIONS.forEach(function(k) { root.setAttribute('data-' + k, state[k]); });
        if (!opts || opts.persist !== false) persist(state);
        reflect(state);
      }
      function resetAll() {
        DIMENSIONS.forEach(function(k) { root.removeAttribute('data-' + k); });
        try { localStorage.removeItem(KEY); } catch (e) {}
        reflect(readCurrent());
      }

      document.querySelector('.theme-knobs').addEventListener('click', function(ev) {
        var btn = ev.target.closest && ev.target.closest('[data-knob]');
        if (!btn) return;
        var p = {};
        p[btn.dataset.knob] = btn.dataset.value;
        applyState(p);
      });
      document.querySelector('.theme-presets').addEventListener('click', function(ev) {
        var btn = ev.target.closest && ev.target.closest('[data-preset]');
        if (!btn) return;
        applyState(PRESETS[btn.dataset.preset]);
      });

      var scrambleBtn = document.getElementById('theme-scramble');
      scrambleBtn.addEventListener('click', function() {
        // Pick the final combo upfront. The scramble is visual-only —
        // knob buttons flash through random values, but the real theme
        // doesn't change until we settle and applyState(chosen).
        var chosen = {};
        DIMENSIONS.forEach(function(dim) {
          var arr = VALUES[dim];
          chosen[dim] = arr[Math.floor(Math.random() * arr.length)];
        });

        // Decelerating delays: ease-out quadratic from ~30ms to ~400ms.
        // Total time ~= 1.5s. Fast at the start, noticeably slowing toward
        // the end — letters shuffle faster, then hang, then land.
        var steps = 14;
        var delays = [];
        for (var k = 0; k < steps; k++) {
          var t = k / (steps - 1);
          delays.push(25 + Math.round(t * t * 380));
        }

        var knobsByDim = {};
        DIMENSIONS.forEach(function(dim) {
          knobsByDim[dim] = Array.prototype.slice.call(
            document.querySelectorAll('[data-knob="' + dim + '"]')
          );
        });
        function clearRolling() {
          DIMENSIONS.forEach(function(dim) {
            knobsByDim[dim].forEach(function(b) { b.classList.remove('rolling'); });
          });
        }
        function flashRandom() {
          DIMENSIONS.forEach(function(dim) {
            knobsByDim[dim].forEach(function(b) { b.classList.remove('rolling'); });
            var btns = knobsByDim[dim];
            btns[Math.floor(Math.random() * btns.length)].classList.add('rolling');
          });
        }
        function shuffledWord() {
          var a = SCRAMBLE_WORD.split('');
          for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
          }
          return a.join('');
        }

        scrambleBtn.disabled = true;

        var step = 0;
        function tick() {
          if (step >= steps) {
            clearRolling();
            applyState(chosen);
            scrambleBtn.disabled = false;
            scrambleBtn.textContent = SCRAMBLE_WORD;
            return;
          }
          scrambleBtn.textContent = shuffledWord();
          flashRandom();
          setTimeout(tick, delays[step]);
          step += 1;
        }
        tick();
      });

      document.getElementById('theme-reset').addEventListener('click', resetAll);

      reflect(readCurrent());
    })();
    </script>
    `
  );
}
