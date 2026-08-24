// Exercises pickNextBanner (src/lib/bannerShuffle.ts) directly against
// real inputs -- the "shuffle bag" selection BannerStore.tsx's reroll()
// calls on every focus-triggered reroll (see that file's own doc comment,
// and the "Vevaty — Managed Banner Placements" design spec, Section 5.1).
// A pure function with zero runtime imports, so this needs no React/
// Supabase stubbing -- straight esbuild + import, same shape as
// ai-attribute-validation.test.mjs.
//
//   node scripts/test/banner-shuffle.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs's
// own comment for why (@expo/fingerprint + package.json's "scripts" block).
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'bannerShuffle.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/bannerShuffle.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
});

const { pickNextBanner } = await import(OUT);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// --- edge cases: nothing active, exactly one active ---
{
  const r = pickNextBanner([], null, null);
  check('no active banners -> null id, null state', r.id === null && r.state === null);
}
{
  const r = pickNextBanner(['only'], null, null);
  check(
    'exactly one active banner -> always that one, trivially (nothing to shuffle or avoid repeating)',
    r.id === 'only' && r.state.order.length === 1 && r.state.index === 1
  );
}

// --- sequential-draw helper: feeds each call's own returned state/id back
// in as the next call's prev/lastShownId, exactly like BannerStore's refs do.
function runSequence(activeIds, draws, random = Math.random) {
  let state = null;
  let last = null;
  const seq = [];
  for (let i = 0; i < draws; i++) {
    const { id, state: next } = pickNextBanner(activeIds, state, last, random);
    seq.push(id);
    state = next;
    last = id;
  }
  return seq;
}

// --- never the same banner twice in a row, over many real-random draws ---
{
  const ids = ['a', 'b', 'c', 'd'];
  const seq = runSequence(ids, 4000);
  let noAdjacentRepeat = true;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) noAdjacentRepeat = false;
  }
  check('never shows the same banner twice in a row, across 4000 real-random draws', noAdjacentRepeat);

  // Equal exposure isn't just probable here, it's structurally guaranteed:
  // every complete bag contains each id exactly once, so over a
  // draw-count that's an exact multiple of the active set's size, every
  // id's total count must come out identical -- an exact check, not a
  // statistical one, so this can never flake.
  const counts = {};
  for (const id of seq) counts[id] = (counts[id] || 0) + 1;
  const expected = 4000 / ids.length;
  const exact = ids.every((id) => counts[id] === expected);
  check(
    `equal exposure: every id shown exactly ${expected} times over 4000 draws (shuffle-bag guarantee, not a statistical average)`,
    exact,
    JSON.stringify(counts)
  );
}

// --- reshuffle boundary: the new bag's first pick must never equal
// whatever was shown last, even when the underlying "random" source is
// degenerate (always 0) and would otherwise hand back the same id twice
// in a row right across the seam between an exhausted bag and a fresh one.
{
  const zeroRandom = () => 0;
  const ids = ['x', 'y', 'z'];
  // What a fresh shuffle of these ids naturally produces under zeroRandom
  // -- computed once so both branches below can assert against it instead
  // of hardcoding a number that would silently go stale if shuffled()'s
  // internals ever changed.
  const { id: naturalFirstPick } = pickNextBanner(ids, null, null, zeroRandom);

  // An already-exhausted bag (index === order.length) forces a fresh
  // shuffle on the next call regardless of its own contents -- only
  // `lastShownId` matters for what happens next, so it can be any
  // placeholder bag.
  const exhausted = { order: ids.slice(), index: ids.length };

  const matching = pickNextBanner(ids, exhausted, naturalFirstPick, zeroRandom);
  check(
    'when the fresh shuffle would naturally repeat lastShownId, it swaps that pick away',
    matching.id !== naturalFirstPick,
    `naturalFirstPick=${naturalFirstPick} got=${matching.id}`
  );

  const nonMatching = pickNextBanner(ids, exhausted, 'not-the-natural-pick', zeroRandom);
  check(
    'when lastShownId does NOT collide with the fresh shuffle, no swap happens (same seed -> same natural order)',
    nonMatching.id === naturalFirstPick,
    `naturalFirstPick=${naturalFirstPick} got=${nonMatching.id}`
  );
}

// --- an active-set change (banners scheduled in/out between rerolls)
// discards a mid-bag, not-yet-exhausted state rather than reusing it ---
{
  const idsA = ['p', 'q', 'r'];
  const first = pickNextBanner(idsA, null, null);
  // Only 1 of 3 drawn from idsA's bag -- then the active set changes
  // entirely before the bag ran out. BannerStore rebuilds activeIds fresh
  // on every reroll from whatever is_active/in-window right now, so this
  // is a real case (a banner's schedule lapsing mid-session), not just a
  // hypothetical.
  const idsB = ['m', 'n'];
  const second = pickNextBanner(idsB, first.state, first.id);
  check('an active-set change forces a fresh bag scoped to the new set', idsB.includes(second.id));
}

// --- pure / dependency-free: doesn't mutate its own inputs ---
{
  const frozenIds = Object.freeze(['a', 'b', 'c']);
  let threw = false;
  try {
    pickNextBanner(frozenIds, null, null);
  } catch (e) {
    threw = true;
  }
  check('does not mutate the activeIds array it was given', !threw);
}

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
