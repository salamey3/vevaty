import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { supabase, ensureSession } from '../lib/supabase';
import { Banner, BannerSlot } from '../types';
import { pickNextBanner, ShuffleBagState } from '../lib/bannerShuffle';

// Managed banners (Editor's Picks-style announcements/ads) across the
// three placements -- sidebar nav, desktop listing-detail rail, mobile
// listing-detail inline. See myazar.banners/banner_events and the
// "Vevaty — Managed Banner Placements" design spec for the full
// behavior. Deliberately separate from CollectionsStore (same reasoning
// as that store's own doc comment): its own concern, no dependency on
// AppStore's listings.
//
// Selection is a "shuffle bag" (bannerShuffle.ts): every active banner in
// a slot is shown exactly once per cycle, never twice in a row, and it
// only ever changes when the relevant section regains navigation focus
// (a hard refresh, or the visitor left and came back) -- never on a
// timer. See useBannerForSlot below and its callers (BannerSlot.tsx,
// TabBar.tsx) for exactly when that reroll fires.
//
// Both an English AND an Arabic creative are required per banner -- no
// fallback -- unlike most other bilingual admin content in this app.

function dbToBanner(row: any): Banner {
  return {
    id: row.id,
    slot: row.slot,
    imageUrlEn: row.image_url_en,
    imageUrlAr: row.image_url_ar,
    linkType: row.link_type,
    linkTarget: row.link_target,
    openNewTab: !!row.open_new_tab,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: !!row.is_active,
    domainId: row.domain_id ?? null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBannerActiveNow(b: Banner): boolean {
  const today = todayStr();
  return b.isActive && b.startDate <= today && today <= b.endDate;
}

// A slot is only half of a placement now: the same slot renders in every
// section, and which banners are eligible there depends on which one. The
// shuffle bag is keyed by the pair, so a visitor moving from Properties to
// Vehicles does not inherit a cycle built from banners that are not even
// eligible on the page they are now looking at.
//
// The anti-repeat memory (lastShownRef) is deliberately NOT keyed this
// way -- it stays per slot. "Never the same creative twice in a row" is a
// promise about one place on the screen, and a viewer does not know or
// care that crossing from a property to a car swapped the pool behind it.
// An untargeted banner sits in every section's bag for a slot, so keying
// the memory per placement would let it come up twice running, which is
// exactly the thing the bag exists to prevent.
function placementKey(slot: BannerSlot, domainId: string | null): string {
  return `${slot}::${domainId ?? ''}`;
}

// Null section = runs everywhere. A section set = runs only where that
// section is known and matches, which is why a placement that knows no
// section (the sidebar) shows untargeted banners only rather than
// everything.
function runsIn(b: Banner, domainId: string | null): boolean {
  return b.domainId == null || b.domainId === domainId;
}

interface SlotSelectionState {
  bannerId: string | null;
  bag: ShuffleBagState | null;
}

interface BannerStoreValue {
  loaded: boolean;
  // Every banner this session can see -- active-and-in-window for a
  // plain visitor, everything (including scheduled/expired/paused) for
  // an admin, per the RLS policy. The admin screen reads this directly;
  // useBannerForSlot below is what everything else should use.
  banners: Banner[];
  refresh: () => Promise<void>;
  addBanner: (input: Omit<Banner, 'id' | 'createdAt'>) => Promise<void>;
  updateBanner: (id: string, input: Omit<Banner, 'id' | 'createdAt'>) => Promise<void>;
  deleteBanner: (id: string) => Promise<void>;
  // Re-rolls the shuffle bag for one placement (a slot inside a section --
  // null section for a placement that belongs to none) and returns the
  // banner it picked, or null if nothing is eligible there right now.
  // Logs an impression for whatever it picks, so it is NOT idempotent:
  // every call advances the bag and reports a view. Call it once per
  // placement per focus -- see useBannerForSlot.
  reroll: (slot: BannerSlot, domainId: string | null) => Banner | null;
  // The banner currently selected for a slot, without re-rolling --
  // callers that already triggered a reroll (via the hook below) read
  // this to render.
  currentForSlot: (slot: BannerSlot, domainId: string | null) => Banner | null;
  logClick: (bannerId: string) => void;
  eventCounts: (bannerId: string) => { impressions: number; clicks: number };
}

const BannerStoreContext = createContext<BannerStoreValue | null>(null);

export function BannerStoreProvider({ children }: { children: React.ReactNode }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [events, setEvents] = useState<{ bannerId: string; type: 'impression' | 'click' }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const selectionRef = useRef<Record<string, SlotSelectionState>>({});
  const lastShownRef = useRef<Record<string, string | null>>({});
  // Forces a re-render after reroll() mutates the refs above -- refs
  // don't trigger one on their own, and every slot's current pick needs
  // to be readable via plain state so consuming components re-render
  // when it changes.
  const [, forceTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      await ensureSession();
      const [{ data: bannerRows, error: bannerErr }, { data: eventRows, error: eventErr }] = await Promise.all([
        supabase.from('banners').select('*').order('created_at', { ascending: false }),
        // Admin-only per RLS -- a plain visitor's select here just comes
        // back empty, which is fine: eventCounts only matters in the
        // admin panel.
        supabase.from('banner_events').select('banner_id, event_type'),
      ]);
      if (!bannerErr && bannerRows) setBanners(bannerRows.map(dbToBanner));
      if (!eventErr && eventRows) {
        setEvents(eventRows.map((r: any) => ({ bannerId: r.banner_id, type: r.event_type })));
      }
    } catch (e) {
      // Offline or backend unreachable -- every slot just renders nothing,
      // same "degrade to empty" convention as CollectionsStore.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeBySlot = useMemo(() => {
    const grouped: Record<string, Banner[]> = {};
    for (const b of banners) {
      if (!isBannerActiveNow(b)) continue;
      (grouped[b.slot] ??= []).push(b);
    }
    return grouped;
  }, [banners]);

  const reroll = useCallback(
    (slot: BannerSlot, domainId: string | null): Banner | null => {
      const active = (activeBySlot[slot] ?? []).filter((b) => runsIn(b, domainId));
      const key = placementKey(slot, domainId);
      const activeIds = active.map((b) => b.id);
      const prevBag = selectionRef.current[key]?.bag ?? null;
      // Per slot, not per placement -- see placementKey's comment.
      const lastShown = lastShownRef.current[slot] ?? null;
      const { id, state } = pickNextBanner(activeIds, prevBag, lastShown);
      selectionRef.current[key] = { bannerId: id, bag: state };
      lastShownRef.current[slot] = id;
      forceTick((n) => n + 1);
      if (id) {
        // Fire-and-forget -- an impression log failing silently is far
        // better than blocking (or breaking) the banner actually showing.
        supabase.from('banner_events').insert({ banner_id: id, event_type: 'impression' }).then(
          () => {},
          () => {}
        );
      }
      return active.find((b) => b.id === id) ?? null;
    },
    [activeBySlot]
  );

  const currentForSlot = useCallback(
    (slot: BannerSlot, domainId: string | null): Banner | null => {
      const id = selectionRef.current[placementKey(slot, domainId)]?.bannerId;
      if (!id) return null;
      const b = banners.find((x) => x.id === id) ?? null;
      // Re-checked rather than trusted: the pick is held in a ref across
      // renders, and an admin pausing a banner (or narrowing it to another
      // section) mid-session would otherwise keep it on screen.
      //
      // The placement then stays empty until something rerolls it, rather
      // than picking a replacement here: this runs during render, and
      // rerolling from render would both advance the bag and POST an
      // impression as a side effect of drawing. An empty slot until the
      // next focus is the cheaper wrong answer.
      return b && isBannerActiveNow(b) && runsIn(b, domainId) ? b : null;
    },
    [banners]
  );

  const logClick = useCallback((bannerId: string) => {
    supabase.from('banner_events').insert({ banner_id: bannerId, event_type: 'click' }).then(
      () => {},
      () => {}
    );
  }, []);

  const eventCounts = useCallback(
    (bannerId: string) => {
      let impressions = 0;
      let clicks = 0;
      for (const e of events) {
        if (e.bannerId !== bannerId) continue;
        if (e.type === 'impression') impressions++;
        else clicks++;
      }
      return { impressions, clicks };
    },
    [events]
  );

  const addBanner = useCallback(
    async (input: Omit<Banner, 'id' | 'createdAt'>) => {
      const { error } = await supabase.from('banners').insert({
        slot: input.slot,
        image_url_en: input.imageUrlEn,
        image_url_ar: input.imageUrlAr,
        link_type: input.linkType,
        link_target: input.linkTarget,
        open_new_tab: input.openNewTab,
        start_date: input.startDate,
        end_date: input.endDate,
        is_active: input.isActive,
        domain_id: input.domainId,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const updateBanner = useCallback(
    async (id: string, input: Omit<Banner, 'id' | 'createdAt'>) => {
      const { error } = await supabase
        .from('banners')
        .update({
          slot: input.slot,
          image_url_en: input.imageUrlEn,
          image_url_ar: input.imageUrlAr,
          link_type: input.linkType,
          link_target: input.linkTarget,
          open_new_tab: input.openNewTab,
          start_date: input.startDate,
          end_date: input.endDate,
          is_active: input.isActive,
          domain_id: input.domainId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const deleteBanner = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('banners').delete().eq('id', id);
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<BannerStoreValue>(
    () => ({ loaded, banners, refresh, addBanner, updateBanner, deleteBanner, reroll, currentForSlot, logClick, eventCounts }),
    [loaded, banners, refresh, addBanner, updateBanner, deleteBanner, reroll, currentForSlot, logClick, eventCounts]
  );

  return <BannerStoreContext.Provider value={value}>{children}</BannerStoreContext.Provider>;
}

export function useBanners() {
  const ctx = useContext(BannerStoreContext);
  if (!ctx) throw new Error('useBanners must be used within BannerStoreProvider');
  return ctx;
}

// For a screen-level slot (the two listing-detail placements): rerolls on
// navigation focus, per the design spec's Section 5.2 -- NOT on mount.
// The distinction matters because a listing detail screen commonly stays
// mounted-but-blurred underneath whatever got pushed on top of it (this
// app's stack navigator doesn't unmount on push), so "navigated away and
// came back" would otherwise never fire a reroll. useIsFocused's value
// flips on exactly that transition, on every platform, including a fresh
// mount (it's already true the first time), so one effect covers both
// "hard refresh" and "left and came back" without extra cases.
//
// The persistent sidebar banner does NOT use this hook -- it isn't a
// screen and is never unfocused/refocused in the way a stack screen is
// (see TabBar.tsx's own focusedIndex effect for how it rerolls instead).
// `domainId` is the section the slot is rendering inside, where the page
// knows one -- a section home, or a listing's own page. Omitted (the
// sidebar) means no section is known, and only banners that target none
// are eligible.
// `domainId` is the section this placement sits inside: a section id, or
// null for a placement that belongs to none (the sidebar). `undefined` is
// a third, different answer -- "not known yet" -- and it holds everything
// back rather than being treated as null.
//
// That distinction is load-bearing. A listing's section is derived from
// its category, and the category tree arrives on its own network call: for
// the first frames of a cold-loaded listing page it is genuinely unknown.
// Reading that as "no section" would roll once against untargeted banners
// only, POST an impression for whatever it picked, and then roll AGAIN the
// moment the categories landed -- two impressions for one page view, the
// first charged to a banner nobody bought that placement for, and a
// section-targeted banner unable to win the roll on the page it was sold
// against.
export function useBannerForSlot(slot: BannerSlot, domainId: string | null | undefined): Banner | null {
  const { reroll, currentForSlot, loaded } = useBanners();
  const isFocused = useIsFocused();
  const known = domainId !== undefined;
  useEffect(() => {
    // Rerolls when the section changes too, not only on focus: the same
    // slot on the Properties home and on the Vehicles home is two
    // different placements drawing from two different sets.
    if (loaded && isFocused && known) reroll(slot, domainId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, domainId, known, isFocused, loaded]);
  return known ? currentForSlot(slot, domainId ?? null) : null;
}
