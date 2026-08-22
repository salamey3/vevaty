import { useState } from 'react';
import { photosForVision } from '../lib/imageToBase64';
import { classifyListingPhotos, ClassifyCategoryOption } from '../lib/classifyPhotos';

// Extracted from CreateListingScreen's original runClassify/classifying/
// classifyError state block (photos-first restructuring) so both the
// single-item wizard and each in-flight batch item (see
// src/store/BatchClassifyContext.tsx) can run the same "guess a category
// from photos" call without duplicating the vision-payload/error-shape
// plumbing. Deliberately does NOT own `category`/`aiCategoryId`/
// `manuallyChosen`/`classifyAttempted` -- those are caller state, because
// what happens with a successful guess (which field it fills, what
// one-shot guard gates re-firing) differs between a single listing and a
// batch item tracked in a context. See CreateListingScreen's own
// `runClassify` wrapper and BatchClassifyContext's per-item runner for the
// two current call sites.

// Capped the same way the other vision calls (AI suggest, moderation) cap
// theirs -- the model only needs enough of the item to identify it, not
// every angle.
const AI_VISION_MAX_PHOTOS = 4;

export interface ClassifyRunResult {
  categoryId: string;
  itemName: string;
}

// Discriminated so a hard error (photos unreadable, network/model failure)
// is distinguishable from "the model looked and genuinely couldn't tell"
// (ok:true, result:null -- not an error, just a fall-through to manual
// category pick). Returned directly from `run` -- rather than left for the
// caller to read off this hook's own `classifyError` state -- because
// BatchClassifyContext drives several concurrent classify calls off ONE
// shared hook instance (one per batch item, all sharing the category
// options/language this hook is built with); if each call's error only
// existed in this hook's single shared `classifyError` state, concurrent
// items would race and clobber each other's message. Returning it inline
// gives each call its own answer regardless of what else is in flight.
export type ClassifyRunOutcome =
  | { ok: true; result: ClassifyRunResult | null }
  | { ok: false; error: string };

export function useClassifyRun(categoryOptions: ClassifyCategoryOption[], language: 'en' | 'ar') {
  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState<string | null>(null);

  // `photoReadFailedMessage` is passed in per-call rather than baked in
  // here, since the two callers use different translated copy for the
  // same "these photos couldn't be read" case.
  const run = async (
    photos: string[],
    photoReadFailedMessage: string
  ): Promise<ClassifyRunOutcome> => {
    setClassifying(true);
    setClassifyError(null);
    const payload = await photosForVision(photos, AI_VISION_MAX_PHOTOS);
    if (payload.length === 0) {
      setClassifying(false);
      setClassifyError(photoReadFailedMessage);
      return { ok: false, error: photoReadFailedMessage };
    }
    const { data, error } = await classifyListingPhotos(payload, categoryOptions, language);
    setClassifying(false);
    if (error) {
      setClassifyError(error.message);
      return { ok: false, error: error.message };
    }
    if (!data?.categoryId) {
      // An explicit "I can't tell" from the qualifier -- not an error, so
      // classifyError stays null and the caller falls back to manual pick.
      return { ok: true, result: null };
    }
    return { ok: true, result: { categoryId: data.categoryId, itemName: data.itemName } };
  };

  return { classifying, classifyError, run };
}
