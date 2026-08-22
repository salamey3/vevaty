import { useCallback, useEffect, useState } from 'react';
import { useClassifyRun, ClassifyRunResult } from '../hooks/useClassifyRun';
import { ClassifyCategoryOption } from '../lib/classifyPhotos';

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
}

const IDLE_STATE: BatchItemClassifyState = { status: 'idle', error: null, result: null };

let itemState: Record<string, BatchItemClassifyState> = {};
const listeners = new Set<() => void>();

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
  notify();
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
export function useBatchClassify(
  categoryOptions: ClassifyCategoryOption[],
  language: 'en' | 'ar',
  photoReadFailedMessage: string
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
        // outcome.result === null here is the AI's own "can't tell" --
        // not an error (status goes back to 'idle', error stays null),
        // the review row just falls through to needing a manual pick,
        // same as the single-item wizard's classifyNoGuessHint.
        patchItem(listingId, { status: 'idle', error: null, result: outcome.result });
      });
    },
    [run, photoReadFailedMessage]
  );

  return { classifyItem };
}
