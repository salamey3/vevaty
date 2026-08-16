import { Platform } from 'react-native';
import { resizePhotoForUpload } from './imageToBase64';

// Listing photos are hosted on the same ChemiCloud domain the app itself is
// served from (vevaty.com/upload.php), not Supabase Storage —
// keeps photo storage off the shared Supabase project's limits entirely.
// NOTE: this must stay in lockstep with the domain the app is actually
// deployed/live on -- do not flip this to vevaty.com until vevaty.com is
// confirmed resolving to this same hosting account (upload.php present at
// its docroot), or photo uploads will break for every visitor.
const UPLOAD_URL = 'https://vevaty.com/upload.php';
const UPLOAD_TOKEN = 'myazar_upload_9f2c7a1d';

// Uploads one local photo (a device file URI on native, or a blob:/data:
// URI on web) and returns its new public URL on vevaty.com.
export async function uploadPhoto(localUri: string): Promise<string> {
  const form = new FormData();
  form.append('token', UPLOAD_TOKEN);

  // upload.php serves back whatever it's given with no server-side
  // resizing, and every card/carousel in the app requests that same
  // full-size original just to paint a ~148px-wide thumbnail -- capping the
  // longest edge here (once, before it ever leaves the device) is what
  // actually fixes that mismatch, instead of every future upload repeating
  // the same "dozens of multi-megabyte photos loading at once" jank a
  // screen recording caught on the existing listings. Falls back to the
  // original URI if resizing fails for any reason (see resizePhotoForUpload).
  const uri = await resizePhotoForUpload(localUri);

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    form.append('photo', blob, 'photo.jpg');
  } else {
    // React Native's FormData/XHR implementation uploads a local file when
    // given this { uri, name, type } shape -- not an actual Blob object.
    form.append('photo', {
      uri,
      name: 'photo.jpg',
      type: 'image/jpeg',
    } as any);
  }

  const res = await fetch(UPLOAD_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  const data = await res.json();
  if (!data.url) throw new Error('Photo upload did not return a URL');
  return data.url as string;
}

// Uploads several photos, skipping (not throwing on) any individual photo
// that fails, so one bad upload doesn't block the rest.
export async function uploadPhotos(localUris: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const uri of localUris) {
    try {
      urls.push(await uploadPhoto(uri));
    } catch (e) {
      // Best-effort — the listing itself was already saved either way.
    }
  }
  return urls;
}
