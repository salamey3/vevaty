import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ContactOutcome, ContactPrompt, Listing, LISTING_STATUSES, ListingSaveErrorCode, ListingVideo, Profile, PointsEvent, SpinSet, Shop, ShopInput, Batch } from '../types';
import { SEED_LISTINGS } from '../data/seed';
import { DEFAULT_LISTING_LIFETIME_DAYS } from '../data/categories';
import { POINTS_RULES, tierForPoints } from '../data/points';
import { supabase, ensureSession } from '../lib/supabase';
import { Alert } from '../lib/alertShim';
import { uploadPhotos, uploadPhotosWithThumbnails } from '../lib/photoUpload';
import { PhotoWriteError, PhotoWriteStage, insertPhotoRows, writeSpinSets } from '../lib/listingMedia';
import { attachVideoToListing, deleteVideo, parseResolutions } from '../lib/bunnyVideo';
import { uriToCompressedBase64 } from '../lib/imageToBase64';
import { triggerListingModeration } from '../lib/moderateListing';
import { slugify } from '../lib/slugify';
import { ALL_CONDITION_VALUES } from '../lib/conditionModes';
import { useLanguage } from '../i18n/LanguageContext';

// Photos sent to the moderate-listing AI check -- capped the same way the
// other vision calls (Magic Listing/AI suggest) cap theirs, since the model
// only needs enough of the item to judge, not every angle.
const MODERATION_MAX_PHOTOS = 6;
// Spin frames go to the moderator too.
//
// The AI pass only ever saw `l.photos` -- the gallery -- and
// moderate-listing is what flips a listing to `active`, so approval was
// granted on the gallery alone while the 360 frames went live unseen. Six
// clean photos and twenty-four of anything else, per set, with no cap on
// the number of sets. It was narrow while only Properties and Vehicles
// could carry a spin at all; making the 360 step available in every
// category is what turns it into something worth closing.
//
// A SAMPLE, not everything, and that is the honest description: a spin is
// one object rotating, so its frames are near-identical by construction
// and one of them represents the set. The gallery keeps all six of its
// slots -- it is what identifies the item, and weakening the main check to
// make room would be a bad trade -- and these two sit on top, which is
// exactly the edge function's own MAX_PHOTOS of 8.
const MODERATION_MAX_SPIN_FRAMES = 2;
// moderate-listing slices the images it is given to its own MAX_PHOTOS of
// 8, FROM THE FRONT -- and the spin frames are appended last, so they are
// what a ninth image would silently push out. Raising either constant
// without raising that one would quietly re-open the hole the spin frames
// were added to close, with no error anywhere. Checked here rather than
// left to a comment.
if (MODERATION_MAX_PHOTOS + MODERATION_MAX_SPIN_FRAMES > 8) {
  console.warn(
    '[AppStore] moderation payload exceeds moderate-listing MAX_PHOTOS (8); spin frames will be dropped'
  );
}

// Which sets and which frames, chosen at RANDOM rather than at fixed
// positions.
//
// This narrows the gap, it does not close it: two frames out of up to 24
// per set, across as many sets as the seller cares to add, means most
// frames are never looked at. Sampling the first two sets at index 0 and
// the midpoint would have made the unlooked-at positions constant and
// therefore choosable -- anything placed in set three, or at any other
// index, would be reliably unseen. Random costs nothing and means a
// seller cannot know in advance where the blind spots are; a re-moderation
// samples somewhere else again.
function spinFramesForModeration(sets: SpinSet[]): string[] {
  const withFrames = sets.filter((set) => Array.isArray(set.frames) && set.frames.length > 0);
  if (withFrames.length === 0) return [];
  const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

  if (withFrames.length === 1) {
    // One set, so the budget goes on covering its rotation instead: as
    // many DISTINCT frames as the budget and the set allow.
    const frames = withFrames[0].frames;
    const chosen = new Set<string>();
    for (let i = 0; i < frames.length && chosen.size < MODERATION_MAX_SPIN_FRAMES; i++) {
      chosen.add(pick(frames));
    }
    return [...chosen];
  }
  // Several sets: one frame from each of a random selection of them, so
  // that being the third set added is not a hiding place.
  const shuffled = withFrames.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, MODERATION_MAX_SPIN_FRAMES).map((set) => pick(set.frames));
}

// What updateListing has to say about a save that succeeded.
//
// `blockedFromSite` is the one a caller cannot work out for itself: the
// listings row saving and the listing going on the site are two different
// events, and the gap between them is exactly the bug this change exists
// to remove. The batch flow used to read a resolved promise as "posted"
// and complete the batch on it, which marked items submitted that were
// sitting invisible at pending_review with no way back to them.
//
// It says what THIS call withheld, not whether the listing is live. That
// distinction matters: "is it live" depends on state a later retry cannot
// reproduce (an item that posted on the first pass comes back 'active',
// so a second pass moderates nothing), and a caller reading it as "not
// posted" would refuse to finish for ever.
export type ListingSaveResult = {
  blockedFromSite: boolean;
  // Why, because the two need different advice from the caller: a media
  // failure is worth retrying, an item with no photos at all never will
  // be, and a screen that tells the seller to press the same button again
  // for the second one leaves them stuck for ever.
  blockedReason: 'no_photos' | 'media' | null;
  mediaFailed: boolean;
  photosMissing: number;
  spinFailed: boolean;
  // Written, but too short to turn. Kept apart from spinFailed so a
  // caller does not report "a problem with the photos or video" about a
  // 360 that is on the listing.
  spinShort: boolean;
  videoFailed: boolean;
  // True when the photo uploads were still running as this returned, so
  // `mediaFailed`/`photosMissing` describe nothing yet and `onLateMedia`
  // is what will carry them. A caller that shows a busy state has to know
  // this: dropping the spinner here let the seller move on a second
  // before the answer arrived, and the answer was then thrown away.
  mediaDeferred: boolean;
  // The gallery as it now stands on the server. Empty when the uploads
  // were deferred -- onLateMedia carries it then.
  photos: string[];
};

// `quietMedia` suppresses the per-listing media alerts, for a caller
// driving this in a loop. AlertHost holds exactly one alert with no queue
// (@AGENTS.md), so twenty items firing twenty alerts means the seller
// reads one of them at random and the rest are destroyed -- including,
// before this, being destroyed by the "Posted 20 items" success alert that
// followed them.
// `waitMedia` holds the save open until the uploads finish, so the
// returned result actually describes them. Deliberately separate from
// `quietMedia`: coupling the two froze BatchPhotosScreen, which re-sends
// every photo of an item on every tap and would have held its Next button
// through a full re-upload each time. A caller that wants to know but
// cannot afford to wait uses `onLateMedia` instead.
export type ListingSaveOptions = {
  quietMedia?: boolean;
  waitMedia?: boolean;
  // `photos` is the gallery as it now stands on the server, hosted URLs
  // in the seller's own order. A screen that holds its photos as local
  // file:// URIs (BatchPhotosScreen does) can adopt these and stop
  // re-uploading the same pictures on every change.
  onLateMedia?: (r: { mediaFailed: boolean; photosMissing: number; photos: string[] }) => void;
};

// One sentence per way the photo write can fail, because they are not the
// same news. "Your photos did not upload" is useless advice for a failed
// REORDER -- every photo is there, in the wrong order -- and it was what
// the seller read for all five of these. `read` has no better sentence of
// its own than the generic one, so it borrows it.
function mediaFailureTitle(stage: PhotoWriteStage): string {
  if (stage === 'delete') return 'media.photoRemovalNotSavedTitle';
  if (stage === 'reorder') return 'media.photoOrderNotSavedTitle';
  return 'media.photosNotSavedTitle';
}
function mediaFailureBody(stage: PhotoWriteStage): string {
  if (stage === 'delete') return 'media.photoRemovalNotSavedBody';
  if (stage === 'reorder') return 'media.photoOrderNotSavedBody';
  return 'media.photosNotSavedBody';
}

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
  updateListing: (id: string, l: ListingInput, opts?: ListingSaveOptions) => Promise<ListingSaveResult>;
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
  // Breaks ties between point events created in the same millisecond --
  // see creditPointsLocally.
  const pointsEventSeq = useRef(0);
  // Held in a ref rather than closed over. Every alert below lives inside a
  // useCallback whose identity is load-bearing (updateListing is in the
  // dependency array of half the edit screens), and `t` changes identity
  // the moment the seller switches language -- putting it in those
  // dependency arrays would rebuild the whole store on a language change.
  // The ref reads the CURRENT t at the moment the alert fires, which is
  // also the only reading that is right: these fire minutes after the
  // callback was created.
  //
  // AppStoreProvider is mounted inside LanguageProvider (see App.tsx), so
  // this hook is always available here. The three alerts it feeds used to
  // be hardcoded English in an app that is half Arabic.
  const { t } = useLanguage();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('profiles')
        .select('id, full_name, district, points, tier, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      // A failed READ is not a missing row. Read as one, this fell into
      // the insert branch below -- which either fails on the primary key
      // or, worse, succeeds against a row that was there all along -- and
      // skipped hydrating name, district, points and tier from the server
      // entirely, so the seller's own profile came back to the cached
      // defaults. Same class as the reads this change fixed in
      // syncPhotoKind and syncSpinSets; this one was missed.
      // Set on EVERY path, before the branches. profile.id is what
      // MyListingsScreen filters the seller's own listings by, what
      // ListingDetailScreen decides isOwner from, and what gates
      // reporting -- and DEFAULT_PROFILE.id is the literal 'me'. Leaving
      // it there because a read failed meant a transient hiccup at launch
      // emptied the seller's own My Listings for the whole session. The
      // old code got this right by accident (a failed read fell into the
      // insert branch, which set it); checking the error properly is what
      // exposed it.
      setProfile((p) => ({ ...p, id: uid }));
      if (existingProfileError) {
        console.warn('[AppStore] profile read refused, keeping the cached profile:', existingProfileError.message);
      } else if (!existingProfile) {
        // Checked, not fired and forgotten. Everything below assumes this
        // row exists -- updateProfileName's own comment says so out loud --
        // and every later `.update().eq('id', uid)` matches zero rows and
        // returns error: null if it does not. A refused insert here is the
        // quiet start of "my name won't save".
        const { error: profileInsertError } = await supabase.from('profiles').insert({
          id: uid,
          full_name: cached.name !== 'You' ? cached.name : null,
          district: cached.district || null,
          points: cached.points || 0,
          tier: cached.tier.toLowerCase(),
        });
        if (profileInsertError) {
          // Not thrown -- a failed profile row must not stop the app
          // loading -- but no longer invisible either. Without this line
          // the only symptom is that every later profile edit appears to
          // save and does not, hours or days afterwards.
          console.warn('[AppStore] profile row insert refused:', profileInsertError.message);
        }
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
      // creates a second one; see createShop below).
      //
      // The error IS checked, and a failed read leaves myShop alone
      // rather than nulling it. The old comment here said a shop lookup
      // failing "only affects the My Storefront entry point, not
      // browsing", and that was not true: CreateListingScreen sends
      // `shopId: attachToShop && myShop?.verifiedAt ? myShop.id : null`,
      // so a null myShop makes every save quietly DETACH the listing from
      // its storefront -- and enforce_listing_shop_ownership returns
      // early on a null shop_id, so the write is accepted and reports
      // success. Same class as the profile read above, one hunk further
      // down, and the one the audit stopped short of.
      const { data: shopRow, error: shopError } = await supabase
        .from('shops')
        .select('id, owner_id, slug, name_en, name_ar, tagline_en, tagline_ar, logo_url, cover_url, governorate, caza, address_line, whatsapp, phone, primary_category_id, domain_id, verified_at, verification_note')
        .eq('owner_id', uid)
        .maybeSingle();
      if (shopError) {
        console.warn('[AppStore] shop read refused, keeping the current shop:', shopError.message);
      } else {
        setMyShop(shopRow ? dbShopToLocal(shopRow) : null);
      }

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

  // The on-device half: the balance, the tier and the ledger entry the
  // seller sees straight away. Split out because the posting award no
  // longer writes any of this to the database from here -- it goes
  // through claim_posting_points, which does the whole thing in one
  // transaction -- but still has to show up on screen at once.
  const creditPointsLocally = useCallback((amount: number, label: string) => {
    setProfile((p) => ({ ...p, points: p.points + amount, tier: tierForPoints(p.points + amount) }));
    // Not `pe-${Date.now()}`: a twenty-item batch fires twenty of these
    // inside the same millisecond, and ProfileScreen keys the list on it.
    setPointsHistory((h) => [
      { id: `pe-${Date.now()}-${pointsEventSeq.current++}`, label, amount, createdAt: Date.now() },
      ...h,
    ]);
  }, []);

  // A listing's one posting-points award.
  //
  // Everything that matters happens inside myazar.claim_posting_points, a
  // SECURITY DEFINER function, in ONE transaction: the claim flag, the
  // ledger row and a RELATIVE balance increment. It replaced three
  // separate client writes that failed together in two ways.
  //
  // (a) The balance was written as an ABSOLUTE total computed from
  // whatever the device was holding. Twenty items posted at once fire
  // twenty of these, each with a total computed before the others landed,
  // so the value that survived could be the one computed after three
  // awards -- and syncFromSupabase then pulled that stale total back over
  // the local one. The seller watched +300 arrive and had +45 the next
  // morning.
  //
  // (b) The claim flag was flipped before the award was known to have
  // landed and was never released, so a refused ledger insert cost those
  // points for ever. Now the flag, the row and the balance commit or roll
  // back together, and a later retry can still earn it.
  //
  // The amount is NOT sent -- it lives in the function, because a
  // SECURITY DEFINER function will do for anybody what it will do on
  // request, and the caller here is a browser console away from asking
  // for a hundred thousand.
  const claimPostingPoints = useCallback(
    async (listingId: string, title: string) => {
      const { data: awarded, error } = await supabase.rpc('claim_posting_points', {
        p_listing_id: listingId,
      });
      if (error) {
        console.warn('[AppStore] posting points not claimed:', error.message);
        return;
      }
      // false means somebody already claimed it -- a retry, a second
      // Post on a batch -- which is the normal case, not a failure.
      if (awarded === true) creditPointsLocally(POINTS_RULES.postListing, `Posted "${title}"`);
    },
    [creditPointsLocally]
  );

  // Local state updates immediately (the profile hero re-renders with the
  // new photo right away); the DB write is awaited so the caller -- the
  // avatar picker on ProfileScreen -- can show an error if it fails,
  // rather than the change silently not sticking past this app session.
  // Doesn't touch listings' already-denormalized sellerAvatarUrl -- same as
  // every other profile field, that catches up on the next syncFromSupabase.
  // One writer for all three profile fields, because all three had the
  // same two holes.
  //
  // (a) No `.select()`. A `.update().eq('id', uid)` that matches no row --
  // an RLS denial, or a profiles row that was never created (see the
  // refused insert in syncFromSupabase) -- returns `error: null` and
  // changes nothing. That is @AGENTS.md's second way a write reports
  // success and changes nothing, and it was live on the seller's own name.
  //
  // (b) No rollback. `setProfile` ran first and was never undone, so on a
  // genuine error the edit screen showed "could not save" while the
  // profile behind it already displayed the new value -- until the next
  // sync quietly put it back.
  //
  // (c) The rollback restores ONLY the fields this call changed, not the
  // whole snapshot it took on the way in. These three writers are not
  // serialised -- ProfileScreen can have a name save in flight when the
  // district picker commits -- and putting a whole `Profile` back would
  // have undone a sibling field that saved perfectly well, with nothing
  // on screen to say so. Which keys those are is read off the optimistic
  // updater itself rather than from the `patch` (whose keys are the
  // database's snake_case names, not the Profile's).
  const writeProfileFields = useCallback(
    async (patch: Record<string, unknown>, optimistic: (p: Profile) => Profile) => {
      const previous = profileRef.current;
      const uid = userIdRef.current;
      // Read BEFORE the optimistic update, and it throws rather than
      // returning. `if (!uid) return` after setProfile was a fourth
      // instance of the very pattern this function was written to close:
      // the edit screen saw a resolved promise, navigated back, and the
      // change was lost at the next sync with nothing said. Reachable on
      // an offline start, before ensureSession has finished.
      if (!uid) throw new Error('profile_not_saved');
      setProfile(optimistic);
      const { data, error } = await supabase
        .from('profiles').update(patch).eq('id', uid).select('id');
      if (error || !data || data.length === 0) {
        const wouldBe = optimistic(previous) as unknown as Record<string, unknown>;
        const touched = Object.keys(wouldBe).filter(
          (k) => wouldBe[k] !== (previous as unknown as Record<string, unknown>)[k]
        );
        setProfile((current) => {
          const restored = { ...(current as unknown as Record<string, unknown>) };
          touched.forEach((k) => {
            restored[k] = (previous as unknown as Record<string, unknown>)[k];
          });
          return restored as unknown as Profile;
        });
        throw error || new Error('profile_not_saved');
      }
    },
    []
  );

  const updateAvatar = useCallback(
    (url: string | null) => writeProfileFields({ avatar_url: url }, (p) => ({ ...p, avatarUrl: url })),
    [writeProfileFields]
  );

  // Same shape as updateAvatar -- a plain `.update()`, not an upsert
  // (see upsertOwnProfile's comment in lib/supabase.ts for why upsert
  // doesn't work on this table): by the time a verified user reaches
  // ProfileScreen's edit menu, syncFromSupabase has already guaranteed a
  // profiles row exists for their uid, so there's never a conflict to
  // resolve here.
  const updateProfileName = useCallback(
    (name: string) => writeProfileFields({ full_name: name }, (p) => ({ ...p, name })),
    [writeProfileFields]
  );

  const updateProfileDistrict = useCallback(
    (district: string) => writeProfileFields({ district }, (p) => ({ ...p, district })),
    [writeProfileFields]
  );

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
    ): Promise<{ urls: string[]; coverThumbnailUrl: string | null; missing: number }> => {
      if (uris.length === 0) return { urls: [], coverThumbnailUrl: null, missing: 0 };
      // THROWS now, on either half. It used to upload, insert without
      // checking the error, and return the urls regardless -- so a refused
      // insert reported success and local state was updated as though the
      // rows existed. The seller's own device then showed photos nobody
      // else had, which is exactly how "my listing has no pictures" reaches
      // us as a bug report instead of as an error.
      //
      // The line it throws on is ZERO, not "fewer than asked for". A
      // listing with no pictures at all cannot go on the site -- that is
      // the bug this whole change exists to remove -- but a listing that
      // got five of its six photos up is a listing with pictures, and
      // parking it would make the seller re-do all six to recover the one.
      // So a partial upload keeps what landed, publishes, and reports the
      // shortfall through `missing` so the caller can say so without
      // treating the save as a failure. The edit path (syncPhotoKind)
      // draws the line in exactly the same place; they disagreed in the
      // first draft of this fix, which meant the same half-finished upload
      // was a failure on one screen and a success on the other.
      if (kind === 'gallery') {
        // silent: the store owns the sentence, in the seller's language.
        // AlertHost holds one alert with no queue (@AGENTS.md), so letting
        // the uploader alert too means one of the two is destroyed and
        // which one is a race -- and the uploader's is hardcoded English.
        const uploaded = await uploadPhotosWithThumbnails(uris, { silent: true });
        if (uploaded.length === 0) {
          throw new PhotoWriteError('upload', uris.length, 0);
        }
        await insertPhotoRows(
          uploaded.map((u, i) => ({
            listing_id: listingId,
            url: u.url,
            thumbnail_url: u.thumbnailUrl,
            sort_order: i,
            kind,
          }))
        );
        return {
          urls: uploaded.map((u) => u.url),
          coverThumbnailUrl: uploaded[0]?.thumbnailUrl ?? null,
          missing: uris.length - uploaded.length,
        };
      }
      const hostedUrls = await uploadPhotos(uris, { silent: true });
      if (hostedUrls.length === 0) {
        throw new PhotoWriteError('upload', uris.length, 0);
      }
      await insertPhotoRows(
        hostedUrls.map((url, i) => ({ listing_id: listingId, url, sort_order: i, kind }))
      );
      return { urls: hostedUrls, coverThumbnailUrl: null, missing: uris.length - hostedUrls.length };
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
  //
  // The loop itself moved to lib/listingMedia.ts, because the admin auction
  // screens need exactly this and a third copy is how the second one drifts.
  //
  // A SHORTFALL is a failure. writeSpinSets is best-effort by default --
  // a refused set row, a set whose frames all failed to upload, a refused
  // frame insert -- and each of those just drops the set and returns a
  // shorter array. Nothing read that length, so every one of them was
  // silent, and the seller was left looking at a 360 spin on their own
  // device that nobody else had: the same shape as the photo bug this
  // whole change exists to remove, one table over.
  const persistNewSpinSets = useCallback(
    async (listingId: string, sets: SpinSet[], onFramesMissing?: (n: number) => void): Promise<SpinSet[]> => {
      const wanted = sets.filter((set) => set.frames.length > 0).length;
      const written = await writeSpinSets(listingId, sets, { silent: true, onFramesMissing });
      if (written.length < wanted) {
        throw new Error(`spin_sets_incomplete: wrote ${written.length} of ${wanted}`);
      }
      return written;
    },
    []
  );

  // Diffs a listing's desired GALLERY photo set against what's on
  // Supabase: deletes rows that were removed, uploads+inserts newly-picked
  // local photos in the background (same fire-and-forget lifecycle as
  // addListing, so the seller isn't blocked waiting on uploads), and
  // re-syncs sort_order for kept photos when there's nothing new to upload.
  // Spin sets are edited as whole units (add/remove/rename/retake a whole
  // spin, not individual frames within one that's kept), so they go
  // through syncSpinSets below instead of this per-frame diff -- see its
  // own comment for why that one's a full replace rather than a diff.
  // `waitForUploads` exists for one caller and one reason: when this edit
  // is the thing that will PUBLISH the listing, moderation must not run
  // until the new photos are actually in the database. Left false -- the
  // ordinary edit of an already-live listing -- the uploads stay
  // fire-and-forget and the seller is not made to wait on them.
  const syncPhotoKind = useCallback(
    async (
      listingId: string,
      kind: 'gallery',
      desiredUris: string[],
      opts: {
        waitForUploads?: boolean;
        // Called with the outcome when the uploads are NOT waited on, so
        // the caller can say its one ranked sentence at the right moment
        // instead of this function firing an alert of its own outside
        // that ranking -- which, AlertHost holding exactly one
        // (@AGENTS.md), meant a low-priority message fired later could
        // destroy the one that mattered.
        onLateResult?: (r: { stage: PhotoWriteStage | null; missing: number; photos: string[] }) => void;
      } = {}
    ): Promise<{ missing: number; deferred: boolean; photos: string[] }> => {
      const hostedKept = desiredUris.filter((p) => /^https?:\/\//.test(p));
      const localNew = desiredUris.filter((p) => !/^https?:\/\//.test(p));

      const { data: existingRows, error: existingError } = await supabase
        .from('listing_photos')
        .select('id, url, sort_order')
        .eq('listing_id', listingId)
        .eq('kind', kind);
      // An unreadable existing set is not an empty one. Carrying on with
      // `existingRows || []` would compute "nothing to remove" from a
      // failed read and, on the reorder branch below, silently do nothing
      // at all.
      if (existingError) {
        console.warn('[AppStore] photo read refused:', existingError.message);
        throw new PhotoWriteError('read', desiredUris.length, 0, existingError.message);
      }
      // The cover as it stands in the DATABASE, before this edit. Read
      // from here rather than from local state, because by the time the
      // setListings below runs, updateListing's optimistic paint has
      // already replaced `it.photos` with the seller's new arrangement --
      // so comparing against `it.photos[0]` compared the new cover with
      // itself and always kept the OLD cover's thumbnail, on a photo it
      // did not belong to.
      const previousCoverUrl: string | null =
        (existingRows || [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url ?? null;

      const removedIds = (existingRows || [])
        .filter((row: any) => !hostedKept.includes(row.url))
        .map((row: any) => row.id as string);

      // Removing the rows the seller took out.
      //
      // Checked, but NOT by counting the returned rows against what we
      // asked for. A DELETE is idempotent, and these calls overlap:
      // BatchPhotosScreen fires one updateListing per photo tap on the
      // same listing (see updateListing's own note on that), so two runs
      // routinely target the same row and the second legitimately deletes
      // nothing. Counting would have turned that into a red "could not
      // save" box over a delete that had already succeeded. What actually
      // matters is whether any of them SURVIVED, so on a short count we
      // go and look.
      const removeStale = async () => {
        if (removedIds.length === 0) return;
        const { data: deletedRows, error: deleteError } = await supabase
          .from('listing_photos').delete().in('id', removedIds).select('id');
        if (!deleteError && deletedRows && deletedRows.length === removedIds.length) return;
        const { data: survivors, error: checkError } = await supabase
          .from('listing_photos').select('id').in('id', removedIds);
        // An unreadable check is not a clean one -- a refused delete
        // means photos the seller took OUT in Edit stay in the database,
        // reappear at the next sync, and that reads as the edit not
        // saving at all.
        if (checkError || !survivors || survivors.length > 0) {
          const detail = deleteError?.message || checkError?.message || `${survivors?.length ?? '?'} rows survived`;
          console.warn('[AppStore] photo delete did not land:', detail);
          throw new PhotoWriteError('delete', removedIds.length, 0, detail);
        }
      };

      // Photo 0 is the card's cover, so the order is a user-visible
      // choice, not bookkeeping. Every error here used to be dropped, so
      // the seller saw their new cover on their own device while every
      // buyer kept the old one until the next sync put it back.
      //
      // Runs on BOTH branches now, not just the reorder-only one. With
      // new photos in the mix it used to be skipped entirely while new
      // rows were written at `hostedKept.length + i` -- so a seller who
      // deleted photo 0 and added one gave the new row a sort_order that
      // collided with a surviving photo's, and which of the two a buyer
      // saw first was whatever the database felt like returning.
      //
      // `.select('id')` on each, because an `.update().eq()` that matches
      // no row is not an error -- it returns `error: null` and changes
      // nothing (@AGENTS.md). Under an RLS policy that filters rather
      // than refuses, EVERY one of these would have come back clean while
      // the buyers' cover image never moved.
      //
      // Only a hard ERROR fails here, not a zero-row result: the same
      // concurrent-edit case that makes the delete count unreliable makes
      // this one unreliable too -- a sibling run that has already
      // replaced the row leaves this `eq('url', ...)` matching nothing,
      // and its own resync set the order correctly.
      const resyncOrder = async (desired: string[]) => {
        if (desired.length === 0) return;
        const results = await Promise.all(
          desired.map((url, i) =>
            supabase
              .from('listing_photos')
              .update({ sort_order: i })
              .eq('listing_id', listingId)
              .eq('kind', kind)
              .eq('url', url)
              .select('id')
          )
        );
        const orderError = results.find((r) => r.error)?.error;
        if (orderError) {
          console.warn('[AppStore] photo reorder refused:', orderError.message);
          throw new PhotoWriteError('reorder', desired.length, 0, orderError.message);
        }
        // Every one matching nothing, with no error, is the one shape
        // that is not a race: an RLS policy filtering the rows out.
        if (results.every((r) => !r.data || r.data.length === 0)) {
          console.warn('[AppStore] photo reorder matched no rows');
          throw new PhotoWriteError('reorder', desired.length, 0, 'no rows matched');
        }
      };

      if (localNew.length > 0) {
        // ORDER MATTERS, and it is the opposite of the obvious one.
        //
        // Uploading and inserting comes FIRST; the removals happen only
        // once the new rows are in. Deleting first -- which is what this
        // did -- meant that a seller who replaced every photo on a LIVE
        // listing and then lost their connection was left with a public
        // listing showing nothing at all: the old rows were gone, the new
        // ones never arrived. That is the same bug as the one this whole
        // change exists to remove, reached from the edit screen instead
        // of the post screen. This way round, the worst case is a listing
        // that briefly shows both sets, which nobody has ever filed a bug
        // about.
        //
        // THE CHAIN IS DELIBERATELY NOT `.catch()`-ED HERE. An earlier
        // draft attached the alerting catch to the same chain it then
        // awaited -- and a `.catch` whose handler returns normally
        // produces a promise that RESOLVES, so `await` on it could never
        // fail and the caller went on to publish a listing with no
        // pictures anyway, having been told the photos landed. Keep the
        // raw promise; attach the alert-and-swallow handler only on the
        // path that is not waiting on it.
        //
        // `silent: true`: the store says the sentence, in the seller's
        // language. AlertHost holds one alert with no queue, so letting
        // the uploader alert too means one of the two is destroyed and
        // which one is a race (@AGENTS.md).
        const run = uploadPhotosWithThumbnails(localNew, { silent: true }).then(async (uploaded) => {
          if (uploaded.length === 0) {
            throw new PhotoWriteError('upload', localNew.length, 0);
          }
          const newPhotoUrls = uploaded.map((u) => u.url);
          // THE SELLER'S OWN ORDER, not "kept ones first, new ones after".
          //
          // desiredUris is the list as it stands in the DraggableList the
          // seller just arranged, index 0 labelled "Cover". Renumbering
          // `[...hostedKept, ...newPhotoUrls]` threw that away: a seller
          // who added a photo AND dragged it to the front got it written
          // last, on the listing and on their own screen, with nothing
          // said. uploadPhotosWithThumbnails returns its results in the
          // order it was given `localNew`, which is desiredUris' own
          // relative order, so mapping each local URI to the URL it
          // became reconstructs exactly what they arranged.
          // Keyed on each result's OWN uri, not on its position.
          // uploadPhotosWithThumbnails compacts -- a failed photo is
          // skipped -- so pairing by index attached every surviving url to
          // an earlier photo's slot the moment anything failed, and
          // resyncOrder then wrote that wrong order to the database. The
          // partial upload is exactly the case the rest of this change is
          // built around, so it is the one this had to get right.
          const hostedFor = new Map<string, string>();
          uploaded.forEach((u) => hostedFor.set(u.uri, u.url));
          const desiredOrder = desiredUris.map((p) => hostedFor.get(p) ?? p).filter((p) => /^https?:\/\//.test(p));

          // Parked ABOVE every row that currently exists, not at
          // `hostedKept.length`. A seller who deletes photo 0 and adds one
          // leaves two kept rows still holding sort_order 1 and 2, so a
          // new row at index 2 collided with a surviving one -- and which
          // of the two a buyer saw first was whatever the database felt
          // like returning. Nothing reads these interim values; the
          // renumber below is what sets the order the buyer sees.
          const startOrder = (existingRows?.length ?? 0) + hostedKept.length;
          await insertPhotoRows(
            uploaded.map((u, i) => ({
              listing_id: listingId,
              url: u.url,
              thumbnail_url: u.thumbnailUrl,
              sort_order: startOrder + i,
              kind,
            }))
          );
          // Remove BEFORE renumbering, not after. The other way round, a
          // renumber that failed skipped the removal entirely -- so the
          // photo the seller deleted was still on the listing AND still
          // held the lowest sort_order, which made it the public cover.
          // The seller was then told "all your photos are on the listing,
          // only the order is wrong", which was wrong on both counts.
          await removeStale();
          await resyncOrder(desiredOrder);
          const thumbFor = new Map<string, string>();
          uploaded.forEach((u) => thumbFor.set(u.url, u.thumbnailUrl));
          setListings((prev) =>
            prev.map((it) => {
              if (it.id !== listingId) return it;
              // The cover is index 0 OF WHAT THE SELLER ARRANGED. The old
              // reading -- "if any kept photo remains it is still the
              // cover" -- was only true while new photos always went
              // last, which is exactly the assumption above that was
              // costing the seller their chosen cover. A newly uploaded
              // photo dragged to the front brings its own thumbnail; a
              // kept one leaves the existing thumbnail alone, since we do
              // not hold thumbnails for photos we did not just upload.
              const cover = desiredOrder[0];
              // Three cases, and the middle one is why this is not a
              // ternary on hostedKept.length. A newly uploaded cover
              // brings its own thumbnail. A cover that is the SAME photo
              // as before keeps the thumbnail it had. A kept photo
              // promoted to cover from further down has no thumbnail we
              // hold, and the stale one belongs to a different picture --
              // null lets the card fall back to the full image until the
              // next sync, which is the only honest answer here.
              const coverThumbnailUrl = !cover
                ? null
                : thumbFor.get(cover) ?? (cover === previousCoverUrl ? it.coverThumbnailUrl : null);
              return { ...it, photos: desiredOrder, coverThumbnailUrl };
            })
          );
          // Same line as the create path: zero threw above, a shortfall is
          // reported and not treated as a failed save.
          return { missing: localNew.length - uploaded.length, deferred: false, photos: desiredOrder };
        });
        // Waiting means the caller intends to act on the answer, so the
        // rejection is left to reach it. Not waiting means nobody
        // downstream will ever see it, so it has to be said here.
        // No deadline wrapped around this any more, and deliberately.
        //
        // An earlier draft raced the whole chain against 180s so it could
        // never hang -- but the chain's own upload half is bounded per
        // PHOTO at 60s and the photos go up one after another, so from
        // the fourth photo on it was the race that fired, not the
        // timeout. It rejected as an insert failure, which blocks
        // publication; meanwhile the uploads carried on and wrote the
        // three that had landed. The seller lost three photos, was told
        // the listing was not on the site, and was never told about the
        // photos at all -- breaking this file's own rule that zero is a
        // failure and a shortfall is not.
        //
        // Both halves are now bounded where they actually are: each
        // upload by UPLOAD_TIMEOUT_MS (see photoUpload.ts) and every
        // database call by the supabase client's own request deadline
        // (see lib/supabase.ts). So this settles without anything here
        // having to guess how long the work should take.
        if (opts.waitForUploads) return await run;
        run.then(
          (r) => opts.onLateResult?.({ stage: null, missing: r.missing, photos: r.photos }),
          (e: any) => {
            console.warn('[AppStore] syncPhotoKind failed:', e?.message || e);
            opts.onLateResult?.({
              stage: e instanceof PhotoWriteError ? e.stage : 'insert',
              missing: 0,
              photos: [],
            });
          }
        );
        // `deferred` is what tells the caller its ranked report has to
        // wait for onLateResult rather than running now. Without it the
        // caller could not tell this branch from the one below, which
        // settles everything before it returns -- and so it never
        // reported at all on an edit that only removed or reordered
        // photos. That silence covered a refused delete, a refused
        // reorder, a failed spin write and a failed video attach: four of
        // the failures this change added messages for, on the commonest
        // edit there is.
        return { missing: 0, deferred: true, photos: [] };
      }

      // Nothing new to upload: remove what went, then re-sync sort_order
      // for what stayed.
      await removeStale();
      await resyncOrder(hostedKept);

      // The cover, on the branch that never touched local state at all.
      //
      // updateListing's optimistic paint has already replaced `it.photos`
      // with the new arrangement, but `coverThumbnailUrl` is not part of
      // that payload -- so a seller who deleted the cover photo, or
      // dragged a different one to the front, kept looking at a thumbnail
      // of the OLD cover on their own card for the rest of the session.
      // The image is still on the CDN (only the row went), and
      // syncFromSupabase runs at launch, so nothing corrected it. There
      // is no thumbnail to hand for a photo we did not just upload, and a
      // null falls back to the full image (see ListingCard), which is the
      // honest answer until the next sync.
      if (hostedKept[0] !== previousCoverUrl) {
        setListings((prev) =>
          prev.map((it) => (it.id === listingId ? { ...it, coverThumbnailUrl: null } : it))
        );
      }
      return { missing: 0, deferred: false, photos: hostedKept };
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
  const syncSpinSets = useCallback(async (
    listingId: string,
    desiredSets: SpinSet[],
    onFramesMissing?: (n: number) => void
  ): Promise<SpinSet[]> => {
    const { data: existingSets, error: existingError } = await supabase
      .from('listing_spin_sets').select('id').eq('listing_id', listingId);
    // A failed READ is not an empty one -- and this function's whole
    // safety rests on the delete below actually running. `existingSets`
    // comes back null on an error, the delete is skipped, and
    // writeSpinSets then inserts a SECOND copy of every set: duplicate
    // 360 tabs on a public page, which is exactly what the delete exists
    // to prevent. This check was missing while the comment below claimed
    // the case was covered.
    if (existingError) {
      console.warn('[AppStore] spin set read refused:', existingError.message);
      throw existingError;
    }
    if (existingSets && existingSets.length > 0) {
      // Checked on both counts, and it THROWS rather than carrying on.
      // This is a replace: if the delete does not happen and the insert
      // below succeeds, the listing carries the old sets AND the new ones
      // while local state is set to only the new ones. Better to fail the
      // sync than to double it. The error check alone is not enough --
      // an RLS policy that filters rather than refuses returns
      // `error: null` having deleted nothing (@AGENTS.md) -- so the
      // survivors are read back. Unlike the gallery delete, a short count
      // IS conclusive here: these ids were read one statement ago and
      // nothing else deletes a listing's spin sets concurrently.
      const ids = existingSets.map((s: any) => s.id as string);
      const { data: deletedRows, error: deleteError } = await supabase
        .from('listing_spin_sets').delete().in('id', ids).select('id');
      if (deleteError || !deletedRows || deletedRows.length < ids.length) {
        const detail = deleteError?.message || `deleted ${deletedRows?.length ?? 0} of ${ids.length}`;
        console.warn('[AppStore] spin set delete did not land:', detail);
        throw deleteError || new Error('spin_set_delete_not_saved');
      }
    }
    // Same writer as the create path -- it already keeps hosted frames and
    // uploads only the newly-picked ones, which is what a replace needs.
    const wanted = desiredSets.filter((set) => set.frames.length > 0).length;
    const written = await writeSpinSets(listingId, desiredSets, { silent: true, onFramesMissing });
    if (written.length < wanted) {
      // See persistNewSpinSets. The caller catches this and tells the
      // seller their spin was not saved, which is the whole point.
      throw new Error(`spin_sets_incomplete: wrote ${written.length} of ${wanted}`);
    }
    return written;
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

      // The media, uploaded in the background rather than making the
      // seller wait -- but the ORDER below is the fix for a real incident
      // and must not be flattened back.
      //
      // What used to happen: the listing row was inserted, the photos
      // started uploading, and moderation was fired at the same moment.
      // Moderation publishes the listing (status -> active) about four
      // seconds later; six photos take ten to twenty. So EVERY listing was
      // live and publicly visible for ten seconds or more with no
      // pictures, and if the uploads never finished -- a closed tab, a
      // reload, a browser throttling a background tab, a dropped
      // connection -- it stayed that way for good. That is exactly what
      // happened on 3 Sep: three listings posted in nine minutes, two had
      // their photos land at +19s and +14s, the third never did, and the
      // seller only got pictures by editing the listing and uploading them
      // again.
      //
      // So: media first, publication second. A listing whose photos did
      // not land stays 'pending_review', which is invisible to buyers --
      // a listing nobody can see yet is a far better failure than a live
      // one with nothing to look at.
      const listingId = data.id;

      // Started HERE, before the photo await below, not inside the same
      // chain. The comment further down says the video is deliberately not
      // allowed to hold up publication -- true -- but sitting after
      // `await persistNewPhotos` meant a photo failure threw before the
      // attach ever ran, so a failure in one optional-ish thing silently
      // took out an unrelated one. They are independent, so they run
      // independently.
      //
      // Linking is what makes the video visible to anyone else: the RLS
      // select policy only exposes a video whose listing is live (its
      // seller can always read their own, which is why the row-count check
      // inside attachVideoToListing is safe here).
      // Declared above videoLanded, whose catch closes over it. Safe
      // either way today because nothing awaits between them, but that is
      // a property of the current line order rather than of the code, and
      // an await inserted in the gap would turn this into a TDZ
      // ReferenceError thrown inside a catch handler.
      const media: { missing: number; spinFailed: boolean; spinShort: boolean; videoFailed: boolean } = {
        missing: 0,
        spinFailed: false,
        spinShort: false,
        videoFailed: false,
      };

      const videoLanded = l.video?.guid
        ? attachVideoToListing(l.video.guid, listingId).catch((e: any) => {
            // Deliberately not allowed to hold up publication -- a video
            // is optional on every listing -- but no longer silent
            // either. RLS shows an unattached clip to its seller and to
            // nobody else, so the seller watched their own video on their
            // own listing, for ever, while no buyer could, and the only
            // trace was a console line. updateListing has said this since
            // the start of this change; addListing had not.
            console.warn('[AppStore] video not attached:', e?.message || e);
            media.videoFailed = true;
          })
        : Promise.resolve();

      // Ranked once, said once, at the end. AlertHost holds exactly one
      // alert with no queue (@AGENTS.md), so a missing-photos alert and a
      // spin alert fired a few hundred milliseconds apart means the seller
      // reads one of them at random.

      const mediaLanded = (async () => {
        if (l.photos.length > 0) {
          const { urls, coverThumbnailUrl, missing } = await persistNewPhotos(listingId, l.photos, 'gallery');
          media.missing = missing;
          setListings((prev) =>
            prev.map((it) => (it.id === listingId ? { ...it, photos: urls, coverThumbnailUrl } : it))
          );
        }
        if (l.spinSets.length > 0) {
          // Caught, not allowed to reject the chain. A 360 spin is
          // optional on every listing, and a listing with six good photos
          // has no business being withheld from the site because a spin
          // set could not be written -- which is what a throw here did,
          // since the failure arm below skips publication.
          try {
            const hostedSets = await persistNewSpinSets(listingId, l.spinSets, () => {
              media.spinShort = true;
            });
            if (hostedSets.length > 0) {
              setListings((prev) => prev.map((it) => (it.id === listingId ? { ...it, spinSets: hostedSets } : it)));
            }
          } catch (e: any) {
            console.warn('[AppStore] spin sets did not land:', e?.message || e);
            media.spinFailed = true;
          }
        }
      })();

      // Moderation -- and therefore publication -- runs only once the
      // pictures are actually in the database. A draft is skipped
      // entirely: there is nothing to moderate yet, and moderate-listing
      // would just flag an incomplete listing that was never submitted.
      mediaLanded.then(
        async () => {
          // Not a gate -- it resolves either way -- just late enough that
          // the ranking below knows about it.
          await videoLanded;

          // THE MEDIA ALERTS COME FIRST, AND THEY ARE NOT SKIPPED FOR A
          // DRAFT. `asDraft` only silences the sentences about
          // PUBLICATION, which is the only thing a draft genuinely has
          // nothing to say about.
          //
          // Putting the draft check at the top of this handler was a
          // regression introduced by this very change: the uploaders were
          // given `{ silent: true }` so the store could say the same
          // thing in the seller's own language, and then the store said
          // nothing at all for a draft. Before that, a partial upload on
          // a batch item at least got the uploader's own English alert.
          // Batch item saved with three photos, two of them failed, the
          // seller sees three thumbnails and is told nothing until the
          // whole batch is posted.
          //
          // The twenty-alerts worry that put the check there belongs to
          // the loop callers, and they go through updateListing with
          // quietMedia. Nothing loops addListing -- BatchPhotosScreen
          // commits one item at a time -- so there is nothing to
          // stampede.
          //
          // The no-photos case is ranked FIRST rather than alerted after
          // the return below, because a listing that is not going on the
          // site at all outranks a spin set -- and firing both meant the
          // second destroyed the first (AlertHost holds exactly one,
          // @AGENTS.md).
          const noPhotos = !asDraft && l.photos.length === 0;
          if (noPhotos) {
            Alert.alert(
              tRef.current('media.notPublishedNoPhotosTitle'),
              tRef.current('media.notPublishedNoPhotosBody')
            );
          } else if (media.missing > 0) {
            // Some got through, some didn't. The seller is told which is
            // which so they can add the rest, rather than discovering the
            // gap later.
            Alert.alert(
              tRef.current('media.somePhotosMissingTitle'),
              tRef.current('media.somePhotosMissingBody', { count: media.missing })
            );
          } else if (media.spinFailed) {
            Alert.alert(tRef.current('media.spinNotSavedTitle'), tRef.current('media.spinNotSavedBody'));
          } else if (media.spinShort) {
            Alert.alert(tRef.current('media.spinTooShortTitle'), tRef.current('media.spinTooShortBody'));
          } else if (media.videoFailed) {
            Alert.alert(tRef.current('media.videoNotAttachedTitle'), tRef.current('media.videoNotAttachedBody'));
          }

          if (asDraft) return;

          // Publication needs POSITIVE evidence that there is something to
          // look at, not merely the absence of a failure. With no photos
          // at all the block above resolves instantly having done nothing,
          // and the old reading of that was "media landed, publish" -- a
          // live listing with nothing on it, by the shortest path there
          // is. CreateListingScreen's wizard will not let a seller reach
          // here empty-handed, but its Save-and-exit path and the batch
          // screens both can.
          if (noPhotos) {
            console.warn('[AppStore] not publishing a listing with no photos:', listingId);
            return;
          }
          // Points are awarded HERE, not on the way out of addListing.
          // They used to be credited for every non-draft the moment the
          // row was written -- including the ones this same function then
          // refused to publish, which wrote a ledger row and a balance for
          // a listing nobody could see. A post that did not go out is not
          // a post.
          //
          Promise.all(
            [...l.photos.slice(0, MODERATION_MAX_PHOTOS), ...spinFramesForModeration(l.spinSets)].map((uri) =>
              uriToCompressedBase64(uri)
            )
          )
            .then((results) => {
              const photos = results.filter((p): p is { data: string; mediaType: string } => !!p);
              return triggerListingModeration(listingId, photos, l.titleEn || l.titleAr, l.descriptionEn || l.descriptionAr);
            })
            .catch(() => {});
          // Claimed against listings.posting_points_awarded rather than
          // inferred from the listing's status, so the repair path
          // (parked, photos added later, published by that edit) earns
          // its award exactly once and nothing earns it twice. See
          // updateListing's twin for the whole reasoning.
          //
          // AFTER the moderation kick-off, and not awaited. This handler
          // has no trailing .catch, so an await here put publication
          // behind a points call that can throw -- points are the least
          // important thing in this function and were gating the most
          // important one.
          void claimPostingPoints(listingId, l.titleEn || l.titleAr);
        },
        (e: any) => {
          // Said out loud. The old code ended this chain with
          // `.catch(() => {})`, so the one person who could fix it -- the
          // seller, still holding the photos on their phone -- was the
          // only person not told. The listing is safe where it is:
          // pending_review, visible to nobody, and repairable by opening
          // it and adding the photos again.
          console.warn('[AppStore] listing media did not land:', e?.message || e);
          // A DRAFT was never going on the site, so "it is not on the site
          // yet" is not news and not true in the way it reads -- but the
          // photos not uploading IS news either way, and returning here
          // said nothing at all. Its own sentence: the item is saved, the
          // pictures are not, and they are still on this device.
          if (asDraft) {
            Alert.alert(
              tRef.current('media.draftPhotosNotUploadedTitle'),
              tRef.current('media.draftPhotosNotUploadedBody')
            );
            return;
          }
          Alert.alert(tRef.current('media.photosDidNotUploadTitle'), tRef.current('media.photosDidNotUploadBody'));
        }
      );

      setListings((prev) => [newListing, ...prev]);
      return newListing;
    },
    [profile, claimPostingPoints, persistNewPhotos, persistNewSpinSets, isVerified, myShop]
  );

  const updateListing = useCallback(
    async (id: string, l: ListingInput, opts: ListingSaveOptions = {}): Promise<ListingSaveResult> => {
      // A listing a human moderator rejected goes back through the same
      // AI-first-pass gate on resubmit, rather than silently staying
      // 'rejected' forever or (worse) silently becoming 'active' again
      // unreviewed -- see AdminModerationScreen's reject flow and
      // ProfileScreen's "Edit & resubmit" action, which both funnel here.
      //
      // WHERE THE STATUS COMES FROM. Not from local state, which is a
      // whole session out of date the moment a listing is posted.
      //
      // `listings` is loaded once, by syncFromSupabase at launch (and on an
      // auth change). Nothing refetches it. But addListing writes
      // 'pending_review'/'pending' locally and the moderate-listing edge
      // function then publishes the row server-side about four seconds
      // later -- so for the rest of that session a live, publicly visible
      // listing reads as pending_review on its own seller's device.
      //
      // Every decision below hangs off that status, and all of them were
      // wrong for exactly the listing a seller is most likely to edit
      // next: the guard that refuses to strip a LIVE listing to nothing
      // did not fire (it read 'pending_review', not 'active'), so the
      // most natural sequence there is -- post, look at it, edit, delete
      // the photos, Save & exit -- deleted every photo row from a public
      // listing and told the seller it was "not on the site yet". And
      // `wasPendingReview` was stale-TRUE, so every ordinary edit re-ran
      // the AI check on an already-approved listing, which flags it on any
      // API timeout.
      //
      // One extra round trip on an edit is cheap. Being wrong about
      // whether a listing is public is not.
      //
      // STARTED here, AWAITED further down, and the difference matters.
      // Two batch screens drive a control straight off the store with no
      // local copy -- BatchReviewScreen's condition pills and its category
      // sheet -- so putting the optimistic paint behind this round trip
      // left the pill sitting on its old value for as long as the network
      // took, which reads as a tap that did not register and invites a
      // second one.
      //
      // Built here, awaited below. Note that postgrest-js is a LAZY
      // thenable -- the request goes out when something awaits it, not at
      // construction, and Promise.resolve() only schedules a microtask
      // rather than forcing it -- so this does not overlap the block
      // between. Nothing between here and the await is async, so there is
      // nothing to overlap; what the split buys is that the optimistic
      // paint below happens before the round trip rather than after it.
      // Anything genuinely slow added in between would need its own
      // arrangement, not this one.
      const liveRowPromise = supabase
        .from('listings')
        .select('status, moderation_status')
        .eq('id', id)
        .maybeSingle();
      const cachedRow = listingsRef.current.find((it) => it.id === id) ?? null;

      // "Save & exit" re-saving an already-parked draft -- see ListingInput's
      // doc comment. Keeps it a draft: no status change, no moderation, no
      // posting points, whether it was already a draft or (impossible in
      // practice, but harmless) something else. Needs no server read, so
      // it is available before the one above lands.
      const asDraft = l.status === 'draft';

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
      // The FIELDS half, painted before the status read lands. These are
      // what the screens actually watch -- BatchReviewScreen's condition
      // pills and category read straight off the store with no local copy
      // -- so making them wait on a round trip is what makes a tap look
      // like it did not register.
      setListings((prev) =>
        prev.map((it) => {
          if (it.id !== id) return it;
          capturedRow = it;
          return { ...it, ...fields, ...shopDisplayFields };
        })
      );

      const rollBack = () => {
        if (updateListingSeq.get(id) !== seq) return;
        const before: Listing | null = capturedRow ?? committedRow;
        if (!before) return;
        setListings((prev) => prev.map((it) => (it.id === id ? before : it)));
      };

      const { data: liveRow, error: liveRowError } = await liveRowPromise;
      if (liveRowError) {
        console.warn('[AppStore] could not read the listing before editing:', liveRowError.message);
      }
      // The cache is the fallback for the ONE case where it is still the
      // best answer available: the read failed, so we are offline or
      // refused, and the seller's own last known truth beats nothing.
      //
      // A read that SUCCEEDED and returned no row is a different thing
      // entirely -- the listing was deleted, or the session went
      // anonymous and RLS filtered it out -- and falling back to the
      // cache there is exactly the stale reading this round trip was
      // added to eliminate. It gets null, and the UPDATE below then fails
      // honestly as 'refused'.
      const currentStatus: string | null = liveRowError
        ? cachedRow?.status ?? null
        : (liveRow?.status as string | undefined) ?? null;
      const currentModeration: string | null = liveRowError
        ? cachedRow?.moderationStatus ?? null
        : (liveRow?.moderation_status as string | undefined) ?? null;

      const wasRejected = currentStatus === 'rejected';
      // Same idea, one status earlier: a draft that's now being submitted
      // for real (the wizard's actual Post/Save button, not another
      // "Save & exit") needs the same draft->pending_review transition and
      // moderation kick-off addListing gives a brand-new listing.
      const wasDraft = currentStatus === 'draft';
      // A listing whose photos never landed is parked at 'pending_review'
      // and invisible (see addListing). Adding the photos has to be able to
      // release it, or the repair path dead-ends: moderation used to be
      // re-run only for a rejected listing or a draft being submitted, so a
      // listing stuck here would have stayed stuck for ever however many
      // times the seller edited it.
      //
      // But 'pending_review' is NOT only where a stuck listing sits: it is
      // also where a listing the AI FLAGGED waits for a human moderator.
      // Gating on the status alone would mean a seller who edits one word
      // of a flagged listing gets the AI re-run on it, and a second
      // opinion that comes back clean takes it straight live -- out of the
      // moderator's queue, without the moderator ever seeing it.
      //
      // `moderationStatus` already carries exactly the distinction needed.
      // 'pending' means the AI never returned a verdict, which is the only
      // way a listing STAYS at pending_review, and is precisely the state
      // a parked listing is in. 'flagged' is a human's to clear.
      // 'ai_approved'/'human_approved'/'rejected' all mean it ran.
      //
      // An earlier draft gated on "the listing has zero photo rows"
      // instead, on the theory that missing photos are what it is
      // repairing. That was worse in a way that mattered: a listing parked
      // by ANY other failure -- a refused spin-set write, a refused photo
      // delete -- has photos, so it never matched, willModerate stayed
      // false on every subsequent edit, and the listing was invisible for
      // good with no way back short of an admin. A repair path that can
      // only repair one of the things that breaks is a trap.
      //
      // 'rejected' counts too, and missing it left a hole exactly like the
      // one above. enforce_listing_moderation_gate is a BEFORE UPDATE
      // trigger that, for a non-privileged caller, does
      // `new.moderation_status := old.moderation_status` WITHOUT raising
      // -- @AGENTS.md's third silent-write shape, and this write does not
      // read that column back. So a seller resubmitting a REJECTED
      // listing moves status to 'pending_review' while moderation_status
      // stays 'rejected' (verified against the live database). If the
      // photos then fail, the listing parks at pending_review/rejected --
      // and on every later save wasRejected is false (status moved),
      // wasDraft is false, and a 'pending'-only gate is false too, so
      // willModerate is false for ever and the seller can never get it
      // back on the site.
      //
      // The combination is unambiguous: the AI writes only 'ai_approved'
      // or 'flagged', never 'rejected', so 'rejected' sitting at
      // 'pending_review' can only mean the seller already resubmitted and
      // the check never ran. 'flagged' stays excluded -- that one is a
      // human moderator's to clear.
      //
      // Written as "anything but flagged" rather than as a list of the
      // states worth releasing, because listing them is how this kept
      // being wrong. It was 'pending' only, and missed the 'rejected' a
      // resubmit leaves behind. It was 'pending' or 'rejected', and
      // missed 'ai_approved': a seller HIDES a live listing (status ->
      // draft), edits it, and submitting that draft sends
      // moderation_status 'pending' which the gate trigger reverts to the
      // 'ai_approved' the listing already had -- so a media failure there
      // parked it at pending_review/ai_approved, outside every branch,
      // with no UI route back (Hide is only offered on an active row).
      // 'human_approved' does the same thing one moderator further on.
      //
      // At 'pending_review' there is exactly ONE moderation state that
      // belongs to somebody else: 'flagged', which a human moderator is
      // holding. Every other value there means the AI verdict is stale or
      // absent and the listing is waiting on a check that is ours to
      // re-run. Naming the one exclusion is both smaller and closed
      // against a moderation state added later.
      const wasPendingReview = currentStatus === 'pending_review' && currentModeration !== 'flagged';
      const submittingDraft = wasDraft && !asDraft;

      // An edit is not allowed to strip a LIVE listing to nothing.
      //
      // Refused before anything is written, because the alternative is a
      // public listing with no pictures -- the exact incident this whole
      // area exists to prevent, reached from the edit screen instead of
      // the post screen. It was reachable: CreateListingScreen's
      // Save-and-exit path checks category, title and price and not the
      // photo count, and syncPhotoKind would then delete every gallery
      // row and say nothing, because a listing that is already active
      // does not go near the publication gate.
      //
      // 'expired' counts as well as 'active', and missing it left the
      // whole guard bypassable without a single failed write: My Listings
      // shows an expired listing with a Republish button, and
      // republish_own_listing is SECURITY DEFINER and sets status straight
      // to 'active'. So the route was: open a listing that has expired,
      // remove every photo, Save & exit (which checks category, title and
      // price, not the photo count), then tap Republish. The RPC now
      // refuses a photoless listing too -- that is the check that
      // actually holds, since its whole job is to bypass the client's
      // rules about status -- and this one keeps the seller from getting
      // there at all, with the message on the screen they are on.
      //
      // 'sold' and 'removed' cannot be made public again without coming
      // back through here, and a listing parked at 'pending_review' is
      // caught by blockedReason() === 'no_photos' further down. A draft
      // with no photos is a normal thing to save.
      // Refused after the FIELDS half of the optimistic paint has already
      // run, so it has to be undone -- otherwise the edit screen shows a
      // refusal while the row behind it already carries the edit, until
      // the next sync quietly puts it back.
      //
      // AND when we could not tell. `currentStatus` falls back to the
      // local cache on a failed read, and that cache is reliably wrong
      // for the listing a seller is most likely to be editing: addListing
      // writes 'pending_review' locally, moderate-listing publishes the
      // row four seconds later, and nothing refetches for the rest of the
      // session. Trusting it here reads a LIVE listing as parked and lets
      // the guard through -- and the damage is not only "it does not
      // publish": syncPhotoKind still deletes every gallery row, off a
      // listing that is on the site, and the seller is then told it is
      // not. Unknown is not safe. Refusing costs a seller who genuinely
      // meant to empty a draft one retry when the connection is back.
      const statusUnknown = currentStatus === null || liveRowError !== null;
      if (!asDraft && l.photos.length === 0 && (statusUnknown || currentStatus === 'active' || currentStatus === 'expired')) {
        rollBack();
        console.warn(
          '[AppStore] refused an edit that would leave a listing photoless:',
          id,
          statusUnknown ? '(status unknown)' : currentStatus
        );
        throw listingSaveError('no-photos');
      }


      // The STATUS half, now that the server has said where this listing
      // actually is.
      // Seq-guarded like rollBack is, and for the same reason: with two
      // overlapping saves on one listing the slower one's status paint
      // would otherwise land on top of the faster one's and never be
      // undone, since its own rollBack no-ops on the mismatch.
      if (updateListingSeq.get(id) === seq && (asDraft || wasRejected || submittingDraft)) {
        setListings((prev) =>
          prev.map((it) =>
            it.id === id
              ? {
                  ...it,
                  ...(asDraft
                    ? { status: 'draft' as const }
                    : {
                        status: 'pending_review' as const,
                        moderationStatus: 'pending' as const,
                        moderationReason: null,
                        // Cleared to match what the database does on the
                        // way out of draft (see set_listing_expiry):
                        // resubmitting IS the seller overruling the buyers
                        // who hid this. Without it the row keeps a Restore
                        // button beside a live listing for the rest of the
                        // session, and that button leads nowhere -- the
                        // RPC finds no hidden listing to restore.
                        autoHiddenAt: null,
                      }),
                }
              : it
          )
        );
      }

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

      // Points are NOT awarded here. They used to be, and moving the
      // award down to the publish decision without deleting this one
      // credited every draft->submit twice -- two ledger rows with the
      // same reason, and a twenty-item batch worth forty posts. See the
      // single award further down, past the point where it is known
      // whether the listing actually went out.

      // Photos: anything already a hosted (https) URL was kept as-is by the
      // edit screen; anything else is a newly-picked local device photo
      // that still needs uploading. Gallery photos diff against what's on
      // Supabase (syncPhotoKind); spin sets fully replace (syncSpinSets) --
      // see that function's comment for why. Spin sets need their own
      // setListings update afterward since syncSpinSets returns the real
      // server-assigned set ids (unlike syncPhotoKind's gallery path,
      // which updates state itself internally).
      // `willModerate` is also what decides whether the gallery upload is
      // waited on below -- see syncPhotoKind's own comment.
      // `!asDraft` is load-bearing and was missing.
      //
      // The old gate was `wasRejected || submittingDraft`, and
      // submittingDraft is itself `wasDraft && !asDraft`, so moderation
      // could never fire on a draft save. `wasPendingReview` is orthogonal
      // to asDraft, so adding it broke that invariant: a seller with a
      // half-failed batch who taps "Save for later" on an item sitting at
      // pending_review hit `willModerate` -- and moderate-listing runs with
      // the service key, so it PUBLISHED the item this very call had just
      // written as a draft. Every batch screen goes through
      // listingToInput, which defaults status to 'draft', so this was not
      // an exotic path.
      const willModerate = !asDraft && (wasRejected || submittingDraft || wasPendingReview);
      // BOTH halves are caught HERE rather than allowed out of
      // updateListing. Everything above this line already saved -- the
      // listings row, the status change -- so throwing would tell the
      // seller nothing was saved when nearly everything was, and the edit
      // screen would keep them on a form whose contents are already in
      // the database.
      //
      // syncSpinSets used to be left to reject, and that was a trap: on
      // this path the row has ALREADY been moved to pending_review, so a
      // rejection thrown from inside Promise.all skipped the moderation
      // call below and left the listing parked and invisible, over a
      // failure in an optional 360 spin. Caught, the spin failure costs
      // the seller a spin set and nothing else.
      //
      // A mutable holder rather than three plain `let`s: TypeScript's
      // control-flow analysis narrows a `let` assigned only inside a
      // callback back to its initial type at every later read, so
      // `media.stage` would read as `null` after the await no matter what
      // the catch put in it.
      const media: {
        stage: PhotoWriteStage | null;
        missing: number;
        spinFailed: boolean;
        // A spin that WAS written but came out too short to turn --
        // different news from one that was not written at all, and
        // "add the 360 spin again" is only half right for it.
        spinShort: boolean;
      } = { stage: null, missing: 0, spinFailed: false, spinShort: false };
      // Waiting is for the callers that need the answer before they can
      // decide something: this call publishes (willModerate), or the
      // caller asked to be told rather than alerted (`waitMedia`).
      //
      // Waiting is deliberately NOT implied by `quietMedia`. An earlier
      // draft coupled them, and it froze BatchPhotosScreen: that screen
      // re-sends every photo of the item on every tap, so forcing the
      // wait held its Next button through a full sequential re-upload
      // each time a photo was added. It gets the outcome through
      // `onLateResult` instead.
      const waitForUploads = willModerate || !!opts.waitMedia;
      // TWO gates on the one report, because the ranked alert can only be
      // ranked once everything it ranks is known, and the two halves
      // settle at different times: the video below always resolves within
      // this function, the gallery sometimes long after it has returned.
      // Whichever finishes last runs the report; the other's call is a
      // no-op. Firing on the first of them instead would have said
      // nothing about the half still in flight and then blocked the half
      // that arrived, which is the clobbering the ranking exists to
      // prevent.
      //
      // Declared up here because onLateResult below is what sets one of
      // them, and that closure is built before the rest of this runs.
      let reported = false;
      let mediaSettled = false;
      let videoSettled = false;
      let reportMedia: () => void = () => {};
      const [galleryOutcome, hostedSpinSets] = await Promise.all([
        syncPhotoKind(id, 'gallery', l.photos, {
          waitForUploads,
          onLateResult: (r) => {
            media.stage = r.stage;
            media.missing = r.missing;
            opts.onLateMedia?.({ mediaFailed: r.stage !== null, photosMissing: r.missing, photos: r.photos });
            mediaSettled = true;
            reportMedia();
          },
        })
          .then((r) => {
            media.missing = r.missing;
            return r;
          })
          .catch((e: any) => {
            media.stage = e instanceof PhotoWriteError ? e.stage : 'insert';
            console.warn('[AppStore] gallery sync did not land:', e?.message || e);
            return null;
          }),
        syncSpinSets(id, l.spinSets, () => {
          // Only fires once the set has dropped below SPIN_MIN_FRAMES --
          // see writeSpinSets. The set is on the listing; it just does
          // not turn properly.
          media.spinShort = true;
        }).catch((e: any) => {
          media.spinFailed = true;
          console.warn('[AppStore] spin sets did not land:', e?.message || e);
          return null;
        }),
      ]);
      if (hostedSpinSets) {
        setListings((prev) => prev.map((it) => (it.id === id ? { ...it, spinSets: hostedSpinSets } : it)));
      }
      // Settled unless syncPhotoKind explicitly said it deferred the
      // uploads. A rejection settles it too -- the answer is known, it is
      // just a bad one -- which is why this reads the outcome rather than
      // `waitForUploads`.
      if (!galleryOutcome || !galleryOutcome.deferred) mediaSettled = true;
      // Read as FUNCTIONS off the `media` holder, not captured once as
      // consts. When the uploads are not waited on, the gallery outcome
      // arrives after this line, and a const would have frozen the
      // "nothing failed" reading that was true only before it landed.
      const galleryFailed = () => media.stage !== null;

      // Which failures actually mean there is nothing to look at.
      //
      // Not all of them do, and blocking on all of them was its own trap:
      // a failed REORDER or a failed DELETE means every photo is in the
      // database and only their order (or one extra) is wrong. Withholding
      // a complete listing from the site over the sort_order of pictures
      // that are all there -- and, if the reorder keeps failing, doing it
      // on every retry -- is a worse outcome than the wrong order.
      const blockingStage = () =>
        media.stage === 'upload' || media.stage === 'insert' || media.stage === 'read';
      // Two different reasons, kept apart because they need different
      // advice: 'no_photos' cannot be fixed by pressing the same button
      // again, and telling a seller to retry something that is
      // deterministic is how a batch becomes impossible to finish.
      const blockedReason = (): 'no_photos' | 'media' | null => {
        if (!willModerate) return null;
        if (l.photos.length === 0) return 'no_photos';
        return blockingStage() ? 'media' : null;
      };

      // Video. Read what is currently attached from the database rather than
      // from local state: this callback deliberately doesn't depend on
      // `listings`, so any copy captured in its closure would be stale.
      //
      // Replacing a video is already handled before we get here -- the edit
      // screen passes the listing id when it asks for an upload ticket, and
      // bunny-video-token deletes the old video from Bunny at that point. So
      // only two cases are left: attach a new one, or the seller removed the
      // one that was there.
      //
      // Done BEFORE the alert block rather than after it, so its outcome
      // can be ranked with the others instead of firing a second alert a
      // round trip later -- which, AlertHost holding exactly one
      // (@AGENTS.md), destroyed whatever the seller actually needed to
      // read.
      let videoFailed = false;
      // Kept apart from videoFailed: "add the video again" is the wrong
      // sentence for a video that would not go away.
      let videoRemovalFailed = false;
      const { data: attachedVideo, error: attachedVideoError } = await supabase
        .from('listing_videos')
        .select('bunny_guid')
        .eq('listing_id', id)
        .maybeSingle();
      // An unreadable answer is not "there is no video". Read as one, a
      // seller's video REMOVAL silently did nothing: previousGuid null
      // means the removal branch below never runs and the video stays on
      // the listing. Same unchecked-read class as the two this change
      // fixed in syncPhotoKind and syncSpinSets.
      if (attachedVideoError) {
        console.warn('[AppStore] could not read the attached video:', attachedVideoError.message);
        // Only the REMOVAL is lost to a failed read -- it has nothing to
        // act on without previousGuid. The attach below still runs, and
        // reports for itself: a read failing is almost always transient,
        // attachVideoToListing now says whether it worked, and one
        // wasted UPDATE is cheaper than a video nobody but the seller can
        // see. A listing with no video in play loses nothing at all here,
        // so it gets the console line and no alert.
        if (!l.video?.guid && cachedRow?.video?.guid) videoRemovalFailed = true;
      }
      const previousGuid: string | null = attachedVideo?.bunny_guid ?? null;
      // `|| attachedVideoError`: with no readable previousGuid to compare
      // against, "different from what is attached" cannot be decided, and
      // attaching what the seller asked for is the right guess.
      if (l.video?.guid && (attachedVideoError || l.video.guid !== previousGuid)) {
        // Reported, not thrown. The listing itself saved several steps
        // ago; failing the whole edit over the video would tell the seller
        // nothing was saved when nearly everything was. attachVideoToListing
        // used to be unable to fail at all -- now that it can, the one
        // thing that must not happen is that it fails and says nothing.
        try {
          await attachVideoToListing(l.video.guid, id);
        } catch (e: any) {
          console.warn('[AppStore] video not attached:', e?.message || e);
          videoFailed = true;
        }
      } else if (!attachedVideoError && !l.video?.guid && previousGuid) {
        // Best effort -- a listing must never be stuck un-editable because
        // Bunny had a bad minute. But not SILENT: the row keeps its
        // listing_id, so the clip the seller just removed is still on the
        // public listing, and this was the one write left in this block
        // that nobody would ever have learned about.
        try {
          await deleteVideo(previousGuid);
        } catch (e: any) {
          console.warn('[AppStore] video not removed:', e?.message || e);
          videoRemovalFailed = true;
        }
      }

      // ONE alert, not five. AlertHost holds a single alert with no queue
      // (@AGENTS.md), so firing one per problem means the seller reads
      // whichever happened to be last and the rest are destroyed silently
      // -- which is how the message that mattered ("this is not on the
      // site") kept losing to the one that did not ("the video was not
      // attached"). Ranked by what it costs them.
      //
      // `quietMedia` exists for the batch flow, which drives this in a
      // loop over ten or twenty items -- there, every alert but the last
      // is destroyed anyway, so the caller collects the results and says
      // one sentence about all of them (see BatchFinalReviewScreen).
      //
      // It has two possible moments, hence the guard. When the uploads
      // were waited on, everything is known by this line and it runs now.
      // When they were not, the gallery outcome only arrives later, so
      // this is deferred to onLateResult -- otherwise the ranking would
      // fire knowing nothing about the gallery and then be destroyed a
      // few seconds later by the late arm, which is the clobbering the
      // ranking exists to prevent. Either way it runs once.
      reportMedia = () => {
        if (reported || opts.quietMedia) return;
        if (!mediaSettled || !videoSettled) return;
        reported = true;
        const reason = blockedReason();
        if (reason === 'no_photos') {
          // NOT the "save again and it goes live" sentence. Saving again
          // with no photos is the same refusal every time, and telling a
          // seller to retry something deterministic is how they end up
          // pressing a button for ever. BatchFinalReviewScreen already
          // separated these two; the single-listing path had not.
          Alert.alert(
            tRef.current('media.notPublishedNoPhotosTitle'),
            tRef.current('media.notPublishedNoPhotosBody')
          );
        } else if (reason === 'media') {
          Alert.alert(tRef.current('media.notPublishedTitle'), tRef.current('media.notPublishedBody'));
        } else if (galleryFailed()) {
          const stage = media.stage as PhotoWriteStage;
          Alert.alert(tRef.current(mediaFailureTitle(stage)), tRef.current(mediaFailureBody(stage)));
        } else if (media.missing > 0) {
          Alert.alert(
            tRef.current('media.somePhotosMissingTitle'),
            tRef.current('media.somePhotosMissingBody', { count: media.missing })
          );
        } else if (media.spinFailed) {
          Alert.alert(tRef.current('media.spinNotSavedTitle'), tRef.current('media.spinNotSavedBody'));
        } else if (media.spinShort) {
          Alert.alert(tRef.current('media.spinTooShortTitle'), tRef.current('media.spinTooShortBody'));
        } else if (videoFailed) {
          Alert.alert(tRef.current('media.videoNotAttachedTitle'), tRef.current('media.videoNotAttachedBody'));
        } else if (videoRemovalFailed) {
          Alert.alert(tRef.current('media.videoNotRemovedTitle'), tRef.current('media.videoNotRemovedBody'));
        }
      };
      videoSettled = true;
      reportMedia();

      // Moderation runs HERE, after the media sync, not before it -- same
      // ordering and the same reason as addListing: moderation publishes,
      // and publishing a listing whose pictures have not landed is the bug
      // this whole change exists to remove. `wasPendingReview` is what lets
      // a listing whose upload failed at post time go live once the seller
      // adds the photos again.
      //
      // The no-photos half of blockedReason is the same positive-evidence
      // rule addListing uses: with no photos the gallery sync succeeds
      // having done nothing, and "no failure" would otherwise read as
      // "publish". CreateListing's Save-and-exit path does not check the
      // photo count, so this is reachable from the UI.
      if (willModerate && blockedReason() === null) {
        Promise.all(
          [...l.photos.slice(0, MODERATION_MAX_PHOTOS), ...spinFramesForModeration(l.spinSets)].map((uri) =>
            uriToCompressedBase64(uri)
          )
        )
          .then((results) => {
            const photos = results.filter((p): p is { data: string; mediaType: string } => !!p);
            return triggerListingModeration(id, photos, l.titleEn || l.titleAr, l.descriptionEn || l.descriptionAr);
          })
          .catch(() => {});

        // Points for a listing that actually went out, credited against
        // an explicit column rather than inferred from the status it
        // happened to be in.
        //
        // Both old inferences were wrong once publication moved behind
        // the upload. addListing credited every non-draft up front,
        // including the ones it then refused to publish; and this branch
        // credited only `submittingDraft`, so a listing repaired through
        // the wasPendingReview path went live having never been credited
        // at all -- it was never a draft. An inference standing in for a
        // fact will eventually be wrong (@AGENTS.md).
        void claimPostingPoints(id, l.titleEn || l.titleAr);
      } else if (!asDraft && currentStatus === 'active') {
        // Self-healing, for a listing that reached the site by a route
        // this branch never saw. A moderator approving a parked listing
        // from the admin screen sets status directly, and nothing there
        // credits the seller -- so without this the award depended on
        // WHO published it. The claim is idempotent and checks ownership
        // server-side, so calling it on any save of an already-live
        // listing costs one update that matches no row.
        void claimPostingPoints(id, l.titleEn || l.titleAr);
      }

      // `blockedFromSite`, not `published`.
      //
      // The first draft returned `published: willModerate &&
      // !publicationBlocked` -- "this call kicked off moderation" -- and
      // the batch screen read it as "this item is on the site". Those are
      // not the same claim, and the difference was a trap: on a second
      // Post (after a restart, once the items that DID post came back as
      // 'active'), willModerate is false for every one of them, so they
      // all reported published:false, the batch refused to complete, and
      // pressing Post again could never change that. Reporting only what
      // THIS call withheld has no such state to get wrong.
      return {
        blockedFromSite: blockedReason() !== null,
        blockedReason: blockedReason(),
        mediaDeferred: !!galleryOutcome?.deferred,
        photos: galleryOutcome?.photos ?? [],
        mediaFailed: galleryFailed(),
        photosMissing: media.missing,
        spinFailed: media.spinFailed,
        spinShort: media.spinShort,
        videoFailed: videoFailed || videoRemovalFailed,
      };
    },
    [syncPhotoKind, syncSpinSets, myShop, claimPostingPoints]
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
        // republish_own_listing raises its own P0001 for a listing with
        // no gallery photos, and 'refused' renders as "please try again"
        // -- the retry-for-ever sentence the whole 'no-photos' code was
        // added to this change to avoid. The server-side check is the one
        // that actually holds; it should not be the one with the worse
        // message.
        if (/no photos/i.test(error?.message || '')) {
          throw listingSaveError('no-photos', error?.message);
        }
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
      // And P0001 with this message is the sibling refusal: the listing
      // has no photos left. Same reasoning -- a second tap changes
      // nothing, the seller has to add one -- and 'refused' would render
      // as "please try again".
      if (/no photos/i.test(error?.message || '')) {
        throw listingSaveError('no-photos', error?.message);
      }
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
  // Still best-effort -- it does not throw -- but no longer a `.then()`
  // with no handler, which was the last one of those left in this flow
  // after the audit. Nothing reads batches.status today, so this only
  // ever ends up in the log; the point is that when something does start
  // reading it, the failure will already be findable.
  const completeBatch = useCallback(async (batchId: string): Promise<void> => {
    const { data, error } = await supabase
      .from('batches').update({ status: 'submitted' }).eq('id', batchId).select('id');
    if (error || !data || data.length === 0) {
      console.warn('[AppStore] batch not marked submitted:', error?.message || 'no row matched');
    }
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
