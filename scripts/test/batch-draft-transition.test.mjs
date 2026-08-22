// Tests updateListing's wasDraft/asDraft/submittingDraft transition
// against the REAL src/store/AppStore.tsx -- the mechanism every batch
// item's final "Post N items" submit depends on (see BatchFinalReviewScreen
// and the batch-listings plan's "Why batch items don't need a new backend
// path" section): a batch item is just an ordinary draft-status listing
// tagged with a batch_id, so posting it for real is the SAME
// draft->pending_review transition a single-item "Save & exit" resumed
// draft already goes through. If this transition ever regresses, both the
// single-item wizard's resumed-draft submit AND every batch item's final
// post silently break the same way -- worth testing directly, once, in
// the shared code both paths call.
//
//   node scripts/test/batch-draft-transition.test.mjs
//
// Run directly, NOT via an npm script -- see upload-retry.test.mjs's own
// comment for why (@expo/fingerprint + package.json's "scripts" block).
//
// AppStoreProvider is a React function component with a dozen hooks and
// mount effects (auth listeners, AsyncStorage cache loads, a Supabase
// sync) -- far more than this test needs. Rather than mounting the real
// hook effects (which would mean also faithfully stubbing AsyncStorage,
// onAuthStateChange, and the exact sequence of Supabase calls
// syncFromSupabase makes), this test calls AppStoreProvider as a PLAIN
// FUNCTION with a minimal hooks shim: useState/useCallback/useMemo/useRef
// behave correctly for a SINGLE call (no re-render is ever needed --
// updateListing reads current data through refs, not state, so one call
// is enough), and useEffect is a deliberate no-op (mount-time side effects
// this test doesn't exercise). The two refs updateListing actually reads
// (userIdRef, listingsRef) are seeded directly, positionally -- see the
// REFS comment below for exactly why that's safe here.
import * as esbuild from 'esbuild';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'node_modules', '.cache', 'AppStore.test.mjs');

const stub = (name, contents) => ({
  name: `stub-${name}`,
  setup(build) {
    const esc = name.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');
    build.onResolve({ filter: new RegExp(`^${esc}$`) }, (a) => ({ path: a.path, namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => (a.path === name ? { contents, loader: 'js' } : undefined));
  },
});

await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/store/AppStore.tsx')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'error',
  // Explicit classic-transform pragma, not just `jsx: 'transform'` -- left
  // implicit, esbuild still resolved the automatic runtime's
  // 'react/jsx-runtime' import straight through to the REAL installed
  // react package (a version mismatch against this file's own minimal
  // shim, which is what actually crashed the first run). Pinning both
  // the mode and the factory/fragment identifiers, plus stubbing
  // 'react/jsx-runtime'/'react/jsx-dev-runtime' below as a belt-and-
  // braces fallback, keeps every JSX call routed through the shim's own
  // createElement no matter which runtime esbuild would otherwise pick.
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  plugins: [
    // A deliberately minimal hooks shim -- see this file's top comment for
    // why a single non-reactive "render" is enough for what this test
    // exercises. useEffect never invokes its callback: every mount-time
    // side effect (auth listener setup, AsyncStorage cache load, the
    // Supabase sync-on-launch) is skipped entirely, and nothing this test
    // checks depends on any of them having run.
    stub('react', `
      function createElement(type, props, ...children) {
        const p = Object.assign({}, props);
        if (children.length === 1) p.children = children[0];
        else if (children.length > 1) p.children = children;
        return { type, props: p };
      }
      export default { createElement };
      export function createContext(defaultValue) { return { _defaultValue: defaultValue }; }
      export function useContext(ctx) { return ctx ? ctx._defaultValue : undefined; }
      export function useState(init) {
        let value = typeof init === 'function' ? init() : init;
        const setter = (updater) => { value = typeof updater === 'function' ? updater(value) : updater; };
        return [value, setter];
      }
      export function useRef(init) {
        const ref = { current: init };
        (globalThis.__REFS__ ||= []).push(ref);
        return ref;
      }
      export function useCallback(fn) { return fn; }
      export function useMemo(fn) { return fn(); }
      export function useEffect() {}
    `),
    // Belt-and-braces: if esbuild still emits an automatic-runtime import
    // for either the production or dev jsx entry point despite the
    // explicit classic-transform pragma above, route it through the same
    // createElement instead of letting it resolve to the real react
    // package (React.Fragment isn't used by AppStore.tsx's own JSX, so a
    // stub value is fine here).
    stub('react/jsx-runtime', `
      function createElement(type, props, ...children) {
        const p = Object.assign({}, props);
        if (children.length === 1) p.children = children[0];
        else if (children.length > 1) p.children = children;
        return { type, props: p };
      }
      export function jsx(type, props) { return createElement(type, props, props && props.children); }
      export const jsxs = jsx;
      export const Fragment = Symbol('Fragment');
    `),
    stub('react/jsx-dev-runtime', `
      function createElement(type, props, ...children) {
        const p = Object.assign({}, props);
        if (children.length === 1) p.children = children[0];
        else if (children.length > 1) p.children = children;
        return { type, props: p };
      }
      export function jsxDEV(type, props) { return createElement(type, props, props && props.children); }
      export const Fragment = Symbol('Fragment');
    `),
    stub('@react-native-async-storage/async-storage', `
      export default { getItem: async () => null, setItem: async () => {} };
    `),
    stub('../lib/supabase', `
      function makeBuilder(table) {
        const capture = (op, payload) => (globalThis.__CAPTURED__ ||= []).push({ table, op, payload });
        const builder = {
          select() { return builder; },
          insert(payload) { capture('insert', payload); return builder; },
          update(payload) { capture('update', payload); return builder; },
          delete() { return builder; },
          eq() { return builder; },
          in() { return builder; },
          order() { return builder; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          single() { return Promise.resolve({ data: null, error: null }); },
          then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
        };
        return builder;
      }
      export const supabase = {
        from(table) { return makeBuilder(table); },
        auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        functions: { invoke: async () => ({ data: null, error: null }) },
      };
      export async function ensureSession() { return { user: { id: 'test-uid', is_anonymous: false } }; }
    `),
    stub('../lib/photoUpload', `
      export async function uploadPhotos(uris) { return uris.map((u) => 'https://vevaty-media.b-cdn.net/listings/' + u); }
    `),
    stub('../lib/bunnyVideo', `
      export async function attachVideoToListing() {}
      export async function deleteVideo() {}
      export function parseResolutions() { return null; }
    `),
    stub('../lib/imageToBase64', `
      export async function uriToCompressedBase64() { return null; }
    `),
    stub('../lib/moderateListing', `
      export async function triggerListingModeration(listingId, photos, title, description) {
        (globalThis.__MODERATION_CALLS__ ||= []).push({ listingId, photos, title, description });
      }
    `),
  ],
});

const { AppStoreProvider } = await import(OUT);

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// REFS: AppStoreProvider declares exactly three useRef calls, in this
// fixed order, right at its top (see src/store/AppStore.tsx):
//   const userIdRef = useRef<string | null>(null);
//   const profileRef = useRef<Profile>(DEFAULT_PROFILE);
//   const listingsRef = useRef<Listing[]>([]);
// The hooks shim above records every ref it creates, in call order, onto
// globalThis.__REFS__ -- so refs[0]/refs[2] below are userIdRef/
// listingsRef. Asserted explicitly rather than trusted blindly: if
// AppStore.tsx's ref declarations ever change shape, this fails loudly
// here instead of silently reading the wrong ref.
globalThis.__REFS__ = [];
globalThis.__CAPTURED__ = [];
globalThis.__MODERATION_CALLS__ = [];

const element = AppStoreProvider({ children: null });
const value = element.props.value;

const refs = globalThis.__REFS__;
check('AppStoreProvider declares exactly 3 refs (userIdRef, profileRef, listingsRef)', refs.length === 3, `got ${refs.length}`);
check('ref[0] (userIdRef) starts null', refs[0]?.current === null);
check('ref[2] (listingsRef) starts an empty array', Array.isArray(refs[2]?.current) && refs[2].current.length === 0);

const userIdRef = refs[0];
const listingsRef = refs[2];
userIdRef.current = 'test-uid';

const basePayload = (overrides = {}) => ({
  cat: 'electronics-phones',
  condition: 'used',
  titleEn: 'iPhone 13',
  titleAr: '',
  descriptionEn: '',
  descriptionAr: '',
  price: 300,
  district: 'Beirut',
  governorate: null,
  caza: null,
  geonameId: null,
  lat: null,
  lng: null,
  // Already-hosted URLs -- keeps syncPhotoKind/syncSpinSets on their
  // cheapest path (no uploadPhotos call), which is all this test needs.
  photos: ['https://vevaty-media.b-cdn.net/listings/existing.jpg'],
  spinSets: [],
  video: null,
  aiGenerated: false,
  attributes: {},
  contactMethod: 'both',
  shopId: null,
  stockQty: 1,
  variants: null,
  batchId: 'batch-1',
  batchParked: false,
  ...overrides,
});

const seedListing = (id, status) => {
  listingsRef.current = [
    {
      id,
      status,
      titleEn: 'iPhone 13',
      titleAr: '',
      batchId: 'batch-1',
      batchParked: false,
    },
  ];
};

const lastCaptured = (table, op) =>
  [...globalThis.__CAPTURED__].reverse().find((c) => c.table === table && c.op === op);

// 1. A plain "still parking" save (status: 'draft') on a draft batch item
//    stays a draft -- no moderation, no submit.
globalThis.__MODERATION_CALLS__ = [];
seedListing('item-parking', 'draft');
await value.updateListing('item-parking', basePayload({ status: 'draft' }));
let upd = lastCaptured('listings', 'update');
check('draft save (status: "draft") keeps status "draft"', upd?.payload?.status === 'draft', JSON.stringify(upd?.payload?.status));
check('  ...triggers no moderation call', globalThis.__MODERATION_CALLS__.length === 0);

// 2. The batch final-review submit: status omitted (undefined) on a
//    listing that WAS draft -- this is the exact transition
//    BatchFinalReviewScreen relies on (see listingToInput's own doc
//    comment on why it overrides the 'draft' default this way).
globalThis.__MODERATION_CALLS__ = [];
seedListing('item-submit', 'draft');
await value.updateListing('item-submit', basePayload({ status: undefined }));
upd = lastCaptured('listings', 'update');
check('submitting a draft (status omitted) flips to "pending_review"', upd?.payload?.status === 'pending_review', JSON.stringify(upd?.payload?.status));
check('  ...resets moderation_status to "pending"', upd?.payload?.moderation_status === 'pending');
check('  ...clears moderation_reason', upd?.payload?.moderation_reason === null);
check('  ...triggers exactly one moderation call for this listing',
  globalThis.__MODERATION_CALLS__.length === 1 && globalThis.__MODERATION_CALLS__[0].listingId === 'item-submit');
check('  ...never sends batch_id in the update (write-once invariant)', !('batch_id' in (upd?.payload || {})), Object.keys(upd?.payload || {}).join(','));
check('  ...does send batch_parked', upd?.payload?.batch_parked === false);

// 3. An ordinary edit of an already-active (non-draft) listing, status
//    omitted -- must NOT re-trigger moderation or re-submit. This is the
//    guard that stops every routine edit of a live listing from being
//    treated as a brand-new submission.
globalThis.__MODERATION_CALLS__ = [];
seedListing('item-active', 'active');
await value.updateListing('item-active', basePayload({ status: undefined }));
upd = lastCaptured('listings', 'update');
check('editing an already-active listing does not touch status', upd?.payload?.status === undefined, JSON.stringify(upd?.payload?.status));
check('  ...triggers no moderation call', globalThis.__MODERATION_CALLS__.length === 0);

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
