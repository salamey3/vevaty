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

export async function uriToCompressedBase64(
  uri: string,
  maxDim = 1024,
  quality = 0.6
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const resizeAction = await computeResizeAction(uri, maxDim);
    const result = await ImageManipulator.manipulateAsync(uri, resizeAction, {
      base64: true,
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (!result.base64) return null;
    return { mediaType: 'image/jpeg', data: result.base64 };
  } catch (e) {
    // Best-effort -- a photo that fails to read/encode is just skipped by
    // the caller, never blocks the rest of the AI suggestion.
    return null;
  }
}

// Caps a local photo URI to a sane upload size before it ever leaves the
// device, returning a new local URI (not base64 -- this one gets uploaded
// as a file, see photoUpload.ts). Sellers' camera/gallery photos routinely
// come in at 4000x3000+ (several MB each); vevaty.com/upload.php serves
// whatever it's given back out verbatim with no server-side resizing, and
// every listing card/carousel on the app requests that same full-size
// original just to paint a 148px-wide thumbnail. That mismatch -- dozens of
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
