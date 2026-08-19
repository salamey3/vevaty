import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { resizePhotoForUpload } from './imageToBase64';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase';
import { Alert } from './alertShim';

// Listing photos go to Bunny edge storage, via the `upload-photo` Supabase
// function -- NOT to vevaty.com/upload.php, which is what this used to do.
//
// upload.php was never broken. It answered a plain HTTP client with the
// right bytes, its certificate chain was complete, and its DNS resolved
// correctly from Google, Cloudflare and everywhere else that was checked.
// It just could not be reached FROM THE APP: photos posted from the phone
// silently arrived with no images, and photos posted from the website
// showed as blank frames in the app, while Supabase calls on the very same
// device worked perfectly. One host unreachable, one host fine.
//
// So the fix is not another retry -- it is to stop routing photos through
// a host the app cannot count on. Uploads now go to the same Supabase
// origin every other call in the app already uses, and the stored file is
// served back from Bunny's CDN rather than from a shared hosting box, so
// neither direction depends on vevaty.com any more. Bunny also caches, and
// serves the Middle East from nearby edges, which the old setup did not:
// every 148px thumbnail used to re-download a full-size original.
const UPLOAD_URL = `${SUPABASE_URL}/functions/v1/upload-photo`;

// How many characters of the server's reply to quote back in an error.
// Enough for the function's JSON ({"error":"...","message":"..."}) without
// pasting an entire HTML error page into a dialog.
const ERROR_BODY_CHARS = 300;

// Turns the upload function's reply into the hosted CDN URL, or throws
// with the reply quoted. Shared by both platform paths so they fail
// identically.
function urlFromResponse(status: number, body: string): string {
  if (status < 200 || status >= 300) {
    throw new Error(`Server rejected the upload (HTTP ${status})\n${body.slice(0, ERROR_BODY_CHARS)}`);
  }
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Server replied with something that isn't JSON (HTTP ${status})\n${body.slice(0, ERROR_BODY_CHARS)}`
    );
  }
  if (!data?.url) {
    throw new Error(`Server accepted the upload but returned no URL\n${body.slice(0, ERROR_BODY_CHARS)}`);
  }
  return data.url as string;
}

// The signed-in seller's token, which is what authorises the upload now.
// There is no ticket to fetch and no shared secret anywhere in the client:
// the edge function resolves the account from this token, refuses
// anonymous sessions, and holds the Bunny storage password itself.
async function authHeaders(contentType: string): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('You are signed out, so photos cannot be uploaded.\nSign in and try again.');
  }
  return {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_PUBLISHABLE_KEY,
    'Content-Type': contentType,
  };
}

// Uploads one local photo and returns its public CDN URL.
//
// The bytes go up as the raw request body rather than as multipart form
// data. That is not a style choice: React Native 0.86 ships a
// spec-compliant FormData that only accepts strings and real Blobs, so the
// `{ uri, name, type }` object RN used to allow is rejected outright with
// "Unsupported FormDataPart implementation" -- which is why photo upload
// never once worked from the app before this was understood. A raw body
// sidesteps FormData on both platforms, and expo-file-system's uploader
// streams the file from disk without loading it into JS memory.
export async function uploadPhoto(localUri: string): Promise<string> {
  // Cap the longest edge first -- the CDN serves back whatever it is
  // given, and a 4000x3000 camera original is several MB to paint a
  // 148px card. Falls back to the original URI if resizing fails.
  const uri = await resizePhotoForUpload(localUri);
  const headers = await authHeaders('image/jpeg');

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    let res: Response;
    try {
      res = await fetch(UPLOAD_URL, { method: 'POST', body: blob, headers });
    } catch (e: any) {
      throw new Error(`Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}`);
    }
    // Read once as text: an error page would make .json() throw a parse
    // error that hides the actual message.
    return urlFromResponse(res.status, await res.text());
  }

  const file = new File(uri);
  let result: { status: number; body: string };
  try {
    // BINARY_CONTENT is expo-file-system's default; named explicitly
    // because the previous version passed MULTIPART here and the
    // difference is the entire point of this function.
    result = await file.upload(UPLOAD_URL, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
    });
  } catch (e: any) {
    // Rejects only when the file can't be read or the request itself
    // fails; any completed HTTP response (including non-2xx) resolves.
    throw new Error(`Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}\nfile: ${uri}`);
  }
  return urlFromResponse(result.status, result.body);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// How many times to attempt one photo before giving up on it, and how long
// to wait between attempts. Three attempts spread over ~3s covers what this
// is actually for -- a phone that loses DNS or drops a packet for a second
// on a mobile connection -- without making a genuinely broken upload take a
// minute to report itself.
const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [700, 2200];

// Is this worth trying again, or would it fail identically every time?
//
// Retry: the request never reached the server at all (DNS failure, no
// route, timeout, connection reset -- uploadPhoto tags all of these "Could
// not reach"), or the server said the problem was on its end (5xx).
//
// Don't retry: the server understood the request and refused it (other
// 4xx), or replied with something unparseable. Those give the same answer
// on the third attempt as on the first, and retrying only delays the error.
function isWorthRetrying(detail: string): boolean {
  if (detail.includes('Could not reach')) return true;
  return /HTTP 5\d\d/.test(detail);
}

// Uploads one photo, retrying transient failures.
//
// There is no longer a 401/403 special case. That branch existed to
// refresh an expired upload ticket; the ticket is gone, and a 401/403 now
// means the seller's session is the problem -- which retrying identically
// cannot fix, and which isWorthRetrying already declines to retry.
async function uploadPhotoResilient(uri: string): Promise<string> {
  let lastDetail = '';

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await uploadPhoto(uri);
    } catch (e: any) {
      lastDetail = e?.message || String(e);
      if (attempt >= UPLOAD_ATTEMPTS || !isWorthRetrying(lastDetail)) break;
      console.warn(`[photoUpload] attempt ${attempt} failed, retrying:`, lastDetail);
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }

  throw new Error(lastDetail);
}

// Uploads several photos. One bad photo still doesn't block the rest -- but
// the seller is now TOLD when something failed, and a photo is only given
// up on after failing several times (see uploadPhotoResilient).
//
// This used to swallow every error silently, on the reasoning that the
// listing had been saved either way. The effect was that a listing could be
// published with none of its photos and nothing to indicate anything had
// gone wrong -- indistinguishable from success until the listing showed up
// blank on both the app and the website.
//
// It then reported failures but still gave up after ONE attempt, so a
// single dropped DNS lookup cost the seller that photo permanently. That is
// exactly what happened on a real phone: one photo uploaded, the next two
// hit "Unable to resolve host vevaty.com" a second later, and the listing
// published with nothing to show. Mobile connections in Lebanon drop
// packets; one attempt was never enough.
export async function uploadPhotos(localUris: string[]): Promise<string[]> {
  const urls: string[] = [];
  const failures: string[] = [];

  for (const uri of localUris) {
    try {
      urls.push(await uploadPhotoResilient(uri));
    } catch (e: any) {
      const detail = e?.message || String(e);
      failures.push(detail);
      console.warn('[photoUpload] gave up:', detail);
    }
  }

  if (failures.length > 0) {
    // Lead with what the seller can actually do about it. The technical
    // detail stays -- it is what made the FormData bug diagnosable from a
    // screenshot -- but it is no longer the first thing they read, because
    // "Unable to resolve host" is not an instruction.
    Alert.alert(
      'Some photos didn’t upload',
      `${failures.length} of ${localUris.length} photo(s) couldn’t be uploaded, so the listing was saved without them. ` +
        `This is usually a patchy connection — open the listing, tap Edit and add them again.\n\n${failures[0]}`
    );
  }

  return urls;
}
