import { useState } from 'react';
import { AttributeValue, CategoryAttribute } from '../types';
import { suggestListingFromWeb, AiSuggestAttributeSchema, AiSuggestSource } from '../lib/aiSuggest';
import { photosForVision } from '../lib/imageToBase64';
import { validateAiAttributeValue } from '../lib/aiAttributeValidation';
import { supabase } from '../lib/supabase';

// Same cap CreateListingScreen.tsx and useClassifyRun.ts each already keep
// locally -- how many of the seller's photos this call is willing to look
// at. Kept as its own local constant rather than a shared export because
// each of the three call sites has always been free to tune this
// independently (see useClassifyRun.ts's own copy of this same constant).
const AI_VISION_MAX_PHOTOS = 4;

export interface AiSpecSuggestionParams {
  seedTitle: string;
  categoryName: string;
  language: 'en' | 'ar';
  // "Label: value" lines for whatever specs are already confirmed --
  // ground truth the AI should write around, never contradict. See
  // CreateListingScreen's buildSpecsLines.
  specsLines: string[];
  // Local photo URIs, in priority order -- put the verification shot(s)
  // FIRST when there are any, since photosForVision gives the lead photos
  // print-legible fidelity (see imageToBase64.ts) and general gallery
  // photos are only ever context here, never the source of a spec value.
  photoUris: string[];
  // The schema of whichever category attributes are still blank -- see
  // CreateListingScreen's buildAttributeSchemaForSuggestion for how this
  // gets built (already excludes anything the seller filled in by hand).
  attributeSchema: AiSuggestAttributeSchema[];
  // The full attribute definitions matching attributeSchema's slugs --
  // needed to validate the AI's proposed values against each field's real
  // type/options (validateAiAttributeValue), not just trust the schema
  // sent out.
  specAttrs: CategoryAttribute[];
  // 'me' (the local-only pre-auth profile id) skips the
  // ai_listing_generations log, same guard CreateListingScreen already
  // uses -- there's no real seller_id to attribute the row to yet.
  sellerId: string;
}

export interface AiSpecSuggestionResult {
  title: string;
  description: string;
  // Whatever attribute values the AI proposed AND validateAiAttributeValue
  // confirmed match the field's own type/options -- keyed by slug, ready
  // to merge into a caller's attrValues state. Callers still decide
  // fill-only-if-empty for themselves (this hook has no opinion on what's
  // already set).
  attributes: Record<string, AttributeValue>;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  sources: AiSuggestSource[];
  uncertain: string[];
  // Handed back so a caller can feed it straight into its own
  // estimateListingPrice call (identification is what lets that second
  // call skip re-sending photos -- see aiSuggest.ts).
  identification: string;
}

export type AiSpecSuggestionOutcome =
  | { ok: true; result: AiSpecSuggestionResult }
  | { ok: false; error: string; rateLimited: boolean };

// The "describe" half of what CreateListingScreen.tsx's applyAiSuggestion
// used to do inline: call the AI, validate whatever attribute values it
// proposed, log the generation. Extracted so the batch flow's per-item
// spec-fill (BatchDetailsScreen, via BatchVerificationShotsScreen's
// captured photos) can run the exact same call CreateListingScreen does,
// instead of a second hand-rolled copy that could drift from it.
//
// Deliberately does NOT cover price estimation -- that's its own separate
// call (estimateListingPrice) with its own latency profile (~3x this
// call's) and its own fire-and-forget race-guard need, which is cheap for
// each caller to keep locally (CreateListingScreen already does, via
// priceRunRef) rather than forcing a second hook.
export function useAiSpecSuggestion() {
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async (params: AiSpecSuggestionParams): Promise<AiSpecSuggestionOutcome> => {
    setSuggesting(true);
    const photoPayload = params.photoUris.length > 0 ? await photosForVision(params.photoUris, AI_VISION_MAX_PHOTOS) : [];
    const { data, error } = await suggestListingFromWeb(
      params.seedTitle,
      params.categoryName,
      params.language,
      params.specsLines,
      photoPayload,
      params.attributeSchema
    );
    setSuggesting(false);
    if (error) {
      return { ok: false, error: error.message, rateLimited: error.rateLimited };
    }
    if (!data) {
      return { ok: false, error: 'AI suggestions are not available right now.', rateLimited: false };
    }
    const attributes: Record<string, AttributeValue> = {};
    if (data.attributes) {
      for (const a of params.specAttrs) {
        const v = validateAiAttributeValue(a, data.attributes[a.slug]);
        if (v !== undefined) attributes[a.slug] = v;
      }
    }
    if (params.sellerId !== 'me') {
      supabase
        .from('ai_listing_generations')
        .insert({
          seller_id: params.sellerId,
          suggested_title: data.title,
          suggested_description: data.description,
          suggested_specs: data.specs,
          suggested_attributes: data.attributes,
          price_range_low: data.priceRangeLow,
          price_range_high: data.priceRangeHigh,
          price_sources: data.sources,
          confidence: data.confidence,
          uncertain: data.uncertain,
          observed: data.observed,
          identification: data.identification,
          model: data.model,
          seller_accepted: true,
        })
        .then(() => {}, () => {});
    }
    return {
      ok: true,
      result: {
        title: data.title,
        description: data.description,
        attributes,
        priceRangeLow: data.priceRangeLow,
        priceRangeHigh: data.priceRangeHigh,
        sources: data.sources,
        uncertain: data.uncertain,
        identification: data.identification,
      },
    };
  };

  return { suggesting, suggest };
}
