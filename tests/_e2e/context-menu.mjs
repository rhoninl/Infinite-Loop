#!/usr/bin/env bun
// Real-Chromium check that right-clicking the canvas opens a menu, and
// picking an item adds a node at the cursor's flow position.
// Picks an empty area that does NOT overlap any existing node so the
// browser reaches the canvas pane (not an xyflow node we deliberately skip).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3457';
const ARTIFACT_DIR = process.env.ARTIFACT_DIR ?? '/tmp/infloop-e2e';
mkdirSync(ARTIFACT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('[data-id="loop-1"]', { timeout: 15_000 });

// Count nodes before. xyflow renders each as a [data-id="…"] descendant of
// .react-flow__nodes; count there to avoid catching label/handle markup.
const before = await page.locator('.react-flow__node').count();

// First: right-click on an existing node and assert the menu does NOT open.
// This is the pane-only contract (Canvas.tsx:onCanvasContextMenu) — clicks
// on nodes/edges/handles/controls should leave the empty-canvas menu out
// so a future node-aware menu can claim those surfaces.
{
  const node = page.locator('[data-id="claude-1"]').first();
  await node.scrollIntoViewIfNeeded();
  await node.click({ button: 'right' });
  // Give React a beat to render any menu it would open.
  await page.waitForTimeout(150);
  const menuOnNode = await page
    .locator('[aria-label="canvas context menu"]')
    .count();
  if (menuOnNode > 0) {
    console.error(
      'FAILED: right-click on a node opened the empty-canvas menu (expected to skip)',
    );
    await page.screenshot({ path: `${ARTIFACT_DIR}/context-menu-on-node.png` });
    process.exit(1);
  }
}

// Pick an empty patch BELOW the existing graph — the workflow's nodes sit
// near y≈230-330 (loop body), so y=700 is well clear and inside the canvas.
const x = 700;
const y = 700;

await page.mouse.move(x, y);
await page.mouse.click(x, y, { button: 'right' });

// Menu should appear.
await page.waitForSelector('[aria-label="canvas context menu"]', { timeout: 5_000 });

await page.screenshot({ path: `${ARTIFACT_DIR}/context-menu-open.png` });

// The Palette also exposes an `add loop node` button — scope to the menu
// via the role="menuitem" added on context-menu items.
await page.locator('[role="menuitem"][aria-label="add loop node"]').click();

// Menu should close.
await page.waitForSelector('[aria-label="canvas context menu"]', {
  state: 'detached',
  timeout: 5_000,
});

// A new loop node should now exist. Verify count grew by 1.
const after = await page.locator('.react-flow__node').count();

await page.screenshot({ path: `${ARTIFACT_DIR}/context-menu-after.png` });

if (consoleLines.length) {
  console.log('console output (first 20):');
  for (const l of consoleLines.slice(0, 20)) console.log('  ' + l);
}

await browser.close();

console.log('node count before:', before, 'after:', after);

const fails = [];
if (after !== before + 1) {
  fails.push(`expected node count to grow by 1; got before=${before} after=${after}`);
}

if (fails.length) {
  console.error('FAILED:');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK — context menu added a node at the right-click position.');
