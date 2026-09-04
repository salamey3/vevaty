import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

// Converts a local photo URI (from expo-image-picker or the guided native
// camera, see CameraCapture.tsx) into a resized/compressed base64 JPEG, for
// sending to the ai-suggest-listing edge function's vision-based suggestion
// (see CreateListingScreen's applyAiSuggestion). Downscaling client-side
// keeps the request small and cheap regardless of how large the original
// photo is -- the edge function only needs enough detail to identify the
// item and its visible condition, not a print-quality image.
//
// This used to go straight through raw DOM APIs (createImageBitmap, a
// canvas element, FileReader) the same "call the Web API directly" approach
// CameraCapture.tsx used to use for its old web-only live preview. Those
// APIs don't exist in Hermes/React Native's native JS environment, so on a
// real Android/iOS build every call silently failed (caught by the
// try/catch below and returned null) -- every one of the seller's photos
// got dropped before ever reaching the AI, which is why the vision-based
// "identify the item from photos" suggestion always fell back to the plain
// template on-device even though it worked fine on the web build.
// expo-image-manipulator + RN's own Image.getSize are the cross-platform
// (native AND web) equivalents, so this one implementation now works
// everywhere without a separate .native.ts file.
// Shared by both exports below -- only one side needs to be specified,
// expo-image-manipulator scales the other to preserve aspect ratio. Pick
// whichever side is longer so the resize actually bounds the longer edge to
// maxDim, and skip resizing entirely (empty action list) if the source is
// already smaller than that.
async function computeResizeAction(uri: string, maxDim: number): Promise<ImageManipulator.Action[]> {
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
  });
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return scale < 1
    ? [{ resize: width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) } }]
    : [];
}

// Neither of the two steps below has a timeout of its own, and one of them
// FETCHES: on an edit, the URIs are hosted https URLs, so Image.getSize
// and manipulateAsync each pull the file over the network. RN's
// Image.getSize in particular has no deadline at all, so a stalled fetch
// leaves this promise pending for ever -- and the callers use Promise.all,
// so one hung photo means the whole batch never settles.
//
// That is not a slow AI suggestion, it is a listing that never gets
// moderated: triggerListingModeration is never called, the listing sits at
// pending_review, and nothing tells anybody. Exactly the shape of failure
// the media work went after (@MEDIA.md), one file over.
//
// Generous, because it is a backstop: a photo that is downloading at all
// finishes well inside it.
const ENCODE_TIMEOUT_MS = 30_000;

export async function uriToCompressedBase64(
  uri: string,
  maxDim = 1024,
  quality = 0.6
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const work = (async () => {
      const resizeAction = await computeResizeAction(uri, maxDim);
      return ImageManipulator.manipulateAsync(uri, resizeAction, {
        base64: true,
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG,
      });
    })();
    const result = await Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`image encode timed out: ${uri}`)), ENCODE_TIMEOUT_MS)
      ),
    ]);
    if (!result.base64) return null;
    return { mediaType: 'image/jpeg', data: result.base64 };
  } catch (e: any) {
    // Best-effort -- a photo that fails to read/encode is just skipped by
    // the caller, never blocks the rest of the AI suggestion. Logged
    // rather than swallowed, because "the AI saw fewer photos than the
    // seller thinks it did" is otherwise invisible everywhere.
    console.warn('[imageToBase64] skipped a photo:', e?.message || e);
    return null;
  }
}

// What the AI is allowed to SEE, and why these numbers.
//
// The vision suggestion used to send every photo at 1024px / quality 0.6,
// on the reasoning that the model "only needs enough detail to identify the
// item, not a print-quality image". That reasoning was wrong in one
// specific, expensive way: identifying a product usually means READING
// something printed on it -- a brand name, a model number, a capacity --
// and JPEG quality 0.6 at 1024px is where small printed text turns to
// mush. The model then does what anyone does with a blurry word: it
// pattern-matches to something plausible. That is how "SanDisk" came back
// as "Samisk", and how two drives came back as two carrying cases.
//
// 1568px is not arbitrary: Claude downscales anything longer than that on
// its long edge before looking at it, so pixels beyond 1568 cost bytes and
// buy nothing. Quality 0.85 is where fine text stops smearing.
//
// The lead photos get that treatment; the rest ride along at the old
// setting as context for shape and condition, which is all they are really
// doing. Full fidelity on every photo would roughly triple the request on
// a connection that is already the app's weakest link.
export const AI_LEAD_PHOTOS = 2;
const AI_LEAD_MAX_DIM = 1568;
const AI_LEAD_QUALITY = 0.85;
const AI_CONTEXT_MAX_DIM = 1024;
const AI_CONTEXT_QUALITY = 0.65;

export interface VisionPhoto {
  data: string;
  mediaType: string;
}

// Builds the photo payload for a vision call: the first AI_LEAD_PHOTOS at
// text-legible fidelity, the remainder as cheaper context. Photos that
// fail to read or encode are dropped rather than blocking the call.
export async function photosForVision(uris: string[], max: number): Promise<VisionPhoto[]> {
  const results = await Promise.all(
    uris.slice(0, max).map((uri, i) =>
      i < AI_LEAD_PHOTOS
        ? uriToCompressedBase64(uri, AI_LEAD_MAX_DIM, AI_LEAD_QUALITY)
        : uriToCompressedBase64(uri, AI_CONTEXT_MAX_DIM, AI_CONTEXT_QUALITY)
    )
  );
  return results.filter((p): p is VisionPhoto => !!p);
}

// Caps a local photo URI to a sane upload size before it ever leaves the
// device, returning a new local URI (not base64 -- this one gets uploaded
// as a file, see photoUpload.ts). Sellers' camera/gallery photos routinely
// come in at 4000x3000+ (several MB each); storage serves back exactly
// what it was given, and every listing card/carousel on the app requests
// that same full-size original just to paint a thumbnail a few hundred points wide at most. That mismatch -- dozens of
// multi-megabyte photos decoded at once for tiny cards -- is what actually
// made scrolling/swiping feel heavy on-device (confirmed via screen
// recording), not just a cold-start blip. 1600px longest-edge at quality
// 0.8 is still sharp full-screen in the photo lightbox, at a fraction of a
// typical camera original's size.
export async function resizePhotoForUpload(uri: string, maxDim = 1600, quality = 0.8): Promise<string> {
  try {
    const resizeAction = await computeResizeAction(uri, maxDim);
    if (resizeAction.length === 0 && quality >= 1) return uri; // already small enough, nothing to do
    const result = await ImageManipulator.manipulateAsync(uri, resizeAction, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch (e) {
    // Best-effort -- if resizing fails for any reason, upload the original
    // rather than blocking the listing from being posted at all.
    return uri;
  }
}

// Same idea as resizePhotoForUpload, but for a genuinely small second copy
// meant only for a listing card's thumbnail -- not a smaller crop of the
// same 1600px "full" photo. The comment above already named the gap this
// closes: sizedPhotoUrl (photoSize.ts) was built to request a smaller size
// at fetch time, but that only works for the picsum.photos seed URLs it was
// tested against. Every real photo goes to Bunny, which serves back exactly
// the bytes it was given -- there is no fetch-time resizing to ask for, so
// the only way to make a card actually decode a small image is to make a
// genuinely small file exist.
//
// 640px, raised from 400 when the browse grid went to one column on a phone.
// 400 was sized for a two-column card (~175pt, so 350 device px at this app's
// max 2x scale) and had room to spare; a full-width card is ~354pt, which
// wants ~708, and a 400px q0.7 JPEG stretched to that is visibly soft on the
// app's primary browse surface -- the one the wider cards were meant to
// improve.
//
// 640 rather than 708-and-up, and the difference is the point. This is a
// single file serving every card in the app, and Bunny returns exactly the
// bytes it was given, so a carousel thumbnail decodes the same bitmap a
// full-width card does -- 640x480 costs ~1.2 MB of Android bitmap heap
// against 400x300's ~0.5 MB, where 800px would have cost ~1.9 MB. At 640 a
// full-width card upscales by about 1.1x, which is not visible, and the heap
// cost stays close to what a one-column grid gives back by mounting roughly
// half as many cards at once. 800 bought a difference nobody can see for a
// cost the mid-range Android this file exists for would feel.
//
// NOTE, because it will look like a bug: this only affects photos uploaded
// from here on. Every listing posted before this keeps its 400px thumbnail
// and will look soft on a full-width card until its photos are re-uploaded.
export async function resizeThumbnailForUpload(uri: string, maxDim = 640, quality = 0.7): Promise<string> {
  try {
    const resizeAction = await computeResizeAction(uri, maxDim);
    const result = await ImageManipulator.manipulateAsync(uri, resizeAction, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch (e) {
    // Best-effort, same as resizePhotoForUpload -- fall back to the original
    // rather than lose the photo. uploadPhotoWithThumbnail still uploads
    // this as the "thumbnail", which only matters if BOTH this and the
    // separate resizePhotoForUpload call for the full photo fail the same
    // way for the same source image -- an already-unlikely coincidence, and
    // even then it's no worse than today's behavior of the full photo being
    // requested for the card.
    return uri;
  }
}
