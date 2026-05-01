#!/usr/bin/env bun
// Visual check that the not_met handle on a condition node is yellow,
// distinct from the red `error` handle right next to it.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3457';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? '/tmp/infloop-e2e';
mkdirSync(ARTIFACT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('[data-id="cond-1"]', { timeout: 15_000 });

// Read computed background colors for the three condition handles.
const colors = await page.evaluate(() => {
  const cond = document.querySelector('[data-id="cond-1"]');
  if (!cond) return null;
  const ids = ['met', 'not_met', 'error'];
  const out = {};
  for (const id of ids) {
    const h = cond.querySelector(`[data-handleid="${id}"]`);
    if (!h) { out[id] = null; continue; }
    out[id] = getComputedStyle(h).backgroundColor;
  }
  return out;
});
console.log('handle colors:', JSON.stringify(colors, null, 2));

await page.screenshot({
  path: `${ARTIFACT_DIR}/handle-color.png`,
  fullPage: false,
  clip: { x: 700, y: 200, width: 500, height: 200 },
});

await browser.close();

// Distinct colors on all three? not_met must differ from error.
const fails = [];
if (!colors) fails.push('cond-1 not found');
else {
  if (!colors.not_met) fails.push('not_met handle missing');
  if (!colors.error) fails.push('error handle missing');
  if (colors.not_met && colors.error && colors.not_met === colors.error) {
    fails.push(`not_met and error are the same color: ${colors.error}`);
  }
}

if (fails.length) {
  console.error('FAILED:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK — not_met has a distinct color from error.');
