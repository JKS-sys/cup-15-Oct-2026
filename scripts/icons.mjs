// Renders the light and dark app icons to PNG with Chromium (run once when the icon changes).
// Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
for (const v of ['dark', 'light']) {
  await p.setContent(`<html><body style="margin:0;background:transparent">${readFileSync(`assets/icon-${v}.svg`, 'utf8')}</body></html>`);
  await p.screenshot({ path: `assets/icon-${v}.png`, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
}
await b.close();
