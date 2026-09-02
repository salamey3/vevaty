import { supabase } from './supabase';
import { uploadPhotos } from './photoUpload';
import { SpinSet } from '../types';

// Writing a listing's 360 spin sets.
//
// This lives here rather than in AppStore because it is no longer only the
// seller's flow that needs it: an auction lot built by an admin is a
// listing like any other, and the whole point of a lot BEING a listing is
// that the media pipeline is shared (@AUCTIONS.md). Two nearly-identical
// copies of this loop already existed inside AppStore -- one for a brand
// new listing, one for an edit -- and a third inside the admin screen
// would have been the copy that drifted.
//
// A spin set is two levels deep, which is why it cannot go through the
// flat photo helpers: the myazar.listing_spin_sets row (label, order) has
// to exist before its frames can point at it, and the frames are ordinary
// listing_photos rows with kind='spin' and a spin_set_id.

// A spin below this many frames stutters rather than turns; above it the
// upload cost stops buying anything a viewer can see. Both live here
// rather than in the create-listing wizard because the admin auction
// screens capture spins too, through the same CameraCapture component.
export const SPIN_MIN_FRAMES = 12;
export const SPIN_MAX_FRAMES = 24;

// Frames may be a mix of already-hosted URLs (kept from a previous save)
// and local URIs just picked. Only the local ones are uploaded; the hosted
// ones are re-inserted as rows under the new set id, because the caller
// that replaces a listing's sets has just cascade-deleted the old rows.
export async function writeSpinSets(
  listingId: string,
  sets: SpinSet[],
  opts: { startSortOrder?: number; strict?: boolean; silent?: boolean } = {}
): Promise<SpinSet[]> {
  const start = opts.startSortOrder ?? 0;
  // A set with no frames is somebody who started one and backed out. There
  // is nothing to create a row for.
  const nonEmpty = sets.filter((s) => s.frames.length > 0);
  const results: SpinSet[] = [];

  for (let i = 0; i < nonEmpty.length; i++) {
    const set = nonEmpty[i];
    const { data: setRow, error: setError } = await supabase
      .from('listing_spin_sets')
      .insert({ listing_id: listingId, label: set.label, sort_order: start + i })
      .select()
      .single();
    if (setError || !setRow) {
      // Best-effort by default -- the same spirit as uploadPhotos skipping
      // a frame it could not send, so one bad set in a seller's save does
      // not lose the rest. `strict` is for a caller writing ONE set that
      // has something to say about it: swallowing an RLS denial here is
      // what turned "this item belongs to another seller" into "check your
      // connection", which an admin will retry for ever.
      if (opts.strict) throw setError || new Error('The 360 set could not be created.');
      continue;
    }

    const hostedKept = set.frames.filter((p) => /^https?:\/\//.test(p));
    const localNew = set.frames.filter((p) => !/^https?:\/\//.test(p));
    // `silent` where the caller owns the message: uploadPhotos' own alert
    // tells the reader to open the listing and tap Edit, which is not a
    // thing that can be done to an auction lot.
    const uploadedUrls = localNew.length > 0 ? await uploadPhotos(localNew, { silent: opts.silent }) : [];
    const allUrls = [...hostedKept, ...uploadedUrls];

    // uploadPhotos never rejects -- it alerts and resolves with fewer, or
    // with none. A set row that ends up with no frames is worse than no
    // set at all: it renders as an empty 360 tab, it takes a sort_order,
    // and nothing in the product can tell it apart from a real one. So it
    // goes back out rather than being left behind.
    if (allUrls.length === 0) {
      await supabase.from('listing_spin_sets').delete().eq('id', setRow.id);
      if (opts.strict) throw new Error('None of the frames uploaded, so the 360 set was not created.');
      continue;
    }

    const { error: framesError } = await supabase.from('listing_photos').insert(
      allUrls.map((url, frameIdx) => ({
        listing_id: listingId,
        url,
        sort_order: frameIdx,
        kind: 'spin',
        spin_set_id: setRow.id,
      }))
    );
    if (framesError) {
      // Same reasoning: a set whose frames did not land is an empty set.
      // Discarding it is the only outcome that leaves the listing honest.
      await supabase.from('listing_spin_sets').delete().eq('id', setRow.id);
      if (opts.strict) throw framesError;
      continue;
    }

    results.push({ id: setRow.id, label: set.label, frames: allUrls });
  }
  return results;
}

// Removing one set. The frames go with it: listing_photos.spin_set_id is
// ON DELETE CASCADE, so there is deliberately no second delete here -- one
// written by hand would be the one that gets out of step with the schema.
export async function deleteSpinSet(setId: string): Promise<void> {
  const { error } = await supabase.from('listing_spin_sets').delete().eq('id', setId);
  if (error) throw error;
}

// The sort_order a newly added set should take.
//
// max + 1, deliberately NOT a count. With a count, removing a set in the
// middle makes the next one collide with a survivor: three sets at 0/1/2,
// delete the one at 1, and a count of 2 puts the new set at 2 alongside the
// existing one -- so their order on screen comes down to whatever the
// database felt like returning, which is the exact thing this function was
// added to prevent. It is also what the label is derived from, so two sets
// cannot end up named the same either.
export async function nextSpinSortOrder(listingId: string): Promise<number> {
  const { data, error } = await supabase
    .from('listing_spin_sets')
    .select('sort_order')
    .eq('listing_id', listingId)
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw error;
  const highest = data?.[0]?.sort_order;
  return typeof highest === 'number' ? highest + 1 : 0;
}
