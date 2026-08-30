import { supabase } from './supabase';
import { AiSuggestPhoto } from './aiSuggest';

// Client for the classify-listing-photos edge function -- the qualifier
// behind the Magic Listing button. Given the seller's photos and the live
// category list, it answers one question: which category does this belong
// in?
//
// Kept separate from aiSuggest.ts for the same reason the edge functions
// are separate: this is a fast closed-list decision the seller waits on,
// while the suggestion is slow research that runs behind them once the
// category is known.

// Prefix marking a candidate that is not a real category but a stand-in
// for a whole other domain. The classifier only ever picks from the list
// it is handed, so adding one of these per *other* domain is how a
// domain-constrained call can still say "these photos are actually a
// property" -- without the edge function knowing domains exist, and
// without loosening the constraint. See DOMAINS.md.
export const DOMAIN_SENTINEL_PREFIX = '__domain__';

export function domainSentinelId(domainId: string): string {
  return `${DOMAIN_SENTINEL_PREFIX}${domainId}`;
}

// The domain a sentinel stands for, or null for an ordinary category id.
export function domainIdFromSentinel(categoryId: string | null): string | null {
  if (!categoryId || !categoryId.startsWith(DOMAIN_SENTINEL_PREFIX)) return null;
  return categoryId.slice(DOMAIN_SENTINEL_PREFIX.length) || null;
}

export interface ClassifyCategoryOption {
  id: string;
  name: string;
  // The parent category's name, where there is one. "Bedroom" is ambiguous
  // on its own and unambiguous as "Furniture & Decor > Bedroom".
  parent?: string;
}

export interface ClassifyResult {
  // null when the AI could not place the item confidently -- an explicit
  // "I don't know" rather than a guess, so the app can drop the seller into
  // the normal category picker instead of filing it somewhere wrong.
  //
  // May also be a domain sentinel (see domainIdFromSentinel) when the call
  // was domain-constrained and the photos plainly belong somewhere else.
  categoryId: string | null;
  itemName: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface ClassifyError {
  notConfigured: boolean;
  message: string;
}

export async function classifyListingPhotos(
  photos: AiSuggestPhoto[],
  categories: ClassifyCategoryOption[],
  language: 'en' | 'ar'
): Promise<{ data?: ClassifyResult; error?: ClassifyError }> {
  try {
    const { data, error } = await supabase.functions.invoke('classify-listing-photos', {
      body: { photos, categories, language },
    });
    if (error) {
      let message = 'Could not analyse these photos right now.';
      let notConfigured = false;
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json();
          if (body?.error === 'not_configured') notConfigured = true;
          if (body?.message) message = body.message;
        } catch {
          // Body wasn't JSON -- keep the generic message.
        }
      }
      return { error: { notConfigured, message } };
    }
    return {
      data: {
        categoryId: typeof data?.categoryId === 'string' ? data.categoryId : null,
        itemName: typeof data?.itemName === 'string' ? data.itemName : '',
        confidence: ['low', 'medium', 'high'].includes(data?.confidence) ? data.confidence : 'low',
      },
    };
  } catch (e: any) {
    return { error: { notConfigured: false, message: e?.message || String(e) } };
  }
}
