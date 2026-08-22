import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { supabase, ensureSession } from '../lib/supabase';
import { SavedSearch, SavedSearchCriteria, CategoryId } from '../types';

// Saved searches -- a buyer bookmarks the current Home filter state (category
// + query + facet selections) so they can re-run it later from the Favorites
// screen's "Searches" tab, instead of re-picking every filter by hand. Mirrors
// FavoritesStore.tsx's shape and gating (isVerified-only, since an anonymous
// session's saved searches would only ever live on one device/browser
// profile) -- deliberately no push/email alerting yet (Phase 5 item 20's
// alerting half is a separate, not-yet-started piece).

function criteriaFromRow(row: any): SavedSearchCriteria {
  const c = row.criteria || {};
  return {
    query: typeof c.query === 'string' ? c.query : '',
    subCatIds: Array.isArray(c.subCatIds) ? c.subCatIds : [],
    facetValues: c.facetValues && typeof c.facetValues === 'object' ? c.facetValues : {},
    priceMin: typeof c.priceMin === 'number' ? c.priceMin : null,
    priceMax: typeof c.priceMax === 'number' ? c.priceMax : null,
    distanceKm: typeof c.distanceKm === 'number' ? c.distanceKm : null,
    // Same defensive story as every field above: a search saved before
    // this filter existed simply has none, same as one saved with it
    // explicitly cleared.
    condition: Array.isArray(c.condition) ? c.condition : [],
  };
}

function dbRowToSavedSearch(row: any): SavedSearch {
  return {
    id: row.id,
    userId: row.user_id,
    cat: row.cat,
    label: row.label,
    criteria: criteriaFromRow(row),
    createdAt: new Date(row.created_at).getTime(),
  };
}

interface SavedSearchesStoreValue {
  savedSearches: SavedSearch[];
  loading: boolean;
  loaded: boolean;
  loadSavedSearches: () => Promise<void>;
  saveSearch: (cat: CategoryId, label: string, criteria: SavedSearchCriteria) => Promise<void>;
  deleteSavedSearch: (id: string) => Promise<void>;
}

const SavedSearchesStoreContext = createContext<SavedSearchesStoreValue | null>(null);

export function SavedSearchesStoreProvider({ children }: { children: React.ReactNode }) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadSavedSearches = useCallback(async () => {
    setLoading(true);
    try {
      const session = await ensureSession();
      const uid = session?.user?.id;
      if (!uid || session.user?.is_anonymous !== false) {
        setSavedSearches([]);
        return;
      }
      const { data, error } = await supabase
        .from('saved_searches')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedSearches((data || []).map(dbRowToSavedSearch));
    } catch (e) {
      // Offline or not signed in -- leave whatever's already in state.
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  const saveSearch = useCallback(async (cat: CategoryId, label: string, criteria: SavedSearchCriteria) => {
    const session = await ensureSession();
    const uid = session?.user?.id;
    if (!uid || session.user?.is_anonymous !== false) throw new Error('Not signed in');

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({ user_id: uid, cat, label, criteria })
      .select('*')
      .single();
    if (error) throw error;
    setSavedSearches((prev) => [dbRowToSavedSearch(data), ...prev]);
  }, []);

  const deleteSavedSearch = useCallback(async (id: string) => {
    const session = await ensureSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error('Not signed in');

    // Optimistic removal first -- this is a single tap on a trash icon.
    const prevSearches = savedSearches;
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    try {
      const { error } = await supabase.from('saved_searches').delete().eq('user_id', uid).eq('id', id);
      if (error) throw error;
    } catch (e) {
      setSavedSearches(prevSearches);
      throw e;
    }
  }, [savedSearches]);

  // Memoized so consumers don't re-render purely because this provider did
  // -- see the matching comment in FavoritesStore. Every function above is
  // already a stable useCallback.
  const value = useMemo<SavedSearchesStoreValue>(
    () => ({
      savedSearches,
      loading,
      loaded,
      loadSavedSearches,
      saveSearch,
      deleteSavedSearch,
    }),
    [savedSearches, loading, loaded, loadSavedSearches, saveSearch, deleteSavedSearch],
  );

  return <SavedSearchesStoreContext.Provider value={value}>{children}</SavedSearchesStoreContext.Provider>;
}

export function useSavedSearches() {
  const ctx = useContext(SavedSearchesStoreContext);
  if (!ctx) throw new Error('useSavedSearches must be used within SavedSearchesStoreProvider');
  return ctx;
}
