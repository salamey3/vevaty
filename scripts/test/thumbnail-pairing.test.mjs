// Does a 360 set keep its small copies through a save?
//
//   node scripts/test/spin-thumbnails.test.mjs
//
// Run directly, NOT via an npm script -- see upload-retry.test.mjs's own
// comment for why (@expo/fingerprint + package.json's "scripts" block).
//
// The bug this exists to keep closed was invisible by construction.
// writeSpinSets rewrites every frame of every set on EVERY save from Edit
// -- a price change included -- and it used to write each already-hosted
// frame's own 1600px url into thumbnail_url, on the reasoning that a kept
// frame had no thumbnail to keep. It did: `previewFrames` comes back off
// the rows with the set (AppStore), entry for entry, and the edit form is
// still holding it when it calls this. So one price change quietly swapped
// a 24-frame spin's card preview to full-size originals -- roughly 180MB
// of Android bitmap heap for a picture drawn 350 points wide -- and the
// next save did it again, so it never recovered on its own.
//
// Nothing about that is visible to the seller, the buyer or the logs. Only
// the bytes change. Hence a test.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'listingMedia.test.mjs');
const SRC = path.join(ROOT, 'src');

// Matched by where an import RESOLVES, not by how it was spelled -- see
// AGENTS.md, "A test that never builds is a test that never fails". Two
// test files in this directory had been dying in esbuild for weeks because
// one module was reached by two different spellings.
const stub = (name, contents) => {
  const bare = !name.startsWith('.');
  const target = bare ? null : path.resolve(SRC, 'lib', name);
  const EXTS = ['', '.ts', '.tsx', '.js'];
  return {
    name: `stub-${name}`,
    setup(build) {
      if (bare) {
        const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
        build.onResolve({ filter: new RegExp(`^${esc}$`) }, () => ({ path: name, namespace: 'stub' }));
      } else {
        build.onResolve({ filter: /^\./ }, (a) => {
          const resolved = path.resolve(path.dirname(a.importer), a.path);
          return EXTS.some((e) => resolved + e === target || resolved === target + e)
            ? { path: name, namespace: 'stub' }
            : undefined;
        });
      }
      build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) =>
        a.path === name ? { contents, loader: 'js' } : undefined
      );
    },
  };
};

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/listingMedia.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
  define: { __DEV__: 'false' },
  plugins: [
    // Records every photo row written, which is the whole subject here.
    stub('./supabase', `
      let setSeq = 0;
      function builder(table) {
        const b = {
          insert(payload) {
            if (table === 'listing_spin_sets') {
              b._row = { id: 'set-' + (++setSeq), ...payload };
            } else {
              (globalThis.__ROWS__ ||= []).push(...(Array.isArray(payload) ? payload : [payload]));
            }
            return b;
          },
          select() { return b; },
          delete() { return b; },
          eq() { return b; },
          in() { return b; },
          order() { return b; },
          limit() { return b; },
          single() { return Promise.resolve({ data: b._row ?? null, error: null }); },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          // insertPhotoRows asks "did the batch already land?" before
          // writing. Answering [] means no, which is the ordinary case.
          then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
        };
        return b;
      }
      export const supabase = { from: (t) => builder(t) };
    `),
    // Every local frame uploads, and the thumbnail is distinguishable from
    // the full-size url so the test can tell which one was written.
    stub('./photoUpload', `
      export async function uploadPhotosWithThumbnails(uris) {
        return uris.map((u) => ({
          uri: u,
          url: 'https://cdn.test/full/' + u,
          thumbnailUrl: 'https://cdn.test/thumb/' + u,
        }));
      }
    `),
  ],
});

const { writeSpinSets } = await import(OUT);

// The pure half: the pairing decision itself, which five places now share
// (lib/thumbnailPairing.ts) -- the gallery's photos/photoThumbnails and a
// 360 set's frames/previewFrames are the same two-arrays-by-index shape,
// and the same bug happened to both. No stubs needed: it imports nothing.
const PURE = path.join(ROOT, 'node_modules', '.cache', 'thumbnailPairing.test.mjs');
await esbuild.build({
  entryPoints: [path.join(SRC, 'lib/thumbnailPairing.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: PURE, logLevel: 'error',
});
const { sameList, carryThumbnails, thumbnailsFor, thumbnailAt } = await import(PURE);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const run = async (set) => {
  globalThis.__ROWS__ = [];
  await writeSpinSets('listing-1', [set]);
  return globalThis.__ROWS__;
};

// A spin read back off the database: hosted frames, and the small copies
// that came back with them.
const hosted = (n) => Array.from({ length: n }, (_, i) => `https://cdn.test/full/f${i}.jpg`);
const thumbs = (n) => Array.from({ length: n }, (_, i) => `https://cdn.test/thumb/f${i}.jpg`);

// 1. THE BUG. An untouched set re-saved by a price change.
{
  const rows = await run({ id: 's1', label: '360', frames: hosted(4), previewFrames: thumbs(4) });
  check('an untouched set writes 4 frames', rows.length === 4, String(rows.length));
  check('  ...and keeps every small copy',
    rows.every((r, i) => r.thumbnail_url === `https://cdn.test/thumb/f${i}.jpg`),
    JSON.stringify(rows.map((r) => r.thumbnail_url)));
  check('  ...without disturbing the full-size urls',
    rows.every((r, i) => r.url === `https://cdn.test/full/f${i}.jpg`));
  check('  ...in frame order', rows.every((r, i) => r.sort_order === i));
}

// 2. A mixed set: frames kept, frames added. The index into `frames` and
//    the index into the kept subset diverge here, which is exactly where a
//    naive fix cross-wires one frame's thumbnail onto another.
{
  const rows = await run({
    id: 's2',
    label: '360',
    frames: ['https://cdn.test/full/a.jpg', 'local-b.jpg', 'https://cdn.test/full/c.jpg'],
    previewFrames: ['https://cdn.test/thumb/a.jpg', 'ignored', 'https://cdn.test/thumb/c.jpg'],
  });
  const byUrl = Object.fromEntries(rows.map((r) => [r.url, r.thumbnail_url]));
  check('mixed set writes all 3 frames', rows.length === 3, String(rows.length));
  check('  ...kept frame a keeps ITS thumbnail, not c’s',
    byUrl['https://cdn.test/full/a.jpg'] === 'https://cdn.test/thumb/a.jpg',
    byUrl['https://cdn.test/full/a.jpg']);
  check('  ...kept frame c keeps ITS thumbnail',
    byUrl['https://cdn.test/full/c.jpg'] === 'https://cdn.test/thumb/c.jpg',
    byUrl['https://cdn.test/full/c.jpg']);
  check('  ...the new frame gets the one the upload made',
    byUrl['https://cdn.test/full/local-b.jpg'] === 'https://cdn.test/thumb/local-b.jpg',
    byUrl['https://cdn.test/full/local-b.jpg']);
}

// 3. previewFrames of the wrong length is not trusted at all. A retake
//    that changed the frame count would otherwise pair the new frames
//    against the old spin's thumbnails.
{
  const rows = await run({ id: 's3', label: '360', frames: hosted(3), previewFrames: thumbs(2) });
  check('a mismatched previewFrames is ignored whole',
    rows.every((r) => r.thumbnail_url === r.url),
    JSON.stringify(rows.map((r) => r.thumbnail_url)));
}

// 4. No previewFrames at all -- a set posted before they existed, or built
//    by the admin auction screen. The frame stands in for its own, which
//    is what the reader falls back to anyway.
{
  const rows = await run({ id: 's4', label: '360', frames: hosted(3) });
  check('no previewFrames falls back to the frame itself',
    rows.every((r) => r.thumbnail_url === r.url));
}

// 5. One empty entry inside an otherwise good array. A row written before
//    spin thumbnails existed has null here.
{
  const pv = thumbs(3);
  pv[1] = '';
  const rows = await run({ id: 's5', label: '360', frames: hosted(3), previewFrames: pv });
  check('an empty entry falls back for that frame only',
    rows[0].thumbnail_url === 'https://cdn.test/thumb/f0.jpg' &&
    rows[1].thumbnail_url === rows[1].url &&
    rows[2].thumbnail_url === 'https://cdn.test/thumb/f2.jpg',
    JSON.stringify(rows.map((r) => r.thumbnail_url)));
}

// 6. A brand-new spin: every frame local. Nothing to keep, everything
//    freshly made.
{
  const rows = await run({ id: 's6', label: '360', frames: ['x.jpg', 'y.jpg'] });
  check('a new spin gets real thumbnails for every frame',
    rows.length === 2 && rows.every((r) => r.thumbnail_url.includes('/thumb/')),
    JSON.stringify(rows.map((r) => r.thumbnail_url)));
  check('  ...and they are not the full-size urls',
    rows.every((r) => r.thumbnail_url !== r.url));
}

// ---- the pairing decision, on its own (gallery AND spin) ----

// 7. Continue without retaking: the frames are the same, so the small
//    copies still describe them and are worth keeping.
{
  const items = ['a', 'b'];
  const thumbs = ['ta', 'tb'];
  check('untouched items keep their thumbnails',
    JSON.stringify(carryThumbnails(items, thumbs, ['a', 'b'])) === JSON.stringify(['ta', 'tb']));
  check('  ...as a copy, not the same array',
    carryThumbnails(items, thumbs, ['a', 'b']) !== thumbs);
}

// 8. THE RETAKE. Same count, different photographs -- the case nothing
//    downstream could detect, because both arrays are length 2.
{
  const items = ['a', 'b'];
  const thumbs = ['ta', 'tb'];
  check('a swap keeping the SAME count drops the old thumbnails',
    carryThumbnails(items, thumbs, ['x', 'y']) === undefined,
    JSON.stringify(carryThumbnails(items, thumbs, ['x', 'y'])));
  check('a different count drops them too',
    carryThumbnails(items, thumbs, ['x', 'y', 'z']) === undefined);
  check('A REORDER of the same items drops them',
    carryThumbnails(items, thumbs, ['b', 'a']) === undefined);
}

// 9. A set that never had any.
{
  check('nothing to carry stays nothing',
    carryThumbnails(['a'], undefined, ['a']) === undefined);
}

// 10. The reader.
{
  check('thumbnailsFor uses the small copies when they pair',
    JSON.stringify(thumbnailsFor(['a', 'b'], ['ta', 'tb'])) === JSON.stringify(['ta', 'tb']));
  check('thumbnailsFor falls back WHOLE on a length mismatch',
    JSON.stringify(thumbnailsFor(['a', 'b'], ['ta'])) === JSON.stringify(['a', 'b']));
  check('thumbnailsFor with none draws the items',
    JSON.stringify(thumbnailsFor(['a'], undefined)) === JSON.stringify(['a']));
  check('thumbnailsFor on nothing is empty', thumbnailsFor([], undefined).length === 0);
}

// 11. keptFrameThumbnail indexes into the SET's frames, which is the
//     whole point of taking the set rather than the filtered subset.
{
  const items = ['a', 'b', 'c'];
  const thumbs = ['ta', 'tb', 'tc'];
  check('thumbnailAt pairs by the FULL list\u2019s own index',
    thumbnailAt(items, thumbs, 2) === 'tc', thumbnailAt(items, thumbs, 2));
  check('  ...and refuses a mismatched array',
    thumbnailAt(['a', 'b'], ['ta'], 0) === 'a');
}

// 12. sameList, since both of the above rest on it.
{
  check('sameList: order counts', sameList(['a', 'b'], ['b', 'a']) === false);
  check('sameList: length counts', sameList(['a'], ['a', 'a']) === false);
  check('sameList: equal is equal', sameList(['a', 'b'], ['a', 'b']) === true);
  check('sameList: empty is empty', sameList([], []) === true);
}

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log();
console.log(allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
