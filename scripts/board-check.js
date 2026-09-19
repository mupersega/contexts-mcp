#!/usr/bin/env node
// scripts/board-check.js — geometry checks for the board view (view: board).
//
// The board's layout claims (clusters don't overlap, callout labels stack
// without collision, images keep their aspect ratio, pins land inside their
// figure, the settle is deterministic) are asserted here as numbers, against
// the REAL client code running in a real headless Chrome — not a parallel
// reimplementation of the layout. BOARD_SCRIPT exposes its settled geometry on
// window.__boardDebug for exactly this harness.
//
// No framework, no new dependencies: PNG fixtures are generated with zlib,
// Chrome is driven over raw CDP using Node's built-in WebSocket (Node >= 22).
// Skips (exit 0, loud message) when Chrome cannot be found.

import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tmpRoot = path.join(os.tmpdir(), `contexts-mcp-board-${process.pid}-${Date.now()}`);
const dataDir = path.join(tmpRoot, "data");
const profileDir = path.join(tmpRoot, "chrome-profile");
const uiPort = 3900 + (process.pid % 90);

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${label}\n        ${err instanceof Error ? err.message : err}`);
  }
}

// --- Minimal PNG writer (truecolor, no deps) ---------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Fixture ------------------------------------------------------------------

// fig-wide: 4 pins exercising all sides/corners (side-label mode).
// fig-tall: 7 pins, past LEGEND_AT — must collapse to legend mode.
const FENCE = {
  nodes: [
    { id: "fig-wide", type: "figure", src: "assets/wide.png", caption: "wide fixture",
      pins: [
        { at: [0, 0], text: "top-left corner pin with a label long enough to wrap onto several lines" },
        { at: [1, 1], text: "bottom-right corner pin" },
        { rect: [0.4, 0.35, 0.25, 0.3], text: "a region pin outlining a precise part of the image" },
        { at: [0.05, 0.9], text: "another left-side pin so the left stack has to resolve an overlap" },
      ] },
    { id: "fig-tall", type: "figure", src: "assets/tall.png", caption: "tall fixture",
      pins: [1, 2, 3, 4, 5, 6, 7].map((n) =>
        n === 2
          ? { rect: [0.9, 0.9, 0.4, 0.4], text: "legend region pin declared past the edge (must clamp)" }
          : { at: [0.5, n / 8], text: `legend finding number ${n}` }
      ) },
    { id: "chip", type: "item", link: "notes" },
    { id: "memo", type: "note", text: "a note card that leans slightly and must not collide with anything" },
  ],
  edges: [
    { from: "chip", to: "fig-wide#2", label: "claim" },
    { from: "fig-wide", to: "fig-tall", label: "pair" },
    { from: "memo", to: "fig-tall#3" },
  ],
};

// Stress fixture: the wild-agent shape that broke the first sim — six figures
// in linked ref/copy pairs, wordy pins, long notes, chips wired into pins.
// Dense enough that a settle which merely runs out of iterations (instead of
// guaranteeing separation) prints text on text.
const LONG = (n) =>
  `finding ${n}: the copy diverges from the reference in value structure, edge quality and colour temperature across the passage`;
const STRESS = {
  groups: { "study-1": { title: "Study One" }, "study-2": "Study Two" }, // study-3 untitled: id fallback
  nodes: [
    ...[1, 2, 3].flatMap((p) => [
      { id: `ref-${p}`, type: "figure", src: p % 2 ? "assets/wide.png" : "assets/tall.png",
        group: `study-${p}`,
        caption: `study ${p} reference with a caption long enough to wrap`,
        pins: [1, 2, 3, 4].map((n) => ({ at: [(n * 0.2) % 1, (n * 0.23) % 1], text: LONG(n) })) },
      { id: `copy-${p}`, type: "figure", src: p % 2 ? "assets/tall.png" : "assets/wide.png",
        group: `study-${p}`,
        caption: `study ${p} copy`,
        pins: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ at: [0.5, n / 8], text: LONG(n) })) },
    ]),
    ...[1, 2, 3, 4].map((n) => ({ id: `note-${n}`, type: "note",
      text: `overview note ${n}: a long paragraph of critique text that wraps onto many lines and makes a tall card, the way a wild agent actually writes notes when summarizing a whole study` })),
    // FOUR hub notes wired into all three copies — the wild board's exact
    // lesson-note shape. Under this load the copies get dragged toward one
    // over-subscribed middle, and a pair loses the geometry lottery unless
    // annotative springs are weaker than structural ones.
    ...["values", "edges", "temp", "draw"].map((k, i) => ({ id: `hub-${k}`, type: "note",
      text: `lesson ${k}: a cross-study observation that applies to all three copies and drags them toward a common centre if its springs are as strong as the pair bonds` })),
    { id: "chip-a", type: "item", link: "notes", label: "critique round one" },
    { id: "chip-b", type: "item", link: "notes", label: "values" },
    // late-declared multi-link chips: the wild board's "values"/"temperature"
    // chips — last in the file, linked to early figures across the board
    { id: "chip-late-1", type: "item", link: "notes", label: "temperature" },
    { id: "chip-late-2", type: "item", link: "notes", label: "edges" },
  ],
  edges: [
    // structural pair bonds: pin-to-pin between figures, as the wild agent wrote them
    ...[1, 2, 3].flatMap((p) => [1, 2, 3].map((n) => ({ from: `ref-${p}#${n}`, to: `copy-${p}#${n}`, label: n === 1 ? "pair" : "" }))),
    { from: "chip-a", to: "copy-1#2" },
    { from: "chip-b", to: "ref-2#3" },
    { from: "note-1", to: "copy-3#1" },
    ...["values", "edges", "temp", "draw"].flatMap((k) =>
      [1, 2, 3].map((p) => ({ from: `hub-${k}`, to: `copy-${p}#3` }))),
    { from: "chip-late-1", to: "ref-1#1" },
    { from: "chip-late-1", to: "copy-2#1" },
    { from: "chip-late-2", to: "ref-3#2" },
  ],
};

function writeFixture() {
  const ctxDir = path.join(dataDir, "board-test");
  fs.mkdirSync(path.join(ctxDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(ctxDir, "assets", "wide.png"), makePng(160, 100, [180, 60, 60]));
  fs.writeFileSync(path.join(ctxDir, "assets", "tall.png"), makePng(100, 160, [60, 60, 180]));
  fs.writeFileSync(path.join(ctxDir, "notes.md"), "---\ntitle: notes\ntags: []\n---\nlinked item\n");
  const fence = JSON.stringify(FENCE, null, 2);
  fs.writeFileSync(
    path.join(ctxDir, "board-test.md"),
    `---\ntitle: board fixture\ntags: []\nview: board\n---\n\n\`\`\`board\n${fence}\n\`\`\`\n`
  );
  const stress = JSON.stringify(STRESS, null, 2);
  fs.writeFileSync(
    path.join(ctxDir, "board-stress.md"),
    `---\ntitle: board stress fixture\ntags: []\nview: board\n---\n\n\`\`\`board\n${stress}\n\`\`\`\n`
  );
}

// --- Server + Chrome ----------------------------------------------------------

async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p)) || null;
}

// Tiny CDP client over Node's built-in WebSocket. One in-flight map per socket.
function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
    ws.onerror = (e) => reject(new Error(`websocket error for ${wsUrl}: ${e.message || e.type}`));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result);
      }
    };
  });
}

// Kiosk/auto-play probe: open the recordable URL, report whether the page
// chrome is hidden and whether the play run signals completion.
async function probeKiosk(browser, debugPort, url) {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const page = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return list.find((x) => x.id === targetId && x.webSocketDebuggerUrl) || null;
  }, 10000, "kiosk page target");
  const tab = await cdp(page.webSocketDebuggerUrl);
  const evalBool = async (expr) => {
    const r = await tab.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return !!(r.result && r.result.value);
  };
  await waitFor(() => evalBool("!!window.__boardDebug"), 15000, "kiosk board settle");
  const headerHidden = await evalBool(
    "(function(){ var h = document.querySelector('.container > header'); return h && getComputedStyle(h).display === 'none'; })()"
  );
  const introGone = await evalBool("!document.querySelector('.graph-intro')");
  const playDone = await waitFor(() => evalBool("window.__boardPlayDone === true"), 25000, "play completion signal")
    .then(() => true)
    .catch(() => false);
  tab.close();
  return { headerHidden, introGone, playDone };
}

// Open the board page in a fresh tab and return its settled __boardDebug.
async function loadBoard(browser, debugPort, url) {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const page = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const t = list.find((x) => x.id === targetId && x.webSocketDebuggerUrl);
    return t || null;
  }, 10000, "page target");
  const tab = await cdp(page.webSocketDebuggerUrl);
  const debug = await waitFor(async () => {
    const r = await tab.send("Runtime.evaluate", {
      expression: "window.__boardDebug ? JSON.stringify(window.__boardDebug) : ''",
      returnByValue: true,
    });
    return r.result && r.result.value ? JSON.parse(r.result.value) : null;
  }, 15000, "board settle (__boardDebug)");
  tab.close();
  return debug;
}

// --- Geometry helpers ----------------------------------------------------------

function figRect(b) {
  // drawn image rect (world): figure centre is body centre minus cluster offset
  const cx = b.x - b.cx, cy = b.y - b.cy;
  return { l: cx - b.fw / 2, r: cx + b.fw / 2, t: cy - b.fh / 2, b: cy + b.fh / 2, cx, cy };
}
function pinWorld(b, pin) {
  const f = figRect(b);
  return { x: f.l + pin.nx * b.fw, y: f.t + pin.ny * b.fh };
}
function segIntersectsRect(x1, y1, x2, y2, rc) {
  // conservative: either endpoint inside, or the segment crosses any rect side
  const inside = (x, y) => x > rc.l && x < rc.r && y > rc.t && y < rc.b;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const cross = (ax, ay, bx, by, cx2, cy2, dx, dy) => {
    const d = (bx - ax) * (dy - cy2) - (by - ay) * (dx - cx2);
    if (d === 0) return false;
    const t = ((cx2 - ax) * (dy - cy2) - (cy2 - ay) * (dx - cx2)) / d;
    const u = ((cx2 - ax) * (by - ay) - (cy2 - ay) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  return (
    cross(x1, y1, x2, y2, rc.l, rc.t, rc.r, rc.t) ||
    cross(x1, y1, x2, y2, rc.r, rc.t, rc.r, rc.b) ||
    cross(x1, y1, x2, y2, rc.l, rc.b, rc.r, rc.b) ||
    cross(x1, y1, x2, y2, rc.l, rc.t, rc.l, rc.b)
  );
}

// --- Run -----------------------------------------------------------------------

async function main() {
  console.log("contexts-mcp board-check");
  console.log(`  data dir: ${dataDir}`);
  console.log("");

  const chrome = findChrome();
  if (!chrome) {
    console.log("  SKIP  no Chrome/Edge found (set CHROME_PATH) — board geometry not verified");
    return;
  }
  if (typeof WebSocket === "undefined") {
    console.log("  SKIP  Node < 22 (no built-in WebSocket) — board geometry not verified");
    return;
  }

  writeFixture();
  fs.mkdirSync(profileDir, { recursive: true });

  const server = spawn(process.execPath, [path.join(repoRoot, "dist", "web.js")], {
    env: { ...process.env, CONTEXTS_DATA_DIR: dataDir, CONTEXTS_UI_PORT: String(uiPort) },
    stdio: "ignore",
  });
  const chromeProc = spawn(
    chrome,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let browser = null;
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${uiPort}/`)).ok, 15000, "web ui");
    // Chrome writes DevToolsActivePort (port + browser ws path) into the profile.
    const dtap = await waitFor(async () => {
      const p = path.join(profileDir, "DevToolsActivePort");
      return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim().split(/\r?\n/) : null;
    }, 15000, "chrome devtools port");
    const debugPort = Number(dtap[0]);
    browser = await cdp(`ws://127.0.0.1:${debugPort}${dtap[1]}`);

    const url = `http://127.0.0.1:${uiPort}/ctx/board-test/board-test`;
    const d1 = await loadBoard(browser, debugPort, url);
    const d2 = await loadBoard(browser, debugPort, url);
    const kiosk = await probeKiosk(browser, debugPort, `${url}?step=1&play=400&kiosk=1`);
    const bodies = d1.bodies;
    const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));
    const figs = bodies.filter((b) => b.type === "figure");
    const LABEL_W = d1.labelW;

    check("all declared nodes became bodies", () => {
      if (bodies.length !== FENCE.nodes.length)
        throw new Error(`expected ${FENCE.nodes.length} bodies, got ${bodies.length}`);
    });

    check("presentation steps = bodies + pins, in declaration order", () => {
      const want = bodies.length + figs.reduce((n, f) => n + f.pins.length, 0);
      if (d1.stepCount !== want)
        throw new Error(`stepCount ${d1.stepCount}, expected ${want}`);
    });

    check("no NaN anywhere in the settled geometry", () => {
      const scan = (o, trail) => {
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${trail}.${k} = ${v}`);
          if (v && typeof v === "object") scan(v, `${trail}.${k}`);
        }
      };
      scan(d1, "debug");
    });

    check("settle is deterministic across two independent loads", () => {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i], b = d2.bodies[i];
        if (a.id !== b.id) throw new Error(`body order differs at ${i}: ${a.id} vs ${b.id}`);
        if (Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6)
          throw new Error(`${a.id} settled at (${a.x},${a.y}) then (${b.x},${b.y})`);
      }
    });

    check("cluster rectangles do not substantially overlap", () => {
      const TOL = 14; // small residual penetration is fine; real overlap is not
      for (let i = 0; i < bodies.length; i++)
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const px = a.hw + b.hw - Math.abs(a.x - b.x);
          const py = a.hh + b.hh - Math.abs(a.y - b.y);
          if (px > TOL && py > TOL)
            throw new Error(`${a.id} and ${b.id} overlap by (${px.toFixed(1)}, ${py.toFixed(1)})`);
        }
    });

    check("figures preserve their image aspect ratio", () => {
      for (const f of figs) {
        if (!f.natW || !f.natH) throw new Error(`${f.id} image did not load (nat ${f.natW}x${f.natH})`);
        const want = f.natW / f.natH, got = f.fw / f.fh;
        if (Math.abs(got - want) / want > 0.06)
          throw new Error(`${f.id}: aspect ${got.toFixed(3)} vs image ${want.toFixed(3)}`);
      }
    });

    check("figures respect the FIG_MAX size cap", () => {
      for (const f of figs)
        if (Math.max(f.fw, f.fh) > 341) throw new Error(`${f.id} is ${f.fw}x${f.fh}`);
    });

    check("every pin lands inside its figure's image rect", () => {
      for (const f of figs)
        for (const p of f.pins) {
          if (p.nx < 0 || p.nx > 1 || p.ny < 0 || p.ny > 1)
            throw new Error(`${f.id}#${p.id} normalized coords out of range`);
          const w = pinWorld(f, p), rc = figRect(f);
          if (w.x < rc.l - 0.01 || w.x > rc.r + 0.01 || w.y < rc.t - 0.01 || w.y > rc.b + 0.01)
            throw new Error(`${f.id}#${p.id} world position escapes the image rect`);
          if (p.region) {
            // the highlighted rectangle itself must clamp inside the image,
            // even when the fence declares it partially past the edge
            const eps = 1e-6;
            if (p.nx - p.rw / 2 < -eps || p.nx + p.rw / 2 > 1 + eps ||
                p.ny - p.rh / 2 < -eps || p.ny + p.rh / 2 > 1 + eps)
              throw new Error(`${f.id}#${p.id} region rect escapes the image (${p.nx},${p.ny} ${p.rw}x${p.rh})`);
          }
        }
    });

    check("both pin kinds present in the fixture (point + region)", () => {
      const all = figs.flatMap((f) => f.pins);
      if (!all.some((p) => p.region) || !all.some((p) => !p.region))
        throw new Error("fixture no longer exercises both pin kinds");
    });

    check("legend collapse triggers at LEGEND_AT and only there", () => {
      if (byId["fig-tall"].legend !== true) throw new Error("fig-tall (7 pins) did not collapse to legend");
      if (byId["fig-wide"].legend !== false) throw new Error("fig-wide (4 pins) collapsed but should not");
      if (byId["fig-tall"].labels.length !== 0) throw new Error("legend mode still produced side labels");
      if (byId["fig-wide"].labels.length !== 4) throw new Error(`fig-wide has ${byId["fig-wide"].labels.length} side labels, expected 4`);
    });

    check("side labels sit fully clear of the image on their own side", () => {
      for (const f of figs)
        for (const l of f.labels) {
          if (l.side === "l" && l.dx + LABEL_W > -f.fw / 2 - 2)
            throw new Error(`${f.id} left label intrudes: dx=${l.dx}`);
          if (l.side === "r" && l.dx < f.fw / 2 + 2)
            throw new Error(`${f.id} right label intrudes: dx=${l.dx}`);
        }
    });

    check("same-side labels stack without vertical overlap", () => {
      for (const f of figs)
        for (const side of ["l", "r"]) {
          const stack = f.labels.filter((l) => l.side === side).sort((a, b) => a.dy - b.dy);
          for (let i = 1; i < stack.length; i++)
            if (stack[i].dy < stack[i - 1].dy + stack[i - 1].h + 7.9)
              throw new Error(`${f.id} ${side} stack: label ${i} overlaps its predecessor`);
        }
    });

    check("label boxes stay inside their cluster rectangle", () => {
      for (const f of figs)
        for (const l of f.labels) {
          // label offsets are relative to the figure centre; body centre is the
          // cluster centre, so convert and compare against the half-extents
          const lx1 = l.dx - f.cx, lx2 = l.dx + LABEL_W - f.cx;
          const ly1 = l.dy - f.cy, ly2 = l.dy + l.h - f.cy;
          if (lx1 < -f.hw - 0.5 || lx2 > f.hw + 0.5 || ly1 < -f.hh - 0.5 || ly2 > f.hh + 0.5)
            throw new Error(`${f.id} label escapes cluster box (pin ${l.pin})`);
        }
    });

    check("every edge pin reference resolves to a real pin", () => {
      for (const e of d1.edges) {
        for (const [endId, pinId] of [[e.from, e.fromPin], [e.to, e.toPin]]) {
          if (!pinId) continue;
          const b = byId[endId];
          if (!b || !b.pins.some((p) => p.id === pinId))
            throw new Error(`edge references ${endId}#${pinId}, which does not exist`);
        }
      }
    });

    // --- Dense-board stress: the wild-agent failure shape ---
    const d3 = await loadBoard(browser, debugPort, `http://127.0.0.1:${uiPort}/ctx/board-test/board-stress`);
    const sBodies = d3.bodies;
    const sById = Object.fromEntries(sBodies.map((b) => [b.id, b]));

    check("dense board: cluster rectangles still never overlap", () => {
      const TOL = 8; // the contact-projection pass should leave real clearance
      for (let i = 0; i < sBodies.length; i++)
        for (let j = i + 1; j < sBodies.length; j++) {
          const a = sBodies[i], b = sBodies[j];
          const px = a.hw + b.hw - Math.abs(a.x - b.x);
          const py = a.hh + b.hh - Math.abs(a.y - b.y);
          if (px > TOL && py > TOL)
            throw new Error(`${a.id} and ${b.id} overlap by (${px.toFixed(1)}, ${py.toFixed(1)})`);
        }
    });

    check("dense board: edge-linked figures settle adjacent, not a diagonal apart", () => {
      // Clear space allowed between linked cluster boxes: enough for a linked
      // satellite (a chip or note wired into the pair) to sit in the corridor,
      // nowhere near the original failure (pairs a full spiral apart).
      const GAP_MAX = 320;
      for (const [a, b] of [["ref-1", "copy-1"], ["ref-2", "copy-2"], ["ref-3", "copy-3"]]) {
        const A = sById[a], B = sById[b];
        const gx = Math.abs(A.x - B.x) - (A.hw + B.hw);
        const gy = Math.abs(A.y - B.y) - (A.hh + B.hh);
        const gap = Math.max(gx, gy);
        if (gap > GAP_MAX)
          throw new Error(`${a} and ${b} are ${gap.toFixed(0)} world units apart (max ${GAP_MAX})`);
      }
    });

    check("dense board: every edge settles short at the unit level", () => {
      // With groups, adjacency means the UNITS are close: a hub note against
      // the region it annotates counts as adjacent even though its target
      // member sits deep inside that region. Endpoints map to their group box
      // when grouped, to their own body otherwise.
      const EDGE_MAX = 450;
      const memberGroup = {};
      for (const g of d3.groups || []) for (const mid of g.members) memberGroup[mid] = g;
      const unitRect = (id) => memberGroup[id] || sById[id];
      let worst = 0, worstPair = "";
      for (const e of d3.edges) {
        const A = unitRect(e.from), B = unitRect(e.to);
        if (A === B) continue; // same group — internal, near by construction
        const gx = Math.abs(A.x - B.x) - (A.hw + B.hw);
        const gy = Math.abs(A.y - B.y) - (A.hh + B.hh);
        const gap = Math.max(gx, gy);
        if (gap > worst) { worst = gap; worstPair = `${e.from}->${e.to}`; }
      }
      console.log(`        (worst unit-level edge gap: ${worst.toFixed(0)} world units, ${worstPair})`);
      if (worst > EDGE_MAX)
        throw new Error(`${worstPair} settles ${worst.toFixed(0)} world units apart at unit level (max ${EDGE_MAX})`);
    });

    check("groups: every region contains its members and regions never overlap", () => {
      const groups = d3.groups;
      if (!Array.isArray(groups) || groups.length !== 3)
        throw new Error(`expected 3 groups, got ${groups ? groups.length : "none"}`);
      for (const g of groups) {
        for (const mid of g.members) {
          const m = sById[mid];
          if (Math.abs(m.x - g.x) + m.hw > g.hw + 0.5 || Math.abs(m.y - g.y) + m.hh > g.hh + 0.5)
            throw new Error(`${mid} escapes region ${g.id}`);
        }
      }
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i], b = groups[j];
          const px = a.hw + b.hw - Math.abs(a.x - b.x);
          const py = a.hh + b.hh - Math.abs(a.y - b.y);
          if (px > 1 && py > 1)
            throw new Error(`regions ${a.id} and ${b.id} overlap by (${px.toFixed(1)}, ${py.toFixed(1)})`);
        }
      const titles = Object.fromEntries(groups.map((g) => [g.id, g.title]));
      if (titles["study-1"] !== "Study One" || titles["study-2"] !== "Study Two" || titles["study-3"] !== "study-3")
        throw new Error(`group titles wrong: ${JSON.stringify(titles)}`);
    });

    check("rest ink follows locality: long annotative edges retract, structural edges stay", () => {
      const max = d3.annotRestMax;
      if (typeof max !== "number") throw new Error("annotRestMax missing from __boardDebug");
      let retracted = 0, visible = 0;
      for (const e of d3.edges) {
        const A = sById[e.from], B = sById[e.to];
        const gap = Math.max(Math.abs(A.x - B.x) - (A.hw + B.hw), Math.abs(A.y - B.y) - (A.hh + B.hh));
        if (!e.annot) {
          if (!e.restVisible) throw new Error(`structural edge ${e.from}->${e.to} lost its resting ink`);
          continue;
        }
        if (gap > max && e.restVisible)
          throw new Error(`annotative edge ${e.from}->${e.to} keeps resting ink at gap ${gap.toFixed(0)} (max ${max})`);
        if (e.restVisible) visible++; else retracted++;
      }
      console.log(`        (annotative edges: ${visible} visible at rest, ${retracted} retracted)`);
      if (retracted === 0) throw new Error("fixture no longer produces any retracted edge — stress lost its teeth");
    });

    check("kiosk mode strips the page chrome", () => {
      if (!kiosk.headerHidden) throw new Error("header still visible under ?kiosk=1");
      if (!kiosk.introGone) throw new Error("board intro/breadcrumb still rendered under ?kiosk=1");
    });

    check("auto-play walks to the overview and signals done", () => {
      if (!kiosk.playDone) throw new Error("window.__boardPlayDone never became true");
    });

    check("edge chords rarely cross unrelated figures", () => {
      let crossings = 0;
      for (const e of d1.edges) {
        const ends = [[e.from, e.fromPin], [e.to, e.toPin]].map(([id, pin]) => {
          const b = byId[id];
          if (pin && b.type === "figure") {
            const p = b.pins.find((q) => q.id === pin);
            if (p) return pinWorld(b, p);
          }
          return b.type === "figure" ? { x: figRect(b).cx, y: figRect(b).cy } : { x: b.x, y: b.y };
        });
        for (const f of figs) {
          if (f.id === e.from || f.id === e.to) continue;
          if (segIntersectsRect(ends[0].x, ends[0].y, ends[1].x, ends[1].y, figRect(f))) crossings++;
        }
      }
      console.log(`        (edge-figure crossings on this fixture: ${crossings})`);
      if (crossings > 1) throw new Error(`${crossings} edges cross unrelated figures`);
    });
  } finally {
    if (browser) {
      await browser.send("Browser.close").catch(() => {});
      browser.close();
    }
    chromeProc.kill();
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5 });
  }

  console.log("");
  if (failed > 0) {
    console.error(`${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("All board checks passed.");
}

main().catch((err) => {
  console.error(`board-check crashed: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
