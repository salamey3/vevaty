import { supabase } from './supabase';

// A short-lived permission slip for uploading photos to vevaty.com.
//
// The app used to carry a fixed shared token (`myazar_upload_9f2c7a1d`)
// straight to upload.php. That token shipped inside the public website
// bundle, the public GitHub repo and the Android APK, so anyone who opened
// vevaty.com could read it and post images to the hosting account
// indefinitely -- an anonymous image host on someone else's domain, with
// their disk and their name attached.
//
// Now the app holds no secret at all. It asks the `sign-upload` Supabase
// function for a ticket; Supabase verifies the caller is signed in before
// the function even runs, and the function refuses anonymous accounts. The
// ticket is a timestamp plus an HMAC signature that upload.php can check
// against the same secret, which exists only on the server side.
export type UploadTicket = { expires: number; signature: string };

// Tickets last ten minutes (see the function). Posting a listing uploads
// several photos in a row, so one ticket is reused for the whole burst
// rather than making a round trip per photo.
let cached: UploadTicket | null = null;

// Treat a ticket as spent slightly before it actually expires, so a slow
// upload that starts just under the wire doesn't land just over it.
const SAFETY_MARGIN_SECONDS = 60;

export async function getUploadTicket(): Promise<UploadTicket> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - now > SAFETY_MARGIN_SECONDS) return cached;

  const { data, error } = await supabase.functions.invoke('sign-upload');

  if (error) {
    // The commonest real cause is being signed out, so say that rather than
    // surfacing a bare HTTP status the seller can't act on.
    throw new Error(
      `Could not get permission to upload photos.\n${error.message || String(error)}\n` +
        `If you were signed out, sign in and try again.`
    );
  }
  if (typeof data?.expires !== 'number' || typeof data?.signature !== 'string') {
    throw new Error('Upload permission response was not in the expected form.');
  }

  cached = { expires: data.expires, signature: data.signature };
  return cached;
}

// Called when a ticket is rejected, so the next attempt fetches a fresh one
// instead of retrying with the same rejected credentials.
export function clearUploadTicket() {
  cached = null;
}
