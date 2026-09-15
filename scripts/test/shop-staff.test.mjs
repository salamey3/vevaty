// Who else works here (src/lib/shopStaff.ts). Pure parsing, so no React
// and no Supabase: the client is stubbed out by the plugin below, the
// same shape as stock.test.mjs.
//
//   node scripts/test/shop-staff.test.mjs
//
// Run directly, NOT via an npm script -- see batch-draft-transition.test.mjs.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'shop-staff.test.mjs');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/lib/shopStaff.ts')],
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
  parseStaff, parseInvites, parseWorkShop, staffLabel, shopName, isWaiting,
  staffErrorKey, MAX_STAFF,
} = await import(OUT);

const results = [];
const check = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  results.push({ name, ok: a === b, detail: a === b ? '' : `got ${a}, want ${b}` });
};

// --- the owner's list ----------------------------------------------------
// What shop_staff_list puts on the wire. The two kinds of row are the same
// shape, and only `name`/`accepted_at` tell them apart.
const wire = [
  { id: 's1', phone: '+96170111111', name: null,
    accepted_at: null, invited_at: '2026-09-15T08:00:00Z' },
  { id: 's2', phone: '+96171222222', name: 'Ahmad',
    accepted_at: '2026-09-15T09:00:00Z', invited_at: '2026-09-14T08:00:00Z' },
];
{
  const rows = parseStaff(wire);
  check('both rows parse', rows.length, 2);
  check('a waiting invite has no name', rows[0].name, null);
  // THE POINT of parsing rather than coercing: 0 is a real epoch, and a
  // waiting invite coerced to 0 would read as accepted in 1970 -- which
  // every "has this person accepted?" test in the app would believe.
  check('and no accepted time at all, not zero', rows[0].acceptedAt, null);
  check('it is waiting', isWaiting(rows[0]), true);
  check('the accepted one is not', isWaiting(rows[1]), false);
  check('and carries a real time', rows[1].acceptedAt > 0, true);
  check('an empty name is the same as no name',
    parseStaff([{ id: 'x', phone: '+9613', name: '   ' }])[0].name, null);
}

// Before anybody accepts there is nobody to name, so the number IS the
// name -- a blank row would look like a broken one.
check('a waiting invite is called by its number', staffLabel(parseStaff(wire)[0]), '+96170111111');
check('and an accepted one by their name', staffLabel(parseStaff(wire)[1]), 'Ahmad');

check('junk with no id is dropped', parseStaff([{ phone: '+9613' }]).length, 0);
check('not an array', parseStaff(null), []);
check('an empty answer', parseStaff([]), []);

// --- what the invited person sees ---------------------------------------
{
  const invites = parseInvites([
    { id: 'i1', shop_id: 'sh1', shop_name_en: 'Vevaty Store', shop_name_ar: 'متجر فيفاتي',
      logo_url: null, invited_by: 'Yousif', invited_at: '2026-09-15T08:00:00Z' },
  ]);
  check('one invite', invites.length, 1);
  check('in both languages',
    [shopName(invites[0], 'en'), shopName(invites[0], 'ar')], ['Vevaty Store', 'متجر فيفاتي']);
  check('and who asked', invites[0].invitedBy, 'Yousif');
  // An invite with no shop behind it is not something to draw a card for.
  check('a shopless invite is dropped', parseInvites([{ id: 'i2' }]).length, 0);
  check('an Arabic name falling back to English',
    shopName({ nameEn: 'Only English', nameAr: null }, 'ar'), 'Only English');
}

// --- which counter am I standing at -------------------------------------
{
  const owned = parseWorkShop({ id: 'sh1', slug: 'v', name_en: 'V', name_ar: null,
    logo_url: null, verified_at: '2026-01-01T00:00:00Z', is_owner: true });
  check('an owner runs the place', owned.isOwner, true);
  check('and it is trading', owned.verifiedAt > 0, true);

  const staffed = parseWorkShop({ id: 'sh1', slug: 'v', name_en: 'V', name_ar: null,
    logo_url: null, verified_at: '2026-01-01T00:00:00Z', is_owner: false });
  check('a staff member does not', staffed.isOwner, false);
  // is_owner must be the server's word and nothing else: anything falsy,
  // missing or merely truthy-looking is NOT ownership, because this is
  // what hides the storefront editor and the staff list.
  check('a missing flag is not ownership',
    parseWorkShop({ id: 'sh1', name_en: 'V' }).isOwner, false);
  check('nor is the string "true"',
    parseWorkShop({ id: 'sh1', name_en: 'V', is_owner: 'true' }).isOwner, false);
  check('a shop still waiting on review has no verified time',
    parseWorkShop({ id: 'sh1', name_en: 'V', verified_at: null }).verifiedAt, null);

  check('nobody works anywhere', parseWorkShop(null), null);
  check('and an answer with no id is nobody', parseWorkShop({ name_en: 'V' }), null);
}

// --- every refusal the server can give has a sentence -------------------
{
  const codes = [
    'bad_phone', 'that_is_you', 'already_invited', 'too_many_people',
    'not_a_trading_shop', 'no_such_person', 'no_such_invite',
    'you_own_a_shop', 'already_in_a_shop', 'no_number_on_your_account',
    'not_in_a_shop',
  ];
  const keys = codes.map((c) => staffErrorKey({ message: c }));
  check('each one maps somewhere', keys.filter((k) => k !== 'staff.errFailed').length, codes.length);
  check('and each to its own key', new Set(keys).size, codes.length);
  check('anything unrecognised still says something',
    staffErrorKey({ message: 'kaboom' }), 'staff.errFailed');
  check('including nothing at all', staffErrorKey(undefined), 'staff.errFailed');
}

check('the cap is a number the screen can show', typeof MAX_STAFF === 'number' && MAX_STAFF > 0, true);

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
