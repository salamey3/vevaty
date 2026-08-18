import { Platform } from 'react-native';
import * as tus from 'tus-js-client';
import { supabase } from './supabase';
import type { ListingVideo } from '../types';

// A listing's optional video, hosted on Bunny Stream.
//
// Photos go to vevaty.com/upload.php (see photoUpload.ts). Video does not,
// and shouldn't: a 60-second clip is two orders of magnitude larger than a
// photo, needs transcoding into something a phone can actually stream, and
// has to survive a Lebanese mobile connection dropping halfway through.
// Bunny does all three. The shared-hosting box does none of them.
//
// Deliberately first-party only -- no YouTube or TikTok links, unlike OLX.
// Besides consistent playback, an external video link is an off-platform
// contact channel: it routes a buyer to a bio link and straight around the
// chat and phone-reveal gating the rest of the app is built on.

// Public identifiers, exactly as public as the Supabase publishable key
// already sitting in supabase.ts. The Bunny API key -- which can delete
// every video in the library -- exists only inside the bunny-video-token
// edge function's environment, and never reaches any client.
export const BUNNY_LIBRARY_ID = '730683';
export const BUNNY_CDN_HOST = 'vz-7a0fc8e2-1e7.b-cdn.net';

// The Stream pull zone refuses any request that arrives without a Referer.
// Measured, not assumed: no Referer gets a 403, `https://vevaty.com/` gets a
// 200 -- and so does `https://example.com/`, so the rule is "block empty
// referrer" rather than a domain allowlist, and it is protecting nothing at
// all (every hotlinker sends one).
//
// A browser sends this by itself. A native player does not, which is why the
// app showed a black frame and no thumbnail: every file 403'd. Sending it
// explicitly on native costs nothing and keeps the app working whether or not
// that CDN setting is ever changed.
export const BUNNY_REFERER = 'https://vevaty.com/';
export const BUNNY_MEDIA_HEADERS: Record<string, string> = { Referer: BUNNY_REFERER };

// The agreed product rule: one video per listing, a minute at most.
export const MAX_VIDEO_SECONDS = 60;

// Backstop for a device that reports no duration at all. A phone recording
// at 4K produces roughly 400MB a minute, so without a ceiling somewhere a
// seller can start an upload that will never finish on mobile data.
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

// The shape itself lives on the Listing type, so every consumer of a
// listing sees the same definition rather than two that can drift.
export type VideoStatus = ListingVideo['status'];

// Bunny publishes each video under a folder named after its guid. Nothing is
// stored in our database except that guid -- every URL below is derived, so
// there are no stale URLs to migrate if the CDN hostname ever changes.
export function videoThumbnailUrl(guid: string): string {
  return `https://${BUNNY_CDN_HOST}/${guid}/thumbnail.jpg`;
}

export function videoPreviewUrl(guid: string): string {
  return `https://${BUNNY_CDN_HOST}/${guid}/preview.webp`;
}

// The adaptive HLS playlist. Used on native, where the platform player
// handles HLS itself: playback starts after one short segment instead of
// after enough of a single file to decode, and the bitrate adapts on mobile
// data instead of committing to one rendition up front.
//
// Not used on web: expo-video's web build has no HLS support at all (no
// hls.js, nothing), so a browser other than Safari would simply refuse this
// URL. Web uses the MP4 below.
export function videoStreamUrl(guid: string): string {
  return `https://${BUNNY_CDN_HOST}/${guid}/playlist.m3u8`;
}

// The MP4 fallback, for web. Verified faststart (the moov box comes before
// mdat), so a browser can begin playing from a partial download rather than
// waiting for the whole file.
//
// Two heights matter and they are different things. `sourceHeight` is what
// Bunny reports for the original: Bunny never upscales, so a clip shot at
// 480p has no 720p rendition and asking for one 404s. `maxHeight` is how big
// the player actually is on screen -- there is no point pulling 720p into a
// 350px-wide phone browser, it just costs the seller's buyer three times the
// data for no visible difference.
export function videoPlaybackUrl(
  guid: string,
  sourceHeight: number | null,
  maxHeight?: number
): string {
  const available = sourceHeight ?? 0;
  const wanted = maxHeight ?? 720;
  const rendition = available >= 700 && wanted >= 700 ? '720p' : '360p';
  return `https://${BUNNY_CDN_HOST}/${guid}/play_${rendition}.mp4`;
}

interface UploadTicket {
  libraryId: string;
  videoId: string;
  expirationTime: number;
  signature: string;
}

// Asks our server to create the video object and sign one upload for it.
// Deliberately not cached, unlike the photo ticket: a photo ticket
// authorises a burst of uploads to one endpoint, but this signature is
// bound to a single specific video guid and is worthless for any other.
export async function createVideoUploadTicket(opts: {
  title?: string;
  listingId?: string | null;
}): Promise<UploadTicket> {
  const { data, error } = await supabase.functions.invoke('bunny-video-token', {
    body: { title: opts.title, listingId: opts.listingId ?? null },
  });

  if (error) {
    // supabase-js throws away the response body on a non-2xx and hands back
    // the useless "Edge Function returned a non-2xx status code". The actual
    // reason is on `error.context`, which is the raw Response -- so read it.
    // "You can add 10 videos a day" is something a seller can act on; a
    // status-code sentence is not.
    let detail = error.message || String(error);
    const response = (error as any)?.context;
    if (response && typeof response.text === 'function') {
      try {
        const body = await response.text();
        const parsed = JSON.parse(body);
        detail = parsed?.message || parsed?.error || body.slice(0, 200) || detail;
      } catch {
        // Leave the generic message rather than replacing it with noise.
      }
    }
    throw new Error(detail);
  }
  if (!data?.videoId || !data?.signature) {
    throw new Error('The upload permission response was not in the expected form.');
  }
  return data as UploadTicket;
}

// How much is sent per request. Left explicit rather than using tus's
// default of "the whole file in one PATCH", because on a phone that means
// one enormous request that has to start again from zero if the connection
// blinks -- which on mobile data here it will.
const CHUNK_BYTES = 6 * 1024 * 1024;

export interface UploadHandle {
  abort: () => void;
}

// Uploads the local file to Bunny and resolves when Bunny has all the bytes.
// Encoding happens afterwards and is reported separately (see the webhook
// edge function) -- this resolving does NOT mean the video is playable yet.
export function uploadVideoToBunny(
  localUri: string,
  ticket: UploadTicket,
  opts: {
    mimeType?: string | null;
    title?: string;
    onProgress?: (fraction: number) => void;
  } = {}
): { promise: Promise<void>; handle: UploadHandle } {
  let upload: tus.Upload | null = null;

  const promise = new Promise<void>((resolve, reject) => {
    (async () => {
      // On web the picker hands back a blob: URL, which fetch can read. On
      // native, tus-js-client takes a { uri } object directly and reads the
      // file itself -- do NOT try to build a Blob or FormData by hand here.
      // React Native 0.86's FormData is spec-compliant and rejects RN's old
      // { uri, name, type } shape, which is exactly the bug that meant photo
      // upload never once worked from the app (see photoUpload.ts).
      const source: any =
        Platform.OS === 'web' ? await (await fetch(localUri)).blob() : { uri: localUri };

      upload = new tus.Upload(source, {
        endpoint: 'https://video.bunnycdn.com/tusupload',
        // Bunny's own recommended ladder. The long tail matters: a seller
        // walking out of wifi shouldn't lose a half-finished upload.
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
        chunkSize: CHUNK_BYTES,
        removeFingerprintOnSuccess: true,
        headers: {
          AuthorizationSignature: ticket.signature,
          AuthorizationExpire: String(ticket.expirationTime),
          VideoId: ticket.videoId,
          LibraryId: ticket.libraryId,
        },
        metadata: {
          filetype: opts.mimeType || 'video/mp4',
          title: opts.title || 'Vevaty listing video',
        },
        onProgress: (sent: number, total: number) => {
          if (total > 0) opts.onProgress?.(sent / total);
        },
        onError: (err: any) => reject(new Error(err?.message || String(err))),
        onSuccess: () => resolve(),
      });

      upload.start();
    })().catch((e) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  return { promise, handle: { abort: () => { try { upload?.abort(true); } catch { /* already gone */ } } } };
}

// Asks the webhook function to re-read this video's real state from Bunny
// and write it to our row.
//
// It looks odd to call a webhook endpoint from the client, but it is the
// right one to call: that function ignores whatever the caller claims and
// goes and reads the truth from Bunny itself, so it cannot be used to lie a
// status into a listing. Bunny does not document whether it retries a failed
// callback, and a video stuck on "processing" forever because one HTTP
// request was dropped is a much worse failure than an extra poll.
export async function nudgeVideoStatus(guid: string): Promise<void> {
  try {
    await fetch(
      `https://ueqfkxvvfrhppdsnsfpx.supabase.co/functions/v1/bunny-video-webhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ VideoGuid: guid, VideoLibraryId: Number(BUNNY_LIBRARY_ID) }),
      }
    );
  } catch {
    // Best effort. The next screen visit tries again.
  }
}

// Reads our own row back. Used after a nudge, and by the create screen while
// the seller is still filling in the rest of the listing.
export async function fetchVideoStatus(guid: string): Promise<ListingVideo | null> {
  const { data, error } = await supabase
    .from('listing_videos')
    .select('bunny_guid, status, duration_s, width, height')
    .eq('bunny_guid', guid)
    .maybeSingle();
  if (error || !data) return null;
  return {
    guid: data.bunny_guid,
    status: data.status as VideoStatus,
    durationS: data.duration_s != null ? Number(data.duration_s) : null,
    width: data.width != null ? Number(data.width) : null,
    height: data.height != null ? Number(data.height) : null,
  };
}

// Removes a video from both our table and Bunny's library. Deleting only our
// row would leave the file on Bunny being paid for forever with nothing
// pointing at it.
export async function deleteVideo(guid: string): Promise<void> {
  const { error } = await supabase.functions.invoke('bunny-video-delete', {
    body: { videoId: guid },
  });
  if (error) throw new Error(error.message || String(error));
}

// Links an already-uploaded video to a listing once that listing exists.
// The upload starts while the seller is still in the wizard, so at upload
// time there is no listing row to point at yet.
export async function attachVideoToListing(guid: string, listingId: string): Promise<void> {
  await supabase.from('listing_videos').update({ listing_id: listingId }).eq('bunny_guid', guid);
}

// How long a clip is, in seconds, or null if the platform won't say.
//
// The 60-second rule cannot be enforced while recording -- neither the web
// capture attribute nor Android's system camera takes a limit from us -- so
// it is checked here, after the file exists and before a single byte is
// sent. Better to refuse in a sentence than to spend ten minutes of someone's
// mobile data and then refuse.
export async function measureVideoSeconds(
  uri: string,
  assetDurationMs?: number | null
): Promise<number | null> {
  if (typeof assetDurationMs === 'number' && assetDurationMs > 0) return assetDurationMs / 1000;
  if (Platform.OS !== 'web') return null;
  return new Promise((resolve) => {
    try {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : null);
      el.onerror = () => resolve(null);
      el.src = uri;
    } catch {
      resolve(null);
    }
  });
}
