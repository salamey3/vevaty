import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, ensureSession } from '../lib/supabase';
import { useAppStore } from './AppStore';
import { Collection, CollectionItem, Listing } from '../types';

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
  resolveCollection: (collection: Collection) => Listing[];
  // The percent a listing's price has dropped, if it currently qualifies
  // as a "hot deal" (>= MIN_PRICE_DROP_PERCENT within the lookback
  // window) -- null otherwise. Split out from resolveCollection so a
  // price_drop row's UI (Home carousel badge, CollectionScreen grid) can
  // show the actual number per listing without resolveCollection itself
  // having to change shape for the other two kinds.
  priceDropPercent: (listingId: string, currentPrice: number) => number | null;
  refresh: () => Promise<void>;
  // Admin curation (kind='curated' only) -- MyListingsScreen/ListingDetailScreen
  // territory this is not; these are only ever called from AdminCollectionsScreen.
  addCollectionItem: (collectionId: string, listingId: string) => Promise<void>;
  removeCollectionItem: (collectionId: string, listingId: string) => Promise<void>;
  reorderCollectionItems: (collectionId: string, orderedListingIds: string[]) => Promise<void>;
}

const CollectionsStoreContext = createContext<CollectionsStoreValue | null>(null);

export function CollectionsStoreProvider({ children }: { children: React.ReactNode }) {
  const { listings } = useAppStore();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [itemsByCollection, setItemsByCollection] = useState<Record<string, CollectionItem[]>>({});
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await ensureSession();
      const lookbackFrom = new Date(Date.now() - PRICE_DROP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: colRows, error: colErr }, { data: itemRows, error: itemErr }, { data: priceRows, error: priceErr }] =
        await Promise.all([
          supabase.from('collections').select('*').order('sort_order', { ascending: true }),
          supabase.from('collection_items').select('*').order('position', { ascending: true }),
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

  const resolveCollection = useCallback(
    (collection: Collection): Listing[] => {
      const active = listings.filter((l) => l.status === 'active');
      if (collection.kind === 'curated') {
        const items = itemsByCollection[collection.id] || [];
        const byId = new Map(active.map((l) => [l.id, l]));
        return items
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((it) => byId.get(it.listingId))
          .filter((l): l is Listing => !!l);
      }
      if (collection.kind === 'recent') {
        return active.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, collection.limitCount);
      }
      // 'price_drop'
      return active
        .map((l) => {
          const earliest = earliestPriceByListing.get(l.id);
          if (!earliest || earliest.oldPrice <= 0) return null;
          const dropPercent = ((earliest.oldPrice - l.price) / earliest.oldPrice) * 100;
          return dropPercent >= MIN_PRICE_DROP_PERCENT ? { listing: l, dropPercent } : null;
        })
        .filter((x): x is { listing: Listing; dropPercent: number } => !!x)
        .sort((a, b) => b.dropPercent - a.dropPercent)
        .slice(0, collection.limitCount)
        .map((x) => x.listing);
    },
    [listings, itemsByCollection, earliestPriceByListing]
  );

  const priceDropPercent = useCallback(
    (listingId: string, currentPrice: number): number | null => {
      const earliest = earliestPriceByListing.get(listingId);
      if (!earliest || earliest.oldPrice <= 0) return null;
      const pct = ((earliest.oldPrice - currentPrice) / earliest.oldPrice) * 100;
      return pct >= MIN_PRICE_DROP_PERCENT ? pct : null;
    },
    [earliestPriceByListing]
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

  const value = useMemo<CollectionsStoreValue>(
    () => ({
      loaded,
      collections,
      collectionBySlug,
      resolveCollection,
      priceDropPercent,
      refresh,
      addCollectionItem,
      removeCollectionItem,
      reorderCollectionItems,
    }),
    [
      loaded,
      collections,
      collectionBySlug,
      resolveCollection,
      priceDropPercent,
      refresh,
      addCollectionItem,
      removeCollectionItem,
      reorderCollectionItems,
    ]
  );

  return <CollectionsStoreContext.Provider value={value}>{children}</CollectionsStoreContext.Provider>;
}

export function useCollections() {
  const ctx = useContext(CollectionsStoreContext);
  if (!ctx) throw new Error('useCollections must be used within CollectionsStoreProvider');
  return ctx;
}
