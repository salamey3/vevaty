import { Listing } from '../types';

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
