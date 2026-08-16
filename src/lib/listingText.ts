import { Listing } from '../types';
import { findPlaceByFreeText, findPlaceById } from '../data/lebanonPlaces';

// Picks the right-language copy for display, falling back to the other
// language rather than showing blank text -- useful for listings posted
// before translation was available, or where the seller skipped the
// translate step.
export function pickText(en: string, ar: string, language: 'en' | 'ar'): string {
  const primary = language === 'ar' ? ar : en;
  const fallback = language === 'ar' ? en : ar;
  return primary && primary.trim() ? primary : fallback || '';
}

export function listingTitle(listing: Listing, language: 'en' | 'ar'): string {
  return pickText(listing.titleEn, listing.titleAr, language);
}

export function listingDescription(listing: Listing, language: 'en' | 'ar'): string {
  return pickText(listing.descriptionEn, listing.descriptionAr, language);
}

// Arabic display name for a listing's district/town, resolved through the
// same Lebanon locality dataset the map picker uses (src/data/
// lebanonPlaces.ts) instead of showing the raw, always-Latin-script
// district string the listing was saved with. Prefers the precise
// geonameId the listing was saved with (map picker / town-name
// autocomplete), falling back to a free-text match against the plain
// district string itself -- covers listings that predate the map picker,
// or that were typed by hand, or (right now) every AI-seeded listing,
// none of which carry a geonameId. Falls back to the original district
// string when nothing resolves (a street-level name no gazetteer would
// have, or a spelling that doesn't match any known alt-name) -- this is
// best-effort, not guaranteed exhaustive.
export function listingDistrict(listing: Listing, language: 'en' | 'ar'): string {
  if (language !== 'ar') return listing.district;
  const place = findPlaceById(listing.geonameId) ?? findPlaceByFreeText(listing.district);
  return place?.nameAr || listing.district;
}
