import { useCallback, useEffect, useState } from 'react';
import { useClassifyRun, ClassifyRunResult } from '../hooks/useClassifyRun';
import { ClassifyCategoryOption, domainIdFromSentinel } from '../lib/classifyPhotos';

// Ephemeral, cross-screen classify status for in-flight batch items (see
// the batch-listings plan's "Cross-screen state" section). Named
// *Context.tsx, per the plan, but deliberately NOT built on React Context:
// a real Context provider would need to wrap every Batch* screen in one
// shared tree so state survives BatchPhotos -> BatchReview navigation,
// which means restructuring the batch flow into its own nested stack
// navigator (its own param-list plumbing, its own linking config) just to
// get one shared value down to five screens. A small module-scoped store
// with a subscribe hook gets the same "shared, ephemeral, gone when the
// app process ends" behaviour with none of that -- React Navigation keeps
// every pushed screen mounted anyway, so the only thing that actually
// needs to be shared is this plain object and its listener set.
//
// Scope: keyed by listing id, so it only ever describes items from
// whichever batch is currently in progress. resetBatchClassifyState()
// below is called once a batch is submitted or abandoned so a later,
// unrelated batch starts clean (not that a stale entry would ever be read
// by the wrong batch -- listing ids never collide -- it's just not worth
// letting the map grow across sessions for no reason).

export type BatchItemClassifyStatus = 'analyzing' | 'error' | 'idle';

export interface BatchItemClassifyState {
  status: BatchItemClassifyStatus;
  error: string | null;
  result: ClassifyRunResult | null;
  // Where `result` came from. 'shop' means the classifier said it could
  // not tell and the seller's own storefront answered instead (see
  // useShopFallbackCategory) -- the row then says so rather than
  // reporting a guess the AI never made.
  source: 'ai' | 'shop';
}

const IDLE_STATE: BatchItemClassifyState = { status: 'idle', error: null, result: null, source: 'ai' };

let itemState: Record<string, BatchItemClassifyState> = {};
const listeners = new Set<() => void>();

// Verification-shot photos per batch item -- same module-scoped store as
// itemState above, kept as its own map (rather than folded into
// BatchItemClassifyState) since it's written by a different screen
// (BatchVerificationShotsScreen) on a different lifecycle: it fills in
// AFTER classify has already resolved a category, and unlike classify
// status it's index-addressed per-item (one slot per verification prompt,
// same shape as CreateListingScreen's own verificationPhotos state) rather
// than a single result object. Local URIs only, same privacy-by-default
// as the single-item wizard -- never uploaded, never merged into a
// listing's real photos array.
let verificationPhotoState: Record<string, string[]> = {};

function notify() {
  listeners.forEach((l) => l());
}

function patchItem(listingId: string, patch: Partial<BatchItemClassifyState>) {
  itemState = {
    ...itemState,
    [listingId]: { ...(itemState[listingId] ?? IDLE_STATE), ...patch },
  };
  notify();
}

export function resetBatchClassifyState() {
  itemState = {};
  verificationPhotoState = {};
  notify();
}

// Replaces one item's whole verification-photos array -- callers (the
// verification-shots screen) always pass the full next array (e.g. via an
// index-splice like CreateListingScreen's pickVerificationPhotoFromLibrary)
// rather than an append, since a retake replaces a specific prompt's slot.
export function setVerificationPhotosFor(listingId: string, photos: string[]) {
  verificationPhotoState = { ...verificationPhotoState, [listingId]: photos };
  notify();
}

// Subscribes to and reads ONE item's captured verification photos -- what
// BatchVerificationShotsScreen renders itself with, and what
// BatchDetailsScreen's auto-suggest effect reads once per item.
export function useVerificationPhotosFor(listingId: string): string[] {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return verificationPhotoState[listingId] ?? [];
}

// Subscribes to and reads ONE item's live state -- what a batch review
// row renders itself with.
export function useBatchItemClassifyState(listingId: string): BatchItemClassifyState {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return itemState[listingId] ?? IDLE_STATE;
}

// Same subscription, but hands back the whole map -- for the review
// screen's collective "N items still being analyzed" banner, which needs
// to count across every row at once rather than per-row.
export function useBatchClassifyStates(): Record<string, BatchItemClassifyState> {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return itemState;
}

// Action hook -- mount wherever a classify run needs to be KICKED OFF:
// BatchPhotosScreen right after an item's addListing call, and the
// review screen's per-row "try again" retry. Bound to that screen's own
// live categoryOptions/language via useClassifyRun, same as the
// single-item wizard's instance -- only the RESULT is written into the
// shared store above, so every other mounted batch screen sees it
// through the read hooks above regardless of which screen's
// classifyItem call produced it.
// `fallbackCategoryId` is what a storefront's own category answers with
// when the classifier cannot tell -- see useShopFallbackCategory. Passed
// in rather than resolved here so both batch screens that can start a
// classify (capture, and the review screen's retry) hand over the same
// one, and so this stays a plain runner with no opinion about shops.
export function useBatchClassify(
  categoryOptions: ClassifyCategoryOption[],
  language: 'en' | 'ar',
  photoReadFailedMessage: string,
  fallbackCategoryId?: string | null
) {
  const { run } = useClassifyRun(categoryOptions, language);

  const classifyItem = useCallback(
    (listingId: string, photos: string[]) => {
      patchItem(listingId, { status: 'analyzing', error: null });
      run(photos, photoReadFailedMessage).then((outcome) => {
        if (!outcome.ok) {
          patchItem(listingId, { status: 'error', error: outcome.error });
          return;
        }
        // The classifier answered from inside a closed in-domain list and
        // said the item belongs to a different section entirely (see
        // buildDomainCandidates). A batch is one section by construction,
        // so there is no per-row switch to offer -- but the answer is not
        // a category either, and it is emphatically not a "cannot tell".
        // The row falls through to a manual pick, and the storefront
        // fallback below is deliberately skipped: a car dealer's batch
        // with a microwave in it must not have the microwave pre-filled
        // as a car, one tap from being confirmed.
        if (outcome.result && domainIdFromSentinel(outcome.result.categoryId)) {
          patchItem(listingId, { status: 'idle', error: null, result: null, source: 'ai' });
          return;
        }
        // outcome.result === null here is the AI's own "can't tell" --
        // not an error (status goes back to 'idle', error stays null).
        // The storefront answers it if it can; otherwise the review row
        // falls through to needing a manual pick, same as the
        // single-item wizard's classifyNoGuessHint.
        //
        // itemName is deliberately empty on that path: a shop's category
        // says what KIND of thing this is, not what this one is called,
        // and a title seeded from it would be the same words on every
        // item in the batch.
        if (!outcome.result && fallbackCategoryId) {
          patchItem(listingId, {
            status: 'idle',
            error: null,
            result: { categoryId: fallbackCategoryId, itemName: '' },
            source: 'shop',
          });
          return;
        }
        patchItem(listingId, { status: 'idle', error: null, result: outcome.result, source: 'ai' });
      });
    },
    [run, photoReadFailedMessage, fallbackCategoryId]
  );

  return { classifyItem };
}
