import { DocumentInfo } from "./types.js";
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
    header::before {
      content: 'SYS.ACTIVE ░░░░░░░░░░░░░░░░░░░░';
      position: absolute; top: -1.5rem; right: 0;
      font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.1em;
      font-family: 'IBM Plex Mono', monospace;
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
      <h1><a href="/">Contexts</a></h1>
      <nav>
        <a href="/">All Contexts</a>
        <a href="/search">Search</a>
      </nav>
    </header>
    ${body}
    <footer class="classification-footer">
      DOCUMENT MANAGEMENT SYSTEM v1.0 &mdash; TERMINAL ${terminalId} &mdash; SESSION ACTIVE
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
  </script>
</body>
</html>`;
}

export function contextListPage(contexts: string[]): string {
  const list = contexts.length
    ? contexts
        .map(
          (c) => `
      <div class="card" id="ctx-${esc(c)}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3><a href="/ctx/${esc(c)}">${esc(c)}</a></h3>
          <button class="btn btn-danger btn-sm"
            hx-delete="/ctx/${esc(c)}"
            hx-target="#ctx-${esc(c)}"
            hx-swap="outerHTML"
            hx-confirm="Delete context '${esc(c)}' and all its documents?">Delete</button>
        </div>
      </div>`
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

export function contextCardFragment(name: string): string {
  return `
    <div class="card" id="ctx-${esc(name)}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3><a href="/ctx/${esc(name)}">${esc(name)}</a></h3>
        <button class="btn btn-danger btn-sm"
          hx-delete="/ctx/${esc(name)}"
          hx-target="#ctx-${esc(name)}"
          hx-swap="outerHTML"
          hx-confirm="Delete context '${esc(name)}' and all its documents?">Delete</button>
      </div>
    </div>`;
}

export function documentListPage(context: string, docs: DocumentInfo[]): string {
  const list = docs.length
    ? docs
        .map(
          (d) => `
      <div class="card" id="doc-${esc(d.name)}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3><a href="/ctx/${esc(context)}/${esc(d.name)}">${esc(d.title)}</a></h3>
            <div class="meta">${esc(d.name)} &middot; updated ${esc(d.updated ? new Date(d.updated).toLocaleDateString() : "never")}</div>
            ${d.tags.length ? `<div>${tags(d.tags)}</div>` : ""}
          </div>
          <button class="btn btn-danger btn-sm"
            hx-delete="/ctx/${esc(context)}/${esc(d.name)}"
            hx-target="#doc-${esc(d.name)}"
            hx-swap="outerHTML"
            hx-confirm="Delete '${esc(d.name)}'?">Delete</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="empty">No documents yet. Create one below.</div>`;

  return layout(
    context,
    `
    <div class="breadcrumb"><a href="/">Contexts</a> / <strong>${esc(context)}</strong></div>
    <h2>${esc(context)}</h2>
    <div id="doc-list" style="margin-top:1rem;">${list}</div>
    <div class="card" style="margin-top:2rem;">
      <h3>New Document</h3>
      <form hx-post="/ctx/${esc(context)}/docs" hx-target="#doc-list" hx-swap="beforeend" hx-on::after-request="if(event.detail.successful) this.reset()">
        <div class="grid-2">
          <div>
            <label for="document">Name</label>
            <input type="text" id="document" name="document" pattern="[a-zA-Z0-9_-]+" required placeholder="architecture">
          </div>
          <div>
            <label for="title">Title</label>
            <input type="text" id="title" name="title" required placeholder="System Architecture">
          </div>
        </div>
        <label for="tags">Tags (comma-separated)</label>
        <input type="text" id="tags" name="tags" placeholder="design, architecture">
        <label for="content">Content</label>
        <textarea id="content" name="content" placeholder="# Your markdown here..."></textarea>
        <button type="submit" class="btn btn-primary">Create Document</button>
      </form>
    </div>`
  );
}

export function documentCardFragment(context: string, d: DocumentInfo): string {
  return `
    <div class="card" id="doc-${esc(d.name)}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3><a href="/ctx/${esc(context)}/${esc(d.name)}">${esc(d.title)}</a></h3>
          <div class="meta">${esc(d.name)} &middot; updated ${esc(d.updated ? new Date(d.updated).toLocaleDateString() : "never")}</div>
          ${d.tags.length ? `<div>${tags(d.tags)}</div>` : ""}
        </div>
        <button class="btn btn-danger btn-sm"
          hx-delete="/ctx/${esc(context)}/${esc(d.name)}"
          hx-target="#doc-${esc(d.name)}"
          hx-swap="outerHTML"
          hx-confirm="Delete '${esc(d.name)}'?">Delete</button>
      </div>
    </div>`;
}

export function documentViewPage(
  context: string,
  name: string,
  title: string,
  tagList: string[],
  created: string,
  updated: string,
  htmlContent: string
): string {
  return layout(
    title,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <strong>${esc(name)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
      <div>
        <h2>${esc(title)}</h2>
        <div class="meta" style="color:var(--text-muted); font-size:0.85rem;">
          Created ${esc(created ? new Date(created).toLocaleDateString() : "unknown")}
          &middot; Updated ${esc(updated ? new Date(updated).toLocaleDateString() : "unknown")}
        </div>
        ${tagList.length ? `<div style="margin-top:0.5rem;">${tags(tagList)}</div>` : ""}
      </div>
      <div class="actions">
        <a href="/ctx/${esc(context)}/${esc(name)}/edit" class="btn btn-sm">Edit</a>
      </div>
    </div>
    <div class="doc-content" id="doc-body">${htmlContent}</div>
    <div class="card" style="margin-top:2rem;">
      <h3>Append Content</h3>
      <form hx-post="/ctx/${esc(context)}/${esc(name)}/append" hx-target="#doc-body" hx-swap="innerHTML" hx-on::after-request="if(event.detail.successful) this.reset()">
        <textarea name="content" placeholder="Additional markdown to append..."></textarea>
        <button type="submit" class="btn btn-primary">Append</button>
      </form>
    </div>`
  );
}

export function documentEditPage(
  context: string,
  name: string,
  title: string,
  tagList: string[],
  content: string
): string {
  return layout(
    `Edit ${title}`,
    `
    <div class="breadcrumb">
      <a href="/">Contexts</a> / <a href="/ctx/${esc(context)}">${esc(context)}</a> / <a href="/ctx/${esc(context)}/${esc(name)}">${esc(name)}</a> / <strong>Edit</strong>
    </div>
    <h2>Edit: ${esc(title)}</h2>
    <form method="POST" action="/ctx/${esc(context)}/${esc(name)}/edit" style="margin-top:1rem;">
      <div class="grid-2">
        <div>
          <label for="title">Title</label>
          <input type="text" id="title" name="title" value="${esc(title)}" required>
        </div>
        <div>
          <label for="tags">Tags (comma-separated)</label>
          <input type="text" id="tags" name="tags" value="${esc(tagList.join(", "))}">
        </div>
      </div>
      <label for="content">Content</label>
      <textarea id="content" name="content" style="min-height:400px;">${esc(content)}</textarea>
      <div class="actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <a href="/ctx/${esc(context)}/${esc(name)}" class="btn">Cancel</a>
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
          <h3><a href="/ctx/${esc(r.context)}/${esc(r.document)}">${esc(r.title)}</a></h3>
          <div class="meta">${esc(r.context)} / ${esc(r.document)}</div>
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
          <input type="text" id="q" name="q" value="${esc(query)}" placeholder="Search all documents..." autofocus>
        </div>
        <div>
          <label for="context">Context (optional)</label>
          <select id="context" name="context" style="width:100%; padding:0.5rem 0.75rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:0.9rem; margin-bottom:0.75rem;">
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
