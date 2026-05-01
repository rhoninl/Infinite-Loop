#!/usr/bin/env bun
// Real-browser regression check for the Loop child-overlap bug.
// Loads /api/workflows/loop-claude-until-condition into the live page,
// reads the rendered xyflow node DOM rectangles, and verifies the children
// don't overlap and sit inside the Loop.

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3457';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? '/tmp/infloop-e2e';
import { mkdirSync } from 'node:fs';
mkdirSync(ARTIFACT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

// `networkidle` never settles because the page opens an SSE channel to
// /api/events that stays open for the lifetime of the tab. Wait for
// domcontentloaded then selector-poll for the rendered nodes instead.
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// Wait until the canvas and the three xyflow nodes we care about are mounted.
await page.waitForSelector('[data-id="loop-1"]', { timeout: 15_000 });
await page.waitForSelector('[data-id="claude-1"]', { timeout: 15_000 });
await page.waitForSelector('[data-id="cond-1"]', { timeout: 15_000 });
await page.waitForSelector('[data-id="end-1"]', { timeout: 15_000 });

const rects = await page.evaluate(() => {
  const ids = ['start-1', 'loop-1', 'claude-1', 'cond-1', 'end-1'];
  const out = {};
  for (const id of ids) {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (!el) { out[id] = null; continue; }
    const r = el.getBoundingClientRect();
    out[id] = { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }
  return out;
});

console.log('rects:', JSON.stringify(rects, null, 2));

await page.screenshot({ path: `${ARTIFACT_DIR}/loop-layout.png`, fullPage: false });

const fails = [];
const overlaps = (a, b) =>
  a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;

if (overlaps(rects['claude-1'], rects['cond-1'])) {
  fails.push('claude-1 overlaps cond-1 (the original bug)');
}
if (overlaps(rects['loop-1'], rects['end-1'])) {
  fails.push('loop-1 overlaps end-1 (the regression we just introduced)');
}

// Children must sit inside their parent Loop's bbox (allow ~1px slack for AA).
const inside = (child, parent) =>
  child && parent &&
  child.x >= parent.x - 1 &&
  child.right <= parent.right + 1 &&
  child.y >= parent.y - 1 &&
  child.bottom <= parent.bottom + 1;
if (!inside(rects['claude-1'], rects['loop-1'])) {
  fails.push('claude-1 is not contained inside loop-1');
}
if (!inside(rects['cond-1'], rects['loop-1'])) {
  fails.push('cond-1 is not contained inside loop-1');
}

if (consoleLines.length) {
  console.log('console output (first 20):');
  for (const l of consoleLines.slice(0, 20)) console.log('  ' + l);
}

await browser.close();

if (fails.length) {
  console.error('\nFAILED:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nOK — no overlap, children contained inside Loop.');
