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

interface ModeratePhoto {
  data: string;
  mediaType: string;
}

export async function triggerListingModeration(
  listingId: string,
  photos: ModeratePhoto[],
  title: string,
  description: string
): Promise<void> {
  try {
    await supabase.functions.invoke('moderate-listing', {
      body: { listingId, photos, title, description },
    });
  } catch {
    // Best-effort -- if this fails outright (network blip, function down),
    // the listing just stays 'pending_review' and surfaces to a human
    // moderator eventually via AdminModerationScreen's normal "not yet
    // resolved" view rather than being silently lost. Nothing for the
    // caller to react to here.
  }
}
