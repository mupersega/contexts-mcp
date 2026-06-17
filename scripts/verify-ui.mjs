// Playwright UI verification — reliable, headless, deterministic.
//   node scripts/verify-ui.mjs <baseUrl>
// Checks the connections panel (no strikethrough border, no overlap) and GFM
// task-list rendering (inline checkbox, no bullet), and writes screenshots.
import { chromium } from "playwright";
import fs from "fs";

const base = (process.argv[2] || fs.readFileSync("/tmp/demourl.txt", "utf8").trim()).replace(/\/$/, "");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`${base}/ctx/alpha-notes/readme`, { waitUntil: "networkidle" });

const styles = await page.evaluate(() => {
  const g = (el) => (el ? getComputedStyle(el) : null);
  const ca = document.querySelector("nav.doc-connections li a");
  const cb = document.querySelector(".doc-content input[type=checkbox]");
  const li = cb ? cb.closest("li") : null;
  return {
    connLinkBorderBottom: ca ? g(ca).borderBottomStyle : "NO-CONN",
    connLinkDisplay: ca ? g(ca).display : null,
    checkboxWidth: cb ? g(cb).width : "NO-CHECKBOX",
    checkboxAppearance: cb ? g(cb).appearance : null,
    taskLiListStyle: li ? g(li).listStyleType : "NO-LI",
  };
});

// Overlap check: do consecutive connections-panel items vertically overlap?
const overlap = await page.evaluate(() => {
  const items = [...document.querySelectorAll("nav.doc-connections li")];
  let overlaps = 0;
  const rows = items.map((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  for (let i = 0; i < rows.length - 1; i++) if (rows[i].bottom > rows[i + 1].top + 1) overlaps++;
  return { items: items.length, overlaps, rows };
});

const panel = await page.$("nav.doc-connections");
if (panel) await panel.screenshot({ path: "/tmp/conn-panel.png" });
await page.screenshot({ path: "/tmp/readme-full.png", fullPage: true });

console.log(JSON.stringify({ styles, overlap }, null, 2));
await browser.close();
