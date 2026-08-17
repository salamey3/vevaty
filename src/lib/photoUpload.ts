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

// Uploads several photos. One bad photo still doesn't block the rest -- but
// the seller is now TOLD when something failed.
//
// This used to swallow every error silently, on the reasoning that the
// listing had been saved either way. The effect was that a listing could be
// published with none of its photos and nothing to indicate anything had
// gone wrong -- indistinguishable from success until the listing showed up
// blank on both the app and the website.
export async function uploadPhotos(localUris: string[]): Promise<string[]> {
  const urls: string[] = [];
  const failures: string[] = [];

  for (const uri of localUris) {
    try {
      urls.push(await uploadPhoto(uri));
    } catch (e: any) {
      const detail = e?.message || String(e);

      // A 403 from upload.php means the ticket was refused -- almost always
      // because it expired mid-post (a slow connection, or the seller left
      // the screen open a while). Throw the cached ticket away and try this
      // photo once more with a fresh one, rather than reusing credentials
      // the server has already rejected and failing every remaining photo
      // for the same stale reason.
      if (detail.includes('HTTP 403')) {
        clearUploadTicket();
        try {
          urls.push(await uploadPhoto(uri));
          continue;
        } catch (retryErr: any) {
          const retryDetail = retryErr?.message || String(retryErr);
          failures.push(retryDetail);
          console.warn('[photoUpload] failed after ticket refresh:', retryDetail);
          continue;
        }
      }

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
