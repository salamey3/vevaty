import { supabase } from './supabase';

// Client for the moderate-listing edge function -- the AI first pass behind
// content moderation. Deliberately fire-and-forget from the caller's point
// of view (see AppStore.tsx's addListing/updateListing): the seller is
// already looking at their own newly-posted "pending review" listing by the
// time this would resolve, so there's nothing useful to await it for. The
// edge function itself writes the outcome straight back to the listing row
// (status/moderation_status/moderation_reason) using the service-role key,
// which is what actually makes the listing go live -- this call just kicks
// that off and is safe to ignore the result of.
//
// AN ID, AND NOTHING ELSE (16 Sep 2026). This used to hand over the photos
// as base64 along with the title and description, and the function judged
// what it was given -- so what was checked and what was published were two
// different things, and a seller could choose both. It now reads the
// listing's own stored photos and text; see @MEDIA.md, "The check believed
// its caller". Sending them was also a second upload of every photo, on
// top of the one that put them on the CDN, from a phone on a Lebanese
// mobile connection.
export async function triggerListingModeration(listingId: string): Promise<void> {
  try {
    await supabase.functions.invoke('moderate-listing', { body: { listingId } });
  } catch {
    // Best-effort -- if this fails outright (network blip, function down),
    // the listing just stays 'pending_review' and surfaces to a human
    // moderator eventually via AdminModerationScreen's normal "not yet
    // resolved" view rather than being silently lost. Nothing for the
    // caller to react to here.
  }
}
