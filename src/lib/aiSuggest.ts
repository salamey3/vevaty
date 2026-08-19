import { supabase } from './supabase';
import { AttributeType, AttributeValue } from '../types';

export interface AiSuggestSource {
  title: string;
  url: string;
}

// The schema (not the value) of one category attribute the seller left
// blank -- sent to the edge function so it knows what it's allowed to fill
// in and, for select/multiselect, exactly which option values are valid.
// See CreateListingScreen's buildAttributeSchemaForSuggestion.
export interface AiSuggestAttributeSchema {
  slug: string;
  label: string;
  type: AttributeType;
  options?: { value: string; label: string }[]; // only meaningful for select/multiselect
  unit?: string; // only meaningful for number
  required: boolean;
}

export interface AiSuggestResult {
  title: string;
  description: string;
  specs: Record<string, string>;
  // AI-suggested values for whatever blank attribute slugs were sent in
  // the request, already validated server-side against each field's
  // type/options -- keyed by slug, same shape as Listing.attributes.
  attributes: Record<string, AttributeValue>;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  confidence: 'low' | 'medium' | 'high';
  // Short phrases naming what the model could NOT pin down -- "exact
  // model number", "whether the case is included". Shown to the seller
  // directly, because a confident-sounding listing that quietly guessed
  // at the model is the failure mode that actually costs them a sale.
  // Empty when the model is genuinely sure of everything it wrote.
  uncertain: string[];
  // The model's own working-out: what it could literally read in the
  // photos, and what it concluded from it. Not shown to the seller --
  // recorded so identification mistakes can be traced back to whether
  // the text was unreadable or the reasoning was wrong.
  observed: string;
  identification: string;
  // Which model actually served this (the edge function falls back if the
  // primary is unavailable), so a sudden quality drop is attributable.
  model: string;
  sources: AiSuggestSource[];
}

export interface AiSuggestError {
  // True when the edge function is deployed but ANTHROPIC_API_KEY hasn't
  // been configured yet -- lets the UI show a clearer "not set up yet"
  // message (and fall back to the plain template) instead of a generic
  // failure.
  notConfigured: boolean;
  // True when this seller has hit the daily suggestion cap (see the edge
  // function's lightweight rate guard) -- lets the UI show a "come back
  // tomorrow" message instead of a generic failure.
  rateLimited: boolean;
  message: string;
}

// A photo already resized/compressed to base64 by imageToBase64.ts, ready
// to send to Claude as an image content block.
export interface AiSuggestPhoto {
  data: string; // base64, no data: prefix
  mediaType: string; // e.g. "image/jpeg"
}

// Calls the ai-suggest-listing edge function, which looks at the seller's
// own photos (identifying what the item actually is and its visible
// condition, Google-Lens style) and/or searches the web for real facts
// about whatever rough item name the seller typed, then writes a fresh
// title/description from whatever it found (never copying manufacturer/
// retailer marketing copy verbatim -- see the edge function's prompt).
// Never throws -- callers get back either { data } or { error } so a
// suggestion hiccup never blocks posting the listing; the caller is
// expected to fall back to the plain hardcoded template on error.
export async function suggestListingFromWeb(
  roughTitle: string,
  categoryName: string,
  language: 'en' | 'ar',
  // Already-entered category spec values as "Label: value" strings (e.g.
  // "Brand: Toyota", "Year: 2020") -- when the seller has filled these in
  // (categories with a Specs step), the edge function treats them as
  // confirmed ground truth and writes the title/description around them
  // instead of needing the seller to type anything first.
  specs?: string[],
  // A handful of the seller's own gallery photos -- when present, these
  // are the strongest signal of all (what the item actually is, its
  // apparent condition), strong enough on their own that roughTitle can
  // be empty. See CreateListingScreen's applyAiSuggestion for how these
  // get gathered/compressed.
  photos?: AiSuggestPhoto[],
  // The schema of whichever category attributes the seller left blank --
  // when present, the edge function may propose values for them (see
  // AiSuggestAttributeSchema above). Already-filled attributes are never
  // sent here; they're already represented in `specs` as ground truth.
  attributes?: AiSuggestAttributeSchema[]
): Promise<{ data?: AiSuggestResult; error?: AiSuggestError }> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-suggest-listing', {
      body: {
        title: roughTitle,
        categoryName,
        language,
        specs: specs && specs.length > 0 ? specs : undefined,
        photos: photos && photos.length > 0 ? photos : undefined,
        attributes: attributes && attributes.length > 0 ? attributes : undefined,
        // Identify and write only. Price research is a separate call
        // (estimateListingPrice below) because it costs three web
        // searches to this one's one, and the seller should not be
        // watching a spinner for a number they usually overwrite.
        mode: 'describe',
      },
    });
    if (error) {
      let message = 'AI suggestions are not available right now.';
      let notConfigured = false;
      let rateLimited = false;
      const context = (error as any)?.context;
      if (context && typeof context.json === 'function') {
        try {
          const body = await context.json();
          if (body?.error === 'not_configured') notConfigured = true;
          if (body?.error === 'rate_limited') rateLimited = true;
          if (body?.message) message = body.message;
        } catch (e) {
          // Response body wasn't JSON -- fall back to the generic message.
        }
      }
      return { error: { notConfigured, rateLimited, message } };
    }
    if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') {
      return { error: { notConfigured: false, rateLimited: false, message: 'AI suggestions are not available right now.' } };
    }
    return {
      data: {
        title: data.title,
        description: data.description,
        specs: data.specs && typeof data.specs === 'object' ? data.specs : {},
        attributes: data.attributes && typeof data.attributes === 'object' && !Array.isArray(data.attributes) ? data.attributes : {},
        priceRangeLow: typeof data.priceRangeLow === 'number' ? data.priceRangeLow : null,
        priceRangeHigh: typeof data.priceRangeHigh === 'number' ? data.priceRangeHigh : null,
        confidence: data.confidence === 'medium' || data.confidence === 'high' ? data.confidence : 'low',
        uncertain: Array.isArray(data.uncertain) ? data.uncertain.filter((u: unknown) => typeof u === 'string') : [],
        observed: typeof data.observed === 'string' ? data.observed : '',
        identification: typeof data.identification === 'string' ? data.identification : '',
        model: typeof data.model === 'string' ? data.model : '',
        sources: Array.isArray(data.sources) ? data.sources : [],
      },
    };
  } catch (e: any) {
    return { error: { notConfigured: false, rateLimited: false, message: e?.message || 'AI suggestions are not available right now.' } };
  }
}

export interface AiPriceResult {
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  confidence: 'low' | 'medium' | 'high';
  sources: AiSuggestSource[];
}

// Researches what the item is worth secondhand, as its own request.
//
// Split out of the suggestion because of what it costs in time, not in
// money: the single combined call spent four web searches and measured
// 19-27 seconds in production, and roughly 17 of those were the searches.
// Identifying the item takes one search; pricing it takes three. Since
// the seller can read and edit a title and description the moment they
// appear, only the identification actually has to block.
//
// Never throws. A missing price is a field the seller fills in
// themselves, which is what they'd do with a wrong one anyway -- it must
// never surface as an error over a listing that is otherwise complete.
export async function estimateListingPrice(
  roughTitle: string,
  categoryName: string,
  language: 'en' | 'ar',
  // What the describe call worked out from the photos. This is the whole
  // reason the price call can skip re-sending the images: it is handed the
  // conclusion they produced.
  identification: string,
  specs?: string[]
): Promise<AiPriceResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-suggest-listing', {
      body: {
        title: roughTitle,
        categoryName,
        language,
        identification,
        specs: specs && specs.length > 0 ? specs : undefined,
        mode: 'price',
      },
    });
    if (error || !data) return null;
    return {
      priceRangeLow: typeof data.priceRangeLow === 'number' ? data.priceRangeLow : null,
      priceRangeHigh: typeof data.priceRangeHigh === 'number' ? data.priceRangeHigh : null,
      confidence: data.confidence === 'medium' || data.confidence === 'high' ? data.confidence : 'low',
      sources: Array.isArray(data.sources) ? data.sources : [],
    };
  } catch (e) {
    return null;
  }
}
