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
// A photo write that did not fully land.
//
// It exists because the alternative was silence. `persistNewPhotos` used to
// upload, insert, and return the urls WITHOUT checking the insert's error --
// so a refused write reported success, local state was updated as though the
// rows existed, and the seller's own device showed photos nobody else had.
// That is the third of the three ways a write reports success and changes
// nothing (@AGENTS.md), in the one table the audit that found the other six
// did not cover.
export type PhotoWriteStage = 'read' | 'upload' | 'insert' | 'delete' | 'reorder';

export class PhotoWriteError extends Error {
  // Where it broke, because each needs a different sentence. "Your photos
  // did not upload" is useless advice for a failed REORDER -- the photos
  // are all there, in the wrong order -- and the store used to say it for
  // every one of these.
  readonly stage: PhotoWriteStage;
  readonly wanted: number;
  readonly landed: number;
  constructor(stage: PhotoWriteStage, wanted: number, landed: number, detail?: string) {
    super(detail || `photo_${stage}_failed`);
    this.name = 'PhotoWriteError';
    this.stage = stage;
    this.wanted = wanted;
    this.landed = landed;
  }
}

// Inserting photo rows, with the retries the upload half already had and
// this half never did.
//
// uploadPhotoResilient retries each FILE three times because mobile
// connections here drop packets -- and then the single insert that records
// all of that work got one attempt and no error check. Same reasoning, same
// treatment: three attempts, short backoff, and a throw if it still fails so
// the caller cannot mistake it for success.
export async function insertPhotoRows(rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  // Every row in one call belongs to one listing -- the two callers build
  // the array that way -- and a multi-row INSERT is one statement, so it
  // either lands whole or not at all. That is what makes the
  // already-landed check below a correct test for "did the last attempt
  // actually get through".
  const first = rows[0];

  // Did the batch already land? Scoped by every column that distinguishes
  // one row from another with the same url, not just (listing_id, url):
  // writeSpinSets re-inserts already-hosted frames under a NEW
  // spin_set_id, so a url-only test would find the previous set's
  // surviving row and report a set with zero frames as written -- an
  // empty 360 tab, which is the one thing writeSpinSets goes out of its
  // way to avoid.
  //
  // Returns null for "could not tell", which is not the same as false and
  // must not be treated as one.
  const alreadyLanded = async (): Promise<boolean | null> => {
    let q = supabase
      .from('listing_photos')
      .select('id')
      .eq('listing_id', first.listing_id as string)
      .eq('url', first.url as string);
    if (first.kind !== undefined && first.kind !== null) q = q.eq('kind', first.kind as string);
    if (first.spin_set_id !== undefined && first.spin_set_id !== null) {
      q = q.eq('spin_set_id', first.spin_set_id as string);
    }
    const { data, error } = await q.limit(1);
    if (error) return null;
    return !!data && data.length > 0;
  };

  let lastMessage = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.from('listing_photos').insert(rows);
    if (!error) return;
    lastMessage = error.message || String(error);
    console.warn(`[listingMedia] photo row insert attempt ${attempt} failed:`, lastMessage);

    const permanent = isPermanentWriteError(error);

    // The dangerous failure is the TIMEOUT: supabase-js reports a dropped
    // connection the same way it reports a refusal, but the statement may
    // well have committed on the server. Inserting again would give the
    // listing every photo twice, and giving up would throw over a write
    // that actually worked. So ask.
    //
    // This runs after EVERY non-permanent failure, including the last one
    // -- an earlier draft checked only before a retry, so a third-attempt
    // timeout that had in fact committed threw anyway, and the caller
    // then refused to publish a listing whose photos were sitting in the
    // database. 23505 is the exception among the permanent codes: a
    // unique violation on a retry is the database telling us the rows are
    // already there, which is a success, not a failure.
    if (!permanent || error.code === '23505') {
      const landed = await alreadyLanded();
      if (landed === true) return;
      // "I could not look" is not "it is not there". Retrying on that
      // reading is how the duplicate gets written.
      if (landed === null) break;
    }

    // Retrying a permanent refusal is three times the wait for the same
    // answer. RLS denials, missing columns and constraint violations do
    // not become true by asking again.
    if (permanent) break;
    if (attempt >= 3) break;
    await new Promise((r) => setTimeout(r, attempt * 700));
  }
  throw new PhotoWriteError('insert', rows.length, 0, lastMessage);
}

// Errors that will not come out differently on the third try. Postgres
// codes come through PostgREST on `error.code`: 42501 is RLS/permission,
// 42703/42P01 are a column or table this build does not have, 23xxx is a
// constraint. PGRST codes are PostgREST's own request-level refusals.
// Errors that will not come out differently on the third try. Postgres
// codes come through PostgREST on `error.code`: class 42 is
// syntax/access (42501 RLS, 42703 unknown column, 42P01 unknown table),
// class 23 is integrity constraints, class 22 is a data exception (a
// value that will not fit the column). PGRST codes are PostgREST's own
// request-level refusals.
//
// An empty code is deliberately NOT permanent: postgrest-js leaves `code`
// unset for client-side failures (a dropped fetch, a non-JSON error body),
// which are exactly the ones worth retrying.
function isPermanentWriteError(error: { code?: string } | null): boolean {
  const code = error?.code || '';
  if (!code) return false;
  return (
    code.startsWith('22') ||
    code.startsWith('23') ||
    code.startsWith('42') ||
    code.startsWith('PGRST')
  );
}

export const SPIN_MIN_FRAMES = 12;
export const SPIN_MAX_FRAMES = 24;

// Frames may be a mix of already-hosted URLs (kept from a previous save)
// and local URIs just picked. Only the local ones are uploaded; the hosted
// ones are re-inserted as rows under the new set id, because the caller
// that replaces a listing's sets has just cascade-deleted the old rows.
// Throwing away a spin-set row whose frames never landed.
//
// Checked, because the delete is the whole point: an empty set renders as
// a 360 tab with nothing in it, holds a sort_order, and nothing in the
// product can tell it apart from a real one -- so a delete that silently
// did nothing leaves exactly the thing this code exists to prevent, live
// on a public listing, while the caller reports the set as not saved.
// (`.select()` because a delete that matches no row is not an error --
// @AGENTS.md. A seller can always read their own listing_spin_sets rows
// back, so the row count is conclusive here.)
//
// It only warns: the caller is already failing this set, and there is
// nothing better to do about an undeletable row than leave a trace.
async function discardEmptySpinSet(setId: string) {
  const { data, error } = await supabase
    .from('listing_spin_sets').delete().eq('id', setId).select('id');
  if (error || !data || data.length === 0) {
    console.warn(
      '[listingMedia] an empty 360 set survived its cleanup and is live on the listing:',
      setId,
      error?.message || 'no row matched'
    );
  }
}

export async function writeSpinSets(
  listingId: string,
  sets: SpinSet[],
  opts: {
    startSortOrder?: number;
    strict?: boolean;
    silent?: boolean;
    // Called with the number of frames that did not upload in a set that
    // was otherwise written. `silent` suppresses uploadPhotos' own alert
    // so the caller can say the sentence in the seller's language -- but
    // a PARTIAL shortfall left the set written with a short frame list
    // and nobody saying anything at all, which is a 360 that stutters
    // (below SPIN_MIN_FRAMES) with no explanation. The caller that asks
    // for silence has to be given the thing it silenced.
    onFramesMissing?: (count: number) => void;
  } = {}
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
    // Reported only when the shortfall actually costs the seller
    // something. A 24-frame spin that lost one frame still turns
    // perfectly, and telling them "the 360 spin was not saved" about a
    // spin that is on the listing and works is worse than saying nothing.
    // The line is SPIN_MIN_FRAMES -- below it the thing stutters instead
    // of turning, which is the whole reason that constant exists. Same
    // standard persistNewPhotos draws for the gallery: zero is a failure,
    // fewer than asked for is not.
    if (uploadedUrls.length < localNew.length && allUrls.length < SPIN_MIN_FRAMES) {
      opts.onFramesMissing?.(localNew.length - uploadedUrls.length);
    }

    // uploadPhotos never rejects -- it alerts and resolves with fewer, or
    // with none. A set row that ends up with no frames is worse than no
    // set at all: it renders as an empty 360 tab, it takes a sort_order,
    // and nothing in the product can tell it apart from a real one. So it
    // goes back out rather than being left behind.
    if (allUrls.length === 0) {
      await discardEmptySpinSet(setRow.id);
      if (opts.strict) throw new Error('None of the frames uploaded, so the 360 set was not created.');
      continue;
    }

    let framesError: unknown = null;
    try {
      await insertPhotoRows(
        allUrls.map((url, frameIdx) => ({
          listing_id: listingId,
          url,
          sort_order: frameIdx,
          kind: 'spin',
          spin_set_id: setRow.id,
        }))
      );
    } catch (e) {
      framesError = e;
    }
    if (framesError) {
      // Same reasoning: a set whose frames did not land is an empty set.
      // Discarding it is the only outcome that leaves the listing honest.
      await discardEmptySpinSet(setRow.id);
      if (opts.strict) throw framesError as Error;
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
