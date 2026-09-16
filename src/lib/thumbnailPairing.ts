// Two arrays read by index: the thing, and the small copy of the thing.
//
// This shape occurs twice on a listing and it has gone wrong in both
// places, the same way:
//
//   photos  / photoThumbnails   -- the gallery, read by ListingCard
//   frames  / previewFrames     -- a 360 set, read by CardPreview
//
// Entry i of one is entry i of the other, which makes the pairing the
// whole contract and makes both failures silent:
//
//   - REPLACE ONE AND NOT THE OTHER and the thumbnails describe the
//     previous photographs. Same count, same length, nothing downstream
//     can tell -- the card just draws the old pictures. A photo reorder
//     that keeps the count did this to the gallery; a 360 retake of the
//     same frame count did it to the spin.
//   - DROP THEM ON A SAVE and each item stands in for its own full-size
//     original. Nothing looks wrong at all -- only the bytes change, at
//     roughly 7.7MB of Android bitmap heap per frame instead of a
//     fraction of it.
//
// Neither is visible to the person it happens to, and neither shows up in
// a log, so the decision lives here with a test rather than inline in the
// four places that make it. See AGENTS.md, "A column nothing reads is
// worse than no column", and @CARDS.md for what the card draws.

/** Same items, same order? */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// What the thumbnails should become when the items are replaced.
//
// Kept only when the items did not actually change -- opening the 360
// preview and tapping Continue without retaking, or a save that touched
// the price and not the photos. Any real change and they go: `undefined`
// reads as "we do not have these", which every reader already handles,
// where a stale array reads as an answer.
export function carryThumbnails(
  previousItems: readonly string[],
  previousThumbnails: readonly string[] | undefined,
  nextItems: readonly string[]
): string[] | undefined {
  if (!sameList(previousItems, nextItems)) return undefined;
  return previousThumbnails ? [...previousThumbnails] : undefined;
}

// The thumbnails to draw, or the items themselves where there are none.
//
// Falls back WHOLE rather than per entry: a mismatched length means
// something upstream is wrong about the pairing, and then no single entry
// can be trusted either -- drawing item 3's thumbnail at position 7 is
// worse than drawing everything at full size.
export function thumbnailsFor(
  items: readonly string[],
  thumbnails: readonly string[] | undefined
): string[] {
  if (Array.isArray(thumbnails) && thumbnails.length === items.length) {
    return [...thumbnails];
  }
  return [...items];
}

// The small copy for ONE item, by its index in `items`.
//
// Never an index into a filtered subset of them: writeSpinSets splits a
// set into frames it is keeping and frames it is uploading, and those two
// indices diverge the moment a set mixes the two. Pairing on the wrong one
// attaches one frame's thumbnail to another's.
export function thumbnailAt(
  items: readonly string[],
  thumbnails: readonly string[] | undefined,
  index: number
): string {
  const item = items[index];
  if (!Array.isArray(thumbnails) || thumbnails.length !== items.length) return item;
  const known = thumbnails[index];
  // An item uploaded before per-item thumbnails existed genuinely has
  // none, and then standing in for its own is still the right answer.
  return typeof known === 'string' && known ? known : item;
}
