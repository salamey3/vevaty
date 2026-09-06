import { supabase } from './supabase';

// Buyer reviews of sellers.
//
// Every call here is an RPC rather than a table read or write, and that is
// not a style choice. The GATE -- has this buyer actually dealt with this
// seller -- is checked against `listing_contact_events` and `chat_threads`,
// neither of which a buyer may select for themselves. Putting the check in
// an RLS policy would mean granting that access, and the policy could then
// only test what the client asserted about itself. So the check lives on
// the server and the tables stay closed.
//
// The gate is CONTACT, not a completed sale: a buyer either revealed the
// seller's phone number (which get_seller_phone logs for exactly this
// reason) or opened a chat thread on the listing. The reviews table used
// to be keyed to a transaction, and transactions are payment records --
// which do not exist yet, so no review could ever honestly be written.

export type ReviewGateReason =
  | 'ok'
  | 'already_reviewed'
  | 'not_signed_in'
  | 'not_verified'
  | 'own_listing'
  | 'no_contact'
  | 'listing_not_found';

export type ReviewGate = {
  canReview: boolean;
  reason: ReviewGateReason;
  // Present only when reason is 'already_reviewed' -- what they wrote last
  // time, so the sheet opens on it rather than on a blank form.
  rating: number | null;
  comment: string | null;
};

export type SellerReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  // The review was changed after it was first written. A minute of grace,
  // because the insert and its own updated_at are the same moment.
  edited: boolean;
  reviewerName: string | null;
  listingId: string | null;
  listingTitleEn: string | null;
  listingTitleAr: string | null;
};

export type ReviewErrorCode =
  | ReviewGateReason | 'rating_invalid' | 'comment_too_long' | 'unknown';

// A real Error, not a bare object: anything generic that catches this --
// an unhandled-rejection handler, a log line reading e.message -- gets a
// diagnostic rather than `{}`.
export class ReviewError extends Error {
  code: ReviewErrorCode;
  constructor(code: ReviewErrorCode) {
    super(code);
    this.name = 'ReviewError';
    this.code = code;
  }
}

const GATE_REASONS: ReviewGateReason[] = [
  'ok', 'already_reviewed', 'not_signed_in', 'not_verified',
  'own_listing', 'no_contact', 'listing_not_found',
];

function toReason(raw: any): ReviewGateReason {
  return GATE_REASONS.includes(raw) ? raw : 'listing_not_found';
}

// What the screen needs before deciding whether to offer the button at
// all: can this person review, and if they already did, what did they say.
// Returns NULL when the check itself failed -- a timeout, an offline
// device, a permission problem. Deliberately not "no": collapsing a
// failure into a refusal made a transient blip hide the review button for
// the life of the screen, and made the post-save re-check able to erase
// an "Edit your review" button seconds after the review saved. The caller
// keeps whatever it had rather than believing a failure.
export async function reviewGate(listingId: string): Promise<ReviewGate | null> {
  const { data, error } = await supabase.rpc('can_review_listing', { p_listing_id: listingId });
  if (error) {
    console.warn('[reviews] gate check failed:', error.message);
    return null;
  }
  const d = (data || {}) as any;
  return {
    canReview: !!d.can_review,
    reason: toReason(d.reason),
    rating: d.rating == null ? null : Number(d.rating),
    comment: d.comment ?? null,
  };
}

export async function leaveReview(
  listingId: string,
  rating: number,
  comment: string | null
): Promise<{ wasNew: boolean; pointsAwarded: number }> {
  const { data, error } = await supabase.rpc('leave_review', {
    p_listing_id: listingId,
    p_rating: rating,
    p_comment: comment && comment.trim() ? comment.trim() : null,
  });
  if (error) {
    // The RPC raises the gate's own reason as the message, so a refusal
    // arrives here already named -- 'no_contact', 'own_listing' and the
    // rest -- and the caller can say the right sentence rather than
    // "something went wrong".
    const raw = String(error.message || '').trim();
    const code = (GATE_REASONS as string[]).concat(['rating_invalid', 'comment_too_long']).includes(raw)
      ? (raw as ReviewErrorCode)
      : 'unknown';
    if (code === 'unknown') console.warn('[reviews] unmapped error:', error.message);
    throw new ReviewError(code);
  }
  const d = (data || {}) as any;
  return { wasNew: !!d.was_new, pointsAwarded: Number(d.points_awarded) || 0 };
}

// Null on failure, for the same reason reviewGate returns null: an empty
// array would render "No reviews yet" under a header counting seven of
// them, which is a contradiction the reader has to resolve themselves.
export async function fetchSellerReviews(
  sellerId: string,
  limit = 20
): Promise<SellerReview[] | null> {
  const { data, error } = await supabase.rpc('seller_reviews', {
    p_seller_id: sellerId,
    p_limit: limit,
  });
  if (error) {
    console.warn('[reviews] could not load seller reviews:', error.message);
    return null;
  }
  return (data || []).map((r: any) => ({
    id: r.id,
    rating: Number(r.rating) || 0,
    comment: r.comment ?? null,
    createdAt: r.created_at,
    edited: !!r.edited,
    // Null when the profile has no name -- the SCREEN translates it, so
    // an anonymous reviewer does not read "Vevaty user" inside an
    // otherwise Arabic page.
    reviewerName: r.reviewer_name || null,
    listingId: r.listing_id ?? null,
    listingTitleEn: r.listing_title_en ?? null,
    listingTitleAr: r.listing_title_ar ?? null,
  }));
}

// The seller's public score. Two plain columns on profiles rather than an
// aggregate, because every card, seller page and listing wants it and none
// of them can aggregate over a PostgREST call. A trigger keeps them in
// step with the rows, so they cannot drift.
export async function fetchSellerRating(
  sellerId: string
): Promise<{ average: number | null; count: number }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('rating_avg, rating_count')
    .eq('id', sellerId)
    .maybeSingle();
  if (error || !data) return { average: null, count: 0 };
  return {
    average: data.rating_avg == null ? null : Number(data.rating_avg),
    count: Number(data.rating_count) || 0,
  };
}
