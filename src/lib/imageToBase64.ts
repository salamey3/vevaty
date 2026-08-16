// Converts a local photo URI (blob:/data: from expo-image-picker or the
// guided camera, on web -- see CameraCapture.tsx's own "this app ships
// web-only" note) into a resized/compressed base64 JPEG, for sending to
// the ai-suggest-listing edge function's vision-based suggestion (see
// CreateListingScreen's applyAiSuggestion). Downscaling client-side keeps
// the request small and cheap regardless of how large the original photo
// is -- the edge function only needs enough detail to identify the item
// and its visible condition, not a print-quality image.
//
// Raw DOM APIs (createImageBitmap/canvas/FileReader), same "call the Web
// API directly, no wrapper library" approach CameraCapture.tsx already
// uses for the live camera preview and frame capture.
export async function uriToCompressedBase64(
  uri: string,
  maxDim = 1024,
  quality = 0.6
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const resp = await fetch(uri);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const dataUrl = await new Promise<string | null>((resolve) => {
      canvas.toBlob(
        (compressedBlob) => {
          if (!compressedBlob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(compressedBlob);
        },
        'image/jpeg',
        quality
      );
    });
    if (!dataUrl) return null;

    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    return { mediaType: match[1], data: match[2] };
  } catch (e) {
    // Best-effort -- a photo that fails to encode is just skipped by the
    // caller, never blocks the rest of the AI suggestion.
    return null;
  }
}
