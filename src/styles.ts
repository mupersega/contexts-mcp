// The CRT/terminal stylesheet. Exported as a plain string so `templates.ts`
// can drop it inside a `<style>` tag in the layout — no bundler, no separate
// asset route, just a TS module compiled by tsc alongside everything else.
// Token substitution (${...}) inside this string is deliberately not used;
// anything dynamic lives in template.ts and uses CSS custom properties.
export const styles = `
    :root {
      --bg: #1c1f26; --surface: #23262e; --surface-raised: #2c303a;
      --border: #3d424d; --border-heavy: #5a6070;
      --text: #c9d1d9; --text-muted: #7d8491; --text-bright: #e6e8ec; --text-dim: #5a6070;
      --tag-bg: #2c303a; --tag-text: #b4bbc7;
      --accent: #4ade80; --accent-glow: #4ade80;
      --accent-line: rgba(74,222,128,0.08); --accent-line-hover: rgba(74,222,128,0.65);
      --selection-bg: #4ade80; --selection-text: #0a1209;
      --accent-complement: #ff6b9d;
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
      --accent-complement: #be185d;
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

    /* --- Theme Lab: accent (data-accent) ---
       Just the highlight chain. Orthogonal to bg/surface — set independently
       via data-palette below. Phosphor is the implicit default (in :root). */
    [data-accent="amber"] {
      --accent: #ffb000; --accent-glow: #ffb000;
      --accent-line: rgba(255,176,0,0.09); --accent-line-hover: rgba(255,176,0,0.7);
      --selection-bg: #ffb000; --selection-text: #1c1200;
      --accent-complement: #60a5fa;
    }
    [data-accent="cyan"] {
      --accent: #22d3ee; --accent-glow: #22d3ee;
      --accent-line: rgba(34,211,238,0.08); --accent-line-hover: rgba(34,211,238,0.65);
      --selection-bg: #22d3ee; --selection-text: #06191e;
      --accent-complement: #f97316;
    }
    [data-accent="magenta"] {
      --accent: #e879f9; --accent-glow: #e879f9;
      --accent-line: rgba(232,121,249,0.09); --accent-line-hover: rgba(232,121,249,0.65);
      --selection-bg: #e879f9; --selection-text: #1e0820;
      --accent-complement: #fbbf24;
    }
    [data-accent="red"] {
      --accent: #f87171; --accent-glow: #f87171;
      --accent-line: rgba(248,113,113,0.09); --accent-line-hover: rgba(248,113,113,0.6);
      --selection-bg: #f87171; --selection-text: #1e0808;
      --accent-complement: #14b8a6;
    }
    [data-accent="slate"] {
      --accent: #94a3b8; --accent-glow: #94a3b8;
      --accent-line: rgba(148,163,184,0.06); --accent-line-hover: rgba(148,163,184,0.5);
      --selection-bg: #94a3b8; --selection-text: #0f172a;
      --accent-complement: #fb7185;
    }

    /* Light-mode accent overrides — darker, more saturated variants that
       read against the paper background. Beats both the dark-mode accent
       rule and the light base (specificity 0-2-0). */
    [data-theme="light"][data-accent="amber"]   { --accent: #b76a00; --accent-glow: #b76a00; --accent-line: rgba(183,106,0,0.08); --accent-line-hover: rgba(183,106,0,0.5); --selection-bg: #b76a00; --selection-text: #f5efe0; --accent-complement: #1d4ed8; }
    [data-theme="light"][data-accent="cyan"]    { --accent: #0e7490; --accent-glow: #0e7490; --accent-line: rgba(14,116,144,0.08); --accent-line-hover: rgba(14,116,144,0.5); --selection-bg: #0e7490; --selection-text: #f5efe0; --accent-complement: #c2410c; }
    [data-theme="light"][data-accent="magenta"] { --accent: #a21caf; --accent-glow: #a21caf; --accent-line: rgba(162,28,175,0.08); --accent-line-hover: rgba(162,28,175,0.5); --selection-bg: #a21caf; --selection-text: #f5efe0; --accent-complement: #a16207; }
    [data-theme="light"][data-accent="red"]     { --accent: #b91c1c; --accent-glow: #b91c1c; --accent-line: rgba(185,28,28,0.08); --accent-line-hover: rgba(185,28,28,0.5); --selection-bg: #b91c1c; --selection-text: #f5efe0; --accent-complement: #0f766e; }
    [data-theme="light"][data-accent="slate"]   { --accent: #475569; --accent-glow: #475569; --accent-line: rgba(71,85,105,0.06); --accent-line-hover: rgba(71,85,105,0.4); --selection-bg: #475569; --selection-text: #f5efe0; --accent-complement: #be123c; }

    /* --- Theme Lab: palette (data-palette) ---
       Full background/surface/text/border chain. Does NOT touch accent vars
       — pair it freely with any data-accent. Dark-mode overrides only; in
       light mode the :root[data-theme="light"] block wins on specificity. */
    [data-palette="warm"] {
      --body-bg: #120d06; --bg: #1b140a; --surface: #231a0f; --surface-raised: #2d2214;
      --border: #3d2e1a; --border-heavy: #5e4828;
      --text: #e8d4a0; --text-muted: #a08866; --text-bright: #fff0c8; --text-dim: #6b5835;
      --hover-text: #ffecb2;
      --tag-bg: #2d2214; --tag-text: #c9b480;
      --input-bg: #1e160c; --input-bg-focus: #261d10;
      --code-bg: #1e160c; --pre-bg: #18120a; --table-stripe: #18120a;
      --btn-shadow: #0a0705; --container-shadow: rgba(60,30,0,0.28);
      --scanline: rgba(80,40,0,0.05); --vignette: rgba(40,20,0,0.4);
    }
    [data-palette="cold"] {
      --body-bg: #0a1218; --bg: #111a22; --surface: #17232e; --surface-raised: #1e2d3b;
      --border: #2c3e50; --border-heavy: #45617d;
      --text: #c4d6e4; --text-muted: #7a8f9e; --text-bright: #e2eef8; --text-dim: #4d6375;
      --hover-text: #f0f8ff;
      --tag-bg: #1e2d3b; --tag-text: #a6bccc;
      --input-bg: #131e28; --input-bg-focus: #18242e;
      --code-bg: #131e28; --pre-bg: #0f1922; --table-stripe: #0f1922;
      --btn-shadow: #050a0f; --container-shadow: rgba(0,30,60,0.25);
      --scanline: rgba(0,30,60,0.05); --vignette: rgba(0,20,50,0.4);
    }
    [data-palette="deep"] {
      --body-bg: #130c1a; --bg: #1a1124; --surface: #241832; --surface-raised: #2f2140;
      --border: #3f2a56; --border-heavy: #604380;
      --text: #d8c0e4; --text-muted: #9676b5; --text-bright: #f0def5; --text-dim: #6b4a80;
      --hover-text: #ffe6ff;
      --tag-bg: #2f2140; --tag-text: #c0a0d8;
      --input-bg: #1d1428; --input-bg-focus: #24182f;
      --code-bg: #1d1428; --pre-bg: #181021; --table-stripe: #181021;
      --btn-shadow: #0b0511; --container-shadow: rgba(60,20,80,0.28);
      --scanline: rgba(60,20,80,0.05); --vignette: rgba(50,10,70,0.4);
    }
    [data-palette="slate"] {
      --body-bg: #15171a; --bg: #1b1e22; --surface: #22262c; --surface-raised: #2b2f37;
      --border: #3d424a; --border-heavy: #5c6270;
      --text: #c6ccd4; --text-muted: #7c838f; --text-bright: #e8ebef; --text-dim: #555b66;
      --hover-text: #f0f2f5;
      --tag-bg: #2b2f37; --tag-text: #b0b6c0;
      --input-bg: #1d2026; --input-bg-focus: #23262d;
      --code-bg: #1d2026; --pre-bg: #181b20; --table-stripe: #181b20;
      --btn-shadow: #0a0b0d; --container-shadow: rgba(0,0,0,0.22);
      --scanline: rgba(0,0,0,0.03); --vignette: rgba(0,0,0,0.3);
    }

    /* --- Theme Lab: complement (data-complement) ---
       Default off. When on, just two surfaces flip from --accent to
       --accent-complement: the text selection, and the occasional flash
       in the sys-bars activity strip. Tiny pops — the rest of the UI
       (sort-tab active, card hover, status badges) stays on accent. */
    [data-complement="on"] ::selection {
      background: var(--accent-complement);
      color: var(--selection-text);
      text-shadow: none;
    }
    [data-complement="on"] ::-moz-selection {
      background: var(--accent-complement);
      color: var(--selection-text);
      text-shadow: none;
    }
    [data-complement="on"] .sys-bars .hit {
      color: var(--accent-complement);
      text-shadow: 0 0 3px var(--accent-complement);
    }

    /* Slot-machine highlight during a roll — knob buttons flash through
       values without actually changing the theme until the roll settles. */
    .sort-tab.rolling {
      color: var(--accent); background: var(--surface-raised);
      border-color: var(--accent); border-bottom: 1px solid var(--accent);
      opacity: 0.55;
    }

    /* Light-mode accent overrides — darker, more saturated variants that
       read against the paper background. */
    [data-theme="light"][data-accent="amber"] {
      --accent: #b76a00; --accent-glow: #b76a00;
      --accent-line: rgba(183,106,0,0.08); --accent-line-hover: rgba(183,106,0,0.5);
      --selection-bg: #b76a00; --selection-text: #f5efe0;
    }
    [data-theme="light"][data-accent="cyan"] {
      --accent: #0e7490; --accent-glow: #0e7490;
      --accent-line: rgba(14,116,144,0.08); --accent-line-hover: rgba(14,116,144,0.5);
      --selection-bg: #0e7490; --selection-text: #f5efe0;
    }
    [data-theme="light"][data-accent="magenta"] {
      --accent: #a21caf; --accent-glow: #a21caf;
      --accent-line: rgba(162,28,175,0.08); --accent-line-hover: rgba(162,28,175,0.5);
      --selection-bg: #a21caf; --selection-text: #f5efe0;
    }
    [data-theme="light"][data-accent="red"] {
      --accent: #b91c1c; --accent-glow: #b91c1c;
      --accent-line: rgba(185,28,28,0.08); --accent-line-hover: rgba(185,28,28,0.5);
      --selection-bg: #b91c1c; --selection-text: #f5efe0;
    }
    [data-theme="light"][data-accent="slate"] {
      --accent: #475569; --accent-glow: #475569;
      --accent-line: rgba(71,85,105,0.06); --accent-line-hover: rgba(71,85,105,0.4);
      --selection-bg: #475569; --selection-text: #f5efe0;
    }

    /* --- Theme Lab: corner radius ---
       One variable, applied only to the shapes we explicitly control
       (below). Default is 0 (sharp), matching the ship look. */
    :root { --corner: 0; }
    [data-corners="soft"]     { --corner: 4px; }
    [data-corners="rounded"]  { --corner: 10px; }
    [data-corners="squircle"] { --corner: 18px; }

    /* --- Theme Lab: chrome intensity ---
       'full' (default) leaves everything on. 'subtle' kills vignette + noise
       but keeps scanlines and content-label ::before badges. 'flat' removes
       all the decorative overlays and badges entirely. */
    [data-chrome="subtle"] body::after,
    [data-chrome="subtle"] #noise-canvas { display: none; }

    [data-chrome="flat"] body::before,
    [data-chrome="flat"] body::after,
    [data-chrome="flat"] #noise-canvas { display: none; }
    [data-chrome="flat"] .container { animation: none; box-shadow: none; }
    [data-chrome="flat"] .card::before,
    [data-chrome="flat"] .ctx-meta-header::before,
    [data-chrome="flat"] .doc-content::before,
    [data-chrome="flat"] .doc-content::after,
    [data-chrome="flat"] .doc-content pre::before,
    [data-chrome="flat"] .status-badge::before,
    [data-chrome="flat"] .status-badge::after,
    [data-chrome="flat"] header h1 a::before,
    [data-chrome="flat"] header h1 a::after,
    [data-chrome="flat"] .sort-tab.active::before { content: none; }
    [data-chrome="flat"] header h1 a::after { display: none; }

    /* --- Theme Lab: motion ---
       Kills CSS animations and transitions globally. The JS-driven noise
       canvas and sys-bars strip keep running silently; we hide/flatten
       their output so the effect is what matters. */
    [data-motion="off"] *,
    [data-motion="off"] *::before,
    [data-motion="off"] *::after {
      animation: none !important;
      transition: none !important;
    }
    [data-motion="off"] #noise-canvas { opacity: 0 !important; }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* Radius applied to the shapes we explicitly control. Element selectors
       (input/textarea/select/button) beat UA defaults; class selectors beat
       the rest. --corner defaults to 0, so the ship look is unchanged. */
    input, textarea, select, button,
    .card, .btn, .status-badge, .tag, .tag-ctx, .ctx-link, .sort-tab,
    .chip, .ctx-meta-header, .doc-content, .search-match, .flash,
    .footer-about-body, .item-kind,
    .list-controls, .empty, .breadcrumb,
    .theme-knob, .theme-preview, .doc-content pre, .doc-content code,
    .doc-content blockquote, .doc-content table, .search-match {
      border-radius: var(--corner);
    }
    /* A few inner elements should clip to their parent's rounding so the
       corners don't show through as a hard square. */
    .doc-content table { overflow: hidden; }

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
    :root[data-width="medium"] .container { max-width: 1100px; }
    :root[data-width="wide"] .container { max-width: calc(100vw - 2rem); }

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
      margin-left: 0.4rem; background: transparent; border: none;
      color: var(--text-muted); font-family: inherit; font-size: 1rem;
      line-height: 1; padding: 0; cursor: pointer; vertical-align: middle;
      transition: color 0.1s, transform 0.2s;
    }
    #theme-toggle:hover { color: var(--text-bright); }
    :root[data-theme="light"] #theme-toggle { transform: rotate(180deg); }
    #theme-lab-link {
      margin-left: 0.5rem; display: inline-flex; align-items: center;
      vertical-align: middle;
      color: var(--accent); border: none; line-height: 1;
      transition: opacity 0.1s, transform 0.15s;
      opacity: 0.85;
    }
    #theme-lab-link:hover { opacity: 1; transform: scale(1.1); border: none; }
    #theme-lab-link svg { display: block; width: 14px; height: 14px; }
    #width-toggle {
      background: transparent; border: none; padding: 0;
      margin-left: 0.5rem; vertical-align: middle;
      color: var(--text-muted); cursor: pointer; line-height: 1;
      font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem;
      letter-spacing: 0.1em; text-transform: uppercase;
      transition: color 0.1s;
    }
    #width-toggle:hover, #width-toggle[aria-expanded="true"] { color: var(--text-bright); }
    #width-popout {
      margin: 0; padding: 0; inset: auto;
      background: var(--surface); border: 1px solid var(--border);
      min-width: 5.5rem;
      z-index: 40; box-shadow: 0 2px 8px var(--container-shadow);
    }
    #width-popout:popover-open { display: flex; flex-direction: column; }
    #width-popout button {
      background: transparent; border: none; padding: 0.35rem 0.65rem;
      color: var(--text-muted); cursor: pointer; text-align: left;
      font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    #width-popout button:hover { color: var(--text-bright); background: var(--surface-raised); }
    #width-popout button.active { color: var(--accent); }
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
      border: 1px solid var(--border); position: relative;
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
      padding: 0.75rem 1rem; margin: 1rem 0;
      background: var(--code-bg); border: 1px dotted var(--border);
      color: var(--text-muted); font-style: italic;
    }
    .doc-content-raw {
      white-space: pre; font-family: 'IBM Plex Mono', monospace;
      font-size: 0.82rem; line-height: 1.65; padding: 2.5rem 2rem;
    }

    /* --- Search --- */
    .search-match {
      background: var(--code-bg); padding: 0.5rem 0.75rem; font-size: 0.8rem;
      font-family: 'IBM Plex Mono', monospace; margin-top: 0.5rem;
      color: var(--text-muted); border: 1px dotted var(--border); position: relative;
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
    /* Vertical divider between the sort group and the status group. */
    .list-controls .list-divider {
      display: inline-block; width: 1px; height: 0.9rem;
      background: var(--border); margin: 0 0.25rem;
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

    /* --- Theme Lab layout --- */
    .theme-lab-intro {
      color: var(--text-muted); font-size: 0.85rem; margin: 0.25rem 0 1.5rem 0;
      font-style: italic;
    }
    .theme-section {
      font-size: 0.75rem; letter-spacing: 0.15em; margin: 2rem 0 0.75rem 0;
      color: var(--text-dim); text-transform: uppercase;
      border-bottom: 1px dotted var(--border); padding-bottom: 0.4rem;
    }
    .theme-preview { margin: 0.5rem 0 0 0; }
    .theme-presets {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
    }
    .theme-knobs {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
    }
    @media (max-width: 640px) { .theme-knobs { grid-template-columns: 1fr; } }
    .theme-knob {
      border: 1px dotted var(--border); background: var(--surface);
      padding: 0.5rem 0.75rem 0.75rem 0.75rem;
    }
    .theme-knob legend {
      font-size: 0.65rem; letter-spacing: 0.15em;
      color: var(--text-dim); text-transform: uppercase;
      padding: 0 0.4rem;
    }
    .theme-knob .knob-row {
      display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.25rem;
    }
    .theme-knob .sort-tab { cursor: pointer; }
    .theme-actions {
      display: flex; gap: 0.75rem; align-items: center;
      margin-top: 1.5rem;
    }
    #theme-scramble {
      font-size: 0.95rem; padding: 0.6rem 1.2rem;
      min-width: 11rem; text-align: center;
    }
    .theme-footnote {
      margin-top: 1rem; font-size: 0.7rem; color: var(--text-dim);
      font-style: italic; letter-spacing: 0.02em;
    }
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
  `;
