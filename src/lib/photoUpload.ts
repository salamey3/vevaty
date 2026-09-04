import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { resizePhotoForUpload, resizeThumbnailForUpload } from './imageToBase64';
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
// POSTs an already-resized local file to the upload-photo function and
// returns its hosted CDN URL. Shared by uploadPhoto (one file) and
// uploadPhotoWithThumbnail (two files -- the full photo and its thumbnail,
// each just a differently-resized local URI by the time it reaches here).
// A request that never answers is not an error, and until this change
// nothing noticed. `fetch` on web has no timeout at all, expo-file-system's
// uploader none either, and uploadPhotoResilient only retries FAILURES --
// so a connection that stalled mid-body simply never came back.
//
// That was survivable while uploads were fire-and-forget. They are not any
// more: CreateListingScreen's Post in edit mode and BatchFinalReviewScreen
// both wait on them, and BatchPhotosScreen holds its Next button while one
// is in flight. A hung request now parks the seller on a spinner with no
// way out but a reload, losing the form.
//
// Generous rather than tight -- these are photos over a Lebanese mobile
// connection -- but NOT retried, which is what keeps the arithmetic sane.
// A link that went quiet for a whole minute goes quiet again; three
// attempts at it is three minutes per photo and, since the gallery
// uploads run one after another, half an hour on an uncancellable
// spinner for a six-photo listing. See isWorthRetrying.
const UPLOAD_TIMEOUT_MS = 60_000;
// The marker isWorthRetrying looks for. Deliberately distinct from the
// "Could not reach" wrapper every other transport failure carries, which
// IS worth retrying.
const TIMED_OUT = 'the upload did not answer in time';

function uploadTimeout(): AbortSignal | undefined {
  // AbortSignal.timeout is not in every runtime this ships to; without it
  // the upload behaves exactly as it did before, which is the current
  // behaviour and not a regression.
  const AS = (globalThis as any).AbortSignal;
  if (AS && typeof AS.timeout === 'function') return AS.timeout(UPLOAD_TIMEOUT_MS) as AbortSignal;
  if (typeof AbortController === 'function') {
    const c = new AbortController();
    setTimeout(() => c.abort(), UPLOAD_TIMEOUT_MS);
    return c.signal;
  }
  return undefined;
}

async function uploadResizedUri(uri: string): Promise<string> {
  const headers = await authHeaders('image/jpeg');

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    let res: Response;
    try {
      res = await fetch(UPLOAD_URL, { method: 'POST', body: blob, headers, signal: uploadTimeout() });
    } catch (e: any) {
      // An abort is reported as a timeout, not as "could not reach": the
      // two want different treatment from isWorthRetrying.
      if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw new Error(TIMED_OUT);
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
    // Raced against a timeout rather than given one: expo-file-system's
    // uploader takes no signal, so the only way to stop waiting on it is
    // to stop waiting. The request itself carries on in the background and
    // is harmless -- a photo that lands late is a row nothing inserts.
    result = await Promise.race([
      file.upload(UPLOAD_URL, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        headers,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(TIMED_OUT)), UPLOAD_TIMEOUT_MS)
      ),
    ]);
  } catch (e: any) {
    // Rejects only when the file can't be read or the request itself
    // fails; any completed HTTP response (including non-2xx) resolves.
    if (e?.message === TIMED_OUT) throw e;
    throw new Error(`Could not reach ${UPLOAD_URL}\n${e?.message || String(e)}\nfile: ${uri}`);
  }
  return urlFromResponse(result.status, result.body);
}

export async function uploadPhoto(localUri: string): Promise<string> {
  // Cap the longest edge first -- the CDN serves back whatever it is
  // given, and a 4000x3000 camera original is several MB to paint a
  // 148px card. Falls back to the original URI if resizing fails.
  const uri = await resizePhotoForUpload(localUri);
  return uploadResizedUri(uri);
}

// Uploads a photo AND a separate, genuinely small thumbnail meant for
// listing cards (see resizeThumbnailForUpload's own comment for why the
// thumbnail has to be a real second file rather than a fetch-time resize).
// Used only for a listing's gallery photos -- the ones a card can actually
// show as its cover -- not for spin-viewer frames, which a card never
// renders. Resizing both variants and uploading both happen in parallel:
// two small independent requests, not one blocking the other.
export async function uploadPhotoWithThumbnail(localUri: string): Promise<{ url: string; thumbnailUrl: string }> {
  const [fullUri, thumbUri] = await Promise.all([
    resizePhotoForUpload(localUri),
    resizeThumbnailForUpload(localUri),
  ]);
  const [url, thumbnailUrl] = await Promise.all([uploadResizedUri(fullUri), uploadResizedUri(thumbUri)]);
  return { url, thumbnailUrl };
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
  // A TIMEOUT is not retried. The whole point of the timeout is to bound
  // how long a seller waits, and retrying it multiplies the bound by
  // UPLOAD_ATTEMPTS and then again by the number of photos -- three
  // attempts at 60s across six photos is eighteen minutes on a spinner
  // that cannot be cancelled. A link that went silent for a minute is
  // not going to answer on the second ask.
  if (detail.includes(TIMED_OUT)) return false;
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
// `silent` suppresses the alert below, for a caller that owns the message
// itself. The sentence here is written for a seller posting a listing and
// is actively wrong elsewhere: it tells the reader to open the listing and
// tap Edit, which no screen in this app can do for an auction lot. A caller
// that has a better sentence should say it instead of after it.
export async function uploadPhotos(
  localUris: string[],
  opts: { silent?: boolean } = {}
): Promise<string[]> {
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

  if (failures.length > 0 && !opts.silent) {
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

// Same retry shape as uploadPhotoResilient, for uploadPhotoWithThumbnail.
async function uploadPhotoWithThumbnailResilient(uri: string): Promise<{ url: string; thumbnailUrl: string }> {
  let lastDetail = '';

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await uploadPhotoWithThumbnail(uri);
    } catch (e: any) {
      lastDetail = e?.message || String(e);
      if (attempt >= UPLOAD_ATTEMPTS || !isWorthRetrying(lastDetail)) break;
      console.warn(`[photoUpload] attempt ${attempt} failed, retrying:`, lastDetail);
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }
  }

  throw new Error(lastDetail);
}

// Same shape as uploadPhotos (partial failure doesn't block the rest, the
// seller is told if anything failed, each photo gets several attempts) --
// for a listing's gallery photos specifically, where each one also needs a
// small thumbnail uploaded alongside it. See uploadPhotoWithThumbnail.
//
// `silent` mirrors uploadPhotos' own, and for the same reason plus one
// more: AlertHost holds exactly ONE alert with no queue (@AGENTS.md), so
// when the store also has something to say about the same failure -- and
// it now does, in the seller's own language rather than this hardcoded
// English -- the two fire a few hundred milliseconds apart and the first
// is silently destroyed. Which one the seller reads came down to how long
// the insert took.
//
// Each result carries the `uri` it came FROM, which matters because this
// function COMPACTS: a failed photo is skipped, so `uploaded[i]` is not
// `localUris[i]` the moment anything fails. A caller that needs to know
// which upload became which url -- syncPhotoKind does, to write the
// listing back in the order the seller arranged -- cannot recover that
// from position, and pairing by index silently attached each surviving
// url to an earlier photo's slot.
export async function uploadPhotosWithThumbnails(
  localUris: string[],
  opts: { silent?: boolean } = {}
): Promise<{ uri: string; url: string; thumbnailUrl: string }[]> {
  const uploaded: { uri: string; url: string; thumbnailUrl: string }[] = [];
  const failures: string[] = [];

  for (const uri of localUris) {
    try {
      uploaded.push({ uri, ...(await uploadPhotoWithThumbnailResilient(uri)) });
    } catch (e: any) {
      const detail = e?.message || String(e);
      failures.push(detail);
      console.warn('[photoUpload] gave up:', detail);
    }
  }

  if (failures.length > 0 && !opts.silent) {
    Alert.alert(
      'Some photos didn’t upload',
      `${failures.length} of ${localUris.length} photo(s) couldn’t be uploaded, so the listing was saved without them. ` +
        `This is usually a patchy connection — open the listing, tap Edit and add them again.\n\n${failures[0]}`
    );
  }

  return uploaded;
}
