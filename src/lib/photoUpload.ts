import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { resizePhotoForUpload } from './imageToBase64';
import { Alert } from './alertShim';

// Listing photos are hosted on the same ChemiCloud domain the app itself is
// served from (vevaty.com/upload.php), not Supabase Storage —
// keeps photo storage off the shared Supabase project's limits entirely.
const UPLOAD_URL = 'https://vevaty.com/upload.php';
const UPLOAD_TOKEN = 'myazar_upload_9f2c7a1d';

// How many bytes of the server's reply to quote back in an error. Enough to
// carry upload.php's JSON ({"error":"..."}) without pasting a whole HTML
// error page into a dialog.
const ERROR_BODY_CHARS = 300;

// Best-effort byte count for a local file, used only to make failures
// diagnosable. `File` implements Blob in expo-file-system 57, so `.size` is
// the file's length on disk. Returns null rather than throwing if the path
// isn't readable -- never let diagnostics break an upload.
function localFileSize(uri: string): number | null {
  if (Platform.OS === 'web') return null;
  try {
    return new File(uri).size ?? null;
  } catch {
    return null;
  }
}

// Uploads one local photo (a device file URI on native, or a blob:/data:
// URI on web) and returns its new public URL on vevaty.com.
//
// Every failure path throws an error whose message says WHICH step failed
// and what the server actually replied. That matters more than it sounds:
// the server has been verified healthy by hand (a plain curl of a JPEG
// returns 200 and a URL), yet not one upload from the app has ever
// succeeded, and the old code discarded the reason entirely.
export async function uploadPhoto(localUri: string): Promise<string> {
  // Cap the longest edge before upload -- upload.php stores whatever it is
  // given at full resolution, and the app then re-downloads that original
  // just to paint a small thumbnail. Falls back to the original URI if
  // resizing fails (see resizePhotoForUpload).
  const uri = await resizePhotoForUpload(localUri);

  // A zero-byte file is the single most likely explanation for a rejected
  // upload: upload.php answers exactly "Not a valid image" for empty input,
  // which is what an unreadable or not-yet-flushed resize output would
  // produce. Catch it here, where we can say so, instead of at the server
  // where the message is ambiguous.
  const size = localFileSize(uri);
  if (size === 0) {
    throw new Error(
      `Resized photo is 0 bytes before upload.\nsource: ${localUri}\nresized: ${uri}`
    );
  }

  const form = new FormData();
  form.append('token', UPLOAD_TOKEN);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    form.append('photo', blob, 'photo.jpg');
  } else {
    // React Native's FormData/XHR implementation uploads a local file when
    // given this { uri, name, type } shape -- not an actual Blob object.
    form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
  }

  let res: Response;
  try {
    res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  } catch (e: any) {
    // Distinguishes "never reached the server" (no connection, TLS, DNS)
    // from "server said no", which are completely different fixes.
    throw new Error(
      `Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}\nfile size: ${size ?? 'unknown'} bytes`
    );
  }

  // Read the body once, as text: a non-2xx reply may not be JSON at all
  // (a PHP fatal error or an HTML error page), and calling .json() on that
  // throws a parse error that hides the real message.
  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(
      `Server rejected the upload (HTTP ${res.status})\n` +
        `${bodyText.slice(0, ERROR_BODY_CHARS)}\nfile size: ${size ?? 'unknown'} bytes`
    );
  }

  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(
      `Server replied with something that isn't JSON (HTTP ${res.status})\n` +
        bodyText.slice(0, ERROR_BODY_CHARS)
    );
  }

  if (!data?.url) {
    throw new Error(
      `Server accepted the upload but returned no URL\n${bodyText.slice(0, ERROR_BODY_CHARS)}`
    );
  }
  return data.url as string;
}

// Uploads several photos. One bad photo still doesn't block the rest -- but
// the seller is now TOLD when something failed.
//
// This used to swallow every error silently, on the reasoning that the
// listing had been saved either way. The effect was that a listing could be
// published with none of its photos and nothing to indicate anything had
// gone wrong: it looked like it worked, right up until the listing appeared
// blank on both the app and the website.
export async function uploadPhotos(localUris: string[]): Promise<string[]> {
  const urls: string[] = [];
  const failures: string[] = [];

  for (const uri of localUris) {
    try {
      urls.push(await uploadPhoto(uri));
    } catch (e: any) {
      const detail = e?.message || String(e);
      failures.push(detail);
      console.warn('[photoUpload] failed:', detail);
    }
  }

  if (failures.length > 0) {
    Alert.alert(
      'Photos could not be uploaded',
      `${failures.length} of ${localUris.length} photo(s) failed. The listing was saved without them.\n\n${failures[0]}`
    );
  }

  return urls;
}
