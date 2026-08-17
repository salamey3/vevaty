import { Listing } from '../types';
import { findPlaceByFreeText, findPlaceById } from '../data/lebanonPlaces';
import { DISTRICT_NAME_AR } from '../data/districtNamesAr';

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

function normalizeDistrictKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Resolves ONE comma-separated piece of a district string to Arabic:
// curated override first (districtNamesAr.ts documents why each entry
// exists), then the GeoNames-derived dataset, then the text unchanged.
function districtSegmentToArabic(segment: string): string {
  const override = DISTRICT_NAME_AR[normalizeDistrictKey(segment)];
  if (override) return override;
  return findPlaceByFreeText(segment)?.nameAr || segment;
}

// Arabic display name for a listing's district/town.
//
// Districts are stored as the seller typed them, which for Beirut is
// routinely "Neighbourhood, City" -- "Hamra, Beirut", "Verdun, Beirut".
// Those must be resolved PIECE BY PIECE, because findPlaceByFreeText
// deliberately prefers the longest name it can find anywhere in the
// string: given "Hamra, Beirut" it scores "Beirut" (6 characters) above
// "Hamra" (5) and returns بيروت, silently discarding the neighbourhood.
// That looked like a successful translation, which is exactly why it went
// unnoticed -- auditing the live listings found 27 of them showing a bare
// "بيروت" where the English named a specific neighbourhood.
//
// Splitting on commas and translating each part preserves the shape the
// English has, joined with the Arabic comma (U+060C) rather than a Latin
// one: "Hamra, Beirut" -> "الحمرا، بيروت".
//
// An exact geonameId still wins outright when a listing has one (set by
// the map picker / town autocomplete), since that's an unambiguous
// identifier rather than a string match. No listing carries one today, so
// in practice everything goes through the free-text path.
//
// Anything that resolves to nothing is left exactly as typed -- a
// street-level address no gazetteer would carry still shows the seller's
// own words rather than disappearing.
export function listingDistrict(listing: Listing, language: 'en' | 'ar'): string {
  if (language !== 'ar') return listing.district;

  const byId = findPlaceById(listing.geonameId);
  if (byId?.nameAr) return byId.nameAr;

  const parts = listing.district.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return listing.district;
  return parts.map(districtSegmentToArabic).join('، ');
}
