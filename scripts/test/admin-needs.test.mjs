// Exercises needsYou/expectedNeeds (src/lib/adminNeeds.ts) -- what the admin
// dashboard's "Needs you" strip shows, and the one case that is invisible on
// screen and matters most: a count that never came back must not be read as
// zero, and must stop the panel claiming nothing needs you.
//
// A pure function with no runtime imports, so no React/Supabase stubbing --
// same shape as banner-shuffle.test.mjs.
//
//   node scripts/test/admin-needs.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs's
// own comment for why (@expo/fingerprint + package.json's "scripts" block).
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'adminNeeds.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/adminNeeds.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
});

const { needsYou, expectedNeeds, NEED_ORDER } = await import(OUT);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const ALL_ZERO_NO_AUCTIONS = { moderation: 0, reports: 0, shops: 0, problems: 0 };

// --- nothing has come back yet ---
{
  const { needs, allClear } = needsYou({}, false);
  check('nothing counted yet shows no lines', needs.length === 0);
  check('nothing counted yet does NOT claim all clear', allClear === false,
    'this is the load state; claiming clear here would be a lie every time the panel opens');
}

// --- everything came back, all zero ---
{
  const { needs, allClear } = needsYou(ALL_ZERO_NO_AUCTIONS, false);
  check('all four zero shows no lines', needs.length === 0);
  check('all four zero DOES claim all clear', allClear === true);
}

// --- the failed-count case, which is the whole reason this is a module ---
{
  // moderation refused; the other three came back zero.
  const { needs, allClear } = needsYou({ reports: 0, shops: 0, problems: 0 }, false);
  check('a refused count shows no line for itself', needs.length === 0);
  check('a refused count blocks "nothing needs you"', allClear === false,
    'three zeroes and one unknown is not four zeroes');
}
{
  // moderation refused, but a report is genuinely waiting.
  const { needs, allClear } = needsYou({ reports: 3, shops: 0, problems: 0 }, false);
  check('a refused count still lets the others show', needs.length === 1 && needs[0].key === 'reports');
  check('a real count alongside a refused one is not all clear', allClear === false);
}

// --- zero never renders a line ---
{
  const { needs } = needsYou({ moderation: 0, reports: 2, shops: 0, problems: 0 }, false);
  check('a zero count renders no line', needs.length === 1 && needs[0].key === 'reports');
  check('the line carries its count', needs[0].count === 2);
}

// --- ranking ---
{
  const { needs } = needsYou({ problems: 9, shops: 1, reports: 4, moderation: 2 }, false);
  check('ranked by cost of leaving it, not by size',
    needs.map((n) => n.key).join(',') === 'moderation,reports,shops,problems',
    needs.map((n) => `${n.key}:${n.count}`).join(' '));
}

// --- auctions off ---
{
  check('consignments is not expected while auctions are off',
    expectedNeeds(false).includes('consignments') === false);
  check('the other four are always expected',
    expectedNeeds(false).join(',') === 'moderation,reports,shops,problems');
  // A count left over in state from before the switch was flipped off.
  const { needs, allClear } = needsYou({ ...ALL_ZERO_NO_AUCTIONS, consignments: 7 }, false);
  check('a stale consignments count shows no line while auctions are off', needs.length === 0,
    'the section does not exist for buyers, so the queue is not the admin’s problem');
  check('a stale consignments count does not block all clear', allClear === true);
}

// --- auctions on ---
{
  check('consignments is expected while auctions are on',
    expectedNeeds(true).includes('consignments') === true);
  const waiting = needsYou({ ...ALL_ZERO_NO_AUCTIONS, consignments: 2 }, true);
  check('consignments shows while auctions are on',
    waiting.needs.length === 1 && waiting.needs[0].key === 'consignments' && waiting.needs[0].count === 2);
  const notYet = needsYou(ALL_ZERO_NO_AUCTIONS, true);
  check('auctions on and consignments not counted yet is not all clear', notYet.allClear === false,
    'four of five answered');
  const all = needsYou({ ...ALL_ZERO_NO_AUCTIONS, consignments: 0 }, true);
  check('auctions on and all five zero IS all clear', all.allClear === true);
}

// --- every entry is wired, so a new queue cannot be added half-way ---
{
  check('every need has a label key', NEED_ORDER.every((n) => /^admin\.needs\./.test(n.label)));
  check('every need has a route', NEED_ORDER.every((n) => /^Admin/.test(n.route)));
  check('no duplicate keys', new Set(NEED_ORDER.map((n) => n.key)).size === NEED_ORDER.length);
  check('no duplicate routes', new Set(NEED_ORDER.map((n) => n.route)).size === NEED_ORDER.length);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail && !r.ok ? `\n        ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
