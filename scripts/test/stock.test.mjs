// The grid maths behind shop stock (src/lib/stock.ts). Pure functions, so
// no React or Supabase: the client that talks to the server is stubbed out
// by the plugin below, the same shape as listing-options.test.mjs.
//
//   node scripts/test/stock.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'stock.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/stock.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
  plugins: [{
    name: 'stub-supabase',
    setup(build) {
      build.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'stub', namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const supabase = { rpc: async () => ({ data: null, error: null }) };', loader: 'js',
      }));
    },
  }],
});

const {
  parseVariants, variantDimensions, combinationsOf, buildGrid, variantKey,
  photoByDimension, applyPhotoToDimension, totalOf, isLow, variantLabel, stockErrorKey,
  gridFor, picksFromRows, photoDimension, offeredValues, rememberRow,
  pickable, rowFor, priceOf,
} = await import(OUT);

// The library joins the two values with U+001F, which nothing can type.
// The tests build their expected keys the same way rather than spelling
// the separator out, so a change to it never turns into a wrong test.
const K = (a, b) => `${a ?? ''}\u001f${b ?? ''}`;

const results = [];
const check = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  results.push({ name, ok: a === b, detail: a === b ? '' : `got ${a}, want ${b}` });
};

// what myazar.listing_variants returns -- numbers arrive as JSON strings
const raw = [
  { id: 'v1', size: 'm', colour: 'black', sku: 'TS-BLK-M', price: '18.00', photo: null, qty: 5, low_at: 2 },
  { id: 'v2', size: 'l', colour: 'black', sku: null, price: null, photo: null, qty: 0, low_at: null },
];
const vs = parseVariants(raw);
check('parsed', vs.length, 2);
check('price as a number', vs[0].price, 18);
check('no price stays null', vs[1].price, null);
check('dimensions by position, not by name', [vs[0].a, vs[0].b], ['m', 'black']);
// An id and nothing else is a real row now, not junk: it is how a
// category with no size and no colour stores its one count.
check('a bare id is the plain row', parseVariants([{ id: 'x' }]).map((v) => [v.a, v.b, v.qty]), [[null, null, 0]]);
check('junk with no id is dropped', parseVariants([{ size: 'm' }]).length, 0);
check('not an array', parseVariants(null), []);

// --- the combinations -----------------------------------------------
check('three sizes, four colours', combinationsOf(['s','m','l'], ['red','blue','green','black']).length, 12);
check('sizes alone', combinationsOf(['s','m'], []), [{ a: 's', b: null }, { a: 'm', b: null }]);
check('colours alone', combinationsOf([], ['red']), [{ a: null, b: 'red' }]);
check('nothing ticked', combinationsOf([], []), []);
check('order is stable', combinationsOf(['s','m'], ['red','blue']).map((c) => `${c.a}-${c.b}`),
  ['s-red', 's-blue', 'm-red', 'm-blue']);

// --- the grid keeps what the listing already has ----------------------
const existing = [
  { id: 'v1', a: 'm', b: 'black', sku: 'TS-BLK-M', price: 18, photo: 'p1', qty: 5, lowAt: 2 },
  { id: 'v2', a: 'l', b: 'black', sku: null, price: null, photo: null, qty: 9, lowAt: null },
];
const grid = buildGrid(['m', 'l'], ['black', 'white'], existing);
check('grid size', grid.length, 4);
check('an existing combination keeps its count', grid.find((g) => variantKey(g) === K('m', 'black')).qty, 5);
check('and its id', grid.find((g) => variantKey(g) === K('m', 'black')).id, 'v1');
check('and its code', grid.find((g) => variantKey(g) === K('m', 'black')).sku, 'TS-BLK-M');
check('a new combination starts empty', grid.find((g) => variantKey(g) === K('m', 'white')).qty, 0);
check('and is marked new so its opening count is sent',
  grid.find((g) => variantKey(g) === K('m', 'white')).id.startsWith('new:'), true);
check('dropping a colour drops it from the grid',
  buildGrid(['m','l'], ['black'], existing).length, 2);
check('and re-adding it brings the old row back with its count',
  buildGrid(['m','l'], ['black','white'], existing).find((g) => variantKey(g) === K('l', 'black')).qty, 9);
check('one dimension only', buildGrid(['s','m','l'], [], []).length, 3);

// --- one photo per colour, not per combination ------------------------
const withPhotos = applyPhotoToDimension(grid, 'b', 'white', 'navy.jpg');
check('the photo lands on every size of that colour',
  withPhotos.filter((r) => r.photo === 'navy.jpg').map((r) => r.a).sort(), ['l', 'm']);
check('and on no other colour',
  withPhotos.filter((r) => r.b === 'black' && r.photo === 'navy.jpg').length, 0);
check('read back by colour', photoByDimension(withPhotos, 'b').white, 'navy.jpg');
check('clearing it', applyPhotoToDimension(withPhotos, 'b', 'white', null)
  .filter((r) => r.photo === 'navy.jpg').length, 0);

// --- totals and low stock ---------------------------------------------
check('total', totalOf(grid), 14);
check('low', isLow({ qty: 2, lowAt: 2 }), true);
check('not low', isLow({ qty: 3, lowAt: 2 }), false);
check('zero is out, not low', isLow({ qty: 0, lowAt: 2 }), false);
check('no threshold set', isLow({ qty: 1, lowAt: null }), false);

// --- labels -----------------------------------------------------------
const dims = [
  { isVariant: true, variantRank: 1, options: [{ value: 'm', labelEn: 'Medium', labelAr: 'وسط' }] },
  { isVariant: true, variantRank: 2, options: [{ value: 'black', labelEn: 'Black', labelAr: 'أسود' }] },
];
check('both dimensions', variantLabel({ a: 'm', b: 'black' }, dims, 'en'), 'Medium · Black');
check('in Arabic', variantLabel({ a: 'm', b: 'black' }, dims, 'ar'), 'وسط · أسود');
check('one dimension', variantLabel({ a: 'm', b: null }, dims, 'en'), 'Medium');
check('an option the category has since dropped still prints',
  variantLabel({ a: 'xxl', b: null }, dims, 'en'), 'xxl');

// --- which attributes are the dimensions ------------------------------
const attrs = [
  { slug: 'colour', isVariant: true, variantRank: 2, options: [] },
  { slug: 'gender', isVariant: false, variantRank: null, options: [] },
  { slug: 'size', isVariant: true, variantRank: 1, options: [] },
];
check('in rank order, not list order', variantDimensions(attrs).map((a) => a.slug), ['size', 'colour']);
check('non-variants excluded', variantDimensions([{ slug: 'x', isVariant: false, variantRank: null }]), []);

// --- refusals in the seller's words ------------------------------------
check('sold out', stockErrorKey({ message: 'none_left' }), 'stock.errNoneLeft');
check('not theirs', stockErrorKey({ message: 'not_your_listing' }), 'stock.errNotYours');
check('anything else', stockErrorKey({ message: 'boom' }), 'stock.errFailed');

// --- gridFor: the one call the posting form makes ----------------------
const SIZE = {
  slug: 'size', isVariant: true, variantRank: 1,
  options: [{ value: 's', labelEn: 'Small', labelAr: 'صغير' }, { value: 'm', labelEn: 'Medium', labelAr: 'وسط' },
            { value: 'l', labelEn: 'Large', labelAr: 'كبير' }],
};
const COLOUR = {
  slug: 'colour', isVariant: true, variantRank: 2,
  options: [{ value: 'black', labelEn: 'Black', labelAr: 'أسود' }, { value: 'navy', labelEn: 'Navy', labelAr: 'كحلي' }],
};

check('two dimensions multiply out',
  gridFor([SIZE, COLOUR], { size: ['s', 'm'], colour: ['navy'] }, []).map(variantKey),
  [K('s','navy'), K('m','navy')]);
check('the category\'s option order wins over the tapping order',
  gridFor([SIZE], { size: ['l', 's', 'm'] }, []).map((v) => v.a), ['s', 'm', 'l']);
check('a value the category has since dropped is not conjured up',
  gridFor([SIZE], { size: ['s', 'xxl'] }, []).map((v) => v.a), ['s']);
check('nothing ticked is an empty grid', gridFor([SIZE], { size: [] }, []), []);
check('no dimensions at all is exactly one row',
  gridFor([], {}, []).map((v) => [v.a, v.b, v.id]), [[null, null, `new:${K(null, null)}`]]);
check('and that row keeps its identity once saved',
  gridFor([], {}, [{ id: 'v9', a: null, b: null, sku: null, price: null, photo: null, qty: 4, lowAt: null }])[0],
  { id: 'v9', a: null, b: null, sku: null, price: null, photo: null, qty: 4, lowAt: null });
check('an existing combination keeps its numbers through a re-tick',
  gridFor([SIZE, COLOUR], { size: ['m'], colour: ['black'] },
    [{ id: 'v1', a: 'm', b: 'black', sku: 'X', price: 18, photo: null, qty: 5, lowAt: 2 }])[0].qty, 5);

// --- reading the ticks back off a listing ------------------------------
const saved = [
  { id: 'v1', a: 'm', b: 'navy', sku: null, price: null, photo: null, qty: 1, lowAt: null },
  { id: 'v2', a: 's', b: 'black', sku: null, price: null, photo: null, qty: 0, lowAt: null },
];
check('ticks come back in the category\'s order', picksFromRows([SIZE, COLOUR], saved),
  { size: ['s', 'm'], colour: ['black', 'navy'] });
check('and re-building from them is a no-op',
  gridFor([SIZE, COLOUR], picksFromRows([SIZE, COLOUR], saved), saved).map(variantKey),
  [K('s','black'), K('s','navy'), K('m','black'), K('m','navy')]);
check('a plain listing has no ticks', picksFromRows([], []), {});

// --- which dimension carries the pictures ------------------------------
check('two dimensions: the second one', photoDimension([SIZE, COLOUR]).which, 'b');
check('two dimensions: and it is colour', photoDimension([SIZE, COLOUR]).attr.slug, 'colour');
check('one dimension: that one', photoDimension([COLOUR]), { attr: COLOUR, which: 'a' });
check('no dimensions: nothing to photograph', photoDimension([]), null);

// --- what the size filter reads ----------------------------------------
check('offered, not in stock this minute', offeredValues([SIZE, COLOUR], saved),
  { size: ['s', 'm'], colour: ['black', 'navy'] });
check('a sold-out row still answers the filter',
  offeredValues([SIZE], [{ id: 'v1', a: 'm', b: null, sku: null, price: null, photo: null, qty: 0, lowAt: null }]),
  { size: ['m'] });
check('a plain listing writes no size at all', offeredValues([], gridFor([], {}, [])), {});

// --- the three the review caught ---------------------------------------
// A category with no dimensions saves ONE row with neither value set.
// parseVariants used to require a size or a colour, so that row came back
// as nothing at all: the shop's own stock panel rendered empty and the
// posting form offered an opening-count box for a row that already
// existed, whose number the server discards.
check('the dimensionless row survives a round trip',
  parseVariants([{ id: 'v9', size: null, colour: null, sku: null, price: null, photo: null, qty: 4, low_at: null }])
    .map((v) => [v.id, v.a, v.b, v.qty]),
  [['v9', null, null, 4]]);
check('and it is the row gridFor then hands back',
  gridFor([], {}, parseVariants([{ id: 'v9', size: null, colour: null, qty: 4 }]))[0].qty, 4);
check('a row with no id at all is still junk', parseVariants([{ size: 'm' }]).length, 0);

// Unticking must not throw the count away. The grid the seller sees is
// derived from the ticks; rememberRow is the set it is derived FROM, and
// that set never shrinks.
{
  const all0 = parseVariants([
    { id: 'v1', size: 's', colour: null, qty: 12 },
    { id: 'v2', size: 'm', colour: null, qty: 8 },
  ]);
  check('both ticked', gridFor([SIZE], { size: ['s', 'm'] }, all0).map((v) => [v.a, v.qty]),
    [['s', 12], ['m', 8]]);
  check('untick S and it leaves the grid',
    gridFor([SIZE], { size: ['m'] }, all0).map((v) => v.a), ['m']);
  check('re-tick S and the twelve are still there, on the same row',
    gridFor([SIZE], { size: ['s', 'm'] }, all0).map((v) => [v.id, v.qty]), [['v1', 12], ['v2', 8]]);
}

// rememberRow keys on the combination, not the id, because a row the
// seller has typed into has only a placeholder id until it is saved.
{
  const fresh = gridFor([SIZE], { size: ['l'] }, [])[0];
  const all1 = rememberRow([], { ...fresh, qty: 5 });
  check('a typed-in new row is remembered', all1.map((v) => [v.a, v.qty]), [['l', 5]]);
  check('untick then re-tick keeps what was typed',
    gridFor([SIZE], { size: ['l'] }, all1)[0].qty, 5);
  check('editing it again replaces rather than duplicates',
    rememberRow(all1, { ...fresh, qty: 9 }).length, 1);
  check('and a different combination is added, not merged',
    rememberRow(all1, { ...gridFor([SIZE], { size: ['s'] }, [])[0], qty: 2 }).length, 2);
}

// Option values are free text an admin types. "38/40" is a real EU
// trouser size, and the row key used to join the two values with "/".
{
  const rows = parseVariants([
    { id: 'a', size: '38/40', colour: 'black', qty: 5 },
    { id: 'b', size: '38', colour: '40/black', qty: 7 },
  ]);
  check('a slash in a value no longer collides two rows into one',
    new Set(rows.map(variantKey)).size, 2);
  const TROUSER = { slug: 'size', isVariant: true, variantRank: 1,
    options: [{ value: '38/40', labelEn: '38/40', labelAr: '38/40' }, { value: '38', labelEn: '38', labelAr: '38' }] };
  const COL = { slug: 'colour', isVariant: true, variantRank: 2,
    options: [{ value: 'black', labelEn: 'Black', labelAr: 'أسود' }, { value: '40/black', labelEn: '40/black', labelAr: '40/black' }] };
  check('and both keep their own count through the grid',
    gridFor([TROUSER, COL], { size: ['38/40', '38'], colour: ['black', '40/black'] }, rows)
      .filter((v) => v.qty > 0).map((v) => [v.id, v.qty]),
    [['a', 5], ['b', 7]]);
}

// --- the second review's findings --------------------------------------
// Two dimensions means BOTH halves, or there is nothing to show. Ticking
// only the colours used to produce rows with no size at all: real-looking
// rows with opening-count boxes, saved as {size:null, colour:'navy'} that
// no size filter can answer, and thrown away the moment a size WAS ticked
// because the combination key changed underneath the number.
check('colours alone on a size x colour category is not a table yet',
  gridFor([SIZE, COLOUR], { colour: ['navy', 'black'] }, []), []);
check('sizes alone is not either', gridFor([SIZE, COLOUR], { size: ['s'] }, []), []);
check('one of each is',
  gridFor([SIZE, COLOUR], { size: ['s'], colour: ['navy'] }, []).map(variantKey), [K('s','navy')]);
// The columns are positions, not names: whatever the category's rank-1
// dimension is goes in the first one. On bags and accessories that is
// colour, and it lands in the same slot size occupies on clothing.
check('a one-dimension category still needs only its own',
  gridFor([COLOUR], { colour: ['navy'] }, []).map(variantKey), [K('navy', null)]);

// The resolved list is an ANCESTOR CHAIN, so the database's one-rank-per-
// category index cannot stop a parent and a child both holding rank 1.
// Slicing the sorted list to two dropped the genuine second dimension.
{
  const chain = [
    { slug: 'colour', isVariant: true, variantRank: 1, options: [] },   // from the parent
    { slug: 'size', isVariant: true, variantRank: 1, options: [] },     // added on the child
    { slug: 'shade', isVariant: true, variantRank: 2, options: [] },
  ];
  check('a duplicated rank does not push out the real second dimension',
    variantDimensions(chain).map((a) => [a.slug, a.variantRank]), [['colour', 1], ['shade', 2]]);
}

check('the mixed-rows refusal has its own sentence',
  stockErrorKey({ message: 'mixed_dimensions' }), 'stock.errMixed');

// --- the buyer's half ---------------------------------------------------
// Navy comes in S and M; red only in L. The point of pickable is that a
// buyer is never invited to ask for red in S -- a pair the shop has never
// made is absent, while a pair it makes but has sold out of is present and
// marked, because "M is out until Friday" is what they came to find out.
{
  const shop = parseVariants([
    { id: 'v1', size: 's', colour: 'navy', qty: 3 },
    { id: 'v2', size: 'm', colour: 'navy', qty: 0 },
    { id: 'v3', size: 'l', colour: 'red', qty: 2, price: '25.00' },
  ]);
  check('every size the listing carries', [...pickable(shop, 'a', null, 'b')], ['s', 'm', 'l']);
  check('the colours that exist in S', [...pickable(shop, 'b', 's', 'a')], ['navy']);
  check('the colours that exist in L', [...pickable(shop, 'b', 'l', 'a')], ['red']);
  check('a sold-out pair is still offered', [...pickable(shop, 'b', 'm', 'a')], ['navy']);

  check('the row a pair lands on', rowFor(shop, 's', 'navy')?.id, 'v1');
  check('a pair the shop never made', rowFor(shop, 's', 'red'), null);
  check('halfway through choosing', rowFor(shop, 's', null), null);

  check('the listing price by default', priceOf(rowFor(shop, 's', 'navy'), 18), 18);
  check("the row's own price when it has one", priceOf(rowFor(shop, 'l', 'red'), 18), 25);
  check('nothing chosen yet', priceOf(null, 18), 18);
  // A row priced at zero is a real answer -- a shop giving something away
  // with a purchase -- and must not fall through to the listing's price.
  check('a row priced at zero stays zero',
    priceOf(parseVariants([{ id: 'z', size: 's', colour: null, qty: 1, price: '0' }])[0], 18), 0);
}

// A one-dimension category: the colours go in the FIRST column, so the
// buyer's chooser reads them off `a` like any other rank-1 dimension.
{
  const bags = parseVariants([
    { id: 'b1', size: 'black', colour: null, qty: 2 },
    { id: 'b2', size: 'brown', colour: null, qty: 0 },
  ]);
  check('one dimension, both offered', [...pickable(bags, 'a', null, 'b')], ['black', 'brown']);
  check('and the row is found with no second value', rowFor(bags, 'brown', null)?.id, 'b2');
}

// --- the second review's findings, buyer side ---------------------------
// A listing posted before its category gained a size still has one row
// with neither value. The chooser must read "nothing to pick" off the ROWS
// rather than off the category, or it draws a size chooser with no rows
// behind it and a send button that can never light.
{
  const drifted = parseVariants([{ id: 'p1', size: null, colour: null, qty: 3 }]);
  check('the plain row is found without a pick', rowFor(drifted, null, null)?.id, 'p1');
  check('and offers nothing to tick', [...pickable(drifted, 'a', null, 'b')], []);
}

// The total is what the buyer is about to ask for. priceOf gives the unit;
// the chooser multiplies. Guard the arithmetic the summary depends on.
{
  const rows = parseVariants([{ id: 'q1', size: 'm', colour: null, qty: 9, price: '18.50' }]);
  const unit = priceOf(rowFor(rows, 'm', null), 20);
  check('a decimal unit price survives the round trip', unit, 18.5);
  check('three of them', unit * 3, 55.5);
}

// --- one is the answer for a shop with one sofa -------------------------
// A category with no size or colour opens at 1, not 0: a shop posting a
// sofa has one sofa, and requiring a tap on the box meant the listing
// saved with no stock row at all and never got its sold-out mark. A new
// size x colour row still opens at 0 -- twelve combinations pre-filled
// with 1 is twelve units the shop never said it had.
check('a plain listing starts at one', gridFor([], {}, [])[0].qty, 1);
check('but a new combination starts at nothing',
  gridFor([SIZE], { size: ['s'] }, [])[0].qty, 0);
check('and a saved plain row keeps its own number, whatever it is',
  gridFor([], {}, parseVariants([{ id: 'p1', size: null, colour: null, qty: 0 }]))[0].qty, 0);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
