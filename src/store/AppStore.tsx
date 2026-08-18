import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Listing, ListingVideo, Profile, PointsEvent, SpinSet } from '../types';
import { SEED_LISTINGS } from '../data/seed';
import { POINTS_RULES, tierForPoints } from '../data/points';
import { supabase, ensureSession } from '../lib/supabase';
import { uploadPhotos } from '../lib/photoUpload';
import { attachVideoToListing, deleteVideo } from '../lib/bunnyVideo';

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
};

// Fields the caller never supplies directly -- addListing/updateListing
// compute or ignore these (status/expiresAt/expiryReminderSentAt are only
// ever changed via extendListing/republishListing, or by the server-side
// pg_cron expiry job).
type ListingInput = Omit<
  Listing,
  'id' | 'createdAt' | 'sellerId' | 'sellerName' | 'rating' | 'status' | 'expiresAt' | 'expiryReminderSentAt'
  // Phase 4 item 16 -- computed from the poster's own account (join or
  // isVerified), never something the create-listing form itself supplies.
  | 'sellerVerified' | 'sellerMemberSince'
>;

interface AppStoreValue {
  ready: boolean;
  online: boolean;
  // True once the current Supabase session belongs to a real, phone-
  // verified account rather than the silent anonymous session every
  // launch starts with (session.user.is_anonymous === false). Gates
  // posting a listing and revealing a seller's contact info -- see
  // MainTabs' "Sell an item" tab and ListingDetailScreen's contact CTA.
  isVerified: boolean;
  listings: Listing[];
  profile: Profile;
  pointsHistory: PointsEvent[];
  addListing: (l: ListingInput) => Promise<Listing>;
  updateListing: (id: string, l: ListingInput) => Promise<void>;
  deleteListing: (id: string) => Promise<void>;
  // Resets a listing's 15-day clock without changing its status --
  // offered on Profile once a still-active listing is within a day of
  // expiring (the same window the WhatsApp reminder fires in).
  extendListing: (id: string) => Promise<void>;
  // Brings an 'expired' ("Unpublished") listing back to 'active' with a
  // fresh 15-day clock.
  republishListing: (id: string) => Promise<void>;
  awardPoints: (amount: number, label: string) => Promise<void>;
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
// 15 days -- kept as one constant since both the client's optimistic local
// value and the server's DB column default (`now() + interval '15 days'`)
// need to agree, and extendListing/republishListing recompute it too.
const LISTING_LIFETIME_MS = 15 * 24 * 60 * 60 * 1000;

function normalizeListing(l: any): Listing {
  return {
    ...l,
    photos: Array.isArray(l?.photos) ? l.photos : [],
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
    video: l?.video && typeof l.video === 'object' && typeof l.video.guid === 'string' ? l.video : null,
    // Same defensive story as photos/spinSets above: a listing cached by
    // a build that predates the login-gate/expiry feature won't have
    // these fields at all.
    status: l?.status === 'draft' || l?.status === 'active' || l?.status === 'sold' || l?.status === 'expired' || l?.status === 'removed' ? l.status : 'active',
    expiresAt: typeof l?.expiresAt === 'number' ? l.expiresAt : Date.now() + LISTING_LIFETIME_MS,
    expiryReminderSentAt: typeof l?.expiryReminderSentAt === 'number' ? l.expiryReminderSentAt : null,
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
    // Map-locator feature -- same defensive story again: a listing cached
    // by a build that predates governorate/caza/geonameId won't have them.
    governorate: typeof l?.governorate === 'string' ? l.governorate : null,
    caza: typeof l?.caza === 'string' ? l.caza : null,
    geonameId: typeof l?.geonameId === 'number' ? l.geonameId : null,
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
  };
}

function dbListingToLocal(row: any): Listing {
  const rows = Array.isArray(row.photos) ? row.photos : [];
  const photos = sortedByKind(rows, 'gallery');
  const spinSets = spinSetsFromRows(rows, Array.isArray(row.spinSets) ? row.spinSets : []);
  return {
    id: row.id,
    cat: row.category_id,
    titleEn: row.title_en ?? '',
    titleAr: row.title_ar ?? '',
    descriptionEn: row.description_en ?? '',
    descriptionAr: row.description_ar ?? '',
    price: Number(row.price) || 0,
    district: row.district ?? '',
    governorate: row.governorate ?? null,
    caza: row.caza ?? null,
    geonameId: row.geoname_id != null ? Number(row.geoname_id) : null,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    photos, // hosted on vevaty.com/uploads, not Supabase Storage
    spinSets,
    video: videoFromRows(row.video), // hosted on Bunny Stream, not either of those

    sellerName: row.seller?.full_name || 'Vevaty user',
    sellerId: row.seller_id,
    rating: 5,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    aiGenerated: !!row.ai_generated,
    attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes : {},
    status: row.status || 'active',
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : Date.now() + LISTING_LIFETIME_MS,
    expiryReminderSentAt: row.expiry_reminder_sent_at ? new Date(row.expiry_reminder_sent_at).getTime() : null,
    contactMethod: row.contact_method === 'phone' || row.contact_method === 'chat' ? row.contact_method : 'both',
    sellerVerified: !!row.seller?.is_phone_verified,
    sellerMemberSince: row.seller?.created_at
      ? new Date(row.seller.created_at).getTime()
      : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
  };
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [pointsHistory, setPointsHistory] = useState<PointsEvent[]>([]);
  const userIdRef = useRef<string | null>(null);
  const profileRef = useRef<Profile>(DEFAULT_PROFILE);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

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
        .select('id, full_name, district, points, tier')
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
        }));
      }

      const { data: listingRows, error } = await supabase
        .from('listings')
        .select(
          '*, seller:profiles!listings_seller_id_fkey(full_name, is_phone_verified, created_at), ' +
            'photos:listing_photos(url, sort_order, kind, spin_set_id), ' +
            'spinSets:listing_spin_sets(id, label, sort_order), ' +
            'video:listing_videos(bunny_guid, status, duration_s, width, height)'
        )
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
      const session = await ensureSession().catch(() => null);
      setIsVerified(!!session && session.user?.is_anonymous === false);
      const uid = session?.user?.id;
      if (uid) await syncFromSupabase(uid);
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

  // Uploads newly-added local photo URIs for the listing's "gallery" kind
  // and inserts the resulting hosted-URL rows. Used by addListing's
  // fire-and-forget background upload path. Spin sets have their own
  // persistNewSpinSets below, not this -- unlike a flat photo list, each
  // spin set is also its own myazar.listing_spin_sets row (id + label),
  // not just more listing_photos rows, so it needs its own insert order
  // (set row first, then its frames referencing that id).
  const persistNewPhotos = useCallback(
    async (listingId: string, uris: string[], kind: 'gallery' | 'spin'): Promise<string[]> => {
      if (uris.length === 0) return [];
      const hostedUrls = await uploadPhotos(uris);
      if (hostedUrls.length > 0) {
        await supabase
          .from('listing_photos')
          .insert(hostedUrls.map((url, i) => ({ listing_id: listingId, url, sort_order: i, kind })));
      }
      return hostedUrls;
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
        uploadPhotos(localNew)
          .then(async (hostedUrls) => {
            if (hostedUrls.length === 0) return;
            const startOrder = hostedKept.length;
            await supabase
              .from('listing_photos')
              .insert(hostedUrls.map((url, i) => ({ listing_id: listingId, url, sort_order: startOrder + i, kind })));
            setListings((prev) =>
              prev.map((it) => (it.id === listingId ? { ...it, photos: [...hostedKept, ...hostedUrls] } : it))
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
      const uid = userIdRef.current;
      let newListing: Listing = {
        ...l,
        id: `l-${Date.now()}`,
        createdAt: Date.now(),
        sellerId: uid || profile.id,
        sellerName: profile.name || 'You',
        rating: 5,
        status: 'active',
        expiresAt: Date.now() + LISTING_LIFETIME_MS,
        expiryReminderSentAt: null,
        // Posting a listing is already gated behind isVerified (see the
        // "Sell an item" tab), so whoever gets here has a real
        // phone-verified account -- this optimistic value gets overwritten
        // with the real DB-joined value on the next syncFromSupabase anyway.
        sellerVerified: isVerified,
        sellerMemberSince: Date.now(),
      };

      if (uid) {
        const { data, error } = await supabase
          .from('listings')
          .insert({
            seller_id: uid,
            category_id: l.cat,
            title_en: l.titleEn,
            title_ar: l.titleAr,
            description_en: l.descriptionEn,
            description_ar: l.descriptionAr,
            price: l.price,
            currency: 'USD',
            district: l.district,
            governorate: l.governorate,
            caza: l.caza,
            geoname_id: l.geonameId,
            lat: l.lat,
            lng: l.lng,
            status: 'active',
            ai_generated: l.aiGenerated,
            attributes: l.attributes || {},
            contact_method: l.contactMethod || 'both',
          })
          .select()
          .single();
        if (!error && data) {
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
              .then((hostedUrls) => {
                if (hostedUrls.length === 0) return;
                setListings((prev) => prev.map((it) => (it.id === listingId ? { ...it, photos: hostedUrls } : it)));
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
        }
      }

      setListings((prev) => [newListing, ...prev]);
      await awardPoints(POINTS_RULES.postListing, `Posted "${l.titleEn || l.titleAr}"`);
      return newListing;
    },
    [profile, awardPoints, persistNewPhotos, persistNewSpinSets, isVerified]
  );

  const updateListing = useCallback(
    async (id: string, l: ListingInput) => {
      // Update local state immediately so the edit feels instant.
      setListings((prev) => prev.map((it) => (it.id === id ? { ...it, ...l } : it)));

      const uid = userIdRef.current;
      if (!uid) return;

      await supabase
        .from('listings')
        .update({
          category_id: l.cat,
          title_en: l.titleEn,
          title_ar: l.titleAr,
          description_en: l.descriptionEn,
          description_ar: l.descriptionAr,
          price: l.price,
          district: l.district,
          governorate: l.governorate,
          caza: l.caza,
          geoname_id: l.geonameId,
          lat: l.lat,
          lng: l.lng,
          ai_generated: l.aiGenerated,
          attributes: l.attributes || {},
          contact_method: l.contactMethod || 'both',
        })
        .eq('id', id);

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
    [syncPhotoKind, syncSpinSets]
  );

  const deleteListing = useCallback(async (id: string) => {
    // Update local state immediately so the listing disappears right away.
    setListings((prev) => prev.filter((l) => l.id !== id));

    const uid = userIdRef.current;
    if (!uid) return;
    // The listing_videos row cascade-deletes with the parent, but the file
    // itself lives on Bunny and would go on being paid for every month with
    // nothing pointing at it -- so it has to be removed explicitly, and
    // before the row that names it disappears. (Expiry is different: an
    // expired listing keeps its video so a one-tap renewal still has one.)
    const { data: attachedVideo } = await supabase
      .from('listing_videos')
      .select('bunny_guid')
      .eq('listing_id', id)
      .maybeSingle();
    if (attachedVideo?.bunny_guid) {
      await deleteVideo(attachedVideo.bunny_guid).catch(() => {});
    }

    // RLS (myazar.listings "sellers manage their own listings") already
    // restricts this to the caller's own rows; listing_photos cascade-
    // deletes with the parent row, so there's nothing else to clean up.
    await supabase.from('listings').delete().eq('id', id).eq('seller_id', uid);
  }, []);

  // Resets the 15-day clock to "another 15 days from right now" -- offered
  // on Profile once a still-active listing is within a day of expiring
  // (see ProfileScreen). Also clears expiry_reminder_sent_at so a fresh
  // reminder can fire again next time this listing approaches expiry.
  const extendListing = useCallback(async (id: string) => {
    const newExpiresAt = Date.now() + LISTING_LIFETIME_MS;
    setListings((prev) =>
      prev.map((it) => (it.id === id ? { ...it, expiresAt: newExpiresAt, expiryReminderSentAt: null } : it))
    );
    const uid = userIdRef.current;
    if (!uid) return;
    await supabase
      .from('listings')
      .update({ expires_at: new Date(newExpiresAt).toISOString(), expiry_reminder_sent_at: null })
      .eq('id', id)
      .eq('seller_id', uid);
  }, []);

  // Brings an 'expired' ("Unpublished" in the UI -- see ProfileScreen)
  // listing back to 'active' with a fresh 15-day clock.
  const republishListing = useCallback(async (id: string) => {
    const newExpiresAt = Date.now() + LISTING_LIFETIME_MS;
    setListings((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, status: 'active', expiresAt: newExpiresAt, expiryReminderSentAt: null } : it
      )
    );
    const uid = userIdRef.current;
    if (!uid) return;
    await supabase
      .from('listings')
      .update({ status: 'active', expires_at: new Date(newExpiresAt).toISOString(), expiry_reminder_sent_at: null })
      .eq('id', id)
      .eq('seller_id', uid);
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
  }, []);

  const value = useMemo(
    () => ({
      ready,
      online,
      isVerified,
      listings,
      profile,
      pointsHistory,
      addListing,
      updateListing,
      deleteListing,
      extendListing,
      republishListing,
      awardPoints,
      signOut,
      deleteAccount,
    }),
    [
      ready,
      online,
      isVerified,
      listings,
      profile,
      pointsHistory,
      addListing,
      updateListing,
      deleteListing,
      extendListing,
      republishListing,
      awardPoints,
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
