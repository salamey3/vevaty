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

// A stub is matched by WHERE IT RESOLVES TO, not by how it was spelled.
//
// This used to match the literal import specifier, and that quietly broke
// the whole file. AppStore says `from '../lib/photoUpload'`, but
// listingMedia.ts -- which AppStore also pulls in -- says
// `from './photoUpload'` for the same module, and `from './supabase'` for
// the same client. Those strings do not match, so the REAL modules came in
// through the side door, dragging expo-file-system, expo-modules-core,
// expo-asset and finally react-native's Flow-typed entry point, which
// esbuild cannot parse. The build died before a single check ran, and
// because this test is run by hand rather than by an npm script (see
// below), nothing said so.
//
// So: a bare package name still matches exactly, and a relative path is
// resolved against this repo's src/ once and then compared as a resolved
// file path, whichever way an importer happens to spell it.
const SRC = path.join(ROOT, 'src');
const stub = (name, contents) => {
  const bare = !name.startsWith('.');
  // './lib/x' and '../lib/x' both mean src/lib/x here.
  const target = bare ? null : path.resolve(SRC, 'store', name);
  const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
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
      build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => (a.path === name ? { contents, loader: 'js' } : undefined));
    },
  };
};

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
  // Metro injects __DEV__; node does not, and alertShim reads it to decide
  // whether to console.warn an alert it cannot show. Undefined, it is a
  // ReferenceError thrown from inside a catch handler, which surfaces as a
  // crash with nothing to do with what failed.
  define: { __DEV__: 'false' },
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
    // react-native itself. esbuild is pointed at the package's `main`,
    // which is Flow-typed source (`import typeof * as ... `) that it
    // cannot parse -- so WITHOUT this stub the bundle does not build at
    // all and this whole file dies before its first check. It is only
    // three symbols deep: AppStore's own AppState (used inside a
    // useEffect, which the hooks shim never runs), and the Platform.OS
    // that testers.ts, LanguageContext and theme/fonts read at import
    // time.
    stub('react-native', `
      export const AppState = {
        currentState: 'active',
        addEventListener() { return { remove() {} }; },
      };
      export const Platform = { OS: 'web', select: (o) => (o.web !== undefined ? o.web : o.default) };
    `),
    stub('@react-native-async-storage/async-storage', `
      export default { getItem: async () => null, setItem: async () => {} };
    `),
    // AppStore takes one thing from the language context -- `t` for the
    // sentences it puts in front of the seller -- and the real hook throws
    // outside a LanguageProvider, which this test deliberately does not
    // mount. The stub returns the key so a failed lookup would be visible
    // in an assertion rather than silently reading as empty.
    stub('../i18n/LanguageContext', `
      export function useLanguage() {
        return { t: (k) => k, lang: 'en', isRTL: false, setLang() {} };
      }
    `),
    stub('../lib/supabase', `
      function makeBuilder(table) {
        const state = { op: null, payload: null, id: null };
        const capture = (op, payload) => {
          state.op = op; state.payload = payload;
          (globalThis.__CAPTURED__ ||= []).push({ table, op, payload });
        };
        // An UPDATE on listings answers with the row it matched.
        // updateListing reads its result back and treats an empty one as a
        // write that went nowhere -- correctly, since that is exactly the
        // silent-loss bug @MEDIA.md records -- so a builder that always
        // answered [] made every path throw 'refused' before reaching the
        // transition this file exists to test.
        const result = () => {
          if (state.op !== 'update') return { data: [], error: null };
          const row = { id: state.id ?? 'stub-row' };
          if (table === 'listings') row.status = state.payload?.status;
          return { data: [row], error: null };
        };
        const builder = {
          select() { return builder; },
          insert(payload) { capture('insert', payload); return builder; },
          update(payload) { capture('update', payload); return builder; },
          delete() { capture('delete', null); return builder; },
          eq(col, val) { if (col === 'id') state.id = val; return builder; },
          in() { return builder; },
          order() { return builder; },
          // The pre-edit read of the listing's CURRENT status, which is
          // what wasDraft/wasRejected/wasPendingReview are decided from.
          // It is a live round trip, not the cache: updateListing falls
          // back to listingsRef only when the read ERRORS, so a stub that
          // answered null here made every listing look deleted and no
          // transition could ever fire.
          maybeSingle() {
            return Promise.resolve(table === 'listings' && globalThis.__LIVE_LISTING__
              ? { data: globalThis.__LIVE_LISTING__, error: null }
              : { data: null, error: null });
          },
          single() { return Promise.resolve({ data: null, error: null }); },
          then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
        };
        return builder;
      }
      export const supabase = {
        from(table) { return makeBuilder(table); },
        auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        functions: { invoke: async () => ({ data: null, error: null }) },
      };
      export async function ensureSession() { return { user: { id: 'test-uid', is_anonymous: false } }; }
      export async function upsertOwnProfile() {}
      export const SUPABASE_URL = 'https://test.invalid';
      export const SUPABASE_PUBLISHABLE_KEY = 'test-key';
    `),
    stub('../lib/photoUpload', `
      const hosted = (u) => 'https://vevaty-media.b-cdn.net/listings/' + u;
      export async function uploadPhotos(uris) { return uris.map(hosted); }
      // Reached from listingMedia.ts as well as from AppStore. Mirrors the
      // real shape -- { uri, url, thumbnailUrl } per photo -- because
      // syncPhotoKind reads all three off it.
      export async function uploadPhotosWithThumbnails(uris) {
        return uris.map((u) => ({ uri: u, url: hosted(u), thumbnailUrl: hosted('thumb-' + u) }));
      }
    `),
    stub('../lib/bunnyVideo', `
      export async function attachVideoToListing() {}
      export async function deleteVideo() {}
      export function parseResolutions() { return null; }
    `),
    stub('../lib/moderateListing', `
      // Records the WHOLE argument list, not just the id. The call used to
      // carry the photos, the title and the description as well, and the
      // function judged what it was handed -- so the listing that was
      // checked and the listing that was published were two different
      // things (@MEDIA.md, "The check believed its caller"). A stub that
      // only remembered the id would not notice them coming back.
      export async function triggerListingModeration(...args) {
        (globalThis.__MODERATION_CALLS__ ||= []).push({ listingId: args[0], args });
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
// The invariant is the ORDER of the first three, not the total. AppStore
// has grown four more refs since (tRef and the three tester-status ones)
// and will grow others; what this test positionally depends on is only
// that userIdRef, profileRef and listingsRef are still the first three
// declared, in that order. Checking each one's distinct starting value is
// what would catch a reorder -- null, then an object, then an array.
check('AppStoreProvider declares at least 3 refs', refs.length >= 3, `got ${refs.length}`);
check('ref[0] (userIdRef) starts null', refs[0]?.current === null);
check('ref[1] (profileRef) starts an object, not an array',
  refs[1]?.current && typeof refs[1].current === 'object' && !Array.isArray(refs[1].current));
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

// Seeds BOTH halves of what updateListing reads: the store's own cache,
// and the row the server hands back when it re-reads the status before
// deciding anything. The second is the one that decides the transition --
// the cache is consulted only when that read fails.
const seedListing = (id, status, moderationStatus = null) => {
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
  globalThis.__LIVE_LISTING__ = { status, moderation_status: moderationStatus };
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
check('  ...and passes the id and nothing else',
  globalThis.__MODERATION_CALLS__[0]?.args?.length === 1,
  JSON.stringify(globalThis.__MODERATION_CALLS__[0]?.args?.length));
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

// 4. The repair path: a listing parked at 'pending_review' because its
//    photos never landed (see @MEDIA.md). Editing it must re-run
//    moderation -- that is the seller's only way back -- and, like every
//    other path, must send the id alone.
globalThis.__MODERATION_CALLS__ = [];
seedListing('item-parked', 'pending_review');
await value.updateListing('item-parked', basePayload({ status: undefined }));
check('editing a parked "pending_review" listing re-runs moderation',
  globalThis.__MODERATION_CALLS__.length === 1 && globalThis.__MODERATION_CALLS__[0].listingId === 'item-parked',
  JSON.stringify(globalThis.__MODERATION_CALLS__.map((c) => c.listingId)));
check('  ...with the id and nothing else',
  globalThis.__MODERATION_CALLS__[0]?.args?.length === 1);

// 5. The same listing with a human verdict on it. 'flagged' belongs to a
//    moderator, and an edit must not hand it back to the AI to overturn.
globalThis.__MODERATION_CALLS__ = [];
seedListing('item-flagged', 'pending_review', 'flagged');
await value.updateListing('item-flagged', basePayload({ status: undefined }));
check('editing a FLAGGED listing does not re-run moderation',
  globalThis.__MODERATION_CALLS__.length === 0,
  JSON.stringify(globalThis.__MODERATION_CALLS__.map((c) => c.listingId)));

console.log();
let allOk = true;
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `   (${r.detail})` : ''}`);
  allOk &&= r.ok;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}\n`);
process.exit(allOk ? 0 : 1);
