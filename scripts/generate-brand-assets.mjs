// Regenerates every brand asset in assets/ from the spec in BRANDING.md.
//
// Nothing in assets/ is drawn by hand. There is exactly one piece of source
// geometry (scripts/brand/mark.svg) and one set of colour tokens (below,
// mirroring BRANDING.md part 3); every icon, favicon and splash file is a
// rasterisation of those. Editing a PNG directly works right up until the
// next person runs this script and silently reverts it.
//
//   npm run brand
//
// Assets containing TYPE (the logos and the share image) are not built
// here -- they need a real font and a text engine, so they come from
// scripts/brand/wordmark.html rendered in a browser. See BRANDING.md.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const MARK = fs.readFileSync(path.join(ROOT, 'scripts/brand/mark.svg'), 'utf8');

// BRANDING.md part 3. Keep in step with src/theme/theme.ts.
const PRIMARY = '#0F3D2E';
const BG = '#F4F3EE';

// BRANDING.md part 5: Android's adaptive icon only guarantees the central
// 66% circle survives masking, so the mark occupies 52% of the canvas and
// clears every launcher shape with room to spare.
const MARK_SCALE = 0.52;

/** The mark alone, in `color`, on a transparent square of `size`. */
function markSvg(size, color, scale = MARK_SCALE) {
  const inner = Math.round(size * scale);
  const offset = Math.round((size - inner) / 2);
  const body = MARK
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .replace(/currentColor/g, color);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<g transform="translate(${offset} ${offset}) scale(${inner / 64})">${body}</g>` +
    `</svg>`
  );
}

/** A flat colour square. */
function solidSvg(size, color) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" fill="${color}"/>` +
    `</svg>`
  );
}

async function write(name, buf) {
  const out = path.join(ASSETS, name);
  await fs.promises.writeFile(out, buf);
  const { size } = await fs.promises.stat(out);
  console.log(`  ${name.padEnd(34)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
}

console.log('\nBrand assets -> assets/\n');

// ---- iOS / store icon -------------------------------------------------
// Deliberately flattened onto an opaque background with no rounded
// corners: iOS applies its own mask, and a pre-rounded PNG gets rounded
// twice, leaving pale wedges in the corners. The App Store also rejects
// icons with an alpha channel.
// removeAlpha() is not redundant next to flatten(): flatten composites the
// transparency away but leaves an (all-opaque) alpha channel on the output,
// and App Store Connect rejects any icon that HAS an alpha channel, whether
// or not it is used. Verified by reading the channel count back.
await write('icon.png', await sharp(solidSvg(1024, PRIMARY))
  .composite([{ input: await sharp(markSvg(1024, '#ffffff')).png().toBuffer() }])
  .flatten({ background: PRIMARY })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toBuffer());

// ---- Android adaptive icon -------------------------------------------
// Two separate layers; the launcher composites and masks them itself.
await write('android-icon-background.png', await sharp(solidSvg(512, PRIMARY))
  .png({ compressionLevel: 9 }).toBuffer());

await write('android-icon-foreground.png', await sharp(markSvg(512, '#ffffff'))
  .png({ compressionLevel: 9 }).toBuffer());

// ---- Android 13+ themed icon -----------------------------------------
// The system throws the colours away and re-tints the silhouette to the
// user's wallpaper, so this must be a solid shape on transparent with no
// colour of its own. Only the outline survives -- which is exactly why the
// mark's V and eyelet are real holes rather than white fills.
await write('android-icon-monochrome.png', await sharp(markSvg(432, '#000000'))
  .png({ compressionLevel: 9 }).toBuffer());

// ---- Splash ----------------------------------------------------------
// BRANDING.md part 6: the splash is CREAM, matching the colour the app
// opens into, so there is no dark-to-light flash. Expo composites this
// icon over the configured background, so the file itself is the mark in
// green on transparent.
await write('splash-icon.png', await sharp(markSvg(1024, PRIMARY, 0.42))
  .png({ compressionLevel: 9 }).toBuffer());

// ---- Favicon ---------------------------------------------------------
// A green tile rather than the bare mark: at 16px the tile is what makes
// it read as an object instead of a smudge (BRANDING.md part 6).
const favicon = (size) => sharp(solidSvg(size, PRIMARY))
  .composite([{ input: markSvg(size, '#ffffff', 0.62) }])
  .png({ compressionLevel: 9 })
  .toBuffer();

await write('favicon.png', await favicon(48));

// Multi-resolution .ico -- browsers pick a size per context, and a
// single-size icon gets scaled badly in bookmark bars and history lists.
const icoSizes = [16, 32, 48];
const pngs = await Promise.all(icoSizes.map(favicon));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const dir = pngs.map((png, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 0);
  e.writeUInt8(icoSizes[i] === 256 ? 0 : icoSizes[i], 1);
  e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
await write('favicon.ico', Buffer.concat([header, ...dir, ...pngs]));

console.log('\nDone. Assets containing type (logos, share image) come from');
console.log('scripts/brand/wordmark.html -- see BRANDING.md.\n');
