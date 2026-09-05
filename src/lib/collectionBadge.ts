import { colors } from '../theme/theme';
import { Collection, Listing } from '../types';
import { CornerBadge } from '../components/ListingCard';

// The ListingCard corner badge a given listing gets for appearing in a
// given collection -- shared between the Home carousel row and
// CollectionScreen's grid so the two surfaces never drift apart.
//
// Editor's Picks (kind='curated'): every item gets the same brand-gold
// sparkle -- membership itself is the signal, there's no per-item number
// to show. Hot Deals (kind='price_drop'): a per-listing "-N%" label, in
// the terracotta deal color -- computed from CollectionsStore's
// priceDropPercent rather than baked into the badge, since it's a live
// number, not a fixed per-collection thing. Just Listed (kind='recent')
// gets no badge at all: recency isn't a promo, and not every row needs to
// shout, per the approved Collections mockup. Featured (kind='featured')
// reuses the sparkle motif -- it's the same "look at this" language as
// Editor's Picks -- but in accentDeep rather than accent, the same gold
// MyListingsScreen already uses for a seller's own "Featured" badge, so
// the two never read as the identical badge.
export function cornerBadgeFor(
  collection: Collection,
  listing: Listing,
  priceDropPercent: (listingId: string, currentPrice: number) => number | null
): CornerBadge | undefined {
  if (collection.kind === 'curated') {
    return { icon: 'sparkle', color: colors.accent };
  }
  if (collection.kind === 'price_drop') {
    const pct = priceDropPercent(listing.id, listing.price);
    if (pct == null) return undefined;
    return { text: `-${Math.round(pct)}%`, color: colors.deal };
  }
  if (collection.kind === 'featured') {
    return { icon: 'sparkle', color: colors.accentDeep };
  }
  return undefined;
}
