import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ContactOutcome, ContactPrompt, Listing, LISTING_STATUSES, ListingSaveErrorCode, ListingVideo, Profile, PointsEvent, SpinSet, Shop, ShopInput, Batch } from '../types';
import { SEED_LISTINGS } from '../data/seed';
import { DEFAULT_LISTING_LIFETIME_DAYS } from '../data/categories';
import { POINTS_RULES, tierForPoints } from '../data/points';
import { supabase, ensureSession } from '../lib/supabase';
import { uploadPhotos, uploadPhotosWithThumbnails } from '../lib/photoUpload';
import { attachVideoToListing, deleteVideo, parseResolutions } from '../lib/bunnyVideo';
import { uriToCompressedBase64 } from '../lib/imageToBase64';
import { triggerListingModeration } from '../lib/moderateListing';
import { slugify } from '../lib/slugify';
import { ALL_CONDITION_VALUES } from '../lib/conditionModes';

// Photos sent to the moderate-listing AI check -- capped the same way the
// other vision calls (Magic Listing/AI suggest) cap theirs, since the model
// only needs enough of the item to judge, not every angle.
const MODERATION_MAX_PHOTOS = 6;

const KEYS = {
  listings: 'vevaty:listings',
  profile: 'vevaty:profile',
  points: 'vevaty:pointsHistory',
};

const DEFAULT_PROFILE: Profile = {
  id: 'me',
  name: 'You',
  district: 'Beirut',
  points: 0,
  tier: 'Bronze',
  avatarUrl: null,
};

// Fields the caller never supplies directly -- addListing/updateListing
// compute or ignore these (status/expiresAt/expiryReminderSentAt are only
// ever changed via extendListing/republishListing, or by the server-side
// pg_cron expiry job).
// Exported so the batch screens (src/screens/batch/*.tsx) can type their
// own "take an existing listing, patch a couple of fields, updateListing"
// helper (src/lib/batchListingInput.ts) against the exact same shape
// addListing/updateListing themselves require, instead of re-deriving it
// or falling back to `any`.
export type ListingInput = Omit<
  Listing,
  'id' | 'createdAt' | 'sellerId' | 'sellerName' | 'rating' | 'status' | 'expiresAt' | 'expiryReminderSentAt'
  // Set by the database when buyers report a listing as already sold, and
  // cleared only by the seller restoring it -- never something a form
  // supplies. See LIFECYCLE.md.
  | 'autoHiddenAt'
  // Phase 4 item 16 -- computed from the poster's own account (join or
  // isVerified), never something the create-listing form itself supplies.
  | 'sellerVerified' | 'sellerMemberSince' | 'sellerAvatarUrl'
  // Content moderation -- addListing always starts a listing at
  // moderation_status 'pending' server-side (the DB trigger enforces this
  // for non-privileged callers too); the create-listing form never sets it.
  | 'moderationStatus' | 'moderationReason'
  // Storefronts -- shopId IS settable by the form now (CreateListingScreen's
  // "List this in my storefront" toggle, only shown when the seller has a
  // verified shop). shopNameEn/shopNameAr/shopSlug stay excluded: they're
  // read-only display/link fields derived from the shops join (see
  // dbListingToLocal) -- addListing/updateListing below fill them in
  // optimistically from AppStore's own myShop rather than trusting the
  // form to supply them, since the form only ever knows its own shop's id,
  // not a denormalized copy of that shop's current name/slug.
  | 'shopNameEn' | 'shopNameAr' | 'shopSlug'
  // Batch listings -- both optional below (ordinary single-item posts
  // never set either).
  | 'batchId' | 'batchParked'
> & {
  // Only ever set to 'draft' -- the unsaved-changes guard's "Save & exit"
  // uses this to park an incomplete new listing (or keep re-saving an
  // already-parked one) without running it through moderation or awarding
  // posting points. Omit entirely for a real submit; addListing/
  // updateListing compute the actual published status themselves rather
  // than trusting the caller with it, same reasoning as moderationStatus
  // above. See useUnsavedChangesGuard and CreateListingScreen's
  // buildPayload/saveAsDraftAndExit.
  status?: 'draft';
  // Batch listings (see Listing.batchId's own doc comment) -- set only by
  // the batch photo-capture screen's very first addListing call for an
  // item; every ordinary single-item post omits it (stored as null).
  // addListing is the only place this is ever read: updateListing
  // deliberately never writes batch_id, so a listing can't be moved out of
  // its batch later even via the ordinary single-item edit form (which the
  // batch final-review screen reuses to drill into an item).
  batchId?: string | null;
  // Batch listings -- settable by BatchDetailsScreen's "save this item as
  // a draft for later" escape hatch. Ordinary single-item posts omit it
  // (stored as false); unlike batchId, updateListing DOES write this one,
  // since parking/unparking an item is meant to happen after creation.
  batchParked?: boolean;
};

interface AppStoreValue {
  ready: boolean;
  online: boolean;
  // True once the current Supabase session belongs to a real, phone-
  // verified account rather than the silent anonymous session every
  // launch starts with (session.user.is_anonymous === false). Gates
  // posting a listing and revealing a seller's contact info -- see
  // MainTabs' "Sell an item" tab and ListingDetailScreen's contact CTA.
  isVerified: boolean;
  // False until the initial ensureSession() round-trip below has resolved
  // at least once. isVerified STARTS false on every launch (its default
  // state) and only flips true once that async check actually completes --
  // so a screen that gates on "if (!isVerified) bounce to Auth" and checks
  // that on first render, before this flag exists, incorrectly bounces a
  // verified user straight back out on a fresh page load / deep link,
  // before their real session has had a chance to load at all. Screens
  // with such a gate (CreateListingScreen, MyStorefrontScreen) must wait
  // for authChecked before treating isVerified===false as a real signal.
  authChecked: boolean;
  listings: Listing[];
  profile: Profile;
  pointsHistory: PointsEvent[];
  // The signed-in user's own storefront, if they've created one -- null
  // for the overwhelming majority of accounts (ordinary buyers/sellers
  // with no shop). Unlike `listings`, this is never a cache of other
  // people's data, so it's fetched once per sign-in (syncFromSupabase)
  // rather than needing its own AsyncStorage persistence.
  myShop: Shop | null;
  createShop: (s: ShopInput) => Promise<Shop>;
  updateShop: (s: ShopInput) => Promise<void>;
  // Batch listings -- see createBatch/completeBatch's own doc comments
  // (below, in the provider body) for why these aren't cached state like
  // myShop.
  createBatch: (domainId?: string | null) => Promise<Batch>;
  completeBatch: (batchId: string) => Promise<void>;
  addListing: (l: ListingInput) => Promise<Listing>;
  updateListing: (id: string, l: ListingInput) => Promise<void>;
  // Soft-deletes: sets status to 'removed' rather than dropping the row,
  // so admin can still pull up the listing (and its photos/video) for a
  // dispute -- see the My Listings feature's delete confirmation. Vanishes
  // from this seller's own `listings` immediately either way; a
  // server-side pg_cron job (purge-removed-listings) actually erases it,
  // photos, and video 15 days after removedAt.
  deleteListing: (id: string) => Promise<void>;
  // Resets a listing's 15-day clock without changing its status --
  // offered on Profile once a still-active listing is within a day of
  // expiring (the same window the WhatsApp reminder fires in).
  extendListing: (id: string) => Promise<void>;
  // Brings an 'expired' ("Unpublished") listing back to 'active' with a
  // fresh 15-day clock.
  republishListing: (id: string) => Promise<void>;
  // My Listings' "Hide Listing" action -- takes a published listing off
  // the market by turning it back into a draft, same status a listing
  // sits in before its first publish. No confirmation prompt (unlike
  // delete/markListingSold): the seller can always resume and republish
  // it later exactly like any other draft.
  hideListing: (id: string) => Promise<void>;
  // My Listings' "Item Sold" action. soldVia is bookkeeping only (which
  // option the seller picked in the confirmation sheet) -- it doesn't
  // change what buyers/sellers see anywhere yet.
  markListingSold: (id: string, soldVia: 'vevaty' | 'elsewhere') => Promise<void>;
  // "Did you reach the seller?" -- one per listing this buyer made real
  // contact with more than a day ago and has not answered about yet. See
  // LIFECYCLE.md for why the buyer is asked rather than the seller.
  contactPrompts: ContactPrompt[];
  answerContactPrompt: (listingId: string, outcome: ContactOutcome) => Promise<void>;
  // The seller's one tap back after buyers hid their listing.
  restoreAutoHiddenListing: (id: string) => Promise<void>;
  awardPoints: (amount: number, label: string) => Promise<void>;
  // Persists a new avatar (already uploaded to Bunny by the caller, same
  // as shop logos -- see MyStorefrontScreen's pickLogo) to profiles.avatar_url
  // and local state; pass null to clear it back to the generic icon.
  updateAvatar: (url: string | null) => Promise<void>;
  // ProfileScreen's "Edit your profile" menu -- same immediate-local-state,
  // awaited-DB-write shape as updateAvatar above, so EditNameScreen/
  // EditLocationScreen can show a save error rather than the change
  // silently not sticking.
  updateProfileName: (name: string) => Promise<void>;
  updateProfileDistrict: (district: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Calls the delete-account edge function (cleans up myazar-schema data
  // via a SECURITY DEFINER RPC, then removes the auth identity itself with
  // the service-role key), then wipes local state exactly like signOut.
  // Throws with a user-facing message on failure -- ProfileScreen is
  // expected to catch it and show the error rather than navigate away.
  deleteAccount: () => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

function dbTierToLocal(tier: string | null | undefined): Profile['tier'] {
  if (tier === 'silver') return 'Silver';
  if (tier === 'gold' || tier === 'diamond') return 'Gold';
  return 'Bronze';
}

// Splits the flat listing_photos join into its two kinds -- 'gallery' (the
// normal listing photos) and 'spin' (the 360° spin-viewer frame sequence,
// Phase 3 item 7). Both share one table/one set of RLS policies; `kind`
// just partitions the ordering (`sort_order` is scoped per listing+kind,
// not globally per listing). Note: this feature does NOT read or write
// listings.has_3d_model/model_3d_url/model_3d_status -- those three columns
// are reserved for a possible future real-photogrammetry feature (roadmap
// item 13), a different thing from this frame-based spin viewer.
function sortedByKind(rows: any[], kind: 'gallery' | 'spin'): string[] {
  return rows
    .filter((p: any) => (p.kind || 'gallery') === kind)
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((p: any) => p.url);
}

// The thumbnail_url of the cover ('gallery' kind, lowest sort_order) photo,
// or null if that row predates thumbnail_url (see the listing_photos
// migration) or has none for any other reason. ListingCard is the only
// thing that ever needs this -- it's the only photo a card shows -- so this
// stays one field on Listing rather than a thumbnail threaded through every
// screen that reads .photos.
function coverThumbnail(rows: any[]): string | null {
  const gallery = rows
    .filter((p: any) => (p.kind || 'gallery') === 'gallery')
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return gallery[0]?.thumbnail_url ?? null;
}

// Groups the kind='spin' rows of a listing_photos join by their
// spin_set_id, ordered by each myazar.listing_spin_sets row's own
// sort_order, then by sort_order within the set. A listing can have zero,
// one, or several named spins (e.g. "Exterior"/"Interior" for a car, one
// per room for a property) -- see the SpinSet type and its doc comment.
function spinSetsFromRows(photoRows: any[], spinSetRows: any[]): SpinSet[] {
  const spinPhotoRows = photoRows.filter((p: any) => p.kind === 'spin');
  return (Array.isArray(spinSetRows) ? spinSetRows : [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((s: any) => ({
      id: s.id,
      label: s.label || '',
      frames: spinPhotoRows
        .filter((p: any) => p.spin_set_id === s.id)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((p: any) => p.url),
    }));
}

// Defends against a real crash found in production right after the Phase 3
// item 7 (360 spin) deploy: listings cached in AsyncStorage by an OLDER
// build of the app (before `spinPhotos` existed on the Listing type) are
// loaded verbatim on step 1 below, before the Supabase re-sync in step 2
// even starts. Any component reading `listing.spinPhotos.length` (the
// spin badge on ListingCard, the Photos/360 toggle on ListingDetailScreen)
// would throw on that stale cached shape -- which is exactly what
// happened: a blank white screen on load for anyone with a pre-existing
// local listings cache, since JSON.parse'd cache data skips
// dbListingToLocal entirely. Normalizing every cached listing here, right
// after reading it back out of AsyncStorage, is the one place that
// guarantees every downstream consumer can trust these arrays exist.
// Which values a database row's `condition` is allowed to be, checked by
// both read paths below. ALL_CONDITION_VALUES is DERIVED from the pickers
// that produce them (src/lib/conditionModes.ts) rather than being a list
// typed out here -- which is what it used to be, and it drifted: 'free'
// was added to the type, the CHECK constraint and every screen, and
// silently became null on the way back out, so a pet given away read as
// "Free" to the seller who posted it and as "$0" to everybody else, for
// as long as the app stayed open.

// A FALLBACK, not the rule. How long a listing lives is a property of its
// category now (see LIFECYCLE.md), resolved nearest-ancestor-first, and
// the database is what applies it: a BEFORE INSERT trigger sets
// expires_at, and extend/republish go through RPCs that resolve it
// server-side. This constant is only reached where a row arrives with no
// expiry at all -- a cached listing written before the column existed --
// and it is deliberately the same number the database falls back to, so
// the two halves of that answer cannot disagree.
const LISTING_LIFETIME_MS = DEFAULT_LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

// Why a code and not just a message: the sentence a seller should read
// has to be translated, and the one PostgREST hands back cannot be --
// "permission denied for column batch_parked" under an Arabic title
// helps nobody, and is not what they need to know anyway (which is
// whether anything was saved and whether to press the button again).
// The code lets each screen say the right thing in the right language;
// the raw text goes to the console, where it is actually useful. Screens
// turn the code back into a sentence with listingActionMessage (see
// lib/listingActionMessage.ts) rather than each writing the same ternary.
//
// Module scope, not inside the provider: it closes over nothing, and
// living inside meant every callback that used it either re-created
// itself each render or captured a stale copy of a pure function.
// Per-listing update counter, read by updateListing's rollback -- see
// its own comment. Module scope because it has to outlive any single
// render, and keyed by listing id so two different listings being edited
// at once never see each other's numbers.
const updateListingSeq = new Map<string, number>();

const listingSaveError = (code: ListingSaveErrorCode, technical?: string) =>
  Object.assign(new Error(technical || code), { code });

// One row of `listings`, changed by its own seller: the shape every
// status action below has (delete, extend, republish, hide, sold).
//
// Two things it does that none of them used to. It reads the error --
// they all discarded it, so a refused write was indistinguishable from a
// saved one. And it checks that a row actually MATCHED: a PostgREST
// update touching nothing is not an error, it is a silent success, so a
// listing whose seller_id no longer matches (an admin moved it, the
// session is signed in as someone else) reported "hidden" while staying
// on the site. `.select('id')` is what makes the difference visible --
// the seller can still read their own row whatever its status, since the
// SELECT policy is `status = 'active' OR seller_id = auth.uid()`, so a
// row coming back empty really does mean nothing was written.
async function updateOwnListingRow(
  id: string,
  uid: string | null,
  patch: Record<string, unknown>,
  what: string,
  // The status this write is supposed to leave behind, checked against
  // what actually came back. There is a third way for one of these to
  // fail that neither the error nor the row count can see:
  // enforce_listing_moderation_gate is a BEFORE UPDATE trigger that
  // rewrites new.status back to old.status rather than raising, so the
  // statement succeeds, a row is returned, and nothing changed. Reading
  // the status back is the only way to tell that apart from a real save.
  //
  // No screen can reach it today: the gate only blocks a move to 'active'
  // from pending_review/rejected/draft, and Republish is offered on
  // 'expired' alone (MyListingsScreen). It is here so that the day a
  // hidden listing gets its own Republish button -- draft IS in the gate's
  // list -- it fails loudly instead of doing nothing forever.
  expectStatus?: string
) {
  if (!uid) throw listingSaveError('not-signed-in');
  const { data, error } = await supabase
    .from('listings')
    .update(patch)
    .eq('id', id)
    .eq('seller_id', uid)
    .select('id, status');
  if (error || !data || data.length === 0) {
    console.warn(`[AppStore] ${what} refused:`, error?.message || 'no row matched');
    throw listingSaveError('refused', error?.message);
  }
  if (expectStatus && data[0].status !== expectStatus) {
    console.warn(`[AppStore] ${what} was reverted by the database: asked for`, expectStatus, 'got', data[0].status);
    throw listingSaveError('needs-review', `status stayed ${data[0].status}`);
  }
}

function normalizeListing(l: any): Listing {
  return {
    ...l,
    photos: Array.isArray(l?.photos) ? l.photos : [],
    // Same defensive story as photos above: a listing cached by a build
    // that predates thumbnail_url has no such field on it at all.
    coverThumbnailUrl: l?.coverThumbnailUrl ?? null,
    // Same defensive story as photos above: a listing cached by an older
    // build (before spinSets replaced the flat spinPhotos field) won't
    // have this field, or will still have the old shape -- either way,
    // default to empty rather than let a stale/wrong shape reach a
    // component expecting SpinSet[].
    spinSets: Array.isArray(l?.spinSets) ? l.spinSets : [],
    // Exactly the same defensive story once more, for exactly the same
    // reason: a listing cached by a build that predates video has no such
    // field, and anything reading `listing.video.status` without a guard
    // would take the whole render tree down on first load -- which is what
    // the 360-spin deploy actually did in production.
    video:
      l?.video && typeof l.video === 'object' && typeof l.video.guid === 'string'
        ? { ...l.video, resolutions: Array.isArray(l.video.resolutions) ? l.video.resolutions : null }
        : null,
    // Same defensive story as photos/spinSets above: a listing cached by
    // a build that predates the login-gate/expiry feature won't have
    // these fields at all.
    status: (LISTING_STATUSES as readonly string[]).includes(l?.status) ? l.status : 'active',
    // Content moderation -- same defensive story as status above: a
    // listing cached by a build that predates this feature won't have
    // these fields at all.
    moderationStatus: ['pending', 'ai_approved', 'flagged', 'human_approved', 'rejected'].includes(l?.moderationStatus) ? l.moderationStatus : 'ai_approved',
    moderationReason: typeof l?.moderationReason === 'string' ? l.moderationReason : null,
    expiresAt: typeof l?.expiresAt === 'number' ? l.expiresAt : Date.now() + LISTING_LIFETIME_MS,
    expiryReminderSentAt: typeof l?.expiryReminderSentAt === 'number' ? l.expiryReminderSentAt : null,
    autoHiddenAt: typeof l?.autoHiddenAt === 'number' ? l.autoHiddenAt : null,
    // Phase 4 item 14 -- same defensive story as photos/spinSets/status
    // above: a listing cached by a build that predates this field won't
    // have it at all.
    contactMethod: l?.contactMethod === 'phone' || l?.contactMethod === 'chat' || l?.contactMethod === 'both' ? l.contactMethod : 'both',
    // Phase 4 item 16 -- same defensive story again: a listing cached by a
    // build that predates the verified-badge/member-since fields won't
    // have them. false/"unknown join never happened" is the safe default
    // for sellerVerified; sellerMemberSince falls back to the listing's
    // own createdAt, which is always at least as old as the account that
    // posted it.
    sellerVerified: typeof l?.sellerVerified === 'boolean' ? l.sellerVerified : false,
    sellerMemberSince: typeof l?.sellerMemberSince === 'number' ? l.sellerMemberSince : (typeof l?.createdAt === 'number' ? l.createdAt : Date.now()),
    // Same defensive story: a listing cached before this field existed.
    sellerAvatarUrl: typeof l?.sellerAvatarUrl === 'string' ? l.sellerAvatarUrl : null,
    // Map-locator feature -- same defensive story again: a listing cached
    // by a build that predates governorate/caza/geonameId won't have them.
    governorate: typeof l?.governorate === 'string' ? l.governorate : null,
    caza: typeof l?.caza === 'string' ? l.caza : null,
    geonameId: typeof l?.geonameId === 'number' ? l.geonameId : null,
    // Storefronts -- same defensive story once more: a listing cached by a
    // build that predates shop_id won't have these fields at all, and the
    // overwhelming majority of listings (anyone not posted through a shop)
    // never have them regardless of build age.
    shopId: typeof l?.shopId === 'string' ? l.shopId : null,
    shopNameEn: typeof l?.shopNameEn === 'string' ? l.shopNameEn : null,
    shopNameAr: typeof l?.shopNameAr === 'string' ? l.shopNameAr : null,
    shopSlug: typeof l?.shopSlug === 'string' ? l.shopSlug : null,
    // Stock/variants -- same defensive story once more: a listing cached
    // by a build that predates this feature won't have these fields, and
    // the DB default (stock_qty 1, variants null) is exactly what every
    // 'unique'-mode listing should read as anyway.
    stockQty: typeof l?.stockQty === 'number' ? l.stockQty : 1,
    variants: Array.isArray(l?.variants) ? l.variants : null,
    // New/used, or (Properties only) sale/rent/both -- same defensive
    // story as everything above: a listing cached by a build that
    // predates this field, or predates the Properties Sale/Rent/Both
    // repurposing of it, simply has no opinion, same as one where the
    // seller's pick genuinely never made it to the DB (see
    // dbListingToLocal's own condition mapping).
    condition:
      ALL_CONDITION_VALUES.includes(l?.condition) ? (l.condition as Listing['condition']) : null,
    // Rent pricing (usesOfferType categories only) -- same defensive story: a
    // listing cached by a build that predates these fields has none of
    // them, which reads correctly as "no rent terms on file", exactly
    // what every sale-only and non-property listing carries anyway. price
    // itself rides the spread above and is NOT NULL in the DB.
    rentPrice: typeof l?.rentPrice === 'number' ? l.rentPrice : null,
    // Day and week are for vehicle hire; month and year for property.
    // Kept in step with RENT_PERIODS and the listings_rent_period_check
    // constraint -- a value missing from this list is silently dropped
    // on read, which turns a $50/day car hire back into a bare $50.
    rentPeriod: ['day', 'week', 'month', 'year'].includes(l?.rentPeriod) ? l.rentPeriod : null,
    rentPaymentFrequency:
      l?.rentPaymentFrequency === 'monthly' ||
      l?.rentPaymentFrequency === 'quarterly' ||
      l?.rentPaymentFrequency === 'semiannual' ||
      l?.rentPaymentFrequency === 'annual'
        ? l.rentPaymentFrequency
        : null,
    // Batch listings -- same defensive story once more: a listing cached
    // by a build that predates this feature won't have these fields, and
    // the overwhelming majority of listings (anything not posted through
    // a batch) never have batchId set regardless of build age.
    batchId: typeof l?.batchId === 'string' ? l.batchId : null,
    batchParked: typeof l?.batchParked === 'boolean' ? l.batchParked : false,
  };
}

// The listing_videos join comes back as an array (it is a one-to-many
// relationship in Postgres even though the product rule allows exactly one
// row per listing, enforced by a partial unique index). Anything not yet
// 'ready' is dropped for everyone except the owner by RLS, so a row arriving
// here at all already means it is showable.
function videoFromRows(rows: any): ListingVideo | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.bunny_guid) return null;
  return {
    guid: row.bunny_guid,
    status: row.status || 'processing',
    durationS: row.duration_s != null ? Number(row.duration_s) : null,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    resolutions: parseResolutions(row.resolutions),
  };
}

// The embed list every listing read uses, and the mapper that turns a row
// into a Listing. Both exported for ONE caller outside this file: the
// auction screens, whose lots are listings this store deliberately does
// not hold (see the `.neq('status','auction')` above). They need the same
// shape -- photos, spin sets, video -- to render the same components, and
// a second hand-written copy of a fifteen-table embed is exactly the kind
// of duplicate that drifts.
export const LISTING_SELECT_HEAD =
  '*, seller:profiles!listings_seller_id_fkey(full_name, is_phone_verified, created_at, avatar_url), ' +
  'photos:listing_photos(url, sort_order, kind, spin_set_id, thumbnail_url), ' +
  'spinSets:listing_spin_sets(id, label, sort_order), ' +
  'video:listing_videos(bunny_guid, status, duration_s, width, height, resolutions), ';

export function dbListingToLocal(row: any): Listing {
  const rows = Array.isArray(row.photos) ? row.photos : [];
  const photos = sortedByKind(rows, 'gallery');
  const coverThumbnailUrl = coverThumbnail(rows);
  const spinSets = spinSetsFromRows(rows, Array.isArray(row.spinSets) ? row.spinSets : []);
  return {
    id: row.id,
    // null means "not classified yet" -- a batch draft whose photos are
    // still being taken. Mapped to '' at this boundary so nothing
    // downstream has to learn a third state: every read site already
    // treats an unknown category defensively (categoryById returning
    // undefined, cat?.icon optional-chained).
    cat: row.category_id ?? '',
    titleEn: row.title_en ?? '',
    titleAr: row.title_ar ?? '',
    descriptionEn: row.description_en ?? '',
    descriptionAr: row.description_ar ?? '',
    price: Number(row.price) || 0,
    // Rent pricing -- null for every sale-only listing, every category
    // that doesn't use offer types, and anything posted before these
    // columns existed. Number() guards the numeric column the same way price/lat/
    // lng above do; the two text columns are already constrained to their
    // allowed values by CHECK constraints in the database, and are read
    // back defensively here regardless.
    rentPrice: row.rent_price != null ? Number(row.rent_price) : null,
    rentPeriod: ['day', 'week', 'month', 'year'].includes(row.rent_period) ? row.rent_period : null,
    rentPaymentFrequency:
      row.rent_payment_frequency === 'monthly' ||
      row.rent_payment_frequency === 'quarterly' ||
      row.rent_payment_frequency === 'semiannual' ||
      row.rent_payment_frequency === 'annual'
        ? row.rent_payment_frequency
        : null,
    district: row.district ?? '',
    governorate: row.governorate ?? null,
    caza: row.caza ?? null,
    geonameId: row.geoname_id != null ? Number(row.geoname_id) : null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    photos, // Bunny CDN URLs from upload-photo, not Supabase Storage
    coverThumbnailUrl,
    spinSets,
    video: videoFromRows(row.video), // hosted on Bunny Stream, not either of those

    sellerName: row.seller?.full_name || 'Vevaty user',
    sellerId: row.seller_id,
    rating: 5,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    aiGenerated: !!row.ai_generated,
    attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes : {},
    status: row.status || 'active',
    moderationStatus: row.moderation_status || 'ai_approved',
    moderationReason: row.moderation_reason ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : Date.now() + LISTING_LIFETIME_MS,
    expiryReminderSentAt: row.expiry_reminder_sent_at ? new Date(row.expiry_reminder_sent_at).getTime() : null,
    autoHiddenAt: row.auto_hidden_at ? new Date(row.auto_hidden_at).getTime() : null,
    contactMethod: row.contact_method === 'phone' || row.contact_method === 'chat' ? row.contact_method : 'both',
    sellerVerified: !!row.seller?.is_phone_verified,
    sellerMemberSince: row.seller?.created_at
      ? new Date(row.seller.created_at).getTime()
      : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
    sellerAvatarUrl: row.seller?.avatar_url ?? null,
    // Storefronts -- row.shop is null for the vast majority of listings
    // (shop_id itself is null, so PostgREST's embed has nothing to join).
    // See the Listing type's doc comment for why these four travel
    // together rather than being looked up again downstream.
    shopId: row.shop_id ?? null,
    shopNameEn: row.shop?.name_en ?? null,
    shopNameAr: row.shop?.name_ar ?? null,
    shopSlug: row.shop?.slug ?? null,
    // Stock/variants -- variants is app-defined JSONB (not a join), so its
    // shape on the wire already matches ListingVariant[] one-for-one; this
    // just guards against a malformed/legacy row rather than converting
    // anything. stock_qty has a DB-level NOT NULL default of 1, but Number()
    // still guards the same way price/lat/lng above do.
    stockQty: row.stock_qty != null ? Number(row.stock_qty) : 1,
    variants: Array.isArray(row.variants) ? row.variants : null,
    // New/used, or (Properties only) sale/rent/both -- null for any
    // listing posted before this field existed, or for the pre-existing
    // seed rows this migration collapsed from a more granular (and never
    // actually seller-facing) used-condition scale. See the Listing
    // type's own doc comment.
    condition:
      ALL_CONDITION_VALUES.includes(row.condition) ? (row.condition as Listing['condition']) : null,
    batchId: row.batch_id ?? null,
    batchParked: !!row.batch_parked,
  };
}

// Maps a myazar.shops row to the local Shop shape -- used for the
// signed-in user's own shop (myShop below). StorefrontScreen does its own
// smaller version of this for a public by-slug fetch, which doesn't need
// (and per RLS's column-blind-but-row-gated visibility, shouldn't bother
// requesting) verification_note -- that's private bookkeeping for the
// owner, not something a visitor's storefront view has any use for.
function dbShopToLocal(row: any): Shop {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    nameEn: row.name_en,
    nameAr: row.name_ar ?? null,
    taglineEn: row.tagline_en ?? null,
    taglineAr: row.tagline_ar ?? null,
    logoUrl: row.logo_url ?? null,
    coverUrl: row.cover_url ?? null,
    governorate: row.governorate ?? null,
    caza: row.caza ?? null,
    addressLine: row.address_line ?? null,
    whatsapp: row.whatsapp ?? null,
    phone: row.phone ?? null,
    primaryCategoryId: row.primary_category_id ?? null,
    domainId: row.domain_id ?? null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).getTime() : null,
    verificationNote: row.verification_note ?? null,
  };
}

// Maps a myazar.batches row to the local Batch shape -- used by
// createBatch/completeBatch below. Unlike myShop, a Batch is never cached
// as AppStoreValue state: the batch screens only ever need the id they got
// back from createBatch (to tag each item's addListing call and read the
// listings back by batchId), so there's nothing to keep in sync here.
function dbBatchToLocal(row: any): Batch {
  return {
    id: row.id,
    sellerId: row.seller_id,
    status: row.status === 'submitted' ? 'submitted' : 'in_progress',
    itemCount: row.item_count ?? 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    domainId: row.domain_id || null,
  };
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [pointsHistory, setPointsHistory] = useState<PointsEvent[]>([]);
  const [myShop, setMyShop] = useState<Shop | null>(null);
  const userIdRef = useRef<string | null>(null);
  const profileRef = useRef<Profile>(DEFAULT_PROFILE);
  const listingsRef = useRef<Listing[]>([]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);

  // 1) Load whatever's cached on-device immediately, so the app is usable
  // instantly, even offline or before the network round-trip below finishes.
  useEffect(() => {
    (async () => {
      try {
        const [rawListings, rawProfile, rawPoints] = await Promise.all([
          AsyncStorage.getItem(KEYS.listings),
          AsyncStorage.getItem(KEYS.profile),
          AsyncStorage.getItem(KEYS.points),
        ]);
        const parsedListings = rawListings ? JSON.parse(rawListings) : SEED_LISTINGS;
        setListings(Array.isArray(parsedListings) ? parsedListings.map(normalizeListing) : SEED_LISTINGS);
        setProfile(rawProfile ? JSON.parse(rawProfile) : DEFAULT_PROFILE);
        setPointsHistory(rawPoints ? JSON.parse(rawPoints) : []);
      } catch (e) {
        setListings(SEED_LISTINGS);
        setProfile(DEFAULT_PROFILE);
        setPointsHistory([]);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // 2) In the background, sign in (anonymously, silently, no login screen)
  // and pull the real data from Supabase. If this fails — offline, backend
  // hiccup, whatever — the app just keeps running on the local cache above.
  const syncFromSupabase = useCallback(async (uid: string) => {
    try {
      userIdRef.current = uid;
      const cached = profileRef.current;

      // Explicit column list, not select('*') -- `phone` has no SELECT grant
      // for anon/authenticated (see supabase.ts's ensureSession comment and
      // the get_seller_phone() RPC), so a select('*') here 403s for every
      // visitor and silently breaks profile sync (see AGENTS.md/session notes).
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, full_name, district, points, tier, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      if (!existingProfile) {
        await supabase.from('profiles').insert({
          id: uid,
          full_name: cached.name !== 'You' ? cached.name : null,
          district: cached.district || null,
          points: cached.points || 0,
          tier: cached.tier.toLowerCase(),
        });
        setProfile((p) => ({ ...p, id: uid }));
      } else {
        setProfile((p) => ({
          ...p,
          id: uid,
          name: existingProfile.full_name || p.name,
          district: existingProfile.district || p.district,
          points: existingProfile.points ?? p.points,
          tier: dbTierToLocal(existingProfile.tier),
          avatarUrl: existingProfile.avatar_url ?? p.avatarUrl,
        }));
      }

      // The signed-in user's own shop, if any -- at most one row (no
      // unique constraint enforces that today, but nothing in the app
      // creates a second one; see createShop below). Not part of the
      // listings/profile error handling above since a shop lookup failing
      // shouldn't be treated as seriously as the listings feed failing --
      // it only affects the "My Storefront" entry point, not browsing.
      const { data: shopRow } = await supabase
        .from('shops')
        .select('id, owner_id, slug, name_en, name_ar, tagline_en, tagline_ar, logo_url, cover_url, governorate, caza, address_line, whatsapp, phone, primary_category_id, domain_id, verified_at, verification_note')
        .eq('owner_id', uid)
        .maybeSingle();
      setMyShop(shopRow ? dbShopToLocal(shopRow) : null);

      const { data: listingRows, error } = await supabase
        .from('listings')
        .select(
          LISTING_SELECT_HEAD +
            // Storefronts -- null for the ~all listings with no shop_id;
            // PostgREST returns null (not []) for a to-one embed via a
            // plain FK, so row.shop is a single object or null, matching
            // the ?. access in dbListingToLocal.
            'shop:shops(slug, name_en, name_ar)'
        )
        // A seller's own 'removed' rows are still readable under RLS (the
        // same "active OR mine" policy that lets drafts/rejected show up
        // here) -- excluded here so a soft-deleted listing actually stays
        // gone from My Listings/Profile after a refetch, not just until
        // the next app reload. Nobody else's 'removed' rows were ever
        // reachable through this query to begin with.
        .neq('status', 'removed')
        // An auction lot is a listing carrying status 'auction', and this
        // is the ONE place it is kept out of the marketplace. Every browse
        // surface -- the grids, search, collections, storefronts, related
        // listings -- filters this same client-side array, so excluding it
        // here excludes it everywhere, and forgetting it here would put a
        // consigned watch with no price and no contact button into Hot
        // Deals. RLS deliberately does NOT hide these rows: the auction
        // screens have to be able to read them. See AUCTIONS.md.
        .neq('status', 'auction')
        .order('created_at', { ascending: false });

      if (error) {
        // Worth saying out loud. A malformed embed in the select above (a
        // renamed table, a foreign key PostgREST can't resolve) fails the
        // WHOLE listings fetch, and the catch below would then quietly fall
        // back to cached data -- an app that looks fine while showing
        // yesterday's listings is far harder to diagnose than one that
        // complains.
        console.warn('[AppStore] listings fetch failed:', error.message);
      } else {
        setOnline(true);
        if (listingRows) {
          setListings(listingRows.map(dbListingToLocal));
        }
      }
    } catch (e) {
      // Offline or backend unreachable — silently keep using local data.
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const session = await ensureSession().catch(() => null);
        setIsVerified(!!session && session.user?.is_anonymous === false);
        const uid = session?.user?.id;
        if (uid) await syncFromSupabase(uid);
      } finally {
        // Only after this resolves does isVerified===false actually mean
        // "not verified" rather than "haven't checked yet" -- see
        // authChecked's doc comment above.
        setAuthChecked(true);
      }
    })();
    // Intentionally only runs once, on launch — the auth-state-change
    // subscription below handles re-syncing after that (e.g. the admin
    // panel signing this session into a different account, or a seller
    // completing phone verification via AuthScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync whenever the Supabase auth session's identity actually
  // changes -- most notably, signing in/out of the admin panel swaps the
  // shared Supabase client's session, and without this the rest of the
  // app would keep posting listings/points under the stale previous uid.
  // This is also how isVerified flips true right after AuthScreen's
  // verifyOtp succeeds -- that call replaces the anonymous session with a
  // real one, which fires this listener with is_anonymous: false.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsVerified(!!session && session.user?.is_anonymous === false);
      const uid = session?.user?.id;
      if (uid && uid !== userIdRef.current) {
        syncFromSupabase(uid);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [syncFromSupabase]);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEYS.listings, JSON.stringify(listings)).catch(() => {});
  }, [listings, ready]);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEYS.profile, JSON.stringify(profile)).catch(() => {});
  }, [profile, ready]);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEYS.points, JSON.stringify(pointsHistory)).catch(() => {});
  }, [pointsHistory, ready]);

  const awardPoints = useCallback(async (amount: number, label: string) => {
    let nextPoints = 0;
    let nextTier: Profile['tier'] = 'Bronze';
    setProfile((p) => {
      nextPoints = p.points + amount;
      nextTier = tierForPoints(nextPoints);
      return { ...p, points: nextPoints, tier: nextTier };
    });
    setPointsHistory((h) => [{ id: `pe-${Date.now()}`, label, amount, createdAt: Date.now() }, ...h]);

    const uid = userIdRef.current;
    if (uid) {
      supabase.from('points_transactions').insert({ user_id: uid, points: amount, reason: label }).then();
      supabase.from('profiles').update({ points: nextPoints, tier: nextTier.toLowerCase() }).eq('id', uid).then();
    }
  }, []);

  // Local state updates immediately (the profile hero re-renders with the
  // new photo right away); the DB write is awaited so the caller -- the
  // avatar picker on ProfileScreen -- can show an error if it fails,
  // rather than the change silently not sticking past this app session.
  // Doesn't touch listings' already-denormalized sellerAvatarUrl -- same as
  // every other profile field, that catches up on the next syncFromSupabase.
  const updateAvatar = useCallback(async (url: string | null) => {
    setProfile((p) => ({ ...p, avatarUrl: url }));
    const uid = userIdRef.current;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
    if (error) throw error;
  }, []);

  // Same shape as updateAvatar -- a plain `.update()`, not an upsert
  // (see upsertOwnProfile's comment in lib/supabase.ts for why upsert
  // doesn't work on this table): by the time a verified user reaches
  // ProfileScreen's edit menu, syncFromSupabase has already guaranteed a
  // profiles row exists for their uid, so there's never a conflict to
  // resolve here.
  const updateProfileName = useCallback(async (name: string) => {
    setProfile((p) => ({ ...p, name }));
    const uid = userIdRef.current;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ full_name: name }).eq('id', uid);
    if (error) throw error;
  }, []);

  const updateProfileDistrict = useCallback(async (district: string) => {
    setProfile((p) => ({ ...p, district }));
    const uid = userIdRef.current;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ district }).eq('id', uid);
    if (error) throw error;
  }, []);

  // Uploads newly-added local photo URIs for the listing's "gallery" kind
  // and inserts the resulting hosted-URL rows. Used by addListing's
  // fire-and-forget background upload path. Spin sets have their own
  // persistNewSpinSets below, not this -- unlike a flat photo list, each
  // spin set is also its own myazar.listing_spin_sets row (id + label),
  // not just more listing_photos rows, so it needs its own insert order
  // (set row first, then its frames referencing that id).
  const persistNewPhotos = useCallback(
    async (
      listingId: string,
      uris: string[],
      kind: 'gallery' | 'spin'
    ): Promise<{ urls: string[]; coverThumbnailUrl: string | null }> => {
      if (uris.length === 0) return { urls: [], coverThumbnailUrl: null };
      // Only gallery photos are ever a card's cover -- spin frames get the
      // plain upload, same as before, with no thumbnail generated for them.
      if (kind === 'gallery') {
        const uploaded = await uploadPhotosWithThumbnails(uris);
        if (uploaded.length > 0) {
          await supabase.from('listing_photos').insert(
            uploaded.map((u, i) => ({
              listing_id: listingId,
              url: u.url,
              thumbnail_url: u.thumbnailUrl,
              sort_order: i,
              kind,
            }))
          );
        }
        return { urls: uploaded.map((u) => u.url), coverThumbnailUrl: uploaded[0]?.thumbnailUrl ?? null };
      }
      const hostedUrls = await uploadPhotos(uris);
      if (hostedUrls.length > 0) {
        await supabase
          .from('listing_photos')
          .insert(hostedUrls.map((url, i) => ({ listing_id: listingId, url, sort_order: i, kind })));
      }
      return { urls: hostedUrls, coverThumbnailUrl: null };
    },
    []
  );

  // Uploads newly-added local photo URIs for each of a listing's spin sets
  // and inserts both the myazar.listing_spin_sets row (label/sort_order)
  // and the resulting hosted-URL listing_photos rows (kind='spin',
  // spin_set_id pointing at that set). Used by addListing's fire-and-
  // forget background upload path, mirroring persistNewPhotos above but
  // one level deeper since each set is its own row, not just more photos.
  // Sets with zero frames (the seller started one and backed out) are
  // skipped entirely -- nothing to create a row for.
  const persistNewSpinSets = useCallback(async (listingId: string, sets: SpinSet[]): Promise<SpinSet[]> => {
    const nonEmpty = sets.filter((s) => s.frames.length > 0);
    const results: SpinSet[] = [];
    for (let i = 0; i < nonEmpty.length; i++) {
      const set = nonEmpty[i];
      const { data: setRow, error: setError } = await supabase
        .from('listing_spin_sets')
        .insert({ listing_id: listingId, label: set.label, sort_order: i })
        .select()
        .single();
      if (setError || !setRow) continue; // best-effort, same spirit as uploadPhotos skipping a failed frame
      const hostedUrls = await uploadPhotos(set.frames);
      if (hostedUrls.length > 0) {
        await supabase
          .from('listing_photos')
          .insert(hostedUrls.map((url, frameIdx) => ({ listing_id: listingId, url, sort_order: frameIdx, kind: 'spin', spin_set_id: setRow.id })));
      }
      results.push({ id: setRow.id, label: set.label, frames: hostedUrls });
    }
    return results;
  }, []);

  // Diffs a listing's desired GALLERY photo set against what's on
  // Supabase: deletes rows that were removed, uploads+inserts newly-picked
  // local photos in the background (same fire-and-forget lifecycle as
  // addListing, so the seller isn't blocked waiting on uploads), and
  // re-syncs sort_order for kept photos when there's nothing new to upload.
  // Spin sets are edited as whole units (add/remove/rename/retake a whole
  // spin, not individual frames within one that's kept), so they go
  // through syncSpinSets below instead of this per-frame diff -- see its
  // own comment for why that one's a full replace rather than a diff.
  const syncPhotoKind = useCallback(
    async (listingId: string, kind: 'gallery', desiredUris: string[]) => {
      const hostedKept = desiredUris.filter((p) => /^https?:\/\//.test(p));
      const localNew = desiredUris.filter((p) => !/^https?:\/\//.test(p));

      const { data: existingRows } = await supabase
        .from('listing_photos')
        .select('id, url')
        .eq('listing_id', listingId)
        .eq('kind', kind);
      const removed = (existingRows || []).filter((row: any) => !hostedKept.includes(row.url));
      if (removed.length > 0) {
        await supabase.from('listing_photos').delete().in('id', removed.map((r: any) => r.id));
      }

      if (localNew.length > 0) {
        uploadPhotosWithThumbnails(localNew)
          .then(async (uploaded) => {
            if (uploaded.length === 0) return;
            const startOrder = hostedKept.length;
            await supabase.from('listing_photos').insert(
              uploaded.map((u, i) => ({
                listing_id: listingId,
                url: u.url,
                thumbnail_url: u.thumbnailUrl,
                sort_order: startOrder + i,
                kind,
              }))
            );
            const newPhotoUrls = uploaded.map((u) => u.url);
            setListings((prev) =>
              prev.map((it) => {
                if (it.id !== listingId) return it;
                // The cover is always index 0. If any kept photo remains,
                // it's still the cover and its thumbnail is unchanged; only
                // when EVERY existing photo was removed does the first
                // newly-uploaded one become the new cover.
                const coverThumbnailUrl = hostedKept.length > 0 ? it.coverThumbnailUrl : uploaded[0].thumbnailUrl;
                return { ...it, photos: [...hostedKept, ...newPhotoUrls], coverThumbnailUrl };
              })
            );
          })
          .catch(() => {});
      } else {
        // Re-sync sort_order for the kept photos to match the edited order.
        await Promise.all(
          hostedKept.map((url, i) =>
            supabase.from('listing_photos').update({ sort_order: i }).eq('listing_id', listingId).eq('kind', kind).eq('url', url)
          )
        );
      }
    },
    []
  );

  // Replaces ALL of a listing's spin sets with the desired list, in one
  // delete-then-reinsert pass, rather than a minimal per-frame diff like
  // syncPhotoKind uses for the flat gallery list. Spin sets can be added,
  // removed, renamed, and reordered as whole units in the edit UI --
  // diffing that structurally (which set is "the same" one after a
  // rename/reorder?) is a lot more error-prone than just replacing the
  // lot, and the frame counts here are small enough (max SPIN_MAX_FRAMES
  // per set, a handful of sets) that the extra churn is cheap. Deleting a
  // listing's existing listing_spin_sets rows cascades to their
  // listing_photos spin rows automatically (FK ON DELETE CASCADE), so
  // there's no separate listing_photos delete step here. Already-hosted
  // (https) frames are NOT re-uploaded -- only newly-picked local frames
  // go through uploadPhotos -- but every frame (kept or new) does get a
  // fresh listing_photos row under the new spin_set_id, since the old rows
  // were just cascade-deleted along with their set. Unlike syncPhotoKind,
  // this is fully awaited rather than fire-and-forget, since the caller
  // needs the real (server-assigned) set ids back to update local state.
  const syncSpinSets = useCallback(async (listingId: string, desiredSets: SpinSet[]): Promise<SpinSet[]> => {
    const { data: existingSets } = await supabase.from('listing_spin_sets').select('id').eq('listing_id', listingId);
    if (existingSets && existingSets.length > 0) {
      await supabase.from('listing_spin_sets').delete().in('id', existingSets.map((s: any) => s.id));
    }

    const nonEmpty = desiredSets.filter((s) => s.frames.length > 0);
    const results: SpinSet[] = [];
    for (let i = 0; i < nonEmpty.length; i++) {
      const set = nonEmpty[i];
      const { data: setRow, error: setError } = await supabase
        .from('listing_spin_sets')
        .insert({ listing_id: listingId, label: set.label, sort_order: i })
        .select()
        .single();
      if (setError || !setRow) continue;
      const hostedKept = set.frames.filter((p) => /^https?:\/\//.test(p));
      const localNew = set.frames.filter((p) => !/^https?:\/\//.test(p));
      const uploadedUrls = localNew.length > 0 ? await uploadPhotos(localNew) : [];
      const allUrls = [...hostedKept, ...uploadedUrls];
      if (allUrls.length > 0) {
        await supabase
          .from('listing_photos')
          .insert(allUrls.map((url, frameIdx) => ({ listing_id: listingId, url, sort_order: frameIdx, kind: 'spin', spin_set_id: setRow.id })));
      }
      results.push({ id: setRow.id, label: set.label, frames: allUrls });
    }
    return results;
  }, []);

  const addListing = useCallback(
    async (l: ListingInput) => {
      // "Save & exit" on an incomplete new listing (see
      // useUnsavedChangesGuard) parks it as a draft instead of submitting
      // it -- no moderation call, no posting points, and it stays invisible
      // to everyone but the seller (same RLS as pending_review/rejected).
      const asDraft = l.status === 'draft';
      const uid = userIdRef.current;
      let newListing: Listing = {
        ...l,
        id: `l-${Date.now()}`,
        createdAt: Date.now(),
        sellerId: uid || profile.id,
        sellerName: profile.name || 'You',
        rating: 5,
        // Every new listing starts here -- publishing is now gated on the
        // AI first pass (or a human moderator) rather than going live
        // immediately. The DB trigger (enforce_listing_moderation_gate)
        // enforces this server-side too, so this optimistic value is
        // purely cosmetic, not the actual gate. A draft save skips all of
        // that -- it isn't a submission yet.
        status: asDraft ? 'draft' : 'pending_review',
        moderationStatus: 'pending',
        moderationReason: null,
        expiresAt: Date.now() + LISTING_LIFETIME_MS,
        autoHiddenAt: null,
        expiryReminderSentAt: null,
        // Posting a listing is already gated behind isVerified (see the
        // "Sell an item" tab), so whoever gets here has a real
        // phone-verified account -- this optimistic value gets overwritten
        // with the real DB-joined value on the next syncFromSupabase anyway.
        sellerVerified: isVerified,
        sellerMemberSince: Date.now(),
        sellerAvatarUrl: profile.avatarUrl,
        // l.shopId came straight from the form; the display fields are
        // filled in from AppStore's own myShop rather than trusted from
        // the caller -- see ListingInput's doc comment above. The
        // `myShop?.id === l.shopId` guard is really just defensive: the
        // only shop CreateListingScreen could have offered is the
        // signed-in seller's own, so in practice this is always true
        // whenever l.shopId is set at all.
        shopNameEn: l.shopId && myShop?.id === l.shopId ? myShop.nameEn : null,
        shopNameAr: l.shopId && myShop?.id === l.shopId ? myShop.nameAr : null,
        shopSlug: l.shopId && myShop?.id === l.shopId ? myShop.slug : null,
        // Batch listings -- see ListingInput's own doc comment; both are
        // optional on the input, defaulted here the same way every other
        // ListingInput-omitted-but-Listing-required field above is.
        batchId: l.batchId ?? null,
        batchParked: l.batchParked ?? false,
      };

      // No session at all: there is nothing to write the listing to, and
      // the caller has to hear that rather than be handed a listing that
      // exists only in this phone's memory. Posting is gated behind
      // isVerified upstream, so in practice this is unreachable -- which
      // is exactly why it must not fail quietly if it ever is reached.
      if (!uid) throw listingSaveError('not-signed-in');

      const { data, error } = await supabase
        .from('listings')
        .insert({
          seller_id: uid,
          // '' is not a category and never was -- it is the batch flow
          // saying "not classified yet". Sent as null, which the column
          // now allows; sending '' failed the foreign key and, until
          // addListing started throwing, failed it silently. See
          // LIFECYCLE.md.
          category_id: l.cat || null,
          title_en: l.titleEn,
          title_ar: l.titleAr,
          description_en: l.descriptionEn,
          description_ar: l.descriptionAr,
          price: l.price,
          currency: 'USD',
          rent_price: l.rentPrice ?? null,
          rent_period: l.rentPeriod ?? null,
          rent_payment_frequency: l.rentPaymentFrequency ?? null,
          condition: l.condition ?? null,
          district: l.district,
          governorate: l.governorate,
          caza: l.caza,
          geoname_id: l.geonameId,
          lat: l.lat,
          lng: l.lng,
          status: asDraft ? 'draft' : 'pending_review',
          ai_generated: l.aiGenerated,
          attributes: l.attributes || {},
          contact_method: l.contactMethod || 'both',
          shop_id: l.shopId,
          stock_qty: l.stockQty ?? 1,
          variants: l.variants ?? null,
          batch_id: l.batchId ?? null,
          batch_parked: l.batchParked ?? false,
        })
        .select()
        .single();
      // The whole reason this function is written this way round.
      //
      // It used to read `if (!error && data) { ...everything... }` with
      // no else: a refused insert was discarded, the optimistic row kept
      // its made-up `l-<timestamp>` id, and it was pushed into local
      // state and RETURNED as though it had been created. The seller saw
      // a normal listing marked "pending review"; its photos were never
      // uploaded (that happens below, inside the success path),
      // moderation never ran so it could never publish, points were
      // awarded for it, and the next sync -- a refresh, an app restart --
      // replaced local state with the server's and it vanished. The bug
      // report is "my listing disappeared", hours later, with nothing to
      // connect it to.
      //
      // Nothing in the app could detect it either: every caller trusts a
      // return value that was indistinguishable from a real one. And the
      // ways this actually fails are all live here -- myazar.listings is
      // granted per COLUMN and PostgREST rejects the whole statement over
      // one ungranted column (this repo has been caught by that twice), a
      // CHECK constraint a migration missed, an RLS denial, the network
      // dropping mid-post.
      if (error || !data) {
        // Said out loud, the way updateListing's own failure is: this line
        // names the ungranted column or the failing CHECK, and it is the
        // only place that information exists at all.
        console.warn('[AppStore] addListing insert refused:', error?.message);
        throw listingSaveError('refused', error?.message);
      }
      newListing = {
        ...newListing,
        id: data.id,
        createdAt: new Date(data.created_at).getTime(),
        expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : newListing.expiresAt,
      };

      // Upload to ChemiCloud in the background rather than making the
      // seller wait on photo uploads before their listing appears —
      // the local device photos already show fine in the meantime.
      const listingId = data.id;
      if (l.photos.length > 0) {
        persistNewPhotos(listingId, l.photos, 'gallery')
          .then(({ urls, coverThumbnailUrl }) => {
            if (urls.length === 0) return;
            setListings((prev) =>
              prev.map((it) => (it.id === listingId ? { ...it, photos: urls, coverThumbnailUrl } : it))
            );
          })
          .catch(() => {});
      }
      if (l.spinSets.length > 0) {
        persistNewSpinSets(listingId, l.spinSets)
          .then((hostedSets) => {
            if (hostedSets.length === 0) return;
            setListings((prev) => prev.map((it) => (it.id === listingId ? { ...it, spinSets: hostedSets } : it)));
          })
          .catch(() => {});
      }
      // The video went to Bunny while the seller was still filling in
      // the rest of the form, so by now it exists but points at nothing.
      // Linking it is what makes it visible to anyone else: the RLS
      // select policy only exposes a video whose listing is live.
      if (l.video?.guid) {
        attachVideoToListing(l.video.guid, listingId).catch(() => {});
      }

      // Fire the AI moderation check in the background too -- the
      // seller is already navigated to their "pending review" listing
      // by the time this resolves (that's the whole point of the
      // "instant-feeling" submit). It publishes itself (status ->
      // active) on a pass, or leaves it flagged for a human on a
      // fail/error -- see moderate-listing and AdminModerationScreen.
      // Skipped entirely for a draft save -- there is nothing to
      // moderate yet, and moderate-listing would just flag an
      // incomplete listing that was never actually submitted.
      if (!asDraft) {
        Promise.all(l.photos.slice(0, MODERATION_MAX_PHOTOS).map((uri) => uriToCompressedBase64(uri)))
          .then((results) => {
            const photos = results.filter((p): p is { data: string; mediaType: string } => !!p);
            return triggerListingModeration(listingId, photos, l.titleEn || l.titleAr, l.descriptionEn || l.descriptionAr);
          })
          .catch(() => {});
      }

      setListings((prev) => [newListing, ...prev]);
      // Saving a draft isn't posting a listing -- only award points once it
      // actually goes out for review (here, or on the draft->submit path in
      // updateListing below).
      if (!asDraft) {
        await awardPoints(POINTS_RULES.postListing, `Posted "${l.titleEn || l.titleAr}"`);
      }
      return newListing;
    },
    [profile, awardPoints, persistNewPhotos, persistNewSpinSets, isVerified, myShop]
  );

  const updateListing = useCallback(
    async (id: string, l: ListingInput) => {
      // A listing a human moderator rejected goes back through the same
      // AI-first-pass gate on resubmit, rather than silently staying
      // 'rejected' forever or (worse) silently becoming 'active' again
      // unreviewed -- see AdminModerationScreen's reject flow and
      // ProfileScreen's "Edit & resubmit" action, which both funnel here.
      const wasRejected = listingsRef.current.find((it) => it.id === id)?.status === 'rejected';
      // Same idea, one status earlier: a draft that's now being submitted
      // for real (the wizard's actual Post/Save button, not another
      // "Save & exit") needs the same draft->pending_review transition and
      // moderation kick-off addListing gives a brand-new listing.
      const wasDraft = listingsRef.current.find((it) => it.id === id)?.status === 'draft';
      // "Save & exit" re-saving an already-parked draft -- see ListingInput's
      // doc comment. Keeps it a draft: no status change, no moderation, no
      // posting points, whether it was already a draft or (impossible in
      // practice, but harmless) something else.
      const asDraft = l.status === 'draft';
      const submittingDraft = wasDraft && !asDraft;

      // Same reasoning as addListing above: the display fields are derived
      // from AppStore's own myShop, never trusted from the caller.
      const shopDisplayFields =
        l.shopId && myShop?.id === l.shopId
          ? { shopNameEn: myShop.nameEn, shopNameAr: myShop.nameAr, shopSlug: myShop.slug }
          : { shopNameEn: null, shopNameAr: null, shopSlug: null };

      // `status` is pulled OUT of the incoming fields and never spread.
      // It is an optional property, and an absent one is not the same as
      // one explicitly set to undefined: listingToInput(listing, { status:
      // undefined }) -- which is how the batch flow says "submit this for
      // real" (see BatchFinalReviewScreen) -- produces an object that HAS
      // the key. Spreading it wrote `status: undefined` straight onto the
      // local row whenever none of the three branches below fired, which
      // is exactly the case on a second Post after a partial failure. A
      // status of undefined renders no badge at all, and worse, does not
      // survive JSON: the cache drops the key and normalizeListing reads
      // the missing value back as 'active', so a listing sitting in
      // moderation showed its own seller as live. Status here is only
      // ever what the branches below decide, or what the row already had.
      const { status: _requestedStatus, ...fields } = l;

      // Update local state immediately so the edit feels instant. Unlike
      // the status actions further down, this one stays optimistic: it is
      // a whole form's worth of fields plus photo and video work, and the
      // edit screen navigates away on success rather than sitting on a
      // spinner.
      //
      // Which call owns the row. These are not serialised -- adding two
      // photos in quick succession fires two updateListings at the same
      // listing (see BatchPhotosScreen's syncPhotos) -- and a rollback
      // that ignored that would put an older snapshot back on top of a
      // newer write that had succeeded. The next photo diff would then
      // delete from storage the very photos it had just been told were
      // not saved. Only the most recent call may undo anything; an older
      // one that loses the race leaves the row to whoever came after,
      // which is safe because every one of these writes the complete
      // field set -- the survivor fully determines the row.
      //
      // One case is knowingly left imperfect: if BOTH concurrent calls
      // fail, the survivor's snapshot was taken after the older one's
      // optimistic change and so puts part of it back. It corrects itself
      // on the next successful write (a photo not yet on the server is
      // still a local file:// URI, so the next sync uploads it), and the
      // seller is told each time, which is why this is not worth a second
      // mechanism to track.
      const seq = (updateListingSeq.get(id) ?? 0) + 1;
      updateListingSeq.set(id, seq);

      // Captured from inside the updater, which is the only place it can
      // be read honestly: listingsRef is refreshed by an effect, so it
      // holds the last COMMITTED render -- one behind a write queued this
      // tick, and empty of a row addListing added moments ago, which is
      // exactly when the first photo sync of a batch item runs. The ref
      // is kept as a fallback for the one path that rolls back before
      // React has rendered at all (the signed-out check just below).
      let capturedRow: Listing | null = null;
      const committedRow = listingsRef.current.find((it) => it.id === id) ?? null;
      setListings((prev) =>
        prev.map((it) => {
          if (it.id !== id) return it;
          capturedRow = it;
          return {
            ...it,
            ...fields,
            ...shopDisplayFields,
            ...(asDraft
              ? { status: 'draft' as const }
              : wasRejected || submittingDraft
              ? {
                  status: 'pending_review' as const,
                  moderationStatus: 'pending' as const,
                  moderationReason: null,
                  // Cleared to match what the database does on the way out
                  // of draft (see set_listing_expiry): resubmitting IS the
                  // seller overruling the buyers who hid this. Without it
                  // the row keeps a Restore button beside a live listing
                  // for the rest of the session, and that button leads
                  // nowhere -- the RPC finds no hidden listing to restore.
                  autoHiddenAt: null,
                }
              : {}),
          };
        })
      );

      const rollBack = () => {
        if (updateListingSeq.get(id) !== seq) return;
        const before: Listing | null = capturedRow ?? committedRow;
        if (!before) return;
        setListings((prev) => prev.map((it) => (it.id === id ? before : it)));
      };

      const uid = userIdRef.current;
      if (!uid) {
        rollBack();
        throw listingSaveError('not-signed-in');
      }

      const { data: updated, error: updateError } = await supabase
        .from('listings')
        .update({
          category_id: l.cat || null,
          title_en: l.titleEn,
          title_ar: l.titleAr,
          description_en: l.descriptionEn,
          description_ar: l.descriptionAr,
          price: l.price,
          rent_price: l.rentPrice ?? null,
          rent_period: l.rentPeriod ?? null,
          rent_payment_frequency: l.rentPaymentFrequency ?? null,
          condition: l.condition ?? null,
          district: l.district,
          governorate: l.governorate,
          caza: l.caza,
          geoname_id: l.geonameId,
          lat: l.lat,
          lng: l.lng,
          ai_generated: l.aiGenerated,
          shop_id: l.shopId,
          attributes: l.attributes || {},
          contact_method: l.contactMethod || 'both',
          stock_qty: l.stockQty ?? 1,
          variants: l.variants ?? null,
          // Batch listings -- batch_parked IS updatable (BatchDetailsScreen's
          // "save as draft for later" escape hatch). batch_id deliberately
          // is NOT in this UPDATE list -- see Listing.batchId's own doc
          // comment for why a listing can never be moved out of its batch
          // once created, even via this same updateListing call used by the
          // ordinary single-item edit form.
          batch_parked: l.batchParked ?? false,
          ...(asDraft
            ? { status: 'draft' }
            : wasRejected || submittingDraft
            ? { status: 'pending_review', moderation_status: 'pending', moderation_reason: null }
            : {}),
        })
        .eq('id', id)
        .select('id');

      // Local state was already updated optimistically above, so a
      // rejected UPDATE used to look like a clean save while the edit was
      // quietly lost -- and PostgREST rejects the WHOLE statement over a
      // single unrecognised column, so one unapplied migration silently
      // discarded every field of every edit. An empty result counts as a
      // failure too: an update that matches no row is not an error, just
      // a write that went nowhere.
      //
      // Throwing here rather than carrying on is the point of the whole
      // change. Everything below this line -- moderation, posting points,
      // photo uploads, the video swap -- was running against a row that
      // may never have been written. CreateListingScreen's Post and both
      // of its Save & exit paths were already waiting on a throw that
      // never came; the batch screens were not, and are handled one at a
      // time in this same change.
      if (updateError || !updated || updated.length === 0) {
        rollBack();
        console.warn('[AppStore] updateListing refused:', updateError?.message || 'no row matched');
        throw listingSaveError('refused', updateError?.message);
      }

      if (wasRejected || submittingDraft) {
        Promise.all(l.photos.slice(0, MODERATION_MAX_PHOTOS).map((uri) => uriToCompressedBase64(uri)))
          .then((results) => {
            const photos = results.filter((p): p is { data: string; mediaType: string } => !!p);
            return triggerListingModeration(id, photos, l.titleEn || l.titleAr, l.descriptionEn || l.descriptionAr);
          })
          .catch(() => {});
      }
      // Mirrors addListing's own points-on-submit gating -- a draft save
      // never awards points; the listing's first real submission does,
      // whether that happens via addListing (brand new) or here (a
      // previously-parked draft finally posted).
      if (submittingDraft) {
        await awardPoints(POINTS_RULES.postListing, `Posted "${l.titleEn || l.titleAr}"`);
      }

      // Photos: anything already a hosted (https) URL was kept as-is by the
      // edit screen; anything else is a newly-picked local device photo
      // that still needs uploading. Gallery photos diff against what's on
      // Supabase (syncPhotoKind); spin sets fully replace (syncSpinSets) --
      // see that function's comment for why. Spin sets need their own
      // setListings update afterward since syncSpinSets returns the real
      // server-assigned set ids (unlike syncPhotoKind's gallery path,
      // which updates state itself internally).
      const [, hostedSpinSets] = await Promise.all([
        syncPhotoKind(id, 'gallery', l.photos),
        syncSpinSets(id, l.spinSets),
      ]);
      setListings((prev) => prev.map((it) => (it.id === id ? { ...it, spinSets: hostedSpinSets } : it)));

      // Video. Read what is currently attached from the database rather than
      // from local state: this callback deliberately doesn't depend on
      // `listings`, so any copy captured in its closure would be stale.
      //
      // Replacing a video is already handled before we get here -- the edit
      // screen passes the listing id when it asks for an upload ticket, and
      // bunny-video-token deletes the old video from Bunny at that point. So
      // only two cases are left: attach a new one, or the seller removed the
      // one that was there.
      const { data: attachedVideo } = await supabase
        .from('listing_videos')
        .select('bunny_guid')
        .eq('listing_id', id)
        .maybeSingle();
      const previousGuid: string | null = attachedVideo?.bunny_guid ?? null;
      if (l.video?.guid && l.video.guid !== previousGuid) {
        await attachVideoToListing(l.video.guid, id);
      } else if (!l.video?.guid && previousGuid) {
        // Best effort -- a listing must never be stuck un-editable because
        // Bunny had a bad minute.
        await deleteVideo(previousGuid).catch(() => {});
      }
    },
    [syncPhotoKind, syncSpinSets, myShop, awardPoints]
  );

  // Soft-delete, not a hard delete: the row, its photos, and its video all
  // stay put, and status just moves to 'removed'. A seller can never
  // retrieve it themselves again once this runs (My Listings/Profile both
  // exclude 'removed' rows, both locally here and on every future refetch
  // -- see the `.neq('status', 'removed')` on the listings query above),
  // but admin can still pull the whole thing up for a dispute or a
  // mistaken-delete recovery, and a server-side pg_cron job
  // (purge-removed-listings, see the migration/edge function of the same
  // name) actually erases it -- row, photos, and Bunny video -- 15 days
  // after removed_at. This mirrors exactly what AdminModerationScreen's
  // own "Remove" action and AdminReportsScreen's "Remove listing" action
  // already do to someone else's listing; this is the same status change,
  // just seller-initiated on their own row (removed_reason distinguishes
  // the three cases -- see the migration's column comment).
  //
  // Server first, then local state -- the reverse of the order this and
  // the four actions below used to run in. They dropped or rewrote the
  // row locally and then fired the write, so a refused one left the
  // seller looking at a listing that was deleted, hidden or sold on their
  // screen alone while it stayed exactly as it was for everyone else. The
  // optimistic order was there to make the tap feel instant, but each of
  // these already sits behind a spinner -- MyListingsScreen's busyId,
  // ListingDetailScreen's per-action flags, and BatchDetailsScreen's
  // `saving`, which this change extends to cover its park and discard
  // actions for exactly that reason -- so nothing is lost by waiting for
  // the answer.
  const deleteListing = useCallback(async (id: string) => {
    await updateOwnListingRow(
      id,
      userIdRef.current,
      {
        status: 'removed',
        removed_at: new Date().toISOString(),
        removed_reason: 'seller_deleted',
        removed_by: userIdRef.current,
      },
      'deleteListing',
      'removed'
    );
    setListings((prev) => prev.filter((l) => l.id !== id));
  }, []);

  // Both of these moved to the server, and for one reason: how long a
  // listing lives is now a property of its category, and these were the
  // two places the client computed "now + 15 days" by hand. A client that
  // decides expiry is a client that drifts from the database the first
  // time either changes -- and there are two of them already, the app and
  // the website. The RPC resolves the category's lifetime the same way
  // the insert trigger does, and hands back the row it actually wrote, so
  // local state stops guessing at a date it did not choose.
  //
  // Same three failure checks as every other write here (see
  // updateOwnListingRow): the error nobody read, the update that matched
  // no row, and the status a trigger quietly put back.
  const renewListing = useCallback(
    async (id: string, rpc: 'extend_own_listing' | 'republish_own_listing', expectStatus?: string) => {
      const uid = userIdRef.current;
      if (!uid) throw listingSaveError('not-signed-in');
      const { data, error } = await supabase.rpc(rpc, { p_listing_id: id });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        console.warn(`[AppStore] ${rpc} refused:`, error?.message || 'no row matched');
        throw listingSaveError('refused', error?.message);
      }
      // Applied BEFORE the status check below, deliberately. When the
      // moderation gate refuses the status it still commits the new
      // expiry and the cleared reminder flag -- the UPDATE ran, only
      // `status` was rewritten -- so throwing without taking these would
      // leave the screen a full lifetime behind the database until the
      // next sync. row.status is whatever actually landed, gate included.
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : Date.now() + LISTING_LIFETIME_MS;
      setListings((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, status: row.status as Listing['status'], expiresAt, expiryReminderSentAt: null }
            : it
        )
      );
      if (expectStatus && row.status !== expectStatus) {
        console.warn(`[AppStore] ${rpc} was reverted by the database: asked for`, expectStatus, 'got', row.status);
        throw listingSaveError('needs-review', `status stayed ${row.status}`);
      }
    },
    []
  );

  // Resets the clock to a fresh full lifetime for this listing's category
  // -- offered on MyListingsScreen once a still-active listing is within a
  // day of expiring. Also clears expiry_reminder_sent_at so a fresh
  // reminder can fire again next time it approaches expiry.
  const extendListing = useCallback((id: string) => renewListing(id, 'extend_own_listing'), [renewListing]);

  // Brings an 'expired' ("Unpublished" in the UI) listing back to
  // 'active' with a fresh clock.
  const republishListing = useCallback(
    (id: string) => renewListing(id, 'republish_own_listing', 'active'),
    [renewListing]
  );

  const hideListing = useCallback(async (id: string) => {
    await updateOwnListingRow(id, userIdRef.current, { status: 'draft' }, 'hideListing', 'draft');
    setListings((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'draft' } : it)));
  }, []);

  const markListingSold = useCallback(async (id: string, soldVia: 'vevaty' | 'elsewhere') => {
    await updateOwnListingRow(id, userIdRef.current, { status: 'sold', sold_via: soldVia }, 'markListingSold', 'sold');
    setListings((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'sold' } : it)));
  }, []);

  // ---- Did you reach the seller? -------------------------------------
  //
  // The only signal that survives a phone conversation. Vevaty can see
  // that a buyer reached for the number (listing_contact_events, written
  // by get_seller_phone) and nothing after it, so the buyer is asked how
  // it went. Two independent phone-verified buyers saying "they told me
  // it's sold" hides the listing; the seller is told why and restores it
  // in one tap. Every guard lives in the RPC, not here -- this is the one
  // write in the app where one user's word affects another user's
  // listing, so it is not a place to trust a client. See LIFECYCLE.md.
  const [contactPrompts, setContactPrompts] = useState<ContactPrompt[]>([]);

  const refreshContactPrompts = useCallback(async () => {
    if (!userIdRef.current) {
      setContactPrompts([]);
      return;
    }
    const { data, error } = await supabase.rpc('my_pending_contact_prompts');
    if (error) {
      // Never surfaced: an unanswerable question is not worth an error
      // message, and the next sync tries again.
      console.warn('[AppStore] contact prompts unavailable:', error.message);
      return;
    }
    setContactPrompts(
      (data || []).map((r: any) => ({
        listingId: r.listing_id,
        titleEn: r.title_en ?? null,
        titleAr: r.title_ar ?? null,
        photoUrl: r.photo_url ?? null,
        contactedAt: r.contacted_at ? new Date(r.contacted_at).getTime() : Date.now(),
      }))
    );
  }, []);

  // Fetched once the app knows who it is, and again whenever a real
  // session replaces the anonymous one -- an anonymous visitor has no
  // contact history and gets nothing. Deliberately not part of
  // syncFromSupabase: it is a small independent query, and a listing feed
  // should not wait on it or fail with it.
  useEffect(() => {
    if (!ready) return;
    refreshContactPrompts();
    // profile.id, not isVerified alone: one signed-in account replacing
    // another leaves isVerified true, so nothing would re-fetch and the
    // previous account's questions would stay on screen.
  }, [ready, isVerified, profile.id, refreshContactPrompts]);

  const answerContactPrompt = useCallback(
    async (listingId: string, outcome: ContactOutcome) => {
      // Dropped from the list first, so the card goes away on the tap
      // rather than after a round trip. Put back if the write is refused
      // -- a question that silently vanishes unanswered is worse than one
      // that stays.
      // Only THIS prompt is remembered, not the whole list. Restoring a
      // snapshot would resurrect a different prompt that a second card --
      // the same question renders on the home and on the listing -- had
      // already answered while this one was in flight.
      let removed: ContactPrompt | null = null;
      setContactPrompts((prev) => {
        removed = prev.find((p) => p.listingId === listingId) ?? null;
        return prev.filter((p) => p.listingId !== listingId);
      });
      const { data, error } = await supabase.rpc('answer_contact_prompt', {
        p_listing_id: listingId,
        p_outcome: outcome,
      });
      if (error) {
        const putBack: ContactPrompt | null = removed;
        if (putBack) {
          setContactPrompts((prev) =>
            prev.some((p) => p.listingId === listingId) ? prev : [...prev, putBack]
          );
        }
        console.warn('[AppStore] answer_contact_prompt refused:', error.message);
        throw listingSaveError('refused', error.message);
      }
      const row = Array.isArray(data) ? data[0] : data;
      // The listing this buyer was asked about may have just been hidden
      // by their own answer. Reflected locally so it stops appearing in
      // their feed immediately, rather than at the next sync.
      if (row?.hidden) {
        setListings((prev) => prev.map((it) => (it.id === listingId ? { ...it, status: 'draft' as const } : it)));
      }
    },
    []
  );

  const restoreAutoHiddenListing = useCallback(async (id: string) => {
    const uid = userIdRef.current;
    if (!uid) throw listingSaveError('not-signed-in');
    const { data, error } = await supabase.rpc('restore_auto_hidden_listing', { p_listing_id: id });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      console.warn('[AppStore] restore_auto_hidden_listing refused:', error?.message || 'no row matched');
      // VV001 is the RPC saying this listing has not passed review. "Try
      // again" is the wrong advice for that -- a second tap does the same
      // nothing -- and auto_hidden_at is deliberately left set, so the
      // badge and its button are still there once a moderator clears it.
      throw listingSaveError((error as any)?.code === 'VV001' ? 'needs-review' : 'refused', error?.message);
    }
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : Date.now() + LISTING_LIFETIME_MS;
    setListings((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, status: row.status as Listing['status'], expiresAt, autoHiddenAt: null, expiryReminderSentAt: null }
          : it
      )
    );
  }, []);

  // "Log out" for an anonymous-auth app: there's no persistent
  // email/password identity to sign back into, so this signs out of the
  // current anonymous session, wipes the local cache, and sends the
  // person back to onboarding as a fresh account -- a clean-slate reset
  // rather than a traditional login/logout pair.
  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      // Ignore -- we're clearing local state regardless.
    }
    userIdRef.current = null;
    await Promise.all([
      AsyncStorage.removeItem(KEYS.listings),
      AsyncStorage.removeItem(KEYS.profile),
      AsyncStorage.removeItem(KEYS.points),
    ]);
    setListings(SEED_LISTINGS);
    setProfile(DEFAULT_PROFILE);
    setPointsHistory([]);
    setMyShop(null);
    // Cleared explicitly, not left to the isVerified effect: swapping one
    // signed-in account for another never flips isVerified, so the
    // previous account's questions would keep rendering -- and answering
    // one under the new uid is refused with "no contact recorded", which
    // leaves an un-clearable card.
    setContactPrompts([]);
  }, []);

  // Delete Account (OLX-comparison follow-up, item 3) -- two-step contract
  // with the delete-account edge function: it runs myazar.delete_my_account()
  // (a SECURITY DEFINER RPC, called under the caller's own JWT so
  // auth.uid() is genuinely them) to clean up every myazar-schema row that
  // references them, then removes the actual auth.users identity with the
  // service-role key (never exposed client-side). Per Supabase's own docs,
  // deleting auth.users does NOT invalidate an already-issued JWT on its
  // own, so this explicitly signs out client-side afterward too.
  const deleteAccount = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('delete-account');
    if (error) {
      let message = 'Could not delete your account. Please try again.';
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json();
          if (body?.message) message = body.message;
        } catch (e) {
          // Response body wasn't JSON -- fall back to the generic message.
        }
      }
      throw new Error(message);
    }
    if (!data?.ok) {
      throw new Error('Could not delete your account. Please try again.');
    }

    try {
      await supabase.auth.signOut();
    } catch (e) {
      // Ignore -- we're clearing local state regardless, same as signOut().
    }
    userIdRef.current = null;
    await Promise.all([
      AsyncStorage.removeItem(KEYS.listings),
      AsyncStorage.removeItem(KEYS.profile),
      AsyncStorage.removeItem(KEYS.points),
    ]);
    setListings(SEED_LISTINGS);
    setProfile(DEFAULT_PROFILE);
    setPointsHistory([]);
    setMyShop(null);
    // Cleared explicitly, not left to the isVerified effect: swapping one
    // signed-in account for another never flips isVerified, so the
    // previous account's questions would keep rendering -- and answering
    // one under the new uid is refused with "no contact recorded", which
    // leaves an un-clearable card.
    setContactPrompts([]);
  }, []);

  // Slugs are unique (myazar.shops.slug has a unique constraint) --
  // rather than pre-checking availability with a SELECT (a second round
  // trip, and still racy against a concurrent signup), this just tries the
  // base slug and retries with -2, -3, ... on a unique-violation error.
  // Five attempts is generous: it only ever loops past 1 when two
  // merchants pick the same name, which is rare, and a merchant whose name
  // is *itself* a duplicate business name colliding five times in a row
  // is not a case worth engineering around silently -- createShop surfaces
  // the error to MyStorefrontScreen instead of trying forever.
  const MAX_SLUG_ATTEMPTS = 5;

  const createShop = useCallback(
    async (s: ShopInput): Promise<Shop> => {
      const uid = userIdRef.current;
      if (!uid) throw new Error('You need to be logged in to create a storefront.');
      const base = slugify(s.nameEn) || 'shop';

      let lastError: any = null;
      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        const { data, error } = await supabase
          .from('shops')
          .insert({
            owner_id: uid,
            slug,
            name_en: s.nameEn,
            name_ar: s.nameAr,
            tagline_en: s.taglineEn,
            tagline_ar: s.taglineAr,
            logo_url: s.logoUrl,
            cover_url: s.coverUrl,
            governorate: s.governorate,
            caza: s.caza,
            address_line: s.addressLine,
            whatsapp: s.whatsapp,
            phone: s.phone,
            primary_category_id: s.primaryCategoryId,
            domain_id: s.domainId,
          })
          .select()
          .single();
        if (!error && data) {
          const shop = dbShopToLocal(data);
          setMyShop(shop);
          return shop;
        }
        lastError = error;
        // 23505 = unique_violation -- only case worth retrying with a
        // different slug. Anything else (RLS denial, a bad FK on
        // primary_category_id, offline) fails immediately rather than
        // burning through five attempts for an error retrying won't fix.
        if (error?.code !== '23505') break;
      }
      throw new Error(lastError?.message || 'Could not create your storefront. Please try again.');
    },
    []
  );

  const updateShop = useCallback(
    async (s: ShopInput): Promise<void> => {
      const current = myShop;
      if (!current) throw new Error('No storefront to update.');
      const { data, error } = await supabase
        .from('shops')
        .update({
          name_en: s.nameEn,
          name_ar: s.nameAr,
          tagline_en: s.taglineEn,
          tagline_ar: s.taglineAr,
          logo_url: s.logoUrl,
          cover_url: s.coverUrl,
          governorate: s.governorate,
          caza: s.caza,
          address_line: s.addressLine,
          whatsapp: s.whatsapp,
          phone: s.phone,
          primary_category_id: s.primaryCategoryId,
          domain_id: s.domainId,
          // Editing counts as resubmitting for review -- clears a prior
          // decline note the same way saving a rejected listing clears
          // moderationReason (see updateListing above). verified_at itself
          // is left untouched here (and the DB trigger would silently
          // revert it even if it weren't): editing an already-verified
          // shop's tagline shouldn't knock it back to unverified, only a
          // fresh shop or one an admin explicitly un-verifies should be.
          verification_note: null,
        })
        .eq('id', current.id)
        .select()
        .single();
      if (error) throw new Error(error.message || 'Could not update your storefront. Please try again.');
      if (data) setMyShop(dbShopToLocal(data));
    },
    [myShop]
  );

  // Batch listings ("sell a bunch of items") -- mirrors createShop/
  // updateShop's plain-supabase.from() pattern rather than syncFromSupabase's
  // caching: a batch isn't a synced entity the way myShop is, just a row
  // the batch screens tag each item's addListing call with and read back
  // by filtering AppStore's own `listings`, so there's nothing to hold in
  // AppStoreValue state for it.
  const createBatch = useCallback(async (domainId?: string | null): Promise<Batch> => {
    const uid = userIdRef.current;
    if (!uid) throw new Error('You need to be logged in to start a batch.');
    const { data, error } = await supabase
      .from('batches')
      .insert({ seller_id: uid, domain_id: domainId ?? null })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message || 'Could not start a new batch. Please try again.');
    return dbBatchToLocal(data);
  }, []);

  // Marks a batch as posted -- called once, by BatchFinalReviewScreen,
  // right after every non-parked item in it has been submitted (the same
  // draft -> pending_review transition updateListing already does for a
  // single resumed draft). Best-effort: the batch row is bookkeeping for a
  // possible future "my batches" view, not something any RLS policy or
  // listing visibility depends on, so a failure here is swallowed rather
  // than left to block the seller after their items are already posted.
  const completeBatch = useCallback(async (batchId: string): Promise<void> => {
    await supabase.from('batches').update({ status: 'submitted' }).eq('id', batchId).then(() => {});
  }, []);

  const value = useMemo(
    () => ({
      ready,
      online,
      isVerified,
      authChecked,
      listings,
      profile,
      pointsHistory,
      myShop,
      createShop,
      updateShop,
      createBatch,
      completeBatch,
      addListing,
      updateListing,
      deleteListing,
      extendListing,
      republishListing,
      hideListing,
      markListingSold,
      contactPrompts,
      answerContactPrompt,
      restoreAutoHiddenListing,
      awardPoints,
      updateAvatar,
      updateProfileName,
      updateProfileDistrict,
      signOut,
      deleteAccount,
    }),
    [
      ready,
      online,
      isVerified,
      authChecked,
      listings,
      profile,
      pointsHistory,
      myShop,
      createShop,
      updateShop,
      createBatch,
      completeBatch,
      addListing,
      updateListing,
      deleteListing,
      extendListing,
      republishListing,
      hideListing,
      markListingSold,
      contactPrompts,
      answerContactPrompt,
      restoreAutoHiddenListing,
      awardPoints,
      updateAvatar,
      updateProfileName,
      updateProfileDistrict,
      signOut,
      deleteAccount,
    ]
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider');
  return ctx;
}
