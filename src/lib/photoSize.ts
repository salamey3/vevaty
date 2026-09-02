import { PixelRatio } from 'react-native';

// Every listing photo in the database today is a picsum.photos seed URL
// baked in at 900x1200 (387 of them across 129 listings), and every one of
// them was being requested at that full size no matter how small it was
// about to be drawn -- a 148px-wide carousel thumbnail included.
//
// On Android that mismatch is not just wasted bandwidth, it's wasted RAM:
// RN's <Image> decodes a remote bitmap at its source resolution, and
// Android's default ARGB_8888 config costs 4 bytes per pixel, so one
// 900x1200 photo occupies ~4.1 MB of heap while on screen regardless of
// how small its view is. A couple dozen mounted cards is 50-160 MB of
// bitmap heap for thumbnails -- enough on a mid-range device to keep the
// GC running continuously, which is what makes *everything* feel heavy
// (scrolling, carousel swipes, and yes, an unrelated language toggle),
// not just the scrolling that's actually loading photos.
//
// Requesting the size we're actually going to draw fixes it at the source.
// For picsum that's just rewriting the trailing /width/height. Uploaded
// photos pass through untouched -- Bunny serves back exactly what was
// stored unless the Optimizer add-on is enabled on the pull zone, which is
// why uploads are also capped client-side before they're sent (see
// resizePhotoForUpload in imageToBase64.ts); the two together mean neither
// seeded nor real photos come down oversized. If Optimizer is ever turned
// on, this is the one place that would need to learn `?width=`.
const PICSUM = /^(https?:\/\/(?:i\.)?picsum\.photos\/(?:seed\/[^/]+\/)?)(\d+)\/(\d+)(.*)$/;

// Cap the multiplier -- a 3x/4x device would otherwise undo the whole point
// by asking for something close to the original again.
const MAX_SCALE = 2;

// Returns `url` rewritten to roughly `displayWidth` logical points at this
// device's pixel density, preserving the original aspect ratio. Any URL
// shape we don't recognise is returned unchanged, so this can be applied
// everywhere safely -- it never invents a URL that might not exist.
export function sizedPhotoUrl(url: string | null | undefined, displayWidth: number): string | null {
  if (!url) return null;
  const match = url.match(PICSUM);
  if (!match) return url;

  const [, prefix, wStr, hStr, suffix] = match;
  const srcW = Number(wStr);
  const srcH = Number(hStr);
  if (!srcW || !srcH) return url;

  const scale = Math.min(PixelRatio.get() || 1, MAX_SCALE);
  const targetW = Math.round(displayWidth * scale);
  // Never upscale past the original -- asking picsum for something larger
  // than the seeded size would make this worse, not better.
  if (targetW >= srcW) return url;
  const targetH = Math.max(1, Math.round(targetW * (srcH / srcW)));
  return `${prefix}${targetW}/${targetH}${suffix}`;
}

// Widths the app actually draws photos at, kept here so the call sites read
// as intent ("this is a card thumbnail") rather than a magic number, and so
// they can be tuned in one place.
// There is deliberately no `card` entry any more. Every card now measures the
// width it actually draws its photo at and passes that (see ListingCard's
// drawnPhotoWidth): one constant for every card in the app meant a small
// related-listing thumbnail requesting the same bitmap as a full-width grid
// card, and RN decodes at the source resolution whatever size the view is,
// which is the entire premise of this file.
export const PHOTO_WIDTHS = {
  // Listing detail hero / gallery, roughly full screen width.
  detail: 420,
} as const;

// The lightbox is the one place the user is deliberately looking at a photo
// full-screen and zoomed, so it keeps the original -- call sites there just
// pass the raw url straight to <Image> rather than going through this.
