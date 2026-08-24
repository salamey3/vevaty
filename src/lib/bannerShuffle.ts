// Pure "shuffle bag" banner selection -- see BannerStore.tsx and the
// "Vevaty — Managed Banner Placements" design spec, Section 5.1.
//
// Requirements the algorithm has to satisfy, all at once: every active
// banner in a slot gets picked exactly once per full cycle (equal
// exposure over time), the same banner never shows twice in a row (not
// even across a reshuffle boundary), and each individual pick still
// feels random. A plain "random pick every time" satisfies none of
// these reliably -- it can repeat back-to-back, and over a short session
// can favor one banner over another purely by chance.
//
// Exported standalone (no React/Supabase imports) so it's testable with
// real inputs -- see scripts/test/banner-shuffle.test.mjs.

export interface ShuffleBagState {
  order: string[];
  index: number;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Picks the next banner id to show for a slot, given its currently-active
// id set, the bag state left over from the last pick (if any), and the id
// that was shown last (across any slot history -- callers pass the
// per-slot value). Returns both the id to show and the state to persist
// for the following call.
//
// `activeIds` is rebuilt fresh by the caller on every reroll (from
// whichever banners are currently is_active and inside their date
// window) -- schedules can change between rerolls, so the bag is only
// reused when the active set is EXACTLY what it was when that bag was
// shuffled; otherwise it's treated as exhausted and reshuffled, same as
// running off the end of a valid bag.
export function pickNextBanner(
  activeIds: string[],
  prev: ShuffleBagState | null,
  lastShownId: string | null,
  random: () => number = Math.random
): { id: string | null; state: ShuffleBagState | null } {
  if (activeIds.length === 0) return { id: null, state: null };

  if (activeIds.length === 1) {
    // Nothing to shuffle or avoid repeating -- it's the only choice.
    return { id: activeIds[0], state: { order: activeIds.slice(), index: 1 } };
  }

  const sameSet =
    !!prev &&
    prev.order.length === activeIds.length &&
    prev.order.every((id) => activeIds.includes(id));
  const bagStillHasNext = sameSet && prev!.index < prev!.order.length;

  let order = bagStillHasNext ? prev!.order : shuffled(activeIds, random);
  let index = bagStillHasNext ? prev!.index : 0;

  if (!bagStillHasNext) {
    // Fresh shuffle (first ever pick for this slot, the active set
    // changed, or the previous bag ran out) -- never let its first pick
    // repeat whatever was shown last, even though that came from a
    // different bag.
    if (lastShownId && order[0] === lastShownId) {
      const swapWith = 1 + Math.floor(random() * (order.length - 1));
      [order[0], order[swapWith]] = [order[swapWith], order[0]];
    }
  }

  const id = order[index];
  return { id, state: { order, index: index + 1 } };
}
