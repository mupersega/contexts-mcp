import { ContextMetadata, ContextSummary, ItemInfo } from "./types.js";
import { SearchResult } from "./search.js";

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
  <meta name="color-scheme" content="dark">
  <style>html,body{background:#111;color:#ccc;}</style>
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
  <style>
    :root {
      --bg: #1a1a1a; --surface: #222222; --surface-raised: #2a2a2a;
      --border: #444444; --border-heavy: #666666;
      --text: #cccccc; --text-muted: #777777; --text-bright: #e0e0e0; --text-dim: #555555;
      --tag-bg: #333333; --tag-text: #bbbbbb;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }

    body {
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      font-size: 14px; font-weight: 400; letter-spacing: 0.01em;
      background: #111111; color: var(--text); line-height: 1.7;
    }

    /* --- CRT Scanlines --- */
    body::before {
      content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px);
      pointer-events: none; z-index: 10000;
    }

    /* --- Vignette --- */
    body::after {
      content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%);
      pointer-events: none; z-index: 10001;
    }

    #noise-canvas {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 9999; opacity: 0.5; mix-blend-mode: overlay;
    }

    h1, h2, h3, .card h3 {
      font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase; font-weight: 400;
    }

    a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--text-dim); transition: all 0.1s; }
    a:hover { color: #ffffff; border-bottom-color: var(--text-muted); border-bottom-style: solid; }

    .container {
      max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem;
      background: var(--bg); min-height: 100vh;
      border-left: 1px solid var(--border); border-right: 1px solid var(--border);
      box-shadow: inset 0 0 80px rgba(0,0,0,0.3);
      animation: screen-flicker 0.5s ease-out;
    }

    /* --- Header --- */
    header {
      border-bottom: 2px double var(--border-heavy); padding-bottom: 1rem; margin-bottom: 2rem;
      display: flex; align-items: center; justify-content: space-between; position: relative;
    }
    .sys-bars {
      position: absolute; top: -1.5rem; right: 0;
      font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.1em;
      font-family: 'IBM Plex Mono', monospace; white-space: pre;
    }
    header h1 { font-size: 1.4rem; letter-spacing: 0.15em; }
    header h1 a { color: var(--text-bright); border-bottom: none; }
    header h1 a::before { content: '> '; color: var(--text-dim); font-family: 'IBM Plex Mono', monospace; }
    header h1 a::after {
      content: '█'; display: inline-block; margin-left: 0.3rem;
      color: var(--text-dim); animation: blink-cursor 1s steps(2) infinite; font-size: 0.8em;
      font-family: 'IBM Plex Mono', monospace;
    }
    header h1 a:hover { border-bottom: none; }
    nav { display: flex; gap: 1rem; }
    nav a {
      font-size: 0.8rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--text-muted); transition: all 0.1s;
      font-family: 'IBM Plex Mono', monospace;
    }
    nav a:hover {
      color: var(--text-bright); border-color: var(--text-bright);
      background: var(--surface); box-shadow: 2px 2px 0 var(--border);
    }

    /* --- Cards --- */
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-left: 3px solid var(--border-heavy);
      padding: 1.25rem 1.25rem 1.25rem 1.5rem; margin-bottom: 1rem;
      position: relative; transition: border-color 0.15s;
      animation: stamp-in 0.2s ease-out;
    }
    .card::before {
      content: '//'; position: absolute; top: 0.5rem; left: 0.4rem;
      font-size: 0.65rem; color: var(--text-dim); font-family: 'IBM Plex Mono', monospace;
    }
    .card:hover { border-left-color: var(--text-muted); }
    .card h3 { font-size: 1rem; margin-bottom: 0.25rem; }
    .card h3 a { color: var(--text-bright); border-bottom: 1px dotted var(--text-dim); }
    .card h3 a:hover { color: #ffffff; border-bottom-color: var(--text-muted); }
    .card .meta {
      color: var(--text-dim); font-size: 0.75rem; margin-bottom: 0.5rem;
      text-transform: uppercase; letter-spacing: 0.05em;
      font-family: 'IBM Plex Mono', monospace;
    }

    /* --- Tags --- */
    .tag {
      display: inline-block; background: var(--tag-bg); color: var(--tag-text);
      padding: 0.1rem 0.45rem; font-size: 0.7rem; margin-right: 0.3rem;
      text-transform: uppercase; letter-spacing: 0.08em;
      border: 1px dashed var(--text-dim); font-family: 'IBM Plex Mono', monospace;
    }
    .tag::before { content: '#'; opacity: 0.5; margin-right: 0.1rem; }
    .tag-ctx { border-style: dotted; color: var(--text); }
    .tag-ctx::before { content: '»'; opacity: 0.5; margin-right: 0.2rem; }

    /* --- Status badge --- */
    .status-badge {
      display: inline-block; background: var(--surface-raised); color: var(--text-bright);
      padding: 0.15rem 0.55rem; font-size: 0.7rem; margin-right: 0.4rem;
      text-transform: uppercase; letter-spacing: 0.12em;
      border: 2px double var(--border-heavy);
      font-family: 'IBM Plex Mono', monospace;
    }
    .status-badge::before { content: '['; margin-right: 0.15rem; color: var(--text-dim); }
    .status-badge::after { content: ']'; margin-left: 0.15rem; color: var(--text-dim); }

    /* --- Item kind label --- */
    .item-kind {
      display: inline-block; padding: 0 0.35rem; font-size: 0.65rem;
      color: var(--text-dim); border: 1px solid var(--text-dim);
      letter-spacing: 0.1em; margin-right: 0.4rem;
      font-family: 'IBM Plex Mono', monospace;
      vertical-align: baseline;
    }

    /* --- Context meta header --- */
    .ctx-meta-header {
      background: var(--surface); border: 1px solid var(--border);
      border-top: 3px double var(--border-heavy); border-bottom: 1px solid var(--border);
      padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; position: relative;
    }
    .ctx-meta-header::before {
      content: '--- CONTEXT ---'; position: absolute; top: -0.6rem; left: 1rem;
      background: var(--bg); padding: 0 0.5rem;
      font-size: 0.6rem; color: var(--text-dim); letter-spacing: 0.15em;
      font-family: 'IBM Plex Mono', monospace;
    }
    .ctx-meta-header h2 { margin-bottom: 0.25rem; }
    .ctx-meta-header .ctx-slug {
      color: var(--text-dim); font-size: 0.7rem;
      text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.75rem;
    }
    .ctx-meta-header .ctx-desc {
      color: var(--text-muted); font-size: 0.85rem; margin: 0.6rem 0;
      line-height: 1.6; font-style: italic;
    }
    .ctx-meta-header .ctx-status-row { margin: 0.5rem 0; }
    .ctx-links { margin-top: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .ctx-link {
      display: inline-block; padding: 0.2rem 0.55rem;
      border: 1px solid var(--border-heavy); background: var(--surface-raised);
      font-size: 0.7rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .ctx-link::before { content: '→ '; color: var(--text-dim); }
    .ctx-link:hover { color: var(--text-bright); border-color: var(--text-bright); border-bottom-style: solid; }
    .ctx-meta-actions { margin-top: 0.75rem; }

    /* --- Buttons --- */
    .btn {
      display: inline-block; padding: 0.45rem 0.9rem;
      border: 1px solid var(--border-heavy); background: var(--surface); color: var(--text);
      cursor: pointer; font-size: 0.8rem; font-family: 'IBM Plex Mono', monospace;
      text-transform: uppercase; letter-spacing: 0.06em; text-decoration: none;
      box-shadow: 2px 2px 0 #000000; transition: all 0.08s; border-bottom: 1px solid var(--border-heavy);
    }
    .btn:hover { background: var(--surface-raised); border-color: var(--text-muted); color: var(--text-bright); text-decoration: none; }
    .btn:active { box-shadow: 0 0 0 #000; transform: translate(2px, 2px); }
    .btn-primary { background: var(--text-bright); color: var(--bg); border-color: var(--text-bright); font-weight: 600; }
    .btn-primary:hover { background: #ffffff; color: #000000; }
    .btn-danger { color: var(--text-muted); border-color: var(--text-muted); border-style: dashed; }
    .btn-danger:hover { background: var(--text-bright); color: var(--bg); border-style: solid; }
    .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.7rem; box-shadow: 1px 1px 0 #000; }
    .btn-sm:active { box-shadow: 0 0 0 #000; transform: translate(1px, 1px); }

    /* --- Forms --- */
    form { margin-bottom: 1rem; }
    label {
      display: block; margin-bottom: 0.25rem; font-size: 0.75rem;
      color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em;
      font-family: 'IBM Plex Mono', monospace;
    }
    input, textarea, select {
      width: 100%; padding: 0.5rem 0.75rem;
      border: 1px solid var(--border); border-bottom: 2px solid var(--border-heavy);
      background: #181818; color: var(--text);
      font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem;
      margin-bottom: 0.75rem; transition: border-color 0.15s;
    }
    textarea { min-height: 200px; resize: vertical; line-height: 1.8; }
    input:focus, textarea:focus, select:focus {
      outline: none; border-color: var(--text-muted); border-bottom-color: var(--text-bright); background: #1d1d1d;
    }
    input::placeholder, textarea::placeholder { color: var(--text-dim); font-style: italic; }
    select {
      -webkit-appearance: none; -moz-appearance: none; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%23777' stroke-width='1.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 0.75rem center; padding-right: 2rem;
    }
    .link-row { display: grid; grid-template-columns: 1fr 2fr; gap: 0.5rem; margin-bottom: 0.4rem; }
    .link-row input { margin-bottom: 0; }

    .actions { display: flex; gap: 0.5rem; align-items: center; }

    /* --- Empty --- */
    .empty {
      color: var(--text-dim); text-align: center; padding: 3rem 1rem;
      font-style: italic; border: 1px dashed var(--border);
    }
    .empty::before {
      content: '[NO RECORDS FOUND]'; display: block; font-style: normal;
      font-size: 0.7rem; letter-spacing: 0.15em; text-transform: uppercase;
      margin-bottom: 0.5rem; color: var(--text-dim); font-family: 'IBM Plex Mono', monospace;
    }

    /* --- Breadcrumbs --- */
    .breadcrumb {
      font-size: 0.8rem; color: var(--text-dim); margin-bottom: 1rem;
      padding-bottom: 0.5rem; border-bottom: 1px dotted var(--border); letter-spacing: 0.03em;
    }
    .breadcrumb a { color: var(--text-muted); border-bottom: none; }
    .breadcrumb a:hover { color: var(--text-bright); border-bottom: none; }
    .breadcrumb strong { color: var(--text); }

    /* --- Document Content --- */
    .doc-content {
      background: var(--surface); border: 1px solid var(--border);
      border-top: 3px double var(--border-heavy); border-bottom: 3px double var(--border-heavy);
      padding: 2rem; line-height: 1.8; position: relative;
    }
    .doc-content::before {
      content: '--- BEGIN DOCUMENT ---'; display: block; text-align: center;
      font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.15em;
      margin-bottom: 1.5rem; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace;
    }
    .doc-content::after {
      content: '--- END DOCUMENT ---'; display: block; text-align: center;
      font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.15em;
      margin-top: 1.5rem; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace;
    }
    .doc-content h1, .doc-content h2, .doc-content h3 {
      font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin: 1.5rem 0 0.75rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border);
    }
    .doc-content h1:first-child, .doc-content h2:first-child { margin-top: 0; }
    .doc-content p { margin-bottom: 0.75rem; }
    .doc-content code {
      background: #181818; padding: 0.15rem 0.4rem; font-size: 0.85em;
      border: 1px solid var(--border); font-family: 'IBM Plex Mono', monospace;
    }
    .doc-content pre {
      background: #141414; padding: 1rem; overflow-x: auto; margin-bottom: 1rem;
      border: 1px solid var(--border); border-left: 3px solid var(--border-heavy); position: relative;
    }
    .doc-content pre::before {
      content: 'OUTPUT'; position: absolute; top: 0.25rem; right: 0.5rem;
      font-size: 0.6rem; color: var(--text-dim); letter-spacing: 0.1em;
      font-family: 'IBM Plex Mono', monospace;
    }
    .doc-content pre code { padding: 0; background: none; border: none; }
    .doc-content ul, .doc-content ol { padding-left: 1.5rem; margin-bottom: 0.75rem; }
    .doc-content blockquote {
      border-left: 3px double var(--border-heavy); padding-left: 1rem;
      color: var(--text-muted); font-style: italic; margin: 1rem 0;
    }
    .doc-content-raw {
      white-space: pre; font-family: 'IBM Plex Mono', monospace;
      font-size: 0.82rem; line-height: 1.65; padding: 2.5rem 2rem;
    }

    /* --- Search --- */
    .search-match {
      background: #181818; padding: 0.5rem 0.75rem; font-size: 0.8rem;
      font-family: 'IBM Plex Mono', monospace; margin-top: 0.5rem;
      color: var(--text-muted); border-left: 2px solid var(--text-dim); position: relative;
    }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }

    /* --- Flash --- */
    .flash { padding: 0.75rem 1rem; margin-bottom: 1rem; border: 1px solid; font-size: 0.85rem; position: relative; padding-left: 2rem; }
    .flash::before { position: absolute; left: 0.75rem; font-weight: bold; }
    .flash-success { background: #1a1f1a; border-color: var(--text-muted); color: var(--text); }
    .flash-success::before { content: '✓'; color: var(--text); }
    .flash-error { background: #1f1a1a; border-color: #888888; color: var(--text); }
    .flash-error::before { content: '!'; color: var(--text-bright); }

    /* --- Footer --- */
    .classification-footer {
      margin-top: 3rem; padding-top: 1rem; border-top: 2px double var(--border);
      text-align: center; font-size: 0.6rem; color: var(--text-dim);
      letter-spacing: 0.2em; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace;
    }
    .footer-shutdown { display: inline-block; margin: 0.5rem 0 0 0; }

    /* --- Scrollbar --- */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--border); border: 1px solid var(--bg); }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

    /* --- HTMX --- */
    .htmx-indicator { opacity: 0; transition: opacity 200ms; }
    .htmx-request .htmx-indicator { opacity: 1; }
    .htmx-request::after {
      content: 'PROCESSING...'; position: fixed; bottom: 1rem; right: 1rem;
      font-size: 0.7rem; color: var(--text-dim); letter-spacing: 0.1em;
      animation: blink-text 0.8s steps(2) infinite; z-index: 9998;
      font-family: 'IBM Plex Mono', monospace;
    }

    /* --- Animations --- */
    @keyframes blink-cursor { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
    @keyframes blink-text { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.3; } }
    @keyframes stamp-in { 0% { opacity: 0; transform: translateY(-4px); } 100% { opacity: 1; transform: translateY(0); } }
    @keyframes screen-flicker { 0% { opacity: 0.97; } 5% { opacity: 1; } 10% { opacity: 0.98; } 15% { opacity: 1; } 100% { opacity: 1; } }
  </style>
</head>
<body>
  <canvas id="noise-canvas"></canvas>
  <div class="container">
    <header>
      <div class="sys-bars" id="sys-bars" aria-hidden="true">SYS.ACTIVE ░░░░░░░░░░░░░░░░░░░░</div>
      <h1><a href="/">Contexts</a></h1>
      <nav>
        <a href="/">All Contexts</a>
        <a href="/search">Search</a>
      </nav>
    </header>
    ${body}
    <footer class="classification-footer">
      <span id="footer-text">CONTEXT MANAGEMENT SYSTEM v1.1 &mdash; TERMINAL ${terminalId} &mdash; SESSION ACTIVE</span>
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
    var el = document.getElementById('sys-bars');
    if (!el) return;
    var N = 20;
    var shades = [' ', '░', '▒', '▓', '█'];
    var anchors = [];
    for (var i = 0; i < 32; i++) anchors.push(Math.random());
    function smooth(t) { return t * t * (3 - 2 * t); }
    function sample(x) {
      var i = Math.floor(x), f = x - i;
      var a = anchors[((i) % 32 + 32) % 32];
      var b = anchors[((i + 1) % 32 + 32) % 32];
      return a + (b - a) * smooth(f);
    }
    var phase = 0, last = 0;
    function bars(t) {
      requestAnimationFrame(bars);
      if (t - last < 120) return;
      last = t;
      phase += 0.04;
      var out = '';
      for (var i = 0; i < N; i++) {
        var v = sample(i * 0.35 + phase);
        out += shades[Math.min(shades.length - 1, Math.floor(v * shades.length))];
      }
      el.textContent = 'SYS.ACTIVE ' + out;
    }
    requestAnimationFrame(bars);
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

export function contextListPage(contexts: ContextSummary[]): string {
  const list = contexts.length
    ? contexts
        .map(
          (c) => `
      <div class="card" id="ctx-${esc(c.name)}">${renderContextCardBody(c)}</div>`
        )
        .join("")
    : `<div class="empty">No contexts yet. Create one below.</div>`;

  return layout(
    "All Contexts",
    `
    <h2>Contexts</h2>
    <div id="context-list" style="margin-top:1rem;">${list}</div>
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
  isMarkdown: boolean
): string {
  const appendSupported = isMarkdown || extension === "txt" || extension === "csv";
  const appendForm = appendSupported
    ? `<div class="card" style="margin-top:2rem;">
      <h3>Append Content</h3>
      <form hx-post="/ctx/${esc(context)}/${esc(name)}/append?ext=${esc(extension)}" hx-target="#doc-body" hx-swap="innerHTML" hx-on::after-request="if(event.detail.successful) this.reset()">
        <textarea name="content" placeholder="Additional content to append..."></textarea>
        <button type="submit" class="btn btn-primary">Append</button>
      </form>
    </div>`
    : `<div class="empty" style="margin-top:2rem;">Append is not supported for structured data items (.json, .yaml, .yml). Use Edit to replace the full content.</div>`;

  const contentClass = isMarkdown ? "doc-content" : "doc-content doc-content-raw";

  return layout(
    title,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <strong>${esc(name)}.${esc(extension)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
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
  contexts: string[]
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
      <button type="submit" class="btn btn-primary">Search</button>
    </form>
    <div style="margin-top:1.5rem;">${resultHtml}</div>`
  );
}
