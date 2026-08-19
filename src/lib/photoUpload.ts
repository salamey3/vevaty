import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { resizePhotoForUpload } from './imageToBase64';
import { getUploadTicket, clearUploadTicket } from './uploadTicket';
import { Alert } from './alertShim';

// Listing photos are hosted on the same ChemiCloud domain the app itself is
// served from (vevaty.com/upload.php), not Supabase Storage —
// keeps photo storage off the shared Supabase project's limits entirely.
const UPLOAD_URL = 'https://vevaty.com/upload.php';

// upload.php expects the image under the field name `photo`, plus the two
// fields of a signed ticket (`expires` and `signature`) obtained from the
// sign-upload function. No shared secret is stored in the app -- see
// uploadTicket.ts for why the old baked-in token had to go.
const FILE_FIELD = 'photo';

// How many characters of the server's reply to quote back in an error.
// Enough for upload.php's JSON ({"error":"..."}) without pasting an entire
// HTML error page into a dialog.
const ERROR_BODY_CHARS = 300;

// Turns upload.php's reply into the hosted URL, or throws with the reply
// quoted. Shared by both platform paths so they fail identically.
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

// Uploads one local photo and returns its new public URL on vevaty.com.
//
// NATIVE USES expo-file-system's UPLOADER, NOT fetch + FormData. This is the
// whole reason photo upload never once worked from the app:
//
//   form.append('photo', { uri, name, type })   // <- what this used to do
//
// That `{ uri, name, type }` object is a React Native invention from the era
// when RN shipped its own loose FormData. React Native 0.86's FormData is
// spec-compliant and only accepts strings and real Blobs, so it rejects that
// shape outright with "Unsupported FormDataPart implementation" -- which is
// exactly what the app reported once failures stopped being swallowed. The
// server was never at fault: posting the same JPEG with curl returns 200 and
// a URL.
//
// expo-file-system's File.upload() does the multipart request natively,
// avoiding JS FormData entirely, and carries the ticket fields through
// `parameters`.
//
// Web keeps fetch + FormData, which is correct there: browsers have always
// had real Blobs, and that path has no equivalent problem.
export async function uploadPhoto(localUri: string): Promise<string> {
  // Cap the longest edge first -- upload.php stores whatever it is given at
  // full resolution, and the app then re-downloads that original just to
  // paint a small thumbnail. Falls back to the original URI if resizing
  // fails (see resizePhotoForUpload).
  const uri = await resizePhotoForUpload(localUri);

  const ticket = await getUploadTicket();

  if (Platform.OS === 'web') {
    const form = new FormData();
    form.append('expires', String(ticket.expires));
    form.append('signature', ticket.signature);
    const blob = await (await fetch(uri)).blob();
    form.append(FILE_FIELD, blob, 'photo.jpg');

    let res: Response;
    try {
      res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
    } catch (e: any) {
      throw new Error(`Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}`);
    }
    // Read once as text: a PHP fatal or HTML error page would make .json()
    // throw a parse error that hides the actual message.
    return urlFromResponse(res.status, await res.text());
  }

  const file = new File(uri);
  let result: { status: number; body: string };
  try {
    result = await file.upload(UPLOAD_URL, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: FILE_FIELD,
      mimeType: 'image/jpeg',
      parameters: { expires: String(ticket.expires), signature: ticket.signature },
    });
  } catch (e: any) {
    // Rejects only when the file can't be read or the request itself fails;
    // any completed HTTP response (including non-2xx) resolves instead.
    throw new Error(
      `Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}\nfile: ${uri}`
    );
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
// The 403 case is handled separately and deliberately does not consume the
// retry budget: it means the signed ticket expired mid-post, which is fixed
// by fetching a new ticket, not by waiting.
async function uploadPhotoResilient(uri: string): Promise<string> {
  let lastDetail = '';

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await uploadPhoto(uri);
    } catch (e: any) {
      lastDetail = e?.message || String(e);

      // Ticket refused -- almost always because it expired mid-post (a slow
      // connection, or the seller left the screen open a while). Throw the
      // cached ticket away and try once more with a fresh one, rather than
      // reusing credentials the server has already rejected and failing
      // every remaining photo for the same stale reason.
      if (lastDetail.includes('HTTP 403')) {
        clearUploadTicket();
        try {
          return await uploadPhoto(uri);
        } catch (retryErr: any) {
          lastDetail = retryErr?.message || String(retryErr);
        }
      }

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
