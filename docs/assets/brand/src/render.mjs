// Renders the MainStreet AI brand files from brand.html into docs/assets/brand/.
// Run from the repo root: node docs/assets/brand/src/render.mjs
// The three phone screens (s1-share, s2-found, s3-job) are captures of the live prototype at 390 x 844, 3x, dark.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../../web/package.json'));
const { chromium } = require('@playwright/test');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();
await pg.goto('file://' + path.join(here, 'brand.html'), { waitUntil: 'networkidle' });
await pg.evaluate(() => document.fonts.ready);
await pg.waitForTimeout(800);
for (const id of ['banner', 'icon', 'wordmark-dark', 'wordmark-light']) {
  await pg.locator('#' + id).screenshot({ path: path.join(here, '..', id + '.png'), omitBackground: true });
}
await b.close();
