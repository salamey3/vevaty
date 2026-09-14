// Exercises the arithmetic behind choices with prices (src/lib/listingOptions.ts)
// against the SAME figures myazar.send_listing_order produced in its own
// rolled-back harness. That agreement is the point of this file: the total
// is worked out twice, once on the phone so the buyer can watch it build
// and once on the server so the card in the chat cannot be lied to, and a
// number that changes when the buyer taps Send is a number nobody trusts.
//
//   node scripts/test/listing-options.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs's
// own comment for why (@expo/fingerprint + package.json's "scripts" block).
//
// listingOptions.ts imports the Supabase client for its four server calls,
// which would drag React Native into the bundle; the plugin below swaps it
// for a stub. Nothing here touches the network.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'listingOptions.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/listingOptions.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
  plugins: [{
    name: 'stub-supabase',
    setup(build) {
      build.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase-stub', namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const supabase = { rpc: async () => ({ data: null, error: null }) };',
        loader: 'js',
      }));
    },
  }],
});

const {
  parseListingOptions, totalsFor, whyNotOrderable, togglePick, setAnswer, prunePicks,
  parseOrderSnapshot, money, extraLabel, EMPTY_OPTIONS, groupsToBody, bodyToGroups,
} = await import(OUT);

const results = [];
const check = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  results.push({ name, ok: a === b, detail: a === b ? '' : `got ${a}, want ${b}` });
};

// Exactly the jsonb myazar.listing_options returns for the baby-cast
// listing the SQL harness built -- numbers arrive as JSON strings.
const raw = {
  min_qty: 1,
  groups: [
    { id: 'g1', title: 'Size', pick: 'one', required: true, options: [
      { id: 'o1', label: 'One hand', extra: '0.00', per: 'item', ask: null, ask_required: false },
      { id: 'o2', label: 'Hands + feet', extra: '50.00', per: 'item', ask: null, ask_required: false }] },
    { id: 'g2', title: 'Base', pick: 'one', required: false, options: [
      { id: 'o3', label: 'White wood', extra: '0.00', per: 'item', ask: null, ask_required: false },
      { id: 'o4', label: 'Dark wood', extra: '10.00', per: 'item', ask: null, ask_required: false }] },
    { id: 'g3', title: 'Add-ons', pick: 'any', required: false, options: [
      { id: 'o5', label: 'Name engraved', extra: '8.00', per: 'item', ask: 'Name to engrave', ask_required: true },
      { id: 'o6', label: 'Delivery', extra: '30.00', per: 'order', ask: null, ask_required: false }] },
  ],
};
const opts = parseListingOptions(raw);

check('three groups parsed', opts.groups.length, 3);
check('numeric strings become numbers', opts.groups[0].options[1].extra, 50);
check('per-order read', opts.groups[2].options[1].per, 'order');
check('question read', opts.groups[2].options[0].ask, 'Name to engrave');

// --- the number the server produced: 60 x (60 + 50 + 10 + 8) + 30 -------
check('agrees with send_listing_order', totalsFor(60, opts, { o2: '', o4: '', o5: 'Sara', o6: '' }, 60),
  { perItem: 128, perOrder: 30, qty: 60, total: 7710 });
check('one piece', totalsFor(60, opts, { o2: '' }, 1), { perItem: 110, perOrder: 0, qty: 1, total: 110 });
check('delivery is charged once, not sixty times',
  totalsFor(60, opts, { o2: '', o6: '' }, 60).total, 60 * 110 + 30);
check('nothing ticked', totalsFor(60, opts, {}, 3), { perItem: 60, perOrder: 0, qty: 3, total: 180 });
check('a free choice adds nothing', totalsFor(60, opts, { o1: '' }, 2).total, 120);
check('a free listing with a per-order fee', totalsFor(0, opts, { o6: '' }, 5).total, 30);
check('the cap', totalsFor(60, opts, { o2: '' }, 999).total, 999 * 110);
check('quantity floors at one', totalsFor(60, opts, {}, 0).qty, 1);
check('a listing with no choices at all', totalsFor(45, EMPTY_OPTIONS, {}, 1).total, 45);

// --- what holds Send ----------------------------------------------------
check('a required group unanswered', whyNotOrderable(opts, {}, 1),
  { kind: 'group', groupId: 'g1', groupTitle: 'Size' });
check('a required question left blank', whyNotOrderable(opts, { o2: '', o5: '  ' }, 1),
  { kind: 'answer', choiceLabel: 'Name engraved', ask: 'Name to engrave' });
check('answered', whyNotOrderable(opts, { o2: '', o5: 'Sara' }, 1), null);
check('under the minimum', whyNotOrderable({ ...opts, minQty: 20 }, { o2: '' }, 5),
  { kind: 'quantity', minQty: 20 });
check('at the minimum', whyNotOrderable({ ...opts, minQty: 20 }, { o2: '' }, 20), null);
check('over the cap', whyNotOrderable(opts, { o2: '' }, 1000), { kind: 'quantity', minQty: 1 });

// --- ticking ------------------------------------------------------------
check('pick-one replaces its sibling', Object.keys(togglePick(opts, { o1: '' }, 'o2')), ['o2']);
check('pick-one keeps the typed answer', togglePick(opts, { o2: 'x' }, 'o2'), { o2: 'x' });
check('tick-any adds', Object.keys(togglePick(opts, { o2: '' }, 'o5')).sort(), ['o2', 'o5']);
check('tick-any removes', Object.keys(togglePick(opts, { o2: '', o5: '' }, 'o5')), ['o2']);
check('groups are independent', Object.keys(togglePick(opts, { o2: '' }, 'o4')).sort(), ['o2', 'o4']);
check('an unknown id is ignored', togglePick(opts, { o2: '' }, 'nope'), { o2: '' });
check('an answer needs a ticked choice', setAnswer({ o2: '' }, 'o5', 'Sara'), { o2: '' });
check('an answer lands', setAnswer({ o5: '' }, 'o5', 'Sara'), { o5: 'Sara' });

// The seller deleted a choice while the buyer had the page open.
check('a pick the seller removed is dropped', prunePicks(opts, { o2: '', gone: 'x' }), { o2: '' });
check('pruning keeps the answers', prunePicks(opts, { o5: 'Sara' }), { o5: 'Sara' });

// --- the frozen card ----------------------------------------------------
const snap = parseOrderSnapshot({
  qty: 60, base: '60.00', per_item: '68.00', per_order: '30.00', total: '7710.00',
  lines: [{ group: 'Add-ons', label: 'Name engraved', extra: '8.00', per: 'item', ask: 'Name to engrave', answer: 'Sara' }],
});
check('snapshot total', snap?.total, 7710);
check('snapshot answer', snap?.lines[0].answer, 'Sara');
check('an unreadable snapshot is null, not a broken card', parseOrderSnapshot({ nope: 1 }), null);
check('a missing snapshot', parseOrderSnapshot(null), null);
// Only a SHOP-STOCK order names a variant, and that is what decides
// whether the seller's card grows a "take one off" button. A
// made-to-order craft has nothing to take off, so it must stay null.
check('a made-to-order card has no variant', snap?.variantId, null);
check('a stock order card names its row',
  parseOrderSnapshot({ total: '36.00', qty: 2, lines: [], variant_id: 'v1' })?.variantId, 'v1');

// --- money and labels ---------------------------------------------------
const t = (k) => (k === 'options.onceSuffix' ? 'once' : k);
check('whole dollars', money(7710), '$7,710');
check('cents kept', money(12.5), '$12.50');
check('a per-piece surcharge', extraLabel({ extra: 8, per: 'item' }, t), '+$8');
check('a per-order surcharge says so', extraLabel({ extra: 30, per: 'order' }, t), '+$30 once');
check('a free choice has no surcharge', extraLabel({ extra: 0, per: 'item' }, t), '');

// --- the seller's saved sets: out to a template and back ----------------
{
  const body = groupsToBody(opts.groups, 24);
  check('the template carries no ids', JSON.stringify(body).includes('"id"'), false);
  check('min qty travels', body.min_qty, 24);
  check('the question travels', body.groups[2].options[0].ask, 'Name to engrave');
  check('per-order travels', body.groups[2].options[1].per, 'order');
  check('a required question with no label cannot be saved',
    groupsToBody([{ id: 'x', title: 'G', pick: 'any', required: false,
      options: [{ id: 'y', label: 'A', extra: 0, per: 'item', ask: null, askRequired: true }] }], 1)
      .groups[0].options[0].ask_required, false);

  const back = bodyToGroups(body);
  check('the round trip keeps every group', back.groups.length, 3);
  check('the round trip keeps the minimum', back.minQty, 24);
  check('the round trip keeps the prices', back.groups[0].options[1].extra, 50);
  check('copied rows get draft ids', back.groups[0].id.startsWith('draft-'), true);
  const twice = bodyToGroups(body);
  check('using a set twice does not reuse a key', twice.groups[0].id === back.groups[0].id, false);
  check('and the total is unchanged by the round trip',
    totalsFor(60, { minQty: back.minQty, groups: back.groups },
      Object.fromEntries(back.groups.flatMap((g) => g.options).filter((o) =>
        ['Hands + feet', 'Dark wood', 'Name engraved', 'Delivery'].includes(o.label)).map((o) => [o.id, ''])),
      60).total, 7710);
}

// --- a payload this build cannot read must not throw --------------------
check('a template whose groups are not an array', bodyToGroups({ groups: 'nope' }).groups, []);
check('a template whose options are not an array', bodyToGroups({ groups: [{ title: 'G', options: 7 }] }).groups, []);
check('an empty template', bodyToGroups(undefined), { minQty: 1, groups: [] });
check('garbage groups', parseListingOptions({ groups: 'nope' }).groups, []);
check('a group with no choices is dropped', parseListingOptions({ groups: [{ id: 'g', options: [] }] }).groups, []);
check('nothing at all', parseListingOptions(undefined), { minQty: 1, groups: [] });

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
