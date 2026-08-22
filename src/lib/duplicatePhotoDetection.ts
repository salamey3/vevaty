// Explicitly out of scope for v1 (the user flagged this as lowest
// priority / a nice-to-have when the batch-listings flow was being
// scoped) -- this is a clean, currently-inert extension seam rather than
// a real implementation. BatchPhotosScreen calls checkForDuplicatePhotos
// after each item's photos are captured; today it always resolves to "no
// matches", so it changes nothing about the flow. A future pass can swap
// the body for a real perceptual-hash/embedding comparison against the
// other photos already captured in this batch without touching any call
// site.

export interface DuplicatePhotoMatch {
  // Index into the current item's own photos array that appears to
  // duplicate something already captured.
  photoIndex: number;
  // Which earlier batch item (by listing id) it appears to duplicate.
  matchesListingId: string;
}

export async function checkForDuplicatePhotos(
  _photos: string[],
  _otherItemsPhotos: Record<string, string[]>
): Promise<DuplicatePhotoMatch[]> {
  return [];
}
