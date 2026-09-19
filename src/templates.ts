import { ContextMetadata, ContextSummary, ItemInfo } from "./types.js";
import { ItemConnections } from "./graph.js";
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

// Agents tag contexts liberally, so an uncapped chip row can swallow a card.
// Show the first few; the rest collapse behind a "+N" toggle chip.
const CTX_TAG_CAP = 5;

function contextTagChips(t: string[]): string {
  const chip = (tag: string) => `<span class="tag tag-ctx">${esc(tag)}</span>`;
  if (t.length <= CTX_TAG_CAP) return t.map(chip).join(" ");
  const shown = t.slice(0, CTX_TAG_CAP).map(chip).join(" ");
  const hidden = t.slice(CTX_TAG_CAP);
  return `${shown} <span class="tag-overflow" hidden>${hidden.map(chip).join(" ")}</span><button type="button" class="tag tag-ctx tag-more" onclick="var s=this.previousElementSibling;s.hidden=!s.hidden;this.textContent=s.hidden?'+${hidden.length}':'less'">+${hidden.length}</button>`;
}

function statusBadge(status?: string): string {
  if (!status) return "";
  return `<span class="status-badge">${esc(status)}</span>`;
}

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto"]);

// Block javascript:/data: and other non-allowlisted schemes — esc() only
// HTML-escapes, it does not neutralize a dangerous URL scheme in an href.
function isSafeLinkUrl(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  if (!match) return true; // relative / scheme-less URL
  return SAFE_LINK_SCHEMES.has(match[1].toLowerCase());
}

function linksRow(links: ContextMetadata["links"]): string {
  if (!links || links.length === 0) return "";
  const items = links
    .map((l) =>
      isSafeLinkUrl(l.url)
        ? `<a class="ctx-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
        : `<span class="ctx-link ctx-link-blocked" title="Link blocked: unsupported URL scheme">${esc(l.label)}</span>`
    )
    .join(" ");
  return `<div class="ctx-links">${items}</div>`;
}

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

// Inject anchor ids into rendered <h1..h6> tags and pull out a flat table of
// contents. Operates on marked's HTML output (not the raw markdown) so the TOC
// ids are guaranteed to match the heading ids the browser actually anchors to.
export function anchorHeadings(html: string): { html: string; toc: TocEntry[] } {
  const counts = new Map<string, number>();
  const toc: TocEntry[] = [];
  const slug = (text: string): string => {
    const base =
      text
        .toLowerCase()
        .replace(/&[a-z]+;/g, "")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
  const out = html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (_m, level: string, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const existing = /\bid="([^"]*)"/.exec(attrs);
      if (existing) {
        toc.push({ level: Number(level), text, id: existing[1] });
        return `<h${level}${attrs}>${inner}</h${level}>`;
      }
      const id = slug(text);
      toc.push({ level: Number(level), text, id });
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );
  return { html: out, toc };
}

function displayContextTitle(summary: ContextSummary): string {
  const metaTitle = summary.metadata?.title;
  return metaTitle && metaTitle.trim().length > 0 ? metaTitle : summary.name;
}

export function layout(title: string, body: string, opts: { fullWidth?: boolean; kiosk?: boolean } = {}): string {
  const terminalId = Math.floor(Math.random() * 900) + 100;
  const containerClass =
    (opts.fullWidth ? "container container-full" : "container") + (opts.kiosk ? " container-kiosk" : "");
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
        ['accent', 'palette', 'corners', 'chrome', 'motion', 'complement', 'width', 'fontsize'].forEach(function(k) {
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
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <!-- Warm the TLS connection to the editor CDN so the lazy first-edit module
       fetch starts fast. A hint only — no editor code is downloaded until edit. -->
  <link rel="preconnect" href="https://esm.sh" crossorigin>
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
  <div class="${containerClass}">
    <header>
      <div class="sys-bars" id="sys-bars"><span aria-hidden="true">SYS.ACTIVE </span><span id="sys-bars-strip" aria-hidden="true">░░░░░░░░░░░░░░░░░░░░</span><a href="/theme" id="theme-lab-link" title="Theme lab" aria-label="Open theme lab"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M7.5 1.5 C3.8 1.5 1 3.9 1 7 C1 9.7 3 11.3 4.8 11.3 C5.5 11.3 5.9 10.9 6.2 10.4 C6.6 9.7 7.2 9.4 7.8 9.4 C8.6 9.4 9 9.8 9.2 10.4 C9.4 11 9.8 11.5 10.5 11.5 C12.8 11.5 15 9.5 15 6.7 C15 3.8 12 1.5 7.5 1.5 Z" fill="currentColor"/><circle cx="4.5" cy="5.5" r="1" fill="var(--bg)"/><circle cx="7.5" cy="3.8" r="1" fill="var(--bg)"/><circle cx="10.5" cy="5" r="1" fill="var(--bg)"/><circle cx="12" cy="7.5" r="1" fill="var(--bg)"/></svg></a><button type="button" id="width-toggle" popovertarget="width-popout" title="Width">W</button><div id="width-popout" popover><button type="button" data-width-set="narrow">narrow</button><button type="button" data-width-set="medium">medium</button><button type="button" data-width-set="wide">wide</button></div><button type="button" id="theme-toggle" aria-label="Toggle theme">◐</button></div>
      <h1><a href="/">Contexts</a></h1>
      <nav>
        <a href="/">All Contexts</a>
        <a href="/search">Search</a>
        <a href="/graph">Graph</a>
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
    // Surface server error bodies into a shared #flash region. htmx 2.x drops
    // 4xx/5xx responses by default (swap:false), so without this a rejected
    // action (e.g. reverting an item whose backup is already gone) gives the
    // user no visible feedback at all.
    function flashRegion() {
      var el = document.getElementById('flash');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'flash';
      el.setAttribute('aria-live', 'polite');
      var header = document.querySelector('.container > header');
      if (header && header.parentNode) header.parentNode.insertBefore(el, header.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
      return el;
    }
    document.body.addEventListener('htmx:beforeSwap', function(evt) {
      var d = evt.detail;
      // Forms that render their own inline error opt out via data-flash="off".
      if (d.elt && d.elt.getAttribute && d.elt.getAttribute('data-flash') === 'off') return;
      if (d.isError && d.xhr && d.xhr.responseText) {
        d.shouldSwap = true;
        d.isError = false;
        d.target = flashRegion();
        d.swapOverride = 'innerHTML';
      } else if (!d.isError) {
        var prev = document.getElementById('flash');
        if (prev && d.target !== prev) prev.innerHTML = '';
      }
    });
  })();
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
    var STYLE_KEYS = ['accent', 'palette', 'corners', 'chrome', 'motion', 'complement', 'width', 'fontsize'];
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
        // The button is now an icon; swap its SVG for a checkmark (don't clobber
        // it with a text node), then restore.
        var orig = btn.innerHTML;
        btn.classList.add('is-copied');
        btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.4 12 L13 4.5"/></svg>';
        setTimeout(function(){ btn.innerHTML = orig; btn.classList.remove('is-copied'); }, 1200);
      }).catch(function(err){
        var t = btn.getAttribute('title');
        btn.classList.add('is-error');
        btn.setAttribute('title', 'Copy failed');
        setTimeout(function(){ btn.classList.remove('is-error'); if (t) btn.setAttribute('title', t); }, 1500);
      });
    });
  })();
  (function() {
    // "Reveal in folder" on embedded attachments — POSTs the loopback-only
    // reveal endpoint, which opens the OS file manager with the file selected.
    document.addEventListener('click', function(ev) {
      var btn = ev.target.closest && ev.target.closest('[data-reveal]');
      if (!btn) return;
      ev.preventDefault();
      var url = btn.getAttribute('data-reveal');
      var orig = btn.textContent;
      fetch(url, { method: 'POST' }).then(function(r){ return r.json(); }).then(function(j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'reveal failed');
        btn.textContent = 'opened';
        setTimeout(function(){ btn.textContent = orig; }, 1200);
      }).catch(function() {
        btn.textContent = 'reveal failed';
        setTimeout(function(){ btn.textContent = orig; }, 1600);
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
      <div id="new-ctx-error"></div>
      <form hx-post="/ctx" hx-swap="none" data-flash="off" hx-on::after-request="var slot=document.getElementById('new-ctx-error');if(event.detail.successful){this.reset();slot.innerHTML='';htmx.ajax('GET',location.pathname+location.search,{target:'#context-list-region',swap:'outerHTML'});}else{slot.innerHTML=event.detail.xhr.responseText;}">
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

  // "recent" leads because it is the default sort (see parseSort in web.ts).
  const sortOptions: Array<{ v: ContextListControls["sort"]; label: string }> = [
    { v: "recent_activity", label: "recent" },
    { v: "name", label: "name" },
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

function contextMetaHeader(name: string, meta: ContextMetadata): string {
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
          <h3><span class="item-kind${item.view === "board" ? " item-kind-board" : ""}">${item.view === "board" ? "BOARD" : item.extension.toUpperCase()}</span><a href="/ctx/${esc(context)}/${esc(item.name)}?ext=${esc(item.extension)}">${esc(item.title)}</a></h3>
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
  items: ItemInfo[],
  degrees: Record<string, number> = {}
): string {
  const connBadge = (name: string): string => {
    const d = degrees[name] || 0;
    return d > 0
      ? `<a class="conn-badge" href="/ctx/${esc(context)}/${esc(name)}" title="${d} connection${d === 1 ? "" : "s"} in the graph">${d} linked</a>`
      : "";
  };
  const list = items.length
    ? items
        .map(
          (i) => `
      <div class="card" id="item-${esc(i.name)}-${esc(i.extension)}">${itemCardInner(context, i)}${connBadge(i.name)}</div>`
        )
        .join("")
    : `<div class="empty">No items yet. Create one below.</div>`;

  return layout(
    meta.title || context,
    `
    <div class="breadcrumb"><a href="/">Contexts</a> / <strong>${esc(context)}</strong></div>
    ${contextMetaHeader(context, meta)}
    <div style="margin-top:0.75rem;"><a class="btn btn-sm" href="/graph?ctx=${esc(context)}">View in graph</a></div>
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
              <option value="yml">YAML (.yml)</option>
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

// Inline action icons (16px square; stroke + fill come from CSS via currentColor).
// Kept minimal to suit the terminal aesthetic; sit as a row in the sticky topbar.
const ICONS: Record<string, string> = {
  copy: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.4"/><path d="M3.2 10.8 H2.9 A1.4 1.4 0 0 1 1.5 9.4 V2.9 A1.4 1.4 0 0 1 2.9 1.5 H9.4 A1.4 1.4 0 0 1 10.8 2.9 V3.2"/></svg>`,
  board: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.5" width="6.2" height="4.8" rx="0.8"/><rect x="8.8" y="9" width="5.4" height="4.3" rx="0.8"/><path d="M7.6 5.6 L10.6 9"/><circle cx="12.1" cy="4.3" r="1.4"/></svg>`,
  download: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 V9.6"/><path d="M4.8 6.6 L8 9.9 L11.2 6.6"/><path d="M2.6 13 H13.4"/></svg>`,
  code: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.6 4.4 L2 8 L5.6 11.6"/><path d="M10.4 4.4 L14 8 L10.4 11.6"/></svg>`,
  doc: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.3 H9 L12 5.3 V13.7 H4 Z"/><path d="M9 2.3 V5.3 H12"/><path d="M5.9 8.4 H10.1 M5.9 10.6 H10.1"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.4 2.7 L13.3 5.6 L6 12.9 L3.1 13.5 L3.7 10.6 Z"/><path d="M9.2 3.9 L12.1 6.8"/></svg>`,
  revert: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 6.5 H9 A4 4 0 1 1 5 10.9"/><path d="M2.8 6.5 L5.1 4.3 M2.8 6.5 L5.1 8.7"/></svg>`,
};
function icon(name: string): string {
  return ICONS[name] || "";
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
  hasBackup: boolean = false,
  toc: TocEntry[] = [],
  connections: ItemConnections | null = null,
  isBoard: boolean = false,
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

  // Left-rail table of contents, deduced from the rendered markdown headings.
  // Only shown for rendered markdown with more than one heading.
  const tocHtml =
    isMarkdown && !rawMode && toc.length > 1
      ? `<nav class="doc-toc" aria-label="Table of contents">
        <div class="doc-toc-title">On this page</div>
        <ul>${toc
          .map((t) => `<li class="toc-l${t.level}"><a href="#${esc(t.id)}">${t.text}</a></li>`)
          .join("")}</ul>
      </nav>`
      : "";

  // Connections panel — right window gutter, mirror of the TOC rail. Backlinks,
  // outbound links, and semantically-related items (from the context graph).
  const connGroup = (
    label: string,
    refs: { context: string; item: string; title: string }[]
  ): string =>
    refs.length
      ? `<div class="conn-group"><h4>${label}</h4><ul>${refs
          .map(
            (r) =>
              `<li><a href="/ctx/${esc(r.context)}/${esc(r.item)}" title="${esc(r.title)}">${esc(r.title)}</a><span class="conn-ctx">${esc(r.context)}</span></li>`
          )
          .join("")}</ul></div>`
      : "";
  const hasConns =
    !rawMode &&
    !!connections &&
    (connections.backlinks.length > 0 ||
      connections.outbound.length > 0 ||
      connections.related.length > 0);
  const connectionsHtml = hasConns
    ? `<nav class="doc-connections" aria-label="Connections">
        <div class="doc-conn-title">Connections</div>
        ${connGroup("Linked from", connections!.backlinks)}
        ${connGroup("Links to", connections!.outbound)}
        ${connGroup("Related", connections!.related)}
      </nav>`
    : "";
  // Inline fallback shown (via CSS) only when the right-gutter panel is hidden
  // (narrow windows / wide content mode) so connections are never lost.
  const connectionsInlineHtml = hasConns
    ? `<div class="doc-connections-inline">
        <h3>Connections</h3>
        ${connGroup("Linked from", connections!.backlinks)}
        ${connGroup("Links to", connections!.outbound)}
        ${connGroup("Related", connections!.related)}
      </div>`
    : "";

  return layout(
    title,
    `
    <div class="doc-topbar">
      <div class="breadcrumb">
        <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <strong>${esc(name)}.${esc(extension)}</strong>${rawMode ? ' <span style="color:var(--text-dim);">(raw)</span>' : ""}
      </div>
      <div class="doc-actions">
        ${isBoard ? `<a class="icon-btn" href="${viewUrl}" title="Board view" aria-label="Board view">${icon("board")}</a>` : ""}
        <button type="button" class="icon-btn" data-copy-raw="${rawUrl}" data-ext="${esc(extension)}" title="${isMarkdown ? "Copy body (Alt = include frontmatter)" : "Copy raw content"}" aria-label="Copy">${icon("copy")}</button>
        <a class="icon-btn" href="${rawUrl}&amp;download=1" title="Download" aria-label="Download">${icon("download")}</a>
        <a class="icon-btn${rawMode ? " is-active" : ""}" href="${rawToggleHref}" title="${rawToggleLabel}" aria-label="${rawToggleLabel}">${icon(rawMode ? "doc" : "code")}</a>
        <a class="icon-btn" href="/ctx/${esc(context)}/${esc(name)}/edit?ext=${esc(extension)}" title="Edit" aria-label="Edit">${icon("edit")}</a>
        ${hasBackup ? `<button type="button" class="icon-btn icon-btn-danger" hx-post="/ctx/${esc(context)}/${esc(name)}/revert?ext=${esc(extension)}" hx-confirm="Revert '${esc(name)}.${esc(extension)}' to previous version? This is one-shot." title="Restore the previous version. One-shot — cannot be undone." aria-label="Revert">${icon("revert")}</button>` : ""}
      </div>
    </div>
    <div class="doc-header">
      <h2><span class="item-kind">${extension.toUpperCase()}</span>${esc(title)}</h2>
      <div class="meta">
        ${esc(name)}.${esc(extension)}
        &middot; Created ${esc(created ? new Date(created).toLocaleDateString() : "unknown")}
        &middot; Updated ${esc(updated ? new Date(updated).toLocaleDateString() : "unknown")}
      </div>
      ${tagList.length ? `<div class="doc-header-tags">${tags(tagList)}</div>` : ""}
    </div>
    <div class="doc-layout${tocHtml ? " has-toc" : ""}">
      ${tocHtml}
      <div class="${contentClass}" id="doc-body">${contentHtml}</div>
    </div>
    ${connectionsHtml}
    ${connectionsInlineHtml}
    ${appendForm}`
  );
}

// Self-contained vanilla-canvas force-directed graph. No deps. Reads /graph.json,
// simulates repulsion + edge springs + gravity in an unbounded WORLD space, then
// views it through a pan/zoom camera (wheel zooms toward the cursor, drag empty
// space to pan, drag a node to move it, click to open). Nodes are sized by degree;
// solid edges are explicit links, dashed edges semantically related. Hovering a
// node focuses it (its neighbourhood stays lit, the rest dims). Labels are placed
// greedily with collision avoidance — highest-degree first — so they never overlap
// and progressively reveal as you zoom in and nodes spread apart. Colours come from
// the live CRT theme variables.
const GRAPH_SCRIPT = `
(function(){
  var canvas = document.getElementById('graph-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('graph-wrap');
  var empty = document.getElementById('graph-empty');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 800, H = 480;
  function resize(){
    var top = wrap.getBoundingClientRect().top;
    W = wrap.clientWidth || 800;
    H = Math.max(440, Math.round(window.innerHeight - top - 20));
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  var cs = getComputedStyle(document.documentElement);
  function v(name, fb){ var x = cs.getPropertyValue(name).trim(); return x || fb; }
  // Same live-theme rule as the board view: re-resolve tokens on root
  // attribute changes so a dark/light toggle never leaves stale canvas ink.
  var ACCENT, MUTED, DIM, BRIGHT, TEXT, BG;
  function refreshColors(){
    ACCENT = v('--accent','#4ade80'); MUTED = v('--text-muted','#7d8491');
    DIM = v('--text-dim','#5a6070'); BRIGHT = v('--text-bright','#e6e8ec');
    TEXT = v('--text','#c9d1d9'); BG = v('--bg','#0c0e12');
  }
  refreshColors();
  if (window.MutationObserver)
    new MutationObserver(refreshColors).observe(document.documentElement, { attributes: true });
  var nodes = [], edges = [], byId = {}, colorOf = {},
      hover = null, drag = null, moved = false, filter = '',
      panning = false, panSX = 0, panSY = 0, panCX = 0, panCY = 0;
  // Settle gate: the sim relaxes, then freezes; labels stay hidden (labelAlpha 0)
  // until it is calm, then fade in — so text never jitters while nodes are moving.
  var settled = false, calm = 0, labelAlpha = 0, tick = 0;
  // Camera: cam.x/cam.y is the WORLD point shown at the centre of the canvas.
  var cam = { x: 0, y: 0, scale: 1 };
  // Tuning: EASE = focus glide rate (lower = gentler/slower); HOVER_DELAY = ms the
  // pointer must rest on a node before it focuses (kills strobing on fast sweeps).
  var EASE = 0.16, HOVER_DELAY = 110;
  function clamp(x, lo, hi){ return x < lo ? lo : (x > hi ? hi : x); }
  function baseR(n){ return 4 + Math.min(11, n.degree * 1.6); }
  function rScreen(n){ return clamp(baseR(n) * cam.scale, 2.5, 30); }
  function sx(wx){ return (wx - cam.x) * cam.scale + W/2; }
  function sy(wy){ return (wy - cam.y) * cam.scale + H/2; }
  function toWorldX(px){ return (px - W/2) / cam.scale + cam.x; }
  function toWorldY(py){ return (py - H/2) / cam.scale + cam.y; }

  resize();
  fetch('/graph.json' + (window.location.search || '')).then(function(r){ return r.json(); }).then(function(g){
    if (!g.nodes || !g.nodes.length){ if(empty) empty.style.display='block'; return; }
    var ns = g.nodes.slice().sort(function(a,b){ return b.degree-a.degree; }).slice(0, 240);
    var ok = {}; ns.forEach(function(n){ ok[n.id]=true; });
    nodes = ns.map(function(n,i){
      // Phyllotaxis seed — spreads the initial layout so the sim relaxes cleanly
      // instead of exploding out of a single overlapping pile at the origin.
      var a = i * 2.399963, rad = Math.sqrt(i) * 34;
      return { id:n.id, label:(n.title||n.item), context:n.context, item:n.item, degree:n.degree,
        x: Math.cos(a)*rad, y: Math.sin(a)*rad, vx:0, vy:0, fixed:false, adj:{},
        foc:1, lab:0, hot:0 }; // eased: foc=highlight, lab=label opacity, hot=focal node
    });
    nodes.forEach(function(n){ byId[n.id]=n; });
    var ctxs = [];
    nodes.forEach(function(n){ if (ctxs.indexOf(n.context) < 0) ctxs.push(n.context); });
    ctxs.sort();
    ctxs.forEach(function(c,k){ colorOf[c] = 'hsl(' + Math.round(k*360/Math.max(1,ctxs.length)) + ',58%,62%)'; });
    var leg = document.getElementById('graph-ctx-legend');
    if (leg){ leg.innerHTML = ctxs.map(function(c){ return '<span class="cl-ctx"><i style="background:'+colorOf[c]+'"></i>'+c.replace(/[<>&"]/g,'')+'</span>'; }).join(''); }
    edges = (g.edges||[]).filter(function(e){ return ok[e.source] && ok[e.target]; })
      .map(function(e){ var s=byId[e.source], t=byId[e.target]; s.adj[t.id]=1; t.adj[s.id]=1; return { s:s, t:t, kind:e.kind }; });
    // Relax fully OFF-SCREEN — until calm, capped — so the very first painted
    // frame is already settled. Nodes never visibly drift; the labels just fade
    // in. (Adaptive: stops early once quiet, runs longer for a stubborn layout.)
    var wv = 1; for (var w=0; w<1400 && (w < 80 || wv > 0.4); w++) wv = step();
    settled = true;
    fitView(70);
    requestAnimationFrame(loop);
  }).catch(function(){ if(empty){ empty.textContent='Could not load the graph.'; empty.style.display='block'; } });

  // One simulation tick. Returns the largest per-node speed so the loop can tell
  // when the layout has gone calm.
  function step(){
    // Per-context centroids — a mild cohesion pull (below) groups same-context
    // items into one clump; cross-context pairs repel harder (in the loop below)
    // so distinct contexts stop sitting on top of one another.
    var cen = {};
    for (var ci=0;ci<nodes.length;ci++){ var cn=nodes[ci];
      var ce=cen[cn.context]||(cen[cn.context]={x:0,y:0,n:0}); ce.x+=cn.x; ce.y+=cn.y; ce.n++; }
    for (var ck in cen){ cen[ck].x/=cen[ck].n; cen[ck].y/=cen[ck].n; }
    for (var i=0;i<nodes.length;i++){
      var a = nodes[i];
      for (var j=i+1;j<nodes.length;j++){
        var b = nodes[j];
        var dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy||0.01, d=Math.sqrt(d2);
        var f=(a.context===b.context?2300:5400)/d2, fx=dx/d*f, fy=dy/d*f;
        a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
      }
    }
    for (var e=0;e<edges.length;e++){
      var ed=edges[e], ex=ed.t.x-ed.s.x, ey=ed.t.y-ed.s.y, el=Math.sqrt(ex*ex+ey*ey)||0.01;
      var rest = ed.kind==='link'?80:165, k = ed.kind==='link'?0.022:0.008;
      var ef=(el-rest)*k, efx=ex/el*ef, efy=ey/el*ef;
      ed.s.vx+=efx; ed.s.vy+=efy; ed.t.vx-=efx; ed.t.vy-=efy;
    }
    var maxv=0;
    for (var n=0;n<nodes.length;n++){
      var p=nodes[n];
      if (p.fixed){ p.vx=0; p.vy=0; continue; }
      var cc=cen[p.context];
      p.vx += (cc.x-p.x)*0.010; p.vy += (cc.y-p.y)*0.010;   // context cohesion
      p.vx += (0-p.x)*0.0014; p.vy += (0-p.y)*0.0014;       // gentle global gravity (unbounded world)
      p.vx*=0.86; p.vy*=0.86;
      p.vx=clamp(p.vx,-40,40); p.vy=clamp(p.vy,-40,40);
      p.x+=p.vx; p.y+=p.vy;
      var spd=Math.abs(p.vx)+Math.abs(p.vy); if (spd>maxv) maxv=spd;
    }
    return maxv;
  }

  // Frame the whole graph in the viewport with a little padding.
  function fitView(pad){
    if (!nodes.length) return;
    var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
    for (var i=0;i<nodes.length;i++){ var n=nodes[i];
      if(n.x<minx)minx=n.x; if(n.x>maxx)maxx=n.x; if(n.y<miny)miny=n.y; if(n.y>maxy)maxy=n.y; }
    var gw=Math.max(1,maxx-minx), gh=Math.max(1,maxy-miny);
    pad = (pad==null)?70:pad;
    cam.scale = clamp(Math.min((W-pad*2)/gw,(H-pad*2)/gh), 0.2, 2.2);
    cam.x = (minx+maxx)/2; cam.y = (miny+maxy)/2;
  }

  function matches(n){ return !filter || String(n.label).toLowerCase().indexOf(filter)>=0 || String(n.context).toLowerCase().indexOf(filter)>=0; }
  function onScreen(n){ var x=sx(n.x), y=sy(n.y); return x>-40 && x<W+40 && y>-40 && y<H+40; }

  // Target highlight for a node: 1 = lit, 0 = dimmed. Drives the eased n.foc.
  function focTarget(n){
    if (hover) return (n===hover || hover.adj[n.id]) ? 1 : 0;
    if (filter) return matches(n) ? 1 : 0;
    return 1;
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // Glide every node toward its targets so hover/filter focus fades in and out
    // instead of snapping — calm even while sweeping the mouse. foc = highlight
    // (self + neighbours), hot = the single focal node (its bright/ring/lift).
    for (var fi=0; fi<nodes.length; fi++){ var fn=nodes[fi];
      fn.foc += (focTarget(fn) - fn.foc) * EASE;
      fn.hot += ((fn===hover?1:0) - fn.hot) * EASE; }
    // Edges — lit only when both endpoints are lit; focal edges ease up brighter.
    for (var e=0;e<edges.length;e++){
      var ed=edges[e];
      var emph = Math.max(ed.s.hot, ed.t.hot);          // eased focal emphasis 0..1
      var lit = Math.min(ed.s.foc, ed.t.foc);
      var baseA = ed.kind==='link'?0.5:0.4;
      var hi = baseA + ((ed.kind==='link'?0.85:0.7) - baseA) * emph;
      ctx.beginPath(); ctx.moveTo(sx(ed.s.x),sy(ed.s.y)); ctx.lineTo(sx(ed.t.x),sy(ed.t.y));
      ctx.strokeStyle = ed.kind==='link'?MUTED:DIM;
      ctx.globalAlpha = 0.05 + (hi - 0.05) * lit;
      ctx.lineWidth = 1 + 0.6 * emph;
      ctx.setLineDash(ed.kind==='link'?[]:[3,3]);
      ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.setLineDash([]);
    // Nodes (cull off-screen)
    for (var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if (!onScreen(n)) continue;
      var vis = 0.16 + 0.84 * n.foc, col = colorOf[n.context] || ACCENT;
      var r = rScreen(n) * (1 + 0.20 * n.hot);          // gentle eased lift on focus
      var px = sx(n.x), py = sy(n.y);
      ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2);
      ctx.globalAlpha = vis; ctx.fillStyle = col; ctx.fill();
      if (n.hot > 0.01){
        // Fade the focal node toward bright + ring it, rather than snapping white.
        ctx.globalAlpha = vis * n.hot; ctx.fillStyle = BRIGHT; ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.stroke();
      }
    }
    ctx.globalAlpha=1;
    drawLabels();
  }

  // priority: 3 = hovered, 2 = neighbour-of-hover or filter match, 1 = idle
  // (collision-avoidance decides), 0 = suppressed while focusing/filtering.
  function priority(n){
    if (n===hover) return 3;
    if (hover) return hover.adj[n.id] ? 2 : 0;
    if (filter) return matches(n) ? 2 : 0;
    return 1;
  }

  // While idle (no hover/filter), cap how many labels show and raise that cap as
  // you zoom in. Candidates are sorted by degree, so a wide view labels only the
  // hubs; labels progressively reveal as you zoom and nodes spread apart. (A flat
  // degree cutoff is useless here — almost every node is mid-degree — so a count
  // budget, paired with collision avoidance, is what actually thins the view.)
  function idleBudget(){
    var s=cam.scale;
    if (s < 0.55) return 10;
    if (s < 0.85) return 20;
    if (s < 1.25) return 38;
    if (s < 1.8) return 66;
    return 9999; // zoomed in close — collision avoidance alone governs
  }

  function drawLabels(){
    ctx.font='12px "IBM Plex Mono", monospace'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.lineJoin='round'; ctx.miterLimit=2; ctx.lineWidth=3.5; ctx.strokeStyle=BG;
    var idle = !hover && !filter, budget = idle ? idleBudget() : 9999, shown = 0;
    // Phase 1 — pick this frame's label set (priority + budget + collision), and
    // flag each chosen node with _lt=1.
    var cand = [];
    for (var i=0;i<nodes.length;i++){ var nn=nodes[i]; nn._lt = 0; if (onScreen(nn)) cand.push(nn); }
    cand.sort(function(a,b){ var pa=priority(a), pb=priority(b); return pa!==pb ? pb-pa : b.degree-a.degree; });
    var placed = [];
    for (var c=0;c<cand.length;c++){
      var n=cand[c], pri=priority(n), force=(n===hover);
      if (!force && pri < 1) continue;
      var text = String(n.label); if (text.length>30) text = text.slice(0,29)+'\\u2026';
      var w = ctx.measureText(text).width;
      var x = sx(n.x) + rScreen(n) + 5, y = sy(n.y);
      var rect = { x:x, y:y-7, w:w, h:14 };
      if (!force){
        var hit=false;
        for (var p=0;p<placed.length;p++){ var q=placed[p];
          if (rect.x<q.x+q.w && rect.x+rect.w>q.x && rect.y<q.y+q.h && rect.y+rect.h>q.y){ hit=true; break; } }
        if (hit) continue;
      }
      placed.push(rect); n._lt = 1;
      if (idle && ++shown >= budget) break;
    }
    // Phase 2 — ease each label's opacity toward its target and draw. A label that
    // dropped out of the set fades away rather than blinking off. Gated by
    // labelAlpha (the settle fade), so nothing shows until the layout is calm.
    for (var d=0; d<nodes.length; d++){
      var m=nodes[d];
      m.lab += (m._lt - m.lab) * 0.22;
      var a = labelAlpha * m.lab;
      if (a < 0.03 || !onScreen(m)) continue;
      var t = String(m.label); if (t.length>30) t = t.slice(0,29)+'\\u2026';
      var lx = sx(m.x) + rScreen(m) + 5, ly = sy(m.y);
      ctx.globalAlpha = a;
      ctx.strokeText(t, lx, ly); // dark outline knocks the text out of the busy edges
      ctx.fillStyle = (priority(m)>=2 || m===hover) ? BRIGHT : TEXT;
      ctx.fillText(t, lx, ly);
    }
    ctx.globalAlpha = 1;
  }

  // Step while relaxing or dragging; once calm, freeze the layout (no drift) and
  // fade the labels in. Camera moves (pan/zoom) just redraw — they never reheat.
  function loop(){
    if (!settled || drag){
      var v = step();
      // Calm for a few frames -> settled. Fallback: force it after ~4s so labels
      // always arrive even if the layout keeps drifting imperceptibly.
      if (!settled){ if (v < 0.5) calm++; else calm = 0; if (calm > 6 || ++tick > 240) settled = true; }
    }
    labelAlpha += ((settled?1:0) - labelAlpha) * 0.18;
    draw();
    requestAnimationFrame(loop);
  }

  function at(mx,my){
    for (var i=nodes.length-1;i>=0;i--){ var n=nodes[i];
      var dx=mx-sx(n.x), dy=my-sy(n.y), rr=rScreen(n)+4;
      if (dx*dx+dy*dy<=rr*rr) return n; }
    return null;
  }
  function pos(ev){ var rc=canvas.getBoundingClientRect(); return { x:ev.clientX-rc.left, y:ev.clientY-rc.top }; }

  // Hover intent: only commit a focus after the pointer rests on the same node
  // for HOVER_DELAY ms, so sweeping the mouse across nodes never strobes. The
  // cursor still reacts instantly — only the (expensive) focus is debounced.
  var pendingHover = null, hoverTimer = 0;
  function aimHover(t){
    if (t === pendingHover) return;
    pendingHover = t;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function(){ hover = pendingHover; hoverTimer = 0; }, HOVER_DELAY);
  }
  canvas.addEventListener('mousemove', function(ev){
    var p=pos(ev);
    if (drag){ drag.x=toWorldX(p.x); drag.y=toWorldY(p.y); drag.fixed=true; moved=true; }
    else if (panning){ cam.x = panCX - (p.x-panSX)/cam.scale; cam.y = panCY - (p.y-panSY)/cam.scale; }
    else { var t=at(p.x,p.y); canvas.style.cursor=t?'pointer':'grab'; aimHover(t); }
  });
  canvas.addEventListener('mouseleave', function(){ aimHover(null); });
  canvas.addEventListener('mousedown', function(ev){
    var p=pos(ev), n=at(p.x,p.y);
    if (n){ drag=n; moved=false; }
    else { panning=true; panSX=p.x; panSY=p.y; panCX=cam.x; panCY=cam.y; canvas.style.cursor='grabbing'; }
  });
  window.addEventListener('mouseup', function(ev){
    if (drag){
      var p=pos(ev), n=at(p.x,p.y);
      if (!moved && n===drag){ window.location.href='/ctx/'+encodeURIComponent(drag.context)+'/'+encodeURIComponent(drag.item); }
      drag.fixed=false; drag=null;
    }
    panning=false; canvas.style.cursor='grab';
  });
  canvas.addEventListener('wheel', function(ev){
    ev.preventDefault();
    var p=pos(ev), wx=toWorldX(p.x), wy=toWorldY(p.y);
    cam.scale = clamp(cam.scale * Math.pow(1.0016, -ev.deltaY), 0.15, 6);
    cam.x = wx - (p.x-W/2)/cam.scale; cam.y = wy - (p.y-H/2)/cam.scale;
  }, { passive:false });
  canvas.addEventListener('dblclick', function(ev){ var p=pos(ev); if(!at(p.x,p.y)) fitView(70); });

  function zoomBy(f){ cam.scale = clamp(cam.scale*f, 0.15, 6); }
  var zi=document.getElementById('graph-zoom-in'), zo=document.getElementById('graph-zoom-out'), zf=document.getElementById('graph-fit');
  if (zi) zi.addEventListener('click', function(){ zoomBy(1.3); });
  if (zo) zo.addEventListener('click', function(){ zoomBy(1/1.3); });
  if (zf) zf.addEventListener('click', function(){ fitView(70); });

  var fin = document.getElementById('graph-filter');
  if (fin) fin.addEventListener('input', function(){ filter = fin.value.trim().toLowerCase(); });
  window.addEventListener('resize', resize);
})();
`;

export function graphPage(
  includeArchived = false,
  scopeCtx = "",
  rebuiltNote = "",
  lastBuild: { mode: string; pass: string; similarity: string; ms: number; nodes: number; edges: number; reindexed: number; rescored: number } | null = null
): string {
  const buildLine = lastBuild
    ? `Last build: ${esc(lastBuild.mode)} (${esc(lastBuild.pass)}, ${esc(lastBuild.similarity)}), ${(lastBuild.ms / 1000).toFixed(1)}s, ${lastBuild.nodes} nodes, ${lastBuild.edges} edges, ${lastBuild.reindexed} re-indexed, ${lastBuild.rescored} re-scored.`
    : "No build in this process yet (graph served from the disk cache).";
  const qstr = (arch: boolean): string => {
    const parts: string[] = [];
    if (scopeCtx) parts.push(`ctx=${encodeURIComponent(scopeCtx)}`);
    if (arch) parts.push("archived=1");
    return parts.length ? `?${parts.join("&")}` : "";
  };
  return layout(
    "Graph",
    `
    <div class="breadcrumb"><a href="/">Contexts</a> / <strong>Graph</strong>${scopeCtx ? ` / <span style="color:var(--text-dim);">${esc(scopeCtx)}</span>` : ""}</div>
    <h2>Context Graph${scopeCtx ? ` &mdash; ${esc(scopeCtx)}` : ""}</h2>
    <p class="graph-intro">${scopeCtx ? `Items in <strong>${esc(scopeCtx)}</strong> and their direct connections. ` : "Every item is a node. "}Solid edges are explicit links; dashed edges are semantically related items. <span class="graph-hint">Scroll to zoom, drag empty space to pan, drag a node to move it, click to open. Hover a node to focus its neighbourhood.</span>${scopeCtx ? ` <a href="/graph${includeArchived ? "?archived=1" : ""}">View full graph</a>.` : ""}</p>
    <input type="text" id="graph-filter" class="graph-filter" placeholder="Filter nodes by title or context…" autocomplete="off">
    <a class="graph-archived-toggle" href="/graph${qstr(!includeArchived)}">${includeArchived ? "Hide archived" : "Show archived"}</a>
    <form class="graph-rebuild" method="post" action="/graph/rebuild" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Rebuilding…';">
      <span class="graph-build-note">${rebuiltNote ? `Rebuilt: ${esc(rebuiltNote)}. ` : ""}${buildLine}</span>
      <button type="submit" name="mode" value="full" title="Drop every cache, re-read everything and run the exact all-pairs similarity. Slow on a large corpus; best link quality.">Full rebuild</button>
    </form>
    <div id="graph-wrap">
      <canvas id="graph-canvas"></canvas>
      <div class="graph-controls" aria-hidden="true">
        <button type="button" id="graph-zoom-in" title="Zoom in">+</button>
        <button type="button" id="graph-fit" title="Fit graph to view">&#9633;</button>
        <button type="button" id="graph-zoom-out" title="Zoom out">&minus;</button>
      </div>
      <div id="graph-empty" class="empty" style="display:none;">No items to graph yet.</div>
    </div>
    <div class="graph-legend"><span class="lg-link">&mdash; linked</span><span class="lg-rel">&middot;&middot;&middot; related</span></div>
    <div id="graph-ctx-legend" class="graph-ctx-legend"></div>
    <script>${GRAPH_SCRIPT}</script>`
  );
}

// Board-view client script (view: board markdown items). Renders the item's
// \`\`\`board fence — figures with region pins, notes, item chips, edges — onto a
// pan/zoom canvas. Layout is deterministic: per-figure callout labels are placed
// by a legend-layout pass (no physics), and only the resulting cluster
// rectangles are packed by a small force relax, seeded from a hash of the fence
// text so the same file always settles the same way. The relax runs fully
// off-screen before the first paint (same move as GRAPH_SCRIPT), then freezes —
// no dragging, no reheat; the camera is the only thing that moves. No backticks
// or \${} inside, and no literal backslash — this string is interpolated into a
// template literal.
const BOARD_SCRIPT = `
(function(){
  var canvas = document.getElementById('board-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = document.getElementById('board-wrap');
  var empty = document.getElementById('board-empty');
  var dataEl = document.getElementById('board-data');
  var CURCTX = wrap.getAttribute('data-context') || '';
  function fail(msg){ canvas.style.display='none'; if (empty){ empty.textContent = msg; empty.style.display='block'; } }
  var spec = null;
  try { spec = JSON.parse(dataEl.textContent); } catch (e) { fail('Could not parse the board fence.'); return; }
  var specNodes = (spec && Array.isArray(spec.nodes)) ? spec.nodes : [];
  if (!specNodes.length){ fail('The board declares no nodes.'); return; }

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 800, H = 480;
  function resize(){
    var top = wrap.getBoundingClientRect().top;
    W = wrap.clientWidth || 800;
    H = Math.max(440, Math.round(window.innerHeight - top - 20));
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  var cs = getComputedStyle(document.documentElement);
  function v(name, fb){ var x = cs.getPropertyValue(name).trim(); return x || fb; }
  // Ink comes from the live theme tokens, re-resolved whenever the root's
  // attributes change (dark/light toggle, theme-lab knobs) — a one-time
  // snapshot leaves the canvas painting a stale palette after a toggle. The
  // rAF loop repaints every frame, so new colors land on the next frame.
  var ACCENT, MUTED, DIM, TEXT, BG, BORDER;
  function refreshColors(){
    ACCENT = v('--accent','#4ade80'); MUTED = v('--text-muted','#7d8491');
    DIM = v('--text-dim','#5a6070'); TEXT = v('--text','#c9d1d9');
    BG = v('--bg','#0c0e12'); BORDER = v('--border','#2a2f3a');
  }
  refreshColors();
  if (window.MutationObserver)
    new MutationObserver(refreshColors).observe(document.documentElement, { attributes: true });

  // Deterministic settle: FNV-1a of the fence text seeds a mulberry32 PRNG, so
  // the same file always lays out the same way and screenshots are reproducible.
  // No positions are ever stored — the fence stays declarative and an agent can
  // regenerate the whole board without destroying anyone's arrangement.
  var seed = 2166136261 >>> 0;
  (function(){ var s = dataEl.textContent; for (var i=0;i<s.length;i++){ seed ^= s.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; } })();
  function rnd(){ seed = (seed + 0x6D2B79F5) >>> 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  var cam = { x: 0, y: 0, scale: 1 };
  function clamp(x, lo, hi){ return x < lo ? lo : (x > hi ? hi : x); }
  function toWorldX(px){ return (px - W/2) / cam.scale + cam.x; }
  function toWorldY(py){ return (py - H/2) / cam.scale + cam.y; }

  // Drawn-annotation strokes. Every bow and wobble is decided ONCE at build time
  // from the seeded PRNG and stored on the object, never rolled per frame — the
  // hand-drawn look is exactly as deterministic as the layout.
  function qc(x1, y1, x2, y2, bow){
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx*dx + dy*dy) || 1;
    return { x: (x1+x2)/2 - dy/len * bow, y: (y1+y2)/2 + dx/len * bow };
  }
  // t (0..1, default 1) draws only the first part of the stroke — a De
  // Casteljau cut of the quadratic — so presentation mode shows the pen
  // mid-stroke instead of fading finished ink in.
  function sketchSeg(x1, y1, x2, y2, bow, t){
    var c = qc(x1, y1, x2, y2, bow);
    if (t != null && t <= 0) return c;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (t == null || t >= 1){ ctx.quadraticCurveTo(c.x, c.y, x2, y2); }
    else {
      var ax = x1 + (c.x - x1) * t, ay = y1 + (c.y - y1) * t;
      var bx = c.x + (x2 - c.x) * t, by = c.y + (y2 - c.y) * t;
      ctx.quadraticCurveTo(ax, ay, ax + (bx - ax) * t, ay + (by - ay) * t);
    }
    ctx.stroke();
    return c;
  }
  function sketchRect(x, y, w, h, j, t){
    // four separate strokes with tiny alternating bows — a frame ruled by hand,
    // one side after another when a partial t is animating in
    var tt = (t == null) ? 1 : t;
    sketchSeg(x, y, x + w, y, (j[0] - 0.5) * 3.5, clamp(tt*4, 0, 1));
    sketchSeg(x + w, y, x + w, y + h, (j[1] - 0.5) * 3.5, clamp(tt*4 - 1, 0, 1));
    sketchSeg(x + w, y + h, x, y + h, (j[2] - 0.5) * 3.5, clamp(tt*4 - 2, 0, 1));
    sketchSeg(x, y + h, x, y, (j[3] - 0.5) * 3.5, clamp(tt*4 - 3, 0, 1));
  }
  function sketchCircle(x, y, r, j, t){
    // two overlapping arcs, neither quite closed — a pen circling twice
    var tt = (t == null) ? 1 : t;
    var w1 = 5.5 * clamp(tt / 0.6, 0, 1), w2 = 4.4 * clamp((tt - 0.4) / 0.6, 0, 1);
    if (w1 > 0){
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1 + (j[0]-0.5)*0.14), r * (1 + (j[1]-0.5)*0.14), j[2]*Math.PI, j[3]*6.3, j[3]*6.3 + w1);
      ctx.stroke();
    }
    if (w2 > 0){
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1 + (j[1]-0.5)*0.18), r * (1 + (j[0]-0.5)*0.12), j[3]*Math.PI, j[2]*6.3, j[2]*6.3 + w2);
      ctx.stroke();
    }
  }

  // --- Presentation mode ---
  // The order IS the file: bodies in nodes[] order, then each figure's pins in
  // declaration order, take 1-based step numbers (assigned in start()). cur >
  // stepsTotal means the whole board — the default view. An edge appears once
  // everything it touches has. No schema, no stored sequence: an agent writing
  // the fence in argument order has already written the presentation.
  var stepsTotal = 0, cur = 0, nowMs = 0, ANIM = 650;
  var camT = { x: 0, y: 0, scale: 1, on: false };
  // Hover/pin focus — the graph page's neighbourhood move: focusing a node
  // lights its edges and dims everything unrelated. Notes toggle a sticky
  // focus on click (figures and chips keep their click actions).
  var hoverB = null, pinnedB = null;
  function focusBody(){ return pinnedB || hoverB; }
  function bodyFocT(b){
    var f = focusBody();
    if (!f) return 1;
    return (b === f || f.lk[b.id] || b.lk[f.id]) ? 1 : 0.3;
  }
  // Per-frame visibility target for an edge: focused node's edges always show;
  // an edge shows during its own presentation beat; otherwise the rest-ink
  // rule applies (and recedes further while something else holds focus).
  function edgeVisT(ed){
    var f = focusBody();
    if (f && (ed.a.b === f || ed.z.b === f)) return 1;
    if (cur <= stepsTotal && ed.stepIdx === cur) return 1;
    var rest = ed.restVisible ? 1 : 0;
    return f ? rest * 0.25 : rest;
  }
  function stubSeg(p1, p2){
    var dx = p2.x - p1.x, dy = p2.y - p1.y, dd = Math.sqrt(dx*dx + dy*dy) || 1;
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x + dx/dd*14, p1.y + dy/dd*14); ctx.stroke();
  }

  // Auto-advance (?play=<ms> or the auto link); any real input hands control
  // back to the human. Completion raises the __boardPlayDone signal.
  var playTimer = 0;
  function stopPlay(){ if (playTimer){ clearInterval(playTimer); playTimer = 0; } }
  function startPlay(dwell){
    stopPlay();
    playTimer = setInterval(function(){
      if (cur <= stepsTotal) gotoStep(cur + 1);
      else {
        stopPlay();
        setTimeout(function(){
          window.__boardPlayDone = true;
          window.dispatchEvent(new Event('board-play-done'));
        }, 900);
      }
    }, dwell);
  }
  function easeOut(t){ return t * (2 - t); }
  // Reveal alpha for a step-bearing element: 0 before its step, a draw-on ramp
  // for ~ANIM ms after it reveals, then steady 1 (revT clears itself).
  function aOf(el){
    if (el.stepIdx > cur) return 0;
    if (!el.revT) return 1;
    var t = (nowMs - el.revT) / ANIM;
    if (t >= 1){ el.revT = 0; return 1; }
    return easeOut(t < 0 ? 0 : t);
  }
  // A callout is ONE gesture: words, spot-circle, and leader animate together
  // over the same ramp (sequential beats made each callout read as two events).
  // The leader still draws from the label toward the pin, so even inside the
  // single motion the eye travels in reading order.

  // World-unit knobs. FIG_MAX caps a figure's longest side; LEGEND_AT is where a
  // dense figure collapses from side labels to a numbered legend beneath it.
  var FIG_MAX = 340, LABEL_W = 170, LABEL_GAP = 18, PAD = 10, LEGEND_AT = 6, MARGIN = 46, ANNOT_REST_MAX = 300;
  var FONT_LABEL = '11px "IBM Plex Mono", monospace';
  var FONT_CAP = '12px "IBM Plex Mono", monospace';
  var FONT_NOTE = '12.5px "IBM Plex Mono", monospace';
  var FONT_CHIP = '12px "IBM Plex Mono", monospace';
  var LABEL_LH = 14, NOTE_LH = 17, CAP_LH = 15;

  var bodies = [], byId = {}, edges = [], groupsArr = [];
  specNodes.forEach(function(n, i){
    if (!n || typeof n !== 'object') return;
    var type = (n.type === 'figure' || n.type === 'item') ? n.type : 'note';
    var b = { id: String(n.id != null ? n.id : 'n' + i), type: type, n: n,
      x: 0, y: 0, vx: 0, vy: 0,
      hw: 60, hh: 20, cx: 0, cy: 0,
      img: null, fw: 0, fh: 0, capLines: [], legend: false, legendLines: null,
      pins: [], labels: [], noteLines: null, chipLabel: '', lk: {}, fA: 1,
      group: (typeof n.group === 'string' && n.group) ? n.group : null, gdx: 0, gdy: 0,
      jit: [rnd(), rnd(), rnd(), rnd()], rot: (rnd() - 0.5) * 0.05 };
    if (byId[b.id]) return; // duplicate id — first declaration wins
    byId[b.id] = b; bodies.push(b);
  });
  if (!bodies.length){ fail('The board declares no usable nodes.'); return; }

  (Array.isArray(spec.edges) ? spec.edges : []).forEach(function(e){
    if (!e || e.from == null || e.to == null) return;
    function end(ref){
      var s = String(ref), hash = s.indexOf('#');
      var b = byId[hash >= 0 ? s.slice(0, hash) : s];
      return b ? { b: b, pin: hash >= 0 ? s.slice(hash + 1) : '' } : null;
    }
    var a = end(e.from), z = end(e.to);
    if (a && z && a.b !== z.b){
      // Two edge classes with different rights. Structural (figure-to-figure
      // pin bonds) are the board's skeleton: full spring, full-time ink.
      // Annotative (note/chip commentary onto figures) are drape: weak spring
      // so four cross-study hubs cannot out-muscle a pair bond, and resting
      // ink only while local (set after settle).
      edges.push({ a: a, z: z, label: e.label ? String(e.label) : '',
        bowk: (rnd() - 0.5), j: rnd(),
        annot: !(a.b.type === 'figure' && z.b.type === 'figure'),
        restVisible: true, vA: 1 });
      a.b.lk[z.b.id] = 1; z.b.lk[a.b.id] = 1;
    }
  });

  function wrapText(text, maxw, font){
    ctx.font = font;
    var words = String(text).split(' ').filter(function(w){ return w.length; });
    var lines = [], cur = '';
    for (var i=0;i<words.length;i++){
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (cur && ctx.measureText(t).width > maxw){ lines.push(cur); cur = words[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // [[wiki-link]] resolution mirrors the server's: bare names live in the
  // board's own context, ctx/item crosses contexts, |alias renames the chip.
  function parseLink(link){
    var s = String(link || '');
    if (s.slice(0,2) === '[[' && s.slice(-2) === ']]') s = s.slice(2, -2);
    var pipe = s.indexOf('|'), alias = '';
    if (pipe >= 0){ alias = s.slice(pipe + 1); s = s.slice(0, pipe); }
    var slash = s.indexOf('/');
    return { ctx: slash >= 0 ? s.slice(0, slash) : CURCTX,
             item: slash >= 0 ? s.slice(slash + 1) : s, alias: alias };
  }

  function figX(b){ return b.x - b.cx; } // figure centre (body centres the cluster box)
  function figY(b){ return b.y - b.cy; }
  function pinWorld(b, pin){
    return { x: figX(b) - b.fw/2 + pin.nx * b.fw, y: figY(b) - b.fh/2 + pin.ny * b.fh };
  }
  function pinRectWorld(b, pin){
    var fx = figX(b) - b.fw/2, fy = figY(b) - b.fh/2;
    return { x: fx + pin.rx * b.fw, y: fy + pin.ry * b.fh, w: pin.rw * b.fw, h: pin.rh * b.fh };
  }
  // Where a leader or edge lands on a pin: a point pin is its point; a region
  // pin is the border of its rectangle toward the approaching line, so ink
  // never crosses into the highlighted region itself.
  function pinAnchor(b, pin, fromX, fromY){
    var c = pinWorld(b, pin);
    if (!pin.region) return c;
    var r = pinRectWorld(b, pin);
    var hw = Math.max(0.01, r.w/2), hh = Math.max(0.01, r.h/2);
    var dx = fromX - c.x, dy = fromY - c.y;
    var tx = dx !== 0 ? hw / Math.abs(dx) : 1e9, ty = dy !== 0 ? hh / Math.abs(dy) : 1e9;
    var t = Math.min(tx, ty, 1);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // Deterministic per-figure callout layout — the legend-layout problem, not
  // physics: each pin's label sits on the side its anchor is nearest, stacked in
  // pin order with overlaps pushed down. The resulting cluster box (figure +
  // labels + caption/legend) is the rectangle the coarse sim packs.
  function layoutFigure(b){
    b.labels = [];
    var belowH = b.capLines.length * CAP_LH + (b.capLines.length ? 8 : 0);
    if (b.legend){
      b.legendLines = [];
      for (var i=0;i<b.pins.length;i++){
        var ls = wrapText(b.pins[i].num + '. ' + b.pins[i].text, b.fw - 12, FONT_LABEL);
        // each line remembers its pin so presentation mode reveals legend
        // entries pin by pin, same as side labels
        for (var k=0;k<ls.length;k++) b.legendLines.push({ t: ls[k], first: k === 0, pin: b.pins[i] });
      }
      belowH += b.legendLines.length * LABEL_LH + (b.legendLines.length ? 10 : 0);
    } else {
      var sides = { l: [], r: [] };
      for (var p=0;p<b.pins.length;p++){ var pn = b.pins[p]; (pn.nx < 0.5 ? sides.l : sides.r).push(pn); }
      ['l','r'].forEach(function(sd){
        var list = sides[sd];
        list.sort(function(a,c){ return a.ny - c.ny; });
        var cursor = -1e9;
        for (var q=0;q<list.length;q++){
          var pin = list[q];
          var lines = wrapText(pin.text, LABEL_W, FONT_LABEL);
          var tw = 0;
          for (var w2=0; w2<lines.length; w2++) tw = Math.max(tw, ctx.measureText(lines[w2]).width);
          var h = lines.length * LABEL_LH;
          var top = Math.max(pin.ny * b.fh - b.fh/2 - h/2, cursor + 10);
          cursor = top + h;
          b.labels.push({ pin: pin, side: sd, lines: lines, h: h, tw: tw,
            dx: sd === 'l' ? (-b.fw/2 - LABEL_GAP - LABEL_W) : (b.fw/2 + LABEL_GAP),
            dy: top, bowk: (rnd() - 0.5), rot: (rnd() - 0.5) * 0.045 });
        }
      });
    }
    var l = -b.fw/2, r = b.fw/2, t = -b.fh/2, btm = b.fh/2 + belowH;
    for (var m=0;m<b.labels.length;m++){
      var lb = b.labels[m];
      l = Math.min(l, lb.dx); r = Math.max(r, lb.dx + LABEL_W);
      t = Math.min(t, lb.dy); btm = Math.max(btm, lb.dy + lb.h);
    }
    b.cx = (l + r) / 2; b.cy = (t + btm) / 2;
    b.hw = (r - l) / 2 + 6; b.hh = (btm - t) / 2 + 6;
  }

  function measureBody(b){
    if (b.type === 'figure'){
      var nw = b.img ? b.img.naturalWidth : 4, nh = b.img ? b.img.naturalHeight : 3;
      var k = FIG_MAX / Math.max(nw, nh, 1);
      b.fw = Math.max(80, Math.round(nw * k)); b.fh = Math.max(60, Math.round(nh * k));
      b.capLines = b.n.caption ? wrapText(b.n.caption, Math.max(120, b.fw - 8), FONT_CAP) : [];
      var pins = Array.isArray(b.n.pins) ? b.n.pins : [];
      b.pins = [];
      for (var i=0;i<pins.length;i++){
        var p = pins[i];
        if (!p) continue;
        // region pin: rect [x, y, w, h] (normalized) marks the precise part of
        // the image — a button, a heading — instead of a single point. Also
        // accepted as a 4-element "at". nx/ny stay the centre so label sides,
        // stacking, and edge anchoring work identically for both kinds.
        var r4 = (Array.isArray(p.rect) && p.rect.length >= 4) ? p.rect
               : (Array.isArray(p.at) && p.at.length >= 4) ? p.at : null;
        if (r4){
          var rx = clamp(+r4[0] || 0, 0, 1), ry = clamp(+r4[1] || 0, 0, 1);
          var rw = clamp(+r4[2] || 0, 0, 1 - rx), rh = clamp(+r4[3] || 0, 0, 1 - ry);
          b.pins.push({ id: p.id != null ? String(p.id) : String(b.pins.length + 1),
            region: true, rx: rx, ry: ry, rw: rw, rh: rh,
            nx: rx + rw/2, ny: ry + rh/2,
            text: String(p.text || ''), num: b.pins.length + 1,
            j: [rnd(), rnd(), rnd(), rnd()] });
          continue;
        }
        if (!Array.isArray(p.at) || p.at.length < 2) continue;
        b.pins.push({ id: p.id != null ? String(p.id) : String(b.pins.length + 1),
          region: false, rw: 0, rh: 0,
          nx: clamp(+p.at[0] || 0, 0, 1), ny: clamp(+p.at[1] || 0, 0, 1),
          text: String(p.text || ''), num: b.pins.length + 1,
          j: [rnd(), rnd(), rnd(), rnd()] });
      }
      b.legend = b.pins.length >= LEGEND_AT;
      layoutFigure(b);
    } else if (b.type === 'note'){
      var lines = wrapText(b.n.text || '', 210, FONT_NOTE);
      b.noteLines = lines;
      var wmax = 40;
      ctx.font = FONT_NOTE;
      for (var j=0;j<lines.length;j++) wmax = Math.max(wmax, ctx.measureText(lines[j]).width);
      b.hw = (wmax + PAD*2) / 2; b.hh = (lines.length * NOTE_LH + PAD*2) / 2;
    } else {
      var t2 = parseLink(b.n.link);
      b.chipLabel = b.n.label ? String(b.n.label) : (t2.alias || t2.item || '?');
      ctx.font = FONT_CHIP;
      b.hw = (ctx.measureText(b.chipLabel).width + 30) / 2; b.hh = 14;
    }
  }

  // One relaxation tick over cluster rectangles: overlap separation along the
  // axis of least penetration, mild long-range repulsion so islands spread,
  // springs on declared edges, gentle gravity. Returns max speed so the relax
  // loop can stop when calm.
  // The sim, parameterized so it can run TWICE: once inside each group
  // (members arranging themselves), once across the board (ungrouped bodies +
  // group super-boxes). Same mechanism as figure+labels, recursed one level.
  // units carry x/y/vx/vy/hw/hh/ulk; springs are {A, Z, annot}.
  function relaxTick(units, springs){
    for (var i=0;i<units.length;i++){
      var a = units[i];
      for (var j=i+1;j<units.length;j++){
        var b = units[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var px = a.hw + b.hw + MARGIN - Math.abs(dx);
        var py = a.hh + b.hh + MARGIN - Math.abs(dy);
        if (px > 0 && py > 0){
          if (px < py){ var f = px * 0.045 * (dx < 0 ? -1 : 1); a.vx -= f; b.vx += f; }
          else { var g = py * 0.045 * (dy < 0 ? -1 : 1); a.vy -= g; b.vy += g; }
        }
        // linked units keep only contact separation — long-range repulsion
        // between them just fights the spring that is trying to pair them up
        if (a.ulk[b.id]) continue;
        var d2 = dx*dx + dy*dy + 0.01, d = Math.sqrt(d2), rf = 12000 / d2;
        a.vx -= dx/d*rf; a.vy -= dy/d*rf; b.vx += dx/d*rf; b.vy += dy/d*rf;
      }
    }
    for (var e=0;e<springs.length;e++){
      var ed = springs[e], A = ed.A, Z = ed.Z;
      var ex = Z.x - A.x, ey = Z.y - A.y, el = Math.sqrt(ex*ex + ey*ey) || 0.01;
      // Rest length projected onto the approach direction: two linked clusters
      // can sit side by side at their touching distance, instead of being held
      // a full diagonal apart (which left a void that unrelated bodies then
      // filled — the "related images ages apart with strangers between" mess).
      var ux = Math.abs(ex/el), uy = Math.abs(ey/el);
      var rest = (A.hw*ux + A.hh*uy) + (Z.hw*ux + Z.hh*uy) + 70;
      var sf = (el - rest) * (ed.annot ? 0.009 : 0.028), sfx = ex/el*sf, sfy = ey/el*sf;
      // Mass-weighted: light bodies do the travelling. Each endpoint moves in
      // proportion to the OTHER's share of the pair's mass, so a tiny hub note
      // chases the huge group region it annotates instead of being shoved
      // around while the region barely feels it. Equal masses = old behavior.
      var aM = A.hw * A.hh, zM = Z.hw * Z.hh, tM = aM + zM || 1;
      var wa = (zM / tM) * 2, wz = (aM / tM) * 2;
      A.vx += sfx * wa; A.vy += sfy * wa; Z.vx -= sfx * wz; Z.vy -= sfy * wz;
    }
    var maxv = 0;
    for (var n=0;n<units.length;n++){
      var p = units[n];
      p.vx += (0 - p.x) * 0.0016; p.vy += (0 - p.y) * 0.0016;
      p.vx *= 0.84; p.vy *= 0.84;
      p.vx = clamp(p.vx, -50, 50); p.vy = clamp(p.vy, -50, 50);
      p.x += p.vx; p.y += p.vy;
      var spd = Math.abs(p.vx) + Math.abs(p.vy);
      if (spd > maxv) maxv = spd;
    }
    return maxv;
  }

  // Contact projection: direct position sweeps that GUARANTEE no two unit
  // boxes overlap. Interleaved into the relax so a squeeze-out is re-pulled by
  // its springs afterwards, with one guaranteeing pass at the end.
  function project(units, cap){
    for (var sw = 0; sw < cap; sw++){
      var movedAny = false;
      for (var si = 0; si < units.length; si++){
        for (var sj = si + 1; sj < units.length; sj++){
          var A3 = units[si], B3 = units[sj];
          var ddx = B3.x - A3.x, ddy = B3.y - A3.y;
          var pxx = A3.hw + B3.hw + 24 - Math.abs(ddx);
          var pyy = A3.hh + B3.hh + 24 - Math.abs(ddy);
          if (pxx > 0 && pyy > 0){
            movedAny = true;
            if (pxx < pyy){ var mx2 = (pxx/2 + 0.5) * (ddx < 0 ? -1 : 1); A3.x -= mx2; B3.x += mx2; }
            else { var my2 = (pyy/2 + 0.5) * (ddy < 0 ? -1 : 1); A3.y -= my2; B3.y += my2; }
          }
        }
      }
      if (!movedAny) break;
    }
  }

  // Seed linked units BESIDE the centroid of their already-placed partners;
  // everything else on the phyllotaxis spiral. Pairs that start together stay
  // together — independent spiral slots let strangers wedge in between.
  function seedUnits(units, uMap){
    for (var i=0;i<units.length;i++){
      var bS = units[i], pxs = 0, pys = 0, pn = 0, pref = null;
      for (var pid in bS.ulk){ var cand = uMap[pid]; if (cand && cand.seeded){ pxs += cand.x; pys += cand.y; pn++; pref = cand; } }
      if (pn){
        var pa3 = rnd() * 6.28318;
        var pr3 = Math.max(pref.hw, pref.hh) + Math.max(bS.hw, bS.hh) + 60;
        bS.x = pxs/pn + Math.cos(pa3) * pr3;
        bS.y = pys/pn + Math.sin(pa3) * pr3;
      } else {
        var a = i * 2.399963 + rnd() * 0.6, rad = Math.sqrt(i + 0.6) * FIG_MAX * 0.85;
        bS.x = Math.cos(a) * rad + (rnd() - 0.5) * 30;
        bS.y = Math.sin(a) * rad + (rnd() - 0.5) * 30;
      }
      bS.seeded = true;
    }
  }

  function relaxRun(units, springs){
    var wv = 1;
    for (var w=0; w<1600 && (w < 120 || wv > 0.35); w++){
      wv = relaxTick(units, springs);
      if (w % 150 === 149) project(units, 60);
    }
    project(units, 400);
  }

  function fitView(pad){
    var minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
    for (var i=0;i<bodies.length;i++){ var b = bodies[i];
      minx = Math.min(minx, b.x - b.hw); maxx = Math.max(maxx, b.x + b.hw);
      miny = Math.min(miny, b.y - b.hh); maxy = Math.max(maxy, b.y + b.hh); }
    for (var gi=0; gi<groupsArr.length; gi++){ var gg = groupsArr[gi];
      minx = Math.min(minx, gg.x - gg.hw); maxx = Math.max(maxx, gg.x + gg.hw);
      miny = Math.min(miny, gg.y - gg.hh); maxy = Math.max(maxy, gg.y + gg.hh); }
    var gw = Math.max(1, maxx - minx), gh = Math.max(1, maxy - miny);
    cam.scale = clamp(Math.min((W - pad*2)/gw, (H - pad*2)/gh), 0.08, 2.5);
    cam.x = (minx + maxx)/2; cam.y = (miny + maxy)/2;
    camT.on = false;
  }

  // Presentation navigation. "Look over here" is the camera: each advance
  // eases onto the newly revealed thing's cluster; the overview is the final
  // step, arrived at rather than opened onto.
  // Per-body zoom ceiling: fill the viewport unless something real stops us.
  // A figure is bounded by its image's native pixels (zooming past them is
  // mush); a text-only note or chip by how large the type should sensibly get.
  // A flat cap here left the action postage-stamp small on big monitors.
  function maxZoom(b){
    if (b.type === 'figure' && b.img && b.fw > 0){
      return Math.max(1.4, (b.img.naturalWidth / b.fw) * 1.15);
    }
    return 2.4;
  }
  function frameBody(b, instant){
    var pad = 90;
    var s = clamp(Math.min((W - pad*2)/Math.max(1, b.hw*2), (H - pad*2)/Math.max(1, b.hh*2)), 0.08, maxZoom(b));
    if (instant){ cam.x = b.x; cam.y = b.y; cam.scale = s; camT.on = false; }
    else { camT.x = b.x; camT.y = b.y; camT.scale = s; camT.on = true; }
  }
  function frameAll(instant){
    var sx0 = cam.x, sy0 = cam.y, ss0 = cam.scale;
    fitView(60);
    if (instant) return;
    camT.x = cam.x; camT.y = cam.y; camT.scale = cam.scale; camT.on = true;
    cam.x = sx0; cam.y = sy0; cam.scale = ss0;
  }
  function stepBody(k){
    for (var i=0;i<bodies.length;i++){
      var b = bodies[i];
      if (b.stepIdx === k) return b;
      for (var p=0;p<b.pins.length;p++) if (b.pins[p].stepIdx === k) return b;
    }
    return null;
  }
  function setUrlStep(k){
    var sp = new URLSearchParams(location.search);
    if (k >= 1 && k <= stepsTotal) sp.set('step', String(k)); else sp['delete']('step');
    var qs = sp.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  // Only the step being arrived at animates; anything skipped over (deep links,
  // esc to overview) shows instantly so scrubbing never queues a light show.
  function markReveals(k){
    var t0 = nowMs || performance.now();
    bodies.forEach(function(b){
      if (b.stepIdx === k) b.revT = t0;
      b.pins.forEach(function(p){ if (p.stepIdx === k) p.revT = t0; });
    });
    edges.forEach(function(e){ if (e.stepIdx === k) e.revT = t0; });
  }
  function gotoStep(k, instant){
    k = Math.round(clamp(k, 1, stepsTotal + 1));
    if (k > cur && k <= stepsTotal) markReveals(k);
    cur = k;
    setUrlStep(k);
    if (k <= stepsTotal){ var b = stepBody(k); if (b) frameBody(b, instant); }
    else frameAll(instant);
  }

  function roundRect(x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // A group region: the faintest layer of the hierarchy (evidence framed >
  // text on panels > regions barely tinted), with a small uppercase title.
  // It fades in with its first revealed member.
  function drawRegion(g){
    var ga = 0;
    for (var i=0;i<g.members.length;i++){ var a2 = aOf(g.members[i]); if (a2 > ga) ga = a2; }
    if (ga <= 0) return;
    roundRect(g.x - g.hw, g.y - g.hh, g.hw*2, g.hh*2, 10);
    ctx.fillStyle = TEXT; ctx.globalAlpha = 0.045 * ga; ctx.fill();
    ctx.globalAlpha = 0.75 * ga;
    ctx.font = FONT_LABEL; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = DIM;
    ctx.fillText(String(g.title).toUpperCase(), g.x - g.hw + 10, g.y - g.hh + 16);
    ctx.globalAlpha = 1;
  }

  function drawCard(b){
    var a = aOf(b) * b.fA;
    if (a <= 0) return;
    if (b.type === 'figure'){
      var fx = figX(b) - b.fw/2, fy = figY(b) - b.fh/2;
      ctx.globalAlpha = a;
      if (b.img){ ctx.drawImage(b.img, fx, fy, b.fw, b.fh); }
      else { // missing/broken image: name the file rather than failing silently
        ctx.fillStyle = BG; ctx.fillRect(fx, fy, b.fw, b.fh);
        ctx.fillStyle = DIM; ctx.font = FONT_LABEL;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(b.n.src || 'missing image'), figX(b), figY(b));
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = BORDER; ctx.lineWidth = 1;
      sketchRect(fx - 1, fy - 1, b.fw + 2, b.fh + 2, b.jit, a);
      var yy = fy + b.fh + 16;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = FONT_CAP; ctx.fillStyle = MUTED; ctx.globalAlpha = a;
      for (var c=0;c<b.capLines.length;c++){ ctx.fillText(b.capLines[c], figX(b), yy); yy += CAP_LH; }
      if (b.legend && b.legendLines){
        // legend entries reveal with their pin's step, like side labels do
        yy += 6; ctx.textAlign = 'left'; ctx.font = FONT_LABEL;
        for (var g=0; g<b.legendLines.length; g++){
          var la = aOf(b.legendLines[g].pin) * b.fA;
          if (la <= 0){ yy += LABEL_LH; continue; }
          ctx.globalAlpha = la;
          ctx.fillStyle = b.legendLines[g].first ? TEXT : MUTED;
          ctx.fillText(b.legendLines[g].t, fx + 4, yy); yy += LABEL_LH;
        }
      }
      ctx.globalAlpha = 1;
    } else if (b.type === 'note'){
      // a note leans a degree or two off square, like something pinned up —
      // soft panel only, no frame: frames are for evidence (figures), text
      // rides on quiet rounded backgrounds
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      roundRect(-b.hw, -b.hh, b.hw*2, b.hh*2, 7);
      ctx.fillStyle = TEXT; ctx.globalAlpha = 0.07 * a; ctx.fill();
      ctx.globalAlpha = a;
      ctx.font = FONT_NOTE; ctx.fillStyle = TEXT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      for (var i=0;i<b.noteLines.length;i++)
        ctx.fillText(b.noteLines[i], -b.hw + PAD, -b.hh + PAD + 12 + i * NOTE_LH);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      // item chips are the interactive things, so they are the accent-tinted
      // things: a quiet pill, no border stroke
      roundRect(b.x - b.hw, b.y - b.hh, b.hw*2, b.hh*2, b.hh);
      ctx.fillStyle = ACCENT; ctx.globalAlpha = 0.13 * a; ctx.fill();
      ctx.globalAlpha = a;
      ctx.font = FONT_CHIP; ctx.fillStyle = ACCENT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.chipLabel, b.x, b.y + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  // Edge endpoint: a pin ref lands exactly on the pin; otherwise the border of
  // the DRAWN rect (the figure image, not its label cluster) toward the far end,
  // so lines never start from empty space beside a card.
  function edgeEnd(endp, twx, twy){
    var b = endp.b;
    if (endp.pin && b.type === 'figure'){
      for (var i=0;i<b.pins.length;i++) if (b.pins[i].id === endp.pin) return pinAnchor(b, b.pins[i], twx, twy);
    }
    var cx = b.x, cy = b.y, hw = b.hw, hh = b.hh;
    if (b.type === 'figure'){ cx = figX(b); cy = figY(b); hw = b.fw/2; hh = b.fh/2; }
    var dx = twx - cx, dy = twy - cy;
    var tx = dx !== 0 ? hw / Math.abs(dx) : 1e9, ty = dy !== 0 ? hh / Math.abs(dy) : 1e9;
    var t = Math.min(tx, ty, 1);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function drawEdge(ed){
    var ea = aOf(ed);
    if (ea <= 0) return;
    ed.vA += (edgeVisT(ed) - ed.vA) * 0.15;
    var zb = ed.z.b, zc = { x: zb.type === 'figure' ? figX(zb) : zb.x, y: zb.type === 'figure' ? figY(zb) : zb.y };
    var pa = edgeEnd(ed.a, zc.x, zc.y);
    var pz = edgeEnd(ed.z, pa.x, pa.y);
    if (ed.vA <= 0.05){
      // retracted: a stub at each anchor — quiet notice that ink lives here,
      // revealed by hovering either node (or the edge's presentation beat)
      ctx.strokeStyle = DIM; ctx.globalAlpha = 0.45 * ea; ctx.lineWidth = 1;
      stubSeg(pa, pz); stubSeg(pz, pa);
      ctx.globalAlpha = 1;
      return;
    }
    var vv = ed.vA * ea;
    var dl = Math.sqrt((pz.x-pa.x)*(pz.x-pa.x) + (pz.y-pa.y)*(pz.y-pa.y)) || 1;
    var bow = clamp(ed.bowk * dl * 0.35, -64, 64);
    ctx.strokeStyle = MUTED; ctx.globalAlpha = 0.55 * vv; ctx.lineWidth = 1;
    // rare figure-to-figure ties read as "special" — dash them apart from claims
    if (ed.a.b.type === 'figure' && ed.z.b.type === 'figure' && !ed.a.pin && !ed.z.pin) ctx.setLineDash([5,5]);
    var c = sketchSeg(pa.x, pa.y, pz.x, pz.y, bow, ea);
    ctx.setLineDash([]);
    if (ea > 0.85){
      // the arrowhead lands only once the pen arrives
      ctx.globalAlpha = 0.55 * vv * (ea - 0.85) / 0.15;
      var ang = Math.atan2(pz.y - c.y, pz.x - c.x);
      ctx.beginPath();
      ctx.moveTo(pz.x - 9*Math.cos(ang - 0.5 - (ed.j-0.5)*0.14), pz.y - 9*Math.sin(ang - 0.5 - (ed.j-0.5)*0.14));
      ctx.lineTo(pz.x, pz.y);
      ctx.lineTo(pz.x - 10*Math.cos(ang + 0.42 + (ed.j-0.5)*0.14), pz.y - 10*Math.sin(ang + 0.42 + (ed.j-0.5)*0.14));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (ed.label){
      // sit the label on the curve itself (quad midpoint), not the chord
      ctx.globalAlpha = vv;
      var mx = 0.25*pa.x + 0.5*c.x + 0.25*pz.x, my = 0.25*pa.y + 0.5*c.y + 0.25*pz.y;
      ctx.font = FONT_LABEL; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.lineJoin = 'round';
      ctx.strokeText(ed.label, mx, my - 8);
      ctx.fillStyle = DIM; ctx.fillText(ed.label, mx, my - 8);
      ctx.globalAlpha = 1;
    }
  }

  function numberedRing(x, y, pin, a){
    ctx.globalAlpha = 0.82 * a; ctx.fillStyle = BG;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.3;
    sketchCircle(x, y, 8.5, pin.j, a);
    if (a > 0.7){
      ctx.globalAlpha = (a - 0.7) / 0.3;
      ctx.fillStyle = ACCENT; ctx.font = 'bold 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(pin.num), x, y + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  function drawCallouts(b){
    for (var i=0;i<b.labels.length;i++){
      var lb = b.labels[i], la = aOf(lb.pin) * b.fA;
      if (la <= 0) continue;
      var lx = figX(b) + lb.dx, ly = figY(b) + lb.dy;
      var ax = lb.side === 'l' ? lx + LABEL_W + 4 : lx - 4;
      var ay = ly + lb.h/2;
      var p = pinAnchor(b, lb.pin, ax, ay);
      // annotation ink: a bowed leader drawn FROM the label TOWARD the pin, so
      // the eye travels in reading order (claim first, then the spot). The
      // negated bow keeps the resting curve byte-identical to the old
      // pin-to-label direction.
      var dlx = ax - p.x, dly = ay - p.y, dl = Math.sqrt(dlx*dlx + dly*dly) || 1;
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.7;
      sketchSeg(ax, ay, p.x, p.y, -clamp(lb.bowk * dl * 0.5, -30, 30), la);
      // inner-edge-aligned text reads toward its pin; each label leans a hair
      ctx.save();
      var tx = lb.side === 'l' ? lx + LABEL_W : lx;
      ctx.translate(tx, ly); ctx.rotate(lb.rot);
      // a soft rounded panel — no border — is each claim's boundary, so a
      // stack of callouts reads as discrete cards rather than one run of text
      roundRect(lb.side === 'l' ? -lb.tw - 9 : -7, -4, lb.tw + 16, lb.h + 9, 5);
      ctx.fillStyle = TEXT; ctx.globalAlpha = 0.08 * la; ctx.fill();
      ctx.globalAlpha = la;
      ctx.font = FONT_LABEL; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = lb.side === 'l' ? 'right' : 'left';
      for (var k=0;k<lb.lines.length;k++){
        var yy = 11 + k * LABEL_LH;
        ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.lineJoin = 'round';
        ctx.strokeText(lb.lines[k], 0, yy);
        ctx.fillStyle = TEXT; ctx.fillText(lb.lines[k], 0, yy);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    for (var q=0;q<b.pins.length;q++){
      var pin = b.pins[q], pa2 = aOf(pin) * b.fA;
      if (pa2 <= 0) continue;
      var w = pinWorld(b, pin);
      if (pin.region){
        // a light, translucent rectangle around the precise part of the image;
        // the leader (or the corner number, in legend mode) does the pointing
        var rr = pinRectWorld(b, pin);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45 * pa2;
        sketchRect(rr.x, rr.y, rr.w, rr.h, pin.j, pa2);
        ctx.globalAlpha = 1;
        if (b.legend) numberedRing(rr.x, rr.y, pin, pa2); // ride the corner
      } else if (b.legend){
        // legend mode: the number IS the pointer — it indexes into the list
        // below the figure, so it keeps its housed, numbered ring
        numberedRing(w.x, w.y, pin, pa2);
      } else {
        // side-label mode: the leader already points here — no number, and
        // translucent so the evidence keeps its visual field
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45 * pa2;
        sketchCircle(w.x, w.y, 7, pin.j, pa2);
        ctx.globalAlpha = 1;
      }
    }
  }

  function loop(){
    nowMs = performance.now();
    if (camT.on){
      // eased camera glide toward the presentation target; any manual pan or
      // zoom cancels it (camT.on cleared in those handlers)
      cam.x += (camT.x - cam.x) * 0.14;
      cam.y += (camT.y - cam.y) * 0.14;
      cam.scale += (camT.scale - cam.scale) * 0.14;
      if (Math.abs(camT.x - cam.x) < 0.5 && Math.abs(camT.y - cam.y) < 0.5 &&
          Math.abs(camT.scale - cam.scale) < 0.004) camT.on = false;
    }
    ctx.clearRect(0, 0, W, H);
    for (var fb=0; fb<bodies.length; fb++){ var bb = bodies[fb]; bb.fA += (bodyFocT(bb) - bb.fA) * 0.16; }
    ctx.save();
    ctx.translate(W/2, H/2); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x, -cam.y);
    for (var gr=0; gr<groupsArr.length; gr++) drawRegion(groupsArr[gr]);
    for (var i=0;i<bodies.length;i++) drawCard(bodies[i]);
    for (var e=0;e<edges.length;e++) drawEdge(edges[e]);
    for (var f=0;f<bodies.length;f++) if (bodies[f].type === 'figure') drawCallouts(bodies[f]);
    ctx.restore();
    if (cur <= stepsTotal){
      var hud = cur + ' / ' + stepsTotal + '  \\u2014  arrows step \\u00b7 esc overview';
      ctx.font = FONT_LABEL; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3; ctx.strokeStyle = BG; ctx.lineJoin = 'round';
      ctx.strokeText(hud, 12, H - 12);
      ctx.fillStyle = MUTED; ctx.fillText(hud, 12, H - 12);
    }
    requestAnimationFrame(loop);
  }

  function pick(mx, my){
    var wx = toWorldX(mx), wy = toWorldY(my);
    for (var i=bodies.length-1;i>=0;i--){
      var b = bodies[i];
      if (b.stepIdx > cur) continue; // not revealed yet — not clickable
      if (b.type === 'figure'){
        if (Math.abs(wx - figX(b)) <= b.fw/2 && Math.abs(wy - figY(b)) <= b.fh/2) return b;
      } else if (Math.abs(wx - b.x) <= b.hw && Math.abs(wy - b.y) <= b.hh){
        return b; // chips and notes alike — notes are hover/pin-focus targets
      }
    }
    return null;
  }
  function pos(ev){ var rc = canvas.getBoundingClientRect(); return { x: ev.clientX - rc.left, y: ev.clientY - rc.top }; }

  // The camera is the only draggable thing (v0 rule: no hand-placed nodes).
  var panning = false, panSX = 0, panSY = 0, panCX = 0, panCY = 0, movedFar = false;
  canvas.addEventListener('mousedown', function(ev){
    var p = pos(ev);
    stopPlay();
    panning = true; movedFar = false; camT.on = false;
    panSX = p.x; panSY = p.y; panCX = cam.x; panCY = cam.y;
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('mousemove', function(ev){
    var p = pos(ev);
    if (panning){
      if (Math.abs(p.x - panSX) + Math.abs(p.y - panSY) > 4) movedFar = true;
      cam.x = panCX - (p.x - panSX)/cam.scale; cam.y = panCY - (p.y - panSY)/cam.scale;
    } else {
      hoverB = pick(p.x, p.y);
      canvas.style.cursor = hoverB ? 'pointer' : 'grab';
    }
  });
  canvas.addEventListener('mouseleave', function(){ hoverB = null; });
  window.addEventListener('mouseup', function(ev){
    if (!panning) return;
    panning = false; canvas.style.cursor = 'grab';
    if (movedFar) return;
    var p = pos(ev), t = pick(p.x, p.y);
    if (!t){ pinnedB = null; return; } // empty click releases a pinned focus
    if (t.type === 'item'){
      var lk = parseLink(t.n.link);
      if (lk.item) window.location.href = '/ctx/' + encodeURIComponent(lk.ctx) + '/' + encodeURIComponent(lk.item);
    } else if (t.type === 'figure' && t.n.src){
      window.open(String(t.n.src), '_blank'); // full-resolution asset
    } else if (t.type === 'note'){
      pinnedB = (pinnedB === t) ? null : t; // sticky focus for the hub notes
    }
  });
  canvas.addEventListener('wheel', function(ev){
    ev.preventDefault();
    stopPlay();
    camT.on = false;
    var p = pos(ev), wx = toWorldX(p.x), wy = toWorldY(p.y);
    cam.scale = clamp(cam.scale * Math.pow(1.0016, -ev.deltaY), 0.06, 6);
    cam.x = wx - (p.x - W/2)/cam.scale; cam.y = wy - (p.y - H/2)/cam.scale;
  }, { passive: false });
  canvas.addEventListener('dblclick', function(ev){ var p = pos(ev); if (!pick(p.x, p.y)) fitView(60); });
  function zoomBy(f){ camT.on = false; cam.scale = clamp(cam.scale * f, 0.06, 6); }

  // Presentation controls: slides muscle memory. Right/space/pagedown advance,
  // left/pageup step back (from the overview, back into the last step), escape
  // jumps to the overview, home restarts. The URL tracks the step (?step=N) so
  // any moment is a deep link.
  window.addEventListener('keydown', function(ev){
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    stopPlay();
    var k = ev.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown'){
      if (cur <= stepsTotal){ gotoStep(cur + 1); ev.preventDefault(); }
    } else if (k === 'ArrowLeft' || k === 'PageUp'){
      if (cur > 1){ gotoStep(cur - 1); ev.preventDefault(); }
    } else if (k === 'Escape'){
      if (pinnedB){ pinnedB = null; ev.preventDefault(); }
      else if (cur <= stepsTotal){ gotoStep(stepsTotal + 1); ev.preventDefault(); }
    } else if (k === 'Home'){
      if (stepsTotal > 0){ gotoStep(1); markReveals(1); ev.preventDefault(); }
    }
  });
  var pres = document.getElementById('board-present');
  if (pres) pres.addEventListener('click', function(ev){
    ev.preventDefault();
    stopPlay();
    gotoStep(1);
    markReveals(1); // restarting should draw the first reveal, not just show it
  });
  // Auto-present straight from the toolbar: same run as ?play=1, no URL
  // knowledge required (the href is the no-JS fallback).
  var auto = document.getElementById('board-auto');
  if (auto) auto.addEventListener('click', function(ev){
    ev.preventDefault();
    gotoStep(1);
    markReveals(1);
    startPlay(2500);
  });
  var zi = document.getElementById('board-zoom-in'), zo = document.getElementById('board-zoom-out'), zf = document.getElementById('board-fit');
  if (zi) zi.addEventListener('click', function(){ zoomBy(1.3); });
  if (zo) zo.addEventListener('click', function(){ zoomBy(1/1.3); });
  if (zf) zf.addEventListener('click', function(){ fitView(60); });
  window.addEventListener('resize', resize);

  // Load every figure's image first (broken ones render as named placeholders),
  // then measure, seed, relax off-screen until calm, and only then paint.
  function start(){
    resize();
    bodies.forEach(measureBody);
    // Step numbering: declaration order is the script — each body, then each
    // of its pins, in file order. Edges take the step of their last dependency.
    var sc = 0;
    bodies.forEach(function(b){
      b.stepIdx = ++sc; b.revT = 0;
      b.pins.forEach(function(p){ p.stepIdx = ++sc; p.revT = 0; });
    });
    stepsTotal = sc;
    cur = stepsTotal + 1; // default view: the whole board, no ceremony
    edges.forEach(function(e){
      var ai = e.a.b.stepIdx, zi = e.z.b.stepIdx;
      if (e.a.pin) e.a.b.pins.forEach(function(p){ if (p.id === e.a.pin) ai = p.stepIdx; });
      if (e.z.pin) e.z.b.pins.forEach(function(p){ if (p.id === e.z.pin) zi = p.stepIdx; });
      e.stepIdx = Math.max(ai, zi); e.revT = 0;
    });
    // --- Grouping: ONE optional level ("group": "<id>" on any node) ---
    // Members settle inside their group, then each group's bounding box packs
    // as a single rigid super-body among the ungrouped bodies — the same
    // mechanism that packs a figure with its labels, recursed exactly once.
    var groupsMeta = (spec.groups && typeof spec.groups === 'object') ? spec.groups : {};
    var gOrder = [], gMap = {};
    bodies.forEach(function(b){
      if (!b.group) return;
      var g = gMap[b.group];
      if (!g){
        g = gMap[b.group] = { id: 'group:' + b.group, gid: b.group, type: 'group',
          members: [], x: 0, y: 0, vx: 0, vy: 0, hw: 40, hh: 30, ulk: {}, title: '' };
        gOrder.push(g);
      }
      g.members.push(b);
    });
    groupsArr = gOrder;
    function unitOf(b){ return b.group ? gMap[b.group] : b; }
    gOrder.forEach(function(g){
      var ms = g.members, mById = {};
      ms.forEach(function(m){ mById[m.id] = m; m.ulk = {}; m.seeded = false; });
      var springs = [];
      edges.forEach(function(e){
        var A = e.a.b, Z = e.z.b;
        if (mById[A.id] && mById[Z.id]){
          springs.push({ A: A, Z: Z, annot: e.annot });
          A.ulk[Z.id] = 1; Z.ulk[A.id] = 1;
        }
      });
      seedUnits(ms, mById);
      relaxRun(ms, springs);
      var minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
      ms.forEach(function(m){
        minx = Math.min(minx, m.x - m.hw); maxx = Math.max(maxx, m.x + m.hw);
        miny = Math.min(miny, m.y - m.hh); maxy = Math.max(maxy, m.y + m.hh);
      });
      var gcx = (minx + maxx) / 2, gcy = (miny + maxy) / 2;
      g.hw = (maxx - minx) / 2 + 26; g.hh = (maxy - miny) / 2 + 26;
      var mt = groupsMeta[g.gid];
      g.title = (typeof mt === 'string') ? mt : (mt && typeof mt.title === 'string') ? mt.title : g.gid;
      ms.forEach(function(m){ m.gdx = m.x - gcx; m.gdy = m.y - gcy; });
    });
    // outer pack: units in first-appearance order (declaration order preserved)
    var units = [], seenU = {};
    bodies.forEach(function(b){
      var u = unitOf(b);
      if (seenU[u.id]) return;
      seenU[u.id] = 1; units.push(u);
    });
    var uById = {};
    units.forEach(function(u){ u.ulk = {}; u.seeded = false; u.vx = 0; u.vy = 0; uById[u.id] = u; });
    var oSprings = [];
    edges.forEach(function(e){
      var A = unitOf(e.a.b), Z = unitOf(e.z.b);
      if (A === Z) return;
      oSprings.push({ A: A, Z: Z, annot: e.annot });
      A.ulk[Z.id] = 1; Z.ulk[A.id] = 1;
    });
    seedUnits(units, uById);
    relaxRun(units, oSprings);
    // members land at their settled offsets inside the settled group box
    gOrder.forEach(function(g){
      g.members.forEach(function(m){ m.x = g.x + m.gdx; m.y = g.y + m.gdy; });
    });
    // Rest-ink rule (settled geometry now known): an annotative edge keeps
    // full-time ink only when it landed local; a long one retracts to stubs
    // until hovered or until its presentation beat. Structural edges always draw.
    edges.forEach(function(e){
      var A = e.a.b, Z = e.z.b;
      var gap = Math.max(Math.abs(A.x - Z.x) - (A.hw + Z.hw), Math.abs(A.y - Z.y) - (A.hh + Z.hh));
      e.restVisible = !e.annot || gap <= ANNOT_REST_MAX;
      e.vA = e.restVisible ? 1 : 0;
    });
    fitView(60);
    // Settled geometry, exposed for the board-check harness (scripts/
    // board-check.js) to assert against — the numbers the real renderer uses,
    // not a parallel reimplementation. Not part of any supported page API.
    window.__boardDebug = {
      labelW: LABEL_W,
      annotRestMax: ANNOT_REST_MAX,
      stepCount: stepsTotal,
      bodies: bodies.map(function(b){
        return { id: b.id, type: b.type, x: b.x, y: b.y, hw: b.hw, hh: b.hh,
          cx: b.cx, cy: b.cy, fw: b.fw, fh: b.fh,
          natW: b.img ? b.img.naturalWidth : 0, natH: b.img ? b.img.naturalHeight : 0,
          legend: b.legend,
          pins: b.pins.map(function(p){ return { id: p.id, nx: p.nx, ny: p.ny, num: p.num, region: !!p.region, rw: p.rw, rh: p.rh }; }),
          labels: b.labels.map(function(l){ return { side: l.side, dx: l.dx, dy: l.dy, h: l.h, pin: l.pin.id }; }) };
      }),
      edges: edges.map(function(e){
        return { from: e.a.b.id, fromPin: e.a.pin, to: e.z.b.id, toPin: e.z.pin,
          annot: e.annot, restVisible: e.restVisible };
      }),
      groups: groupsArr.map(function(g){
        return { id: g.gid, title: g.title, x: g.x, y: g.y, hw: g.hw, hh: g.hh,
          members: g.members.map(function(m){ return m.id; }) };
      })
    };
    // ?step=N enters presentation at that step (camera snapped, no catch-up
    // animation for everything already on the board by then).
    var q = new URLSearchParams(location.search).get('step');
    if (q && stepsTotal > 0) gotoStep(parseInt(q, 10) || 1, true);
    // ?play=<ms>: hands-free walkthrough for recording rigs. Reaching the
    // overview sets window.__boardPlayDone and fires "board-play-done" so a
    // driving agent knows when the take is over.
    var pq = new URLSearchParams(location.search).get('play');
    if (pq && stepsTotal > 0){
      if (!q) gotoStep(1, true);
      startPlay((pq === '1' || pq === 'true') ? 2500 : Math.max(400, parseInt(pq, 10) || 2500));
    }
    requestAnimationFrame(loop);
  }
  // Layout gates: every figure image, plus the webfont. Font metrics feed
  // measureText, measureText feeds label wrapping, wrapping feeds cluster
  // sizes — measuring before the font resolves makes the settle depend on a
  // network race (board-check caught exactly this as a determinism failure).
  var gates = 1; // the font gate; each figure image arms one more
  function gateDone(){ if (--gates === 0) start(); }
  bodies.forEach(function(b){
    if (b.type !== 'figure') return;
    gates++;
    var im = new Image();
    im.onload = function(){ b.img = im; gateDone(); };
    im.onerror = function(){ gateDone(); };
    im.src = String(b.n.src || ''); // relative: resolves into this context's assets/
  });
  if (document.fonts && document.fonts.load){
    Promise.all([document.fonts.load(FONT_LABEL), document.fonts.load(FONT_NOTE)])
      .then(gateDone, gateDone);
  } else gateDone();
})();
`;

// A \`view: board\` markdown item rendered as an evidence board. The route has
// already validated that fenceRaw parses as JSON with a nodes array; it is
// embedded as an application/json script tag (with < escaped so a string value
// can never close the tag) and drawn by BOARD_SCRIPT. ?doc=1 is the escape
// hatch back to the ordinary document rendering of the same item.
export function boardViewPage(
  context: string,
  itemName: string,
  title: string,
  fenceRaw: string,
  // kiosk (?kiosk=1): board only, no chrome — the recordable presentation
  // surface (layout hides the header/footer; we skip our own breadcrumb/title)
  kiosk: boolean = false,
): string {
  const self = `/ctx/${encodeURIComponent(context)}/${encodeURIComponent(itemName)}`;
  const pageChrome = kiosk
    ? ""
    : `
      <div class="breadcrumb"><a href="/">Contexts</a> / <a href="/ctx/${encodeURIComponent(context)}">${esc(context)}</a> / <strong>${esc(itemName)}</strong></div>
      <h2>${esc(title)}</h2>
      <p class="graph-intro">Evidence board. <span class="graph-hint">Scroll to zoom, drag to pan, double-click empty space to fit. Click a chip to open its item, a figure to open the full image. Present steps through the board in file order.</span>
        <a href="${self}?step=1" id="board-present">present</a> &middot; <a href="${self}?step=1&amp;play=1" id="board-auto">auto</a> &middot; <a href="${self}?doc=1">document view</a> &middot; <a href="${self}?raw=1">raw</a> &middot; <a href="${self}/edit">edit</a></p>`;
  return layout(
    title,
    `
    <div class="board-page">${pageChrome}
      <div id="board-wrap" data-context="${esc(context)}">
        <canvas id="board-canvas"></canvas>
        <div class="graph-controls" aria-hidden="true">
          <button type="button" id="board-zoom-in" title="Zoom in">+</button>
          <button type="button" id="board-fit" title="Fit board to view">&#9633;</button>
          <button type="button" id="board-zoom-out" title="Zoom out">&minus;</button>
        </div>
        <div id="board-empty" class="empty" style="display:none;"></div>
      </div>
      <script type="application/json" id="board-data">${fenceRaw.replace(/</g, "\\u003c")}</script>
      <script>${BOARD_SCRIPT}</script>
    </div>`,
    { fullWidth: true, kiosk }
  );
}

// Edit-page-only client script. Lazily pulls TipTap from esm.sh on first entry
// to rich mode (editing is rare; nothing here loads on view pages), mounts a
// rich editor over the markdown body, and serializes back to markdown on
// save/toggle. The raw <textarea> stays the data source and the fallback if the
// CDN/parse fails. No backticks or ${} inside — this string is interpolated into
// a template literal — and no literal backslash (BS via fromCharCode) so the
// wiki-link un-escape stays readable.
const EDITOR_SCRIPT = `
(function(){
  var form = document.getElementById('rt-form');
  var ta = document.getElementById('content');
  if (!form || !ta) return;
  var wrap = document.getElementById('rt-wrap');
  var mount = document.getElementById('rt-editor');
  var loader = document.getElementById('rt-loader');
  var toolbar = document.getElementById('rt-toolbar');
  var toggle = document.getElementById('rt-toggle');
  var note = document.getElementById('rt-note');

  var V = '2';
  var deps = '?deps=@tiptap/core@2';
  var BASE = 'https://esm.sh/';
  var BS = String.fromCharCode(92);
  var M = null, editor = null, mode = 'raw';

  // tiptap-markdown escapes [ and ] (CommonMark-correct), turning our
  // [[wiki-links]] into escaped brackets. Drop any backslash that escapes a
  // square bracket on the way out so graph links survive. Raw-mode text never
  // passes through here, so hand-typed escapes are left alone.
  function unesc(md){
    var out = '';
    for (var i = 0; i < md.length; i++){
      var c = md.charAt(i), n = md.charAt(i + 1);
      if (c === BS && (n === '[' || n === ']')) continue;
      out += c;
    }
    return out;
  }
  function serialize(){ return editor ? unesc(editor.storage.markdown.getMarkdown()) : ta.value; }

  // [[wiki-links]] as a first-class atomic node (chip) rather than literal text:
  // a markdown-it rule turns [[target|alias]] into a span on load, the node
  // renders it as a styled pill (selectable/deletable as one unit), and serializes
  // straight back to [[..]] with no escaping. markdown-it leaves a lone [bracket]
  // alone, so only true wiki-links become chips.
  function wikilinkPlugin(md){
    md.inline.ruler.before('link', 'wikilink', function(state, silent){
      var src = state.src, start = state.pos;
      if (src.charCodeAt(start) !== 0x5B || src.charCodeAt(start + 1) !== 0x5B) return false;
      var end = src.indexOf(']]', start + 2);
      if (end < 0) return false;
      var inner = src.slice(start + 2, end);
      if (inner.length === 0 || inner.indexOf('[') >= 0 || inner.indexOf(']') >= 0) return false;
      if (!silent){ var t = state.push('wikilink', '', 0); t.content = inner; }
      state.pos = end + 2;
      return true;
    });
    md.renderer.rules.wikilink = function(tokens, idx){
      var inner = tokens[idx].content, pipe = inner.indexOf('|');
      var target = pipe >= 0 ? inner.slice(0, pipe) : inner;
      var alias = pipe >= 0 ? inner.slice(pipe + 1) : '';
      var label = alias || target.split('/').pop();
      var esc = md.utils.escapeHtml;
      return '<span data-wikilink data-target="' + esc(target) + '" data-alias="' + esc(alias) + '">' + esc(label) + '</span>';
    };
  }
  function makeWikiLink(Node){
    return Node.create({
      name: 'wikilink', inline: true, group: 'inline', atom: true, selectable: true,
      addAttributes: function(){
        return {
          target: { default: '', parseHTML: function(el){ return el.getAttribute('data-target') || ''; } },
          alias: { default: '', parseHTML: function(el){ return el.getAttribute('data-alias') || ''; } }
        };
      },
      parseHTML: function(){ return [{ tag: 'span[data-wikilink]' }]; },
      renderHTML: function(props){
        var a = props.node.attrs;
        var label = a.alias || String(a.target).split('/').pop();
        return ['span', { 'data-wikilink': '', 'data-target': a.target, 'data-alias': a.alias, 'class': 'wikilink-chip' }, label];
      },
      addStorage: function(){
        return { markdown: {
          serialize: function(state, node){
            var a = node.attrs, inner = a.alias ? (a.target + '|' + a.alias) : a.target;
            state.write('[[' + inner + ']]');
          },
          parse: { setup: function(md){ md.use(wikilinkPlugin); } }
        } };
      }
    });
  }

  function loadMods(){
    if (M) return Promise.resolve(M);
    return Promise.all([
      import(BASE + '@tiptap/core@' + V),
      import(BASE + '@tiptap/starter-kit@' + V + deps),
      import(BASE + '@tiptap/extension-link@' + V + deps),
      import(BASE + '@tiptap/extension-image@' + V + deps),
      import(BASE + '@tiptap/extension-table@' + V + deps),
      import(BASE + '@tiptap/extension-table-row@' + V + deps),
      import(BASE + '@tiptap/extension-table-cell@' + V + deps),
      import(BASE + '@tiptap/extension-table-header@' + V + deps),
      import(BASE + '@tiptap/extension-task-list@' + V + deps),
      import(BASE + '@tiptap/extension-task-item@' + V + deps),
      import(BASE + 'tiptap-markdown@0.8' + deps)
    ]).then(function(m){
      M = { Editor:m[0].Editor, StarterKit:m[1].default, Link:m[2].default, Image:m[3].default,
        Table:m[4].default, TableRow:m[5].default, TableCell:m[6].default, TableHeader:m[7].default,
        TaskList:m[8].default, TaskItem:m[9].default, Markdown:m[10].Markdown };
      M.WikiLink = makeWikiLink(m[0].Node);
      return M;
    });
  }

  function build(md){
    return new M.Editor({
      element: mount,
      editorProps: { attributes: { class: 'doc-content' } },
      extensions: [
        M.StarterKit, M.Link.configure({ openOnClick:false }), M.Image, M.WikiLink,
        M.Table.configure({ resizable:false }), M.TableRow, M.TableCell, M.TableHeader,
        M.TaskList, M.TaskItem.configure({ nested:true }),
        M.Markdown.configure({ html:false, transformPastedText:true, transformCopiedText:true })
      ],
      content: md
    });
  }

  function showRich(){
    loader.style.display = 'none'; toolbar.hidden = false; mount.style.display = '';
    ta.style.display = 'none'; wrap.hidden = false; toggle.textContent = 'edit raw markdown'; mode = 'rich';
  }
  function showRaw(){ wrap.hidden = true; ta.style.display = ''; toggle.textContent = 'edit rich text'; mode = 'raw'; }

  function enterRich(){
    wrap.hidden = false; toolbar.hidden = true; mount.style.display = 'none';
    loader.style.display = ''; ta.style.display = 'none';
    loadMods().then(function(){
      if (editor) editor.destroy();
      editor = build(ta.value);
      wireToolbar();
      showRich();
    }).catch(function(){
      loader.style.display = 'none'; wrap.hidden = true; ta.style.display = ''; mode = 'raw';
      toggle.textContent = 'edit rich text';
      if (note){ note.hidden = false; note.textContent = 'rich editor unavailable - editing raw markdown'; }
    });
  }
  function enterRaw(){ if (editor) ta.value = serialize(); showRaw(); }

  toggle.addEventListener('click', function(){ if (mode === 'rich') enterRaw(); else enterRich(); });
  form.addEventListener('submit', function(){ if (mode === 'rich' && editor) ta.value = serialize(); });

  function run(make){ if (editor) make(editor.chain().focus()).run(); }
  function wireToolbar(){
    if (toolbar.getAttribute('data-wired')) return;
    toolbar.setAttribute('data-wired', '1');
    var map = [
      ['rt-bold', function(c){ return c.toggleBold(); }],
      ['rt-italic', function(c){ return c.toggleItalic(); }],
      ['rt-h1', function(c){ return c.toggleHeading({ level:1 }); }],
      ['rt-h2', function(c){ return c.toggleHeading({ level:2 }); }],
      ['rt-ul', function(c){ return c.toggleBulletList(); }],
      ['rt-ol', function(c){ return c.toggleOrderedList(); }],
      ['rt-quote', function(c){ return c.toggleBlockquote(); }],
      ['rt-code', function(c){ return c.toggleCodeBlock(); }]
    ];
    map.forEach(function(pair){
      var b = document.getElementById(pair[0]);
      if (b) b.addEventListener('click', function(){ run(pair[1]); });
    });
    var lk = document.getElementById('rt-link');
    if (lk) lk.addEventListener('click', function(){
      if (!editor) return;
      var url = window.prompt('link url');
      if (url === null) return;
      if (url === '') editor.chain().focus().unsetLink().run();
      else editor.chain().focus().setLink({ href: url }).run();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enterRich);
  else enterRich();
})();
`;

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

  const richArea = isMarkdown
    ? `
      <div id="rt-note" class="meta" hidden style="margin-bottom:0.5rem;"></div>
      <div id="rt-wrap" hidden>
        <div id="rt-toolbar" class="rt-toolbar" hidden>
          <button type="button" id="rt-bold" class="rt-btn" title="Bold (Ctrl+B)"><b>B</b></button>
          <button type="button" id="rt-italic" class="rt-btn" title="Italic (Ctrl+I)"><i>I</i></button>
          <button type="button" id="rt-h1" class="rt-btn" title="Heading 1">H1</button>
          <button type="button" id="rt-h2" class="rt-btn" title="Heading 2">H2</button>
          <button type="button" id="rt-ul" class="rt-btn" title="Bullet list">&bull;</button>
          <button type="button" id="rt-ol" class="rt-btn" title="Numbered list">1.</button>
          <button type="button" id="rt-quote" class="rt-btn" title="Blockquote">&ldquo;&rdquo;</button>
          <button type="button" id="rt-code" class="rt-btn" title="Code block">&lt;/&gt;</button>
          <button type="button" id="rt-link" class="rt-btn" title="Link">link</button>
        </div>
        <div id="rt-loader" class="rt-loader">preparing editor&hellip;</div>
        <div id="rt-editor" class="rt-editor"></div>
      </div>`
    : "";

  const toggleBtn = isMarkdown
    ? `<button type="button" id="rt-toggle" class="btn">edit raw markdown</button>`
    : "";

  return layout(
    `Edit ${title}`,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <a href="/ctx/${esc(context)}/${esc(name)}?ext=${esc(extension)}">${esc(name)}.${esc(extension)}</a> / <strong>Edit</strong>
    </div>
    <h2>Edit: ${esc(title)}</h2>
    <form id="rt-form" method="POST" action="/ctx/${esc(context)}/${esc(name)}/edit?ext=${esc(extension)}" style="margin-top:1rem;">
      ${mdFields}
      <label for="content">Content</label>
      ${richArea}
      <textarea id="content" name="content" style="min-height:400px;">${esc(content)}</textarea>
      <div class="actions">
        <button type="submit" class="btn btn-primary">Save</button>
        ${toggleBtn}
        <a href="/ctx/${esc(context)}/${esc(name)}?ext=${esc(extension)}" class="btn">Cancel</a>
      </div>
    </form>${isMarkdown ? `\n    <script>${EDITOR_SCRIPT}</script>` : ""}`
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

    <h3 class="theme-section">Text size</h3>
    <div class="theme-knobs">
      <fieldset class="theme-knob">
        <legend>Scale</legend>
        <div class="knob-row">
          <button type="button" class="sort-tab" data-fontsize-set="default">default</button>
          <button type="button" class="sort-tab" data-fontsize-set="compact">compact</button>
          <button type="button" class="sort-tab" data-fontsize-set="small">small</button>
        </div>
      </fieldset>
    </div>

    <div class="theme-actions">
      <button type="button" class="btn btn-primary" id="theme-scramble">Scramble</button>
      <button type="button" class="btn" id="theme-reset">Reset to default</button>
    </div>

    <p class="theme-footnote">Preset sets every knob at once. Scramble randomizes every knob — text size and width are left alone. Keep it or scramble again.</p>

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
        try {
          // Read-modify-merge so we preserve sibling keys (e.g. the header's
          // 'width') that share the same localStorage object — overwriting the
          // whole object would silently drop the user's width preference.
          var raw = localStorage.getItem(KEY);
          var s = raw ? JSON.parse(raw) : {};
          DIMENSIONS.forEach(function(k) { s[k] = state[k]; });
          localStorage.setItem(KEY, JSON.stringify(s));
        } catch (e) {}
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
        try {
          // Remove only the theme DIMENSION keys, preserving sibling keys (e.g.
          // the header's 'width') in the shared object; drop it only if empty.
          var raw = localStorage.getItem(KEY);
          var s = raw ? JSON.parse(raw) : {};
          DIMENSIONS.forEach(function(k) { delete s[k]; });
          if (Object.keys(s).length) localStorage.setItem(KEY, JSON.stringify(s));
          else localStorage.removeItem(KEY);
        } catch (e) {}
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

      // Text size — a standalone preference like 'width': persisted in the same
      // localStorage blob under 'fontsize', applied as data-fontsize, and
      // DELIBERATELY not a theme DIMENSION, so Scramble and Reset never touch it.
      var fontsizeBtns = Array.prototype.slice.call(document.querySelectorAll('[data-fontsize-set]'));
      function currentFs() { return root.getAttribute('data-fontsize') || 'default'; }
      function reflectFs() {
        var cur = currentFs();
        fontsizeBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.fontsizeSet === cur); });
      }
      function setFontsize(v) {
        if (v === 'default') root.removeAttribute('data-fontsize');
        else root.setAttribute('data-fontsize', v);
        try {
          var raw = localStorage.getItem(KEY);
          var s = raw ? JSON.parse(raw) : {};
          if (v === 'default') delete s.fontsize; else s.fontsize = v;
          localStorage.setItem(KEY, JSON.stringify(s));
        } catch (e) {}
        reflectFs();
      }
      fontsizeBtns.forEach(function(b) {
        b.addEventListener('click', function() { setFontsize(b.dataset.fontsizeSet); });
      });
      reflectFs();

      reflect(readCurrent());
    })();
    </script>
    `
  );
}
