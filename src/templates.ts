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
  <meta name="color-scheme" content="dark light">
  <script>
  (function() {
    try {
      var t = localStorage.getItem('contexts-theme');
      if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
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
  <style>
    :root {
      --bg: #1c1f26; --surface: #23262e; --surface-raised: #2c303a;
      --border: #3d424d; --border-heavy: #5a6070;
      --text: #c9d1d9; --text-muted: #7d8491; --text-bright: #e6e8ec; --text-dim: #5a6070;
      --tag-bg: #2c303a; --tag-text: #b4bbc7;
      --accent: #4ade80; --accent-glow: #4ade80;
      --accent-line: rgba(74,222,128,0.08); --accent-line-hover: rgba(74,222,128,0.65);
      --selection-bg: #4ade80; --selection-text: #0a1209;
      --body-bg: #16181d;
      --input-bg: #1d2027; --input-bg-focus: #22262e;
      --code-bg: #1d2027; --pre-bg: #181b21; --table-stripe: #181b21;
      --hover-text: #f0f2f5;
      --btn-shadow: #0c0e12; --btn-primary-text: #111318;
      --flash-success-bg: #1d2523; --flash-error-bg: #25211d; --flash-error-border: #8a8070;
      --scanline: rgba(0,0,0,0.035); --vignette: rgba(0,0,0,0.35);
      --noise-blend: overlay; --noise-opacity: 0.35;
      --container-shadow: rgba(0,0,0,0.25);
      --sticky-header-h: 4.5rem;
      --sticky-crumb-h: 2.25rem;
    }

    :root[data-theme="light"] {
      --bg: #f5efe0; --surface: #ece5d3; --surface-raised: #e0d8c2;
      --border: #bfb8a5; --border-heavy: #8a8470;
      --text: #2a2824; --text-muted: #5a5647; --text-bright: #1a1814; --text-dim: #8a8470;
      --tag-bg: #ddd5c0; --tag-text: #3a3830;
      --accent: #2d7a3f; --accent-glow: #2d7a3f;
      --accent-line: rgba(45,122,63,0.08); --accent-line-hover: rgba(45,122,63,0.5);
      --selection-bg: #2d7a3f; --selection-text: #f5efe0;
      --body-bg: #e8e0cc;
      --input-bg: #f9f4e5; --input-bg-focus: #fdf9ec;
      --code-bg: #e8e0cc; --pre-bg: #e0d8c2; --table-stripe: #ece5d3;
      --hover-text: #1a1814;
      --btn-shadow: #8a8470; --btn-primary-text: #f5efe0;
      --flash-success-bg: #dce6d0; --flash-error-bg: #e6d5d0; --flash-error-border: #8a8470;
      --scanline: rgba(58,50,32,0.022); --vignette: rgba(58,50,32,0.07);
      --noise-blend: normal; --noise-opacity: 0;
      --container-shadow: rgba(58,50,32,0.035);
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }

    body {
      font-family: 'IBM Plex Mono', 'Courier New', monospace;
      font-size: 14px; font-weight: 400; letter-spacing: 0.01em;
      background: var(--body-bg); color: var(--text); line-height: 1.7;
    }

    /* --- CRT Scanlines --- */
    body::before {
      content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, var(--scanline) 2px, var(--scanline) 4px);
      pointer-events: none; z-index: 10000;
    }

    /* --- Vignette --- */
    body::after {
      content: ''; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(ellipse at center, transparent 60%, var(--vignette) 100%);
      pointer-events: none; z-index: 10001;
    }

    #noise-canvas {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 9999; opacity: var(--noise-opacity); mix-blend-mode: var(--noise-blend);
    }
    /* Light mode: disable the fixed noise canvas entirely.
       mix-blend-mode on a position:fixed canvas triggers a Chromium repaint
       bug where scrolling content leaves ghost trails in the blended region. */
    :root[data-theme="light"] #noise-canvas { display: none; }

    h1, h2, h3, .card h3 {
      font-family: 'IBM Plex Mono', 'Courier New', monospace; font-weight: 600;
      letter-spacing: 0.04em; text-transform: uppercase; font-weight: 400;
    }

    a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--text-dim); transition: all 0.1s; }
    a:hover { color: var(--hover-text); border-bottom-color: var(--text-muted); border-bottom-style: solid; }

    .container {
      max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem;
      background: var(--bg); min-height: 100vh;
      border-left: 1px solid var(--border); border-right: 1px solid var(--border);
      box-shadow: inset 0 0 80px var(--container-shadow);
      animation: screen-flicker 0.5s ease-out;
    }

    /* --- Header --- */
    header {
      border-bottom: 2px double var(--border-heavy); padding: 1rem 0; margin-bottom: 1.5rem;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 30; background: var(--bg);
    }
    .sys-bars {
      position: absolute; top: -1.5rem; right: 0;
      font-size: 0.65rem; color: var(--text-dim); letter-spacing: 0.1em;
      font-family: 'IBM Plex Mono', monospace; white-space: pre;
    }
    .sys-bars .hit { color: var(--accent); text-shadow: 0 0 3px var(--accent-glow); }
    #theme-toggle {
      margin-left: 0.75rem; background: transparent; border: none;
      color: var(--text-muted); font-family: inherit; font-size: 1rem;
      line-height: 1; padding: 0; cursor: pointer; vertical-align: middle;
      transition: color 0.1s, transform 0.2s;
    }
    #theme-toggle:hover { color: var(--text-bright); }
    :root[data-theme="light"] #theme-toggle { transform: rotate(180deg); }
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
      /* Zero-alpha scanline layer always present so the hover transitions
         smoothly into a phosphor-green CRT texture. */
      background:
        repeating-linear-gradient(
          0deg,
          transparent 0px,
          transparent 1px,
          transparent 1px,
          transparent 3px
        ),
        var(--surface);
      border: 1px solid var(--border);
      padding: 1.25rem 1.25rem 1.25rem 1.5rem; margin-bottom: 1rem;
      position: relative; transition: background 0.18s;
      animation: stamp-in 0.2s ease-out;
    }
    .card::before {
      content: '//'; position: absolute; top: 0.5rem; left: 0.4rem;
      font-size: 0.65rem; color: var(--text-dim); font-family: 'IBM Plex Mono', monospace;
    }
    /* Only cards with a stretched title link (i.e. navigable ones) get the
       hover affordance — the New Context form card is excluded. */
    .card:has(h3 a):hover {
      background:
        repeating-linear-gradient(
          0deg,
          var(--accent-line) 0px,
          var(--accent-line) 1px,
          transparent 1px,
          transparent 3px
        ),
        var(--surface);
    }
    .card:has(h3 a):hover h3 a { color: var(--hover-text); border-bottom-color: var(--accent-line-hover); }
    .card h3 { font-size: 1rem; margin-bottom: 0.25rem; }
    .card h3 a { color: var(--text-bright); border-bottom: 1px dotted var(--text-dim); }
    /* Stretched-link pattern: title anchor's ::after anchors to .card (the
       nearest positioned ancestor) and covers the whole card for click. */
    .card h3 a::after { content: ''; position: absolute; inset: 0; z-index: 1; }
    .card h3 a:hover { color: var(--hover-text); border-bottom-color: var(--text-muted); }
    /* Keep interactive children above the stretched-link overlay. */
    .card .btn, .card .ctx-link { position: relative; z-index: 2; }
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

    .item-title-sticky {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 0.75rem 0; margin-bottom: 1rem;
      border-bottom: 1px dotted var(--border);
      position: sticky;
      top: calc(var(--sticky-header-h) + var(--sticky-crumb-h));
      z-index: 10; background: var(--bg);
    }

    /* --- Buttons --- */
    .btn {
      display: inline-block; padding: 0.45rem 0.9rem;
      border: 1px solid var(--border-heavy); background: var(--surface); color: var(--text);
      cursor: pointer; font-size: 0.8rem; font-family: 'IBM Plex Mono', monospace;
      text-transform: uppercase; letter-spacing: 0.06em; text-decoration: none;
      box-shadow: 2px 2px 0 var(--btn-shadow); transition: all 0.08s; border-bottom: 1px solid var(--border-heavy);
    }
    .btn:hover { background: var(--surface-raised); border-color: var(--text-muted); color: var(--text-bright); text-decoration: none; }
    .btn:active { box-shadow: 0 0 0 var(--btn-shadow); transform: translate(2px, 2px); }
    .btn-primary { background: var(--text-bright); color: var(--btn-primary-text); border-color: var(--text-bright); font-weight: 600; }
    .btn-primary:hover { background: var(--hover-text); color: var(--btn-primary-text); }
    .btn-danger { color: var(--text-muted); border-color: var(--text-muted); border-style: dashed; }
    .btn-danger:hover { background: var(--text-bright); color: var(--bg); border-style: solid; }
    .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.7rem; box-shadow: 1px 1px 0 var(--btn-shadow); }
    .btn-sm:active { box-shadow: 0 0 0 var(--btn-shadow); transform: translate(1px, 1px); }

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
      background: var(--input-bg); color: var(--text);
      font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem;
      margin-bottom: 0.75rem; transition: border-color 0.15s;
    }
    textarea { min-height: 200px; resize: vertical; line-height: 1.8; }
    input:focus, textarea:focus, select:focus {
      outline: none; border-color: var(--text-muted); border-bottom-color: var(--text-bright); background: var(--input-bg-focus);
    }
    input::placeholder, textarea::placeholder { color: var(--text-dim); font-style: italic; }
    select {
      -webkit-appearance: none; -moz-appearance: none; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%23777777' stroke-width='1.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 0.75rem center; padding-right: 2rem;
    }
    :root[data-theme="light"] select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%235a5647' stroke-width='1.5'/%3E%3C/svg%3E");
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
      padding: 0.5rem 0; border-bottom: 1px dotted var(--border); letter-spacing: 0.03em;
      position: sticky; top: var(--sticky-header-h); z-index: 20; background: var(--bg);
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
      background: var(--code-bg); padding: 0.15rem 0.4rem; font-size: 0.85em;
      border: 1px solid var(--border); font-family: 'IBM Plex Mono', monospace;
    }
    .doc-content pre {
      background: var(--pre-bg); padding: 1rem; overflow-x: auto; margin-bottom: 1rem;
      border: 1px solid var(--border); border-left: 3px solid var(--border-heavy); position: relative;
    }
    .doc-content pre::before {
      content: 'CODE'; position: absolute; top: 0.25rem; right: 0.5rem;
      font-size: 0.6rem; color: var(--text-dim); letter-spacing: 0.1em;
      font-family: 'IBM Plex Mono', monospace; text-transform: uppercase;
    }
    .doc-content pre[data-lang]::before { content: attr(data-lang); }
    .doc-content pre code { padding: 0; background: none; border: none; }
    .doc-content table {
      border-collapse: collapse; margin: 1rem 0; font-size: 0.85rem;
      width: 100%; border: 1px solid var(--border);
    }
    .doc-content th, .doc-content td {
      border: 1px solid var(--border); padding: 0.4rem 0.75rem;
      text-align: left; vertical-align: top;
    }
    .doc-content thead th {
      background: var(--code-bg); font-family: 'IBM Plex Mono', monospace;
      text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem;
      color: var(--text-bright); border-bottom: 2px solid var(--border-heavy);
    }
    .doc-content tbody tr:nth-child(even) td { background: var(--table-stripe); }
    .doc-content td code, .doc-content th code {
      border: none; background: none; padding: 0; color: var(--text-bright);
    }
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
      background: var(--code-bg); padding: 0.5rem 0.75rem; font-size: 0.8rem;
      font-family: 'IBM Plex Mono', monospace; margin-top: 0.5rem;
      color: var(--text-muted); border-left: 2px solid var(--text-dim); position: relative;
    }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }

    /* --- Flash --- */
    .flash { padding: 0.75rem 1rem; margin-bottom: 1rem; border: 1px solid; font-size: 0.85rem; position: relative; padding-left: 2rem; }
    .flash::before { position: absolute; left: 0.75rem; font-weight: bold; }
    .flash-success { background: var(--flash-success-bg); border-color: var(--text-muted); color: var(--text); }
    .flash-success::before { content: '✓'; color: var(--text); }
    .flash-error { background: var(--flash-error-bg); border-color: var(--flash-error-border); color: var(--text); }
    .flash-error::before { content: '!'; color: var(--text-bright); }

    /* --- Footer --- */
    .classification-footer {
      margin-top: 3rem; padding-top: 1rem; border-top: 2px double var(--border);
      text-align: center; font-size: 0.6rem; color: var(--text-dim);
      letter-spacing: 0.2em; text-transform: uppercase; font-family: 'IBM Plex Mono', monospace;
    }
    .footer-shutdown { display: inline-block; margin: 0.5rem 0 0 0; }
    .footer-about { display: block; margin: 1rem auto 0; max-width: 32rem; text-align: left; }
    .footer-about summary {
      cursor: pointer; color: var(--text-muted); letter-spacing: 0.2em;
      font-size: 0.6rem; text-align: center; list-style: none;
    }
    .footer-about summary::-webkit-details-marker { display: none; }
    .footer-about summary::before { content: '▸ '; opacity: 0.6; }
    .footer-about[open] summary::before { content: '▾ '; }
    .footer-about-body {
      margin-top: 0.75rem; padding: 0.75rem 1rem;
      background: var(--code-bg); border: 1px solid var(--border);
      font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem;
      letter-spacing: 0.02em; text-transform: none; color: var(--text-muted);
      white-space: pre-wrap; word-break: break-all;
    }
    .footer-about-body dt { color: var(--text-dim); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; }
    .footer-about-body dd { margin: 0 0 0.4rem 0; color: var(--text); }
    .footer-about-body dd:last-child { margin-bottom: 0; }

    /* --- List header controls --- */
    .list-controls {
      display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: center;
      margin: 0.75rem 0 1rem 0; padding: 0.5rem 0.75rem;
      border: 1px dotted var(--border); background: var(--surface);
      font-size: 0.7rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .list-controls .list-label {
      color: var(--text-dim); font-size: 0.65rem; margin-right: 0.1rem;
    }
    .sort-tab {
      display: inline-block; padding: 0.15rem 0.5rem;
      font-size: 0.7rem; color: var(--text-muted);
      border: 1px solid transparent; border-bottom: 1px dotted var(--text-dim);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .sort-tab:hover {
      color: var(--text-bright); border-color: var(--border);
      border-bottom-style: solid; background: var(--surface-raised);
    }
    .sort-tab.active {
      color: var(--accent); background: var(--surface-raised);
      border-color: var(--accent); border-bottom: 1px solid var(--accent);
      text-shadow: 0 0 6px var(--accent-glow);
    }
    .sort-tab.active::before { content: '▸ '; color: var(--accent); }
    .list-controls .chip {
      display: inline-flex; align-items: center; gap: 0.3rem;
      margin-left: auto;
      padding: 0.15rem 0.55rem; font-size: 0.65rem;
      background: var(--surface-raised); border: 1px dotted var(--border);
      color: var(--text-muted);
    }
    .list-controls .chip::before { content: '▮'; color: var(--text-dim); font-size: 0.55rem; }
    .list-controls .chip:hover { color: var(--text-bright); border-style: solid; }

    /* --- Selection --- */
    ::selection { background: var(--selection-bg); color: var(--selection-text); text-shadow: none; }
    ::-moz-selection { background: var(--selection-bg); color: var(--selection-text); text-shadow: none; }

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
      <div class="sys-bars" id="sys-bars"><span aria-hidden="true">SYS.ACTIVE </span><span id="sys-bars-strip" aria-hidden="true">░░░░░░░░░░░░░░░░░░░░</span><button type="button" id="theme-toggle" aria-label="Toggle theme">◐</button></div>
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
      try { localStorage.setItem('contexts-theme', next || 'dark'); } catch (e) {}
      render();
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
}

export function contextListPage(
  contexts: ContextSummary[],
  controls: ContextListControls
): string {
  const list = contexts.length
    ? contexts
        .map(
          (c) => `
      <div class="card" id="ctx-${esc(c.name)}">${renderContextCardBody(c)}</div>`
        )
        .join("")
    : `<div class="empty">No contexts yet. Create one below.</div>`;

  const sortOptions: Array<{ v: ContextListControls["sort"]; label: string }> = [
    { v: "name", label: "name" },
    { v: "recent_activity", label: "recent" },
    { v: "updated", label: "updated" },
    { v: "created", label: "created" },
  ];
  // Plain links instead of a <select> — the native select shows the CRT
  // scanline overlay, which reads as visual garbage on a small control.
  const sortParam = (v: string) =>
    controls.showArchived ? `?sort=${v}&show_archived=1` : `?sort=${v}`;
  const sortTabs = sortOptions
    .map(
      (o) =>
        `<a class="sort-tab${o.v === controls.sort ? " active" : ""}" href="${sortParam(o.v)}">${o.label}</a>`
    )
    .join("");

  const archivedToggleHref = controls.showArchived
    ? `?sort=${esc(controls.sort)}`
    : `?sort=${esc(controls.sort)}&show_archived=1`;
  const archivedChip = controls.archivedCount > 0 || controls.showArchived
    ? `<a class="chip" href="${archivedToggleHref}">${
        controls.showArchived ? "hide archived" : `archived (${controls.archivedCount})`
      }</a>`
    : "";

  const controlsRow = `
    <div class="list-controls">
      <span class="list-label">sort by</span>
      ${sortTabs}
      ${archivedChip}
    </div>`;

  return layout(
    "All Contexts",
    `
    <h2>Contexts</h2>
    ${controlsRow}
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
