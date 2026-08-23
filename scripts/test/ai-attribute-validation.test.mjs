// Exercises validateAiAttributeValue (src/lib/aiAttributeValidation.ts)
// directly against real inputs -- the shared client-side re-check that
// BOTH the single-item wizard (via useAiSpecSuggestion, called from
// CreateListingScreen's applyAiSuggestion) and the batch flow (via the
// same hook, called from BatchDetailsScreen's companion effect) run
// every AI-proposed attribute value through before it's ever allowed to
// fill a blank field. A pure function with zero runtime imports (only
// type-only imports, erased at compile), so this needs no React/Supabase
// stubbing the way batch-draft-transition.test.mjs does -- straight
// esbuild + import.
//
//   node scripts/test/ai-attribute-validation.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs's
// own comment for why (@expo/fingerprint + package.json's "scripts" block).
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'aiAttributeValidation.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/aiAttributeValidation.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
});

const { validateAiAttributeValue } = await import(OUT);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

const baseAttr = (overrides = {}) => ({
  id: 'a1',
  categoryId: 'mobiles-accessories-mobile-phones',
  slug: 'storage_gb',
  labelEn: 'Storage',
  labelAr: 'التخزين',
  type: 'text',
  options: [],
  unitEn: null,
  unitAr: null,
  required: false,
  sortOrder: 0,
  filterPriority: null,
  bound: null,
  cardPriority: null,
  isVariant: false,
  ...overrides,
});

// text
const textAttr = baseAttr({ type: 'text' });
check('text: trims and accepts a plain string', validateAiAttributeValue(textAttr, '  256GB  ') === '256GB');
check('text: rejects empty/whitespace-only', validateAiAttributeValue(textAttr, '   ') === undefined);
check('text: rejects a value over 80 chars', validateAiAttributeValue(textAttr, 'x'.repeat(81)) === undefined);
check('text: rejects a number (wrong type)', validateAiAttributeValue(textAttr, 256) === undefined);
check('text: rejects null/undefined', validateAiAttributeValue(textAttr, null) === undefined && validateAiAttributeValue(textAttr, undefined) === undefined);

// number
const numAttr = baseAttr({ type: 'number', slug: 'capacity_kg' });
check('number: accepts a finite number', validateAiAttributeValue(numAttr, 7.5) === 7.5);
check('number: rejects NaN', validateAiAttributeValue(numAttr, NaN) === undefined);
check('number: rejects Infinity', validateAiAttributeValue(numAttr, Infinity) === undefined);
check('number: rejects a numeric string (never coerced -- a bad number must not silently become 0)', validateAiAttributeValue(numAttr, '7.5') === undefined);
check('number: does NOT coerce a bad value to 0', validateAiAttributeValue(numAttr, 'not a number') !== 0);

// boolean
const boolAttr = baseAttr({ type: 'boolean', slug: 'inverter' });
check('boolean: accepts true', validateAiAttributeValue(boolAttr, true) === true);
check('boolean: accepts false', validateAiAttributeValue(boolAttr, false) === false);
check('boolean: rejects a truthy string ("true")', validateAiAttributeValue(boolAttr, 'true') === undefined);

// select
const selectAttr = baseAttr({
  type: 'select',
  slug: 'ac_type',
  options: [
    { value: 'split', labelEn: 'Split', labelAr: 'سبليت' },
    { value: 'window', labelEn: 'Window', labelAr: 'شباك' },
  ],
});
check('select: accepts a value present in options', validateAiAttributeValue(selectAttr, 'split') === 'split');
check('select: rejects a value not in options', validateAiAttributeValue(selectAttr, 'central') === undefined);
check('select: rejects a non-string', validateAiAttributeValue(selectAttr, 1) === undefined);

// multiselect
const multiAttr = baseAttr({
  type: 'multiselect',
  slug: 'connectivity',
  options: [
    { value: 'gps', labelEn: 'GPS', labelAr: 'جي بي إس' },
    { value: 'gps_cellular', labelEn: 'GPS + Cellular', labelAr: 'جي بي إس + خلوي' },
  ],
});
check(
  'multiselect: keeps only options that are actually valid, drops the rest',
  JSON.stringify(validateAiAttributeValue(multiAttr, ['gps', 'bluetooth'])) === JSON.stringify(['gps'])
);
check('multiselect: rejects a non-array', validateAiAttributeValue(multiAttr, 'gps') === undefined);
check('multiselect: rejects an array with nothing valid (empty result -> undefined, not [])', validateAiAttributeValue(multiAttr, ['bluetooth']) === undefined);

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
