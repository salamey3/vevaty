// Renders the brand assets that contain type, from scripts/brand/wordmark.html.
//
// Kept separate from generate-brand-assets.mjs because these need a browser:
// rasterising the wordmark means shaping real text in a real font, and
// Arabic in particular needs contextual shaping that a plain SVG rasteriser
// will not do. Everything else in the brand is pure geometry and does not.
//
//   node scripts/brand/render-wordmark.mjs
//
// Requires playwright and @fontsource/cairo. Both are devDependencies, so
// the fonts resolve from node_modules rather than a CDN and the output is
// stable across machines.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'assets', 'brand');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('\nplaywright is not installed.\n  npm install --save-dev playwright && npx playwright install chromium\n');
  process.exit(1);
}

// Each plate is screenshotted at its own CSS size x2, so the PNGs are
// retina-ready without anyone having to remember to double the numbers.
const PLATES = [
  ['logo-en',      'logo-en.png'],
  ['logo-en-dark', 'logo-en-dark.png'],
  ['logo-ar',      'logo-ar.png'],
  ['logo-ar-dark', 'logo-ar-dark.png'],
  ['og',           'share-image.png'],
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(HERE, 'wordmark.html')).href, { waitUntil: 'load' });

// font-display:block plus an explicit wait: screenshotting before the
// webfont settles silently produces a fallback-font logo, which looks
// almost right and is completely wrong.
await page.evaluate(() => document.fonts.ready);
const loaded = await page.evaluate(() =>
  [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`)
);
if (!loaded.some((f) => f.startsWith('Cairo'))) {
  console.error('Cairo did not load - the output would silently use a fallback font. Aborting.');
  await browser.close();
  process.exit(1);
}

console.log('\nBrand type assets -> assets/brand/\n');
for (const [id, file] of PLATES) {
  const el = await page.$(`#${id}`);
  if (!el) { console.error(`  missing plate #${id}`); continue; }
  const out = path.join(OUT, file);
  await el.screenshot({ path: out, omitBackground: file !== 'share-image.png' });
  console.log(`  ${file.padEnd(22)} ${(fs.statSync(out).size / 1024).toFixed(1).padStart(7)} KB`);
}

await browser.close();
console.log('');
