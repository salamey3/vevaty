// ONE PREVIEW AT A TIME, ACROSS EVERY CARD ON SCREEN.
//
// On a desktop this was free: a preview follows the pointer, and a pointer
// can only rest on one card, so moving to the next card ended the last
// one. Touch has no pointer to leave. A preview there is started by a
// button and stays started, so a shopper walking down the grid tapping
// Preview on three cards had three of them running at once -- each holding
// every frame of a spin in memory at full size (see CardPreview), which is
// the exact thing the twenty-second auto-stop exists to bound.
//
// The fix is a claim: starting a preview stops whichever one was playing
// before it. Deliberately a module-level singleton rather than a context
// provider -- cards render inside half a dozen different screens and
// carousels, and there is no tree that contains all of them without
// wrapping the whole app in a provider whose only job is to hold one
// pointer.
//
// Claims are per CARD INSTANCE, not per listing id: the same listing can be
// on screen twice at once (a grid card and a related-listings carousel
// behind it), and keying by listing id would let one instance release the
// other's claim.

type Stop = () => void;

let current: { token: number; stop: Stop } | null = null;
let seq = 0;

// A token for one mounted card. Cheap, monotonic, never reused.
export function nextPreviewToken(): number {
  return ++seq;
}

// Start previewing: whatever was playing stops first.
export function claimPreview(token: number, stop: Stop): void {
  if (current && current.token !== token) current.stop();
  current = { token, stop };
}

// Stop previewing, or unmount. Only clears the claim if this card still
// holds it -- a card that was already stopped by someone else's claim must
// not wipe the newer one on its way out.
export function releasePreview(token: number): void {
  if (current && current.token === token) current = null;
}
