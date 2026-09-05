import { Listing } from '../types';

// How Bump Up / Featured (myazar.redeem_boost, see MyListingsScreen's
// "Boost" pill) change what a buyer actually sees, in one place, so
// HomeScreen's browse grid, CollectionsStore's 'recent'/'featured' kinds
// and BrowseGateScreen's "newest across the site" row can't drift apart
// on what "boosted" means.

// A listing's recency for sort purposes. Bump Up sets bumpedAt without
// touching createdAt itself (createdAt stays the true post date
// everywhere else that reads it -- expiry, "member since" math, etc.), so
// a bumped listing competes for "newest" exactly like a fresh post would,
// for one moment, and then sinks again as later posts/bumps overtake it --
// there is no window, matching the Listing type's own doc comment on
// bumpedAt.
export function listingSortTime(l: Pick<Listing, 'createdAt' | 'bumpedAt'>): number {
  return Math.max(l.createdAt, l.bumpedAt ?? 0);
}

// True while a listing's Featured window (set by redeem_boost, cleared by
// nothing -- it just lapses) is still running.
export function isFeaturedNow(l: Pick<Listing, 'featuredUntil'>): boolean {
  return !!l.featuredUntil && l.featuredUntil > Date.now();
}

// Fisher-Yates. Used to rotate Featured listings among themselves rather
// than always favoring whoever boosted most recently -- sellers paying
// the same price for the same tier get an equal shot at the top, not a
// fixed queue. Deliberately NOT called on every render: callers run this
// once per listings snapshot (a useMemo keyed on the listings array), so
// the order holds steady while someone scrolls and only reshuffles when
// the data actually refreshes.
export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Featured listings first (shuffled among themselves), then everyone else
// by recency (bump-aware). This is the general "browse/search" ordering --
// it pins Featured above regular results wherever a plain listings array
// is rendered (HomeScreen's category grid, search, the per-category
// mobile carousels). It is deliberately NOT used for recency-only surfaces
// like Just Listed, where an old-but-Featured listing showing up would
// read as a lie about how recently it was posted -- those use
// listingSortTime alone.
export function sortListingsForBrowse<T extends Pick<Listing, 'createdAt' | 'bumpedAt' | 'featuredUntil'>>(
  listings: T[]
): T[] {
  const featured: T[] = [];
  const rest: T[] = [];
  for (const l of listings) (isFeaturedNow(l) ? featured : rest).push(l);
  rest.sort((a, b) => listingSortTime(b) - listingSortTime(a));
  return [...shuffle(featured), ...rest];
}
