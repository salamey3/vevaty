import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, ensureSession } from '../lib/supabase';
import { useAppStore } from './AppStore';
import { Collection, CollectionItem, Listing } from '../types';
import { offersRent } from '../lib/rentTerms';

// Home-screen collections (Editor's Picks, Hot Deals, Just Listed) -- see
// myazar.collections/collection_items/listing_price_changes, and the
// Collection/CollectionItem doc comments in types/index.ts for the shape
// each `kind` resolves to. Deliberately small and separate from AppStore
// (same reasoning as FavoritesStore/ChatStore): collections are their own
// concern, this just needs read access to AppStore's `listings` to turn a
// collection into an actual list of Listings to render.
//
// Nested inside AppStoreProvider in App.tsx (not the other way around) --
// resolveCollection reads useAppStore()'s listings directly rather than
// having them threaded in as a prop.

// A price has to have dropped by at least this much (percent, off the
// earliest recorded price in the lookback window) to count as a "hot
// deal" -- otherwise a $1 tweak on a $2,000 car would qualify. Also
// filters out noise from a seller just fixing a typo.
const MIN_PRICE_DROP_PERCENT = 5;
// How far back to look for a price drop. Long enough that a deal posted a
// few days ago still shows, short enough that a price cut from months back
// isn't still being advertised as "hot".
const PRICE_DROP_LOOKBACK_DAYS = 14;

interface PriceChange {
  listingId: string;
  oldPrice: number;
  newPrice: number;
  changedAt: number;
}

function dbToCollection(row: any): Collection {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    descriptionEn: row.description_en ?? null,
    descriptionAr: row.description_ar ?? null,
    active: !!row.active,
    sortOrder: row.sort_order ?? 0,
    limitCount: row.limit_count ?? 20,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

function dbToCollectionItem(row: any): CollectionItem {
  return { id: row.id, collectionId: row.collection_id, listingId: row.listing_id, position: row.position ?? 0 };
}

function dbToPriceChange(row: any): PriceChange {
  return {
    listingId: row.listing_id,
    oldPrice: Number(row.old_price),
    newPrice: Number(row.new_price),
    changedAt: row.changed_at ? new Date(row.changed_at).getTime() : Date.now(),
  };
}

interface CollectionsStoreValue {
  loaded: boolean;
  // Every active collection (or, for an admin, every collection --
  // RLS already applies that distinction, this just passes through
  // whatever came back), sorted by sortOrder.
  collections: Collection[];
  collectionBySlug: (slug: string) => Collection | undefined;
  // The actual Listings a collection resolves to right now, computed
  // against AppStore's current `listings` -- always active, always fresh,
  // never stored. Empty for a curated collection nobody has populated yet,
  // or a recent/price_drop collection with nothing that currently qualifies.
  //
  // For 'recent'/'price_drop', this is pinned items FIRST (collection_items
  // rows an admin manually added -- see addCollectionItem below; same
  // mechanism 'curated' uses for its entire membership), then the
  // algorithmic candidates filling the rest, minus anything an admin has
  // explicitly excluded (see excludeFromCollection). A listing an admin
  // pinned always shows even if it wouldn't otherwise qualify (e.g. a
  // pinned "hot deal" whose price hasn't actually dropped); exclusions
  // only ever suppress an ALGORITHMIC pick, never a pin -- there's no UI
  // path that lets the two apply to the same listing at once.
  resolveCollection: (collection: Collection, scope?: (listing: Listing) => boolean) => Listing[];
  // The percent a listing's price has dropped, if it currently qualifies
  // as a "hot deal" (>= MIN_PRICE_DROP_PERCENT within the lookback
  // window) -- null otherwise. Split out from resolveCollection so a
  // price_drop row's UI (Home carousel badge, CollectionScreen grid) can
  // show the actual number per listing without resolveCollection itself
  // having to change shape for the other two kinds.
  priceDropPercent: (listingId: string, currentPrice: number) => number | null;
  // Which of resolveCollection's current results were manually pinned
  // (vs. algorithmically picked) -- purely a display concern (AdminCollectionsScreen
  // tags each row "Pinned"/"Auto" so it's clear what removing it does).
  pinnedListingIds: (collectionId: string) => string[];
  // Listings an admin has manually excluded from an algorithmic collection
  // -- ids only; AdminCollectionsScreen resolves them against AppStore's
  // full listings itself to show what's hidden and offer to un-hide it.
  excludedListingIds: (collectionId: string) => string[];
  refresh: () => Promise<void>;
  // Admin curation -- MyListingsScreen/ListingDetailScreen territory this
  // is not; these are only ever called from AdminCollectionsScreen.
  // Pin a listing INTO a collection: its entire membership for 'curated',
  // a manual addition shown ahead of the algorithmic picks for the other
  // two kinds.
  addCollectionItem: (collectionId: string, listingId: string) => Promise<void>;
  removeCollectionItem: (collectionId: string, listingId: string) => Promise<void>;
  reorderCollectionItems: (collectionId: string, orderedListingIds: string[]) => Promise<void>;
  // Hide one listing FROM a 'recent'/'price_drop' collection despite it
  // otherwise qualifying algorithmically -- the opposite of a pin, and
  // meaningless for 'curated' (nothing there is ever algorithmic).
  excludeFromCollection: (collectionId: string, listingId: string) => Promise<void>;
  unexcludeFromCollection: (collectionId: string, listingId: string) => Promise<void>;
}

const CollectionsStoreContext = createContext<CollectionsStoreValue | null>(null);

export function CollectionsStoreProvider({ children }: { children: React.ReactNode }) {
  const { listings } = useAppStore();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [itemsByCollection, setItemsByCollection] = useState<Record<string, CollectionItem[]>>({});
  const [exclusionsByCollection, setExclusionsByCollection] = useState<Record<string, Set<string>>>({});
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await ensureSession();
      const lookbackFrom = new Date(Date.now() - PRICE_DROP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [
        { data: colRows, error: colErr },
        { data: itemRows, error: itemErr },
        { data: exclusionRows, error: exclusionErr },
        { data: priceRows, error: priceErr },
      ] = await Promise.all([
        supabase.from('collections').select('*').order('sort_order', { ascending: true }),
        supabase.from('collection_items').select('*').order('position', { ascending: true }),
        supabase.from('collection_exclusions').select('collection_id, listing_id'),
        supabase
          .from('listing_price_changes')
          .select('listing_id, old_price, new_price, changed_at')
          .gte('changed_at', lookbackFrom),
      ]);
      if (!colErr && colRows) setCollections(colRows.map(dbToCollection));
      if (!itemErr && itemRows) {
        const grouped: Record<string, CollectionItem[]> = {};
        for (const row of itemRows.map(dbToCollectionItem)) {
          (grouped[row.collectionId] ??= []).push(row);
        }
        setItemsByCollection(grouped);
      }
      if (!exclusionErr && exclusionRows) {
        const grouped: Record<string, Set<string>> = {};
        for (const row of exclusionRows) {
          (grouped[row.collection_id] ??= new Set()).add(row.listing_id);
        }
        setExclusionsByCollection(grouped);
      }
      if (!priceErr && priceRows) setPriceChanges(priceRows.map(dbToPriceChange));
    } catch (e) {
      // Offline or backend unreachable -- collections just won't show this
      // load; Home/CollectionScreen degrade to rendering nothing for them,
      // same as any other empty section.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Earliest recorded old_price per listing within the lookback window --
  // i.e. roughly "what this was priced at PRICE_DROP_LOOKBACK_DAYS ago",
  // not just its most recent single edit. A listing that dropped price
  // twice in the window is compared against the first of the two, so the
  // full cumulative cut counts, not just the latest nudge.
  const earliestPriceByListing = useMemo(() => {
    const map = new Map<string, PriceChange>();
    for (const change of priceChanges) {
      const existing = map.get(change.listingId);
      if (!existing || change.changedAt < existing.changedAt) map.set(change.listingId, change);
    }
    return map;
  }, [priceChanges]);

  // `scope` narrows the catalogue this collection resolves against, and it
  // is applied BEFORE limitCount rather than to the result -- otherwise a
  // section gets "the properties among the 20 newest listings site-wide"
  // instead of "the 20 newest properties", and a busy Classifieds would
  // empty out Just Listed everywhere else. See HomeScreen's own comment on
  // why collections filter rather than being tagged with a section.
  const resolveCollection = useCallback(
    (collection: Collection, scope?: (listing: Listing) => boolean): Listing[] => {
      const active = listings.filter((l) => l.status === 'active' && (!scope || scope(l)));
      const byId = new Map(active.map((l) => [l.id, l]));

      if (collection.kind === 'curated') {
        const items = itemsByCollection[collection.id] || [];
        return items
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((it) => byId.get(it.listingId))
          .filter((l): l is Listing => !!l);
      }

      // 'recent' / 'price_drop': pinned items first (an admin's explicit
      // "yes, include this" -- see addCollectionItem), then the
      // algorithmic candidates filling the rest of limitCount, with
      // anything an admin excluded (see excludeFromCollection) dropped
      // from the algorithmic side only -- a pin always wins.
      const pinned = (itemsByCollection[collection.id] || [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((it) => byId.get(it.listingId))
        .filter((l): l is Listing => !!l);
      const pinnedIds = new Set(pinned.map((l) => l.id));
      const excluded = exclusionsByCollection[collection.id] ?? new Set<string>();
      const eligible = active.filter((l) => !pinnedIds.has(l.id) && !excluded.has(l.id));

      const algorithmic =
        collection.kind === 'recent'
          ? eligible.slice().sort((a, b) => b.createdAt - a.createdAt)
          : eligible
              .map((l) => {
                // A property that rents holds its rent value in `price`
                // when it isn't also being sold (see Listing.price), so
                // switching an apartment from "for sale" to "for rent"
                // moves that number from a six-figure asking price to a
                // four-figure monthly rent. That is not a discount, but
                // the price-change log can't tell the difference -- it
                // would read as a ~99% drop and, since this list sorts by
                // depth of discount, put the apartment at the very front
                // of Hot Deals with a "-99%" badge. Rentals simply don't
                // participate in price-drop collections.
                // ...and neither is a giveaway. A pet listed at $300 and
                // then rehomed free moves its price to 0, which reads as
                // a 100% drop -- the deepest possible, so it would sort
                // to the very front of Hot Deals with a "-100%" badge.
                // Same class of bug as the rental one above, same guard.
                if (offersRent(l.condition) || l.condition === 'free') return null;
                const earliest = earliestPriceByListing.get(l.id);
                if (!earliest || earliest.oldPrice <= 0) return null;
                const dropPercent = ((earliest.oldPrice - l.price) / earliest.oldPrice) * 100;
                return dropPercent >= MIN_PRICE_DROP_PERCENT ? { listing: l, dropPercent } : null;
              })
              .filter((x): x is { listing: Listing; dropPercent: number } => !!x)
              .sort((a, b) => b.dropPercent - a.dropPercent)
              .map((x) => x.listing);

      return [...pinned, ...algorithmic].slice(0, collection.limitCount);
    },
    [listings, itemsByCollection, exclusionsByCollection, earliestPriceByListing]
  );

  const pinnedListingIds = useCallback(
    (collectionId: string) => (itemsByCollection[collectionId] || []).map((it) => it.listingId),
    [itemsByCollection]
  );

  const excludedListingIds = useCallback(
    (collectionId: string) => [...(exclusionsByCollection[collectionId] ?? [])],
    [exclusionsByCollection]
  );

  const priceDropPercent = useCallback(
    (listingId: string, currentPrice: number): number | null => {
      // Same rental exclusion as the price_drop list above, applied here
      // too because this is what actually renders the "-N%" corner badge
      // (see collectionBadge.ts) -- and a rental can still reach that
      // badge by being PINNED into a price-drop collection by an admin,
      // which bypasses the algorithmic filter entirely.
      const listing = listings.find((l) => l.id === listingId);
      if (listing && (offersRent(listing.condition) || listing.condition === 'free')) return null;
      const earliest = earliestPriceByListing.get(listingId);
      if (!earliest || earliest.oldPrice <= 0) return null;
      const pct = ((earliest.oldPrice - currentPrice) / earliest.oldPrice) * 100;
      return pct >= MIN_PRICE_DROP_PERCENT ? pct : null;
    },
    [earliestPriceByListing, listings]
  );

  const collectionBySlug = useCallback((slug: string) => collections.find((c) => c.slug === slug), [collections]);

  const addCollectionItem = useCallback(async (collectionId: string, listingId: string) => {
    const session = await ensureSession();
    const uid = session?.user?.id;
    const currentItems = itemsByCollection[collectionId] || [];
    const nextPosition = currentItems.length ? Math.max(...currentItems.map((it) => it.position)) + 1 : 0;
    const { error } = await supabase
      .from('collection_items')
      .insert({ collection_id: collectionId, listing_id: listingId, position: nextPosition, added_by: uid || null });
    if (error) throw error;
    await refresh();
  }, [itemsByCollection, refresh]);

  const removeCollectionItem = useCallback(async (collectionId: string, listingId: string) => {
    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', collectionId)
      .eq('listing_id', listingId);
    if (error) throw error;
    await refresh();
  }, [refresh]);

  // Re-numbers every item 0..n-1 in the given order -- simplest correct
  // approach for a handful of curated items (Editor's Picks is meant to
  // stay small and deliberate, not a paginated hundred-row list), rather
  // than computing a minimal diff of which positions actually moved.
  const reorderCollectionItems = useCallback(async (collectionId: string, orderedListingIds: string[]) => {
    await Promise.all(
      orderedListingIds.map((listingId, position) =>
        supabase.from('collection_items').update({ position }).eq('collection_id', collectionId).eq('listing_id', listingId)
      )
    );
    await refresh();
  }, [refresh]);

  const excludeFromCollection = useCallback(async (collectionId: string, listingId: string) => {
    const session = await ensureSession();
    const uid = session?.user?.id;
    const { error } = await supabase
      .from('collection_exclusions')
      .insert({ collection_id: collectionId, listing_id: listingId, excluded_by: uid || null });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const unexcludeFromCollection = useCallback(async (collectionId: string, listingId: string) => {
    const { error } = await supabase
      .from('collection_exclusions')
      .delete()
      .eq('collection_id', collectionId)
      .eq('listing_id', listingId);
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const value = useMemo<CollectionsStoreValue>(
    () => ({
      loaded,
      collections,
      collectionBySlug,
      resolveCollection,
      priceDropPercent,
      pinnedListingIds,
      excludedListingIds,
      refresh,
      addCollectionItem,
      removeCollectionItem,
      reorderCollectionItems,
      excludeFromCollection,
      unexcludeFromCollection,
    }),
    [
      loaded,
      collections,
      collectionBySlug,
      resolveCollection,
      priceDropPercent,
      pinnedListingIds,
      excludedListingIds,
      refresh,
      addCollectionItem,
      removeCollectionItem,
      reorderCollectionItems,
      excludeFromCollection,
      unexcludeFromCollection,
    ]
  );

  return <CollectionsStoreContext.Provider value={value}>{children}</CollectionsStoreContext.Provider>;
}

export function useCollections() {
  const ctx = useContext(CollectionsStoreContext);
  if (!ctx) throw new Error('useCollections must be used within CollectionsStoreProvider');
  return ctx;
}
