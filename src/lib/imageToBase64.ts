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
export async function uriToCompressedBase64(
  uri: string,
  maxDim = 1024,
  quality = 0.6
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
    });
    const scale = Math.min(1, maxDim / Math.max(width, height));
    // Only one side needs to be specified -- expo-image-manipulator scales
    // the other to preserve aspect ratio. Pick whichever side is longer so
    // the resize actually bounds the longer edge to maxDim.
    const resizeAction: ImageManipulator.Action[] =
      scale < 1
        ? [{ resize: width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) } }]
        : [];

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
