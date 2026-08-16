import React, { createContext, useCallback, useContext, useState } from 'react';
import { supabase, ensureSession } from '../lib/supabase';

// Phase 4 item 17 -- saved/favorited listings. Deliberately small and
// separate from AppStore (like ChatStore): just a set of favorited listing
// ids plus load/toggle, no realtime subscription needed since favorites are
// single-user, not a two-party live feed like chat.
//
// Favoriting is gated behind isVerified the same way chat/contact-reveal
// are (see ListingCard/ListingDetailScreen) -- an anonymous session's
// favorites would only ever live on one device/browser profile, which
// isn't what "save this for later" implies to a shopper.

interface FavoritesStoreValue {
  favoriteIds: Set<string>;
  loading: boolean;
  loaded: boolean;
  loadFavorites: () => Promise<void>;
  isFavorite: (listingId: string) => boolean;
  toggleFavorite: (listingId: string) => Promise<void>;
}

const FavoritesStoreContext = createContext<FavoritesStoreValue | null>(null);

export function FavoritesStoreProvider({ children }: { children: React.ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const session = await ensureSession();
      const uid = session?.user?.id;
      if (!uid || session.user?.is_anonymous !== false) {
        setFavoriteIds(new Set());
        return;
      }
      const { data, error } = await supabase.from('favorites').select('listing_id').eq('user_id', uid);
      if (error) throw error;
      setFavoriteIds(new Set((data || []).map((row: any) => row.listing_id)));
    } catch (e) {
      // Offline or not signed in -- leave whatever's already in state.
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  const isFavorite = useCallback((listingId: string) => favoriteIds.has(listingId), [favoriteIds]);

  const toggleFavorite = useCallback(async (listingId: string) => {
    const session = await ensureSession();
    const uid = session?.user?.id;
    if (!uid || session.user?.is_anonymous !== false) throw new Error('Not signed in');

    const alreadyFavorited = favoriteIds.has(listingId);
    // Optimistic flip first -- this is a single tap on a heart icon, it
    // should feel instant.
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (alreadyFavorited) next.delete(listingId);
      else next.add(listingId);
      return next;
    });

    try {
      if (alreadyFavorited) {
        const { error } = await supabase.from('favorites').delete().eq('user_id', uid).eq('listing_id', listingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('favorites').insert({ user_id: uid, listing_id: listingId });
        if (error) throw error;
      }
    } catch (e) {
      // Roll back the optimistic flip on failure.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (alreadyFavorited) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
      throw e;
    }
  }, [favoriteIds]);

  const value: FavoritesStoreValue = { favoriteIds, loading, loaded, loadFavorites, isFavorite, toggleFavorite };

  return <FavoritesStoreContext.Provider value={value}>{children}</FavoritesStoreContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesStoreContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesStoreProvider');
  return ctx;
}
