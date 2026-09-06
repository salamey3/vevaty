import { supabase } from './supabase';

// Consignors offering an item for a sale, and the queue an admin screens
// them in.
//
// Every call here is an RPC, for the same reason the review calls are:
// the tables have RLS on with NO policies at all. A consignor may read
// their own submissions and nothing else, an admin may read all of them
// plus the private screening note, and neither of those is a rule a row
// policy can express without granting the table to the client first.
//
// The shape of the flow, because it is not obvious from the function
// names: submitting does not create a listing, and ACCEPTING does not
// create a listing either. Accepting says "we want this object". Turning
// it into a lot is a second, separate act -- convertSubmission -- because
// between the two sits a physical inspection and a conversation about
// terms, and those take days. A submission is a request, not a draft.

export type SubmissionStatus =
  | 'pending'      // in the queue
  | 'needs_info'   // sent back with a question
  | 'accepted'     // we want it; terms and sale not yet set
  | 'declined'
  | 'withdrawn'    // the consignor pulled it
  | 'converted';   // it is a lot now

export type SubmissionKind = {
  kind: string;
  labelEn: string;
  labelAr: string;
};

export type SubmissionPhoto = { url: string; thumbnailUrl: string | null };

// The condition grades an auction item is offered in. The same four the
// marketplace's 'graded' mode uses, so the value carries straight onto
// the listing at conversion with no mapping.
export type SubmissionCondition = 'new' | 'like_new' | 'good' | 'fair';

export const SUBMISSION_CONDITIONS: SubmissionCondition[] = ['new', 'like_new', 'good', 'fair'];

// A draft's condition may be unset. '' rather than a default grade,
// because the default WAS 'good' and that is the answer a consignor gives
// by not reading the question -- and the grade carries straight onto the
// listing at conversion, so an unworn watch submitted as Good is a
// mispriced lot nobody chose.
export type DraftCondition = SubmissionCondition | '';

// What the consignor typed. Also exactly what goes back up on an edit --
// the form always holds the whole thing, so there is no partial-update
// path and no question about which fields a save touched.
export type SubmissionDraft = {
  kind: string;
  title: string;
  description: string;
  brand: string;
  modelRef: string;
  yearMade: string;
  sizeNotes: string;
  condition: DraftCondition;
  conditionNotes: string;
  provenance: string;
  hasBox: boolean;
  hasPapers: boolean;
  hasAuthentication: boolean;
  ownsOutright: boolean;
  // Strings, not numbers: these come straight off text inputs, and '' is a
  // meaningful value ("did not say") that 0 and NaN both mislabel.
  estimateLow: string;
  estimateHigh: string;
  reserveExpectation: string;
  governorate: string;
  district: string;
  logisticsNotes: string;
  photos: SubmissionPhoto[];
};

export const EMPTY_DRAFT: SubmissionDraft = {
  kind: '', title: '', description: '', brand: '', modelRef: '', yearMade: '',
  sizeNotes: '', condition: '', conditionNotes: '', provenance: '',
  hasBox: false, hasPapers: false, hasAuthentication: false, ownsOutright: false,
  estimateLow: '', estimateHigh: '', reserveExpectation: '',
  governorate: '', district: '', logisticsNotes: '', photos: [],
};

export const MIN_SUBMISSION_PHOTOS = 3;
export const MAX_SUBMISSION_PHOTOS = 8;

// One submission as its own consignor sees it. Note what is NOT here:
// admin_private_note. The server builds a different object for them and
// for us, rather than one object with a flag, so there is no call that
// can be made with the flag the wrong way round.
export type Submission = SubmissionDraft & {
  id: string;
  status: SubmissionStatus;
  kindLabelEn: string;
  kindLabelAr: string;
  // The note we wrote FOR them -- the question on a needs_info, the reason
  // on a decline. Null when there is nothing to say.
  adminNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  submittedAt: string;
  // Whether this one is still theirs to change. Computed server-side so
  // the screen cannot re-derive the rule and get it wrong.
  editable: boolean;
};

export type SubmissionSeller = {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  isPhoneVerified: boolean;
  isIdVerified: boolean;
  district: string | null;
  joinedAt: string;
};

// What the convert form opens on, so nothing is retyped. `categoryId` is
// null for the 'other' kind, which is the one case that makes the admin
// choose for themselves.
export type SubmissionSuggestion = {
  categoryId: string | null;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  district: string | null;
  condition: DraftCondition;
  reservePrice: number | null;
};

export type AdminSubmission = Submission & {
  adminPrivateNote: string | null;
  listingId: string | null;
  lotId: string | null;
  seller: SubmissionSeller;
  // What else this account has sent us. The screening signal that is not
  // in the item: four previous declines is a different proposition from a
  // first-time consignor with the same watch.
  sellerHistory: { total: number; accepted: number; declined: number; converted: number };
  suggested: SubmissionSuggestion;
};

export type SubmissionQueue = {
  rows: AdminSubmission[];
  // Counted over the whole table, not the page returned, so a filtered
  // view still tells the truth about how much is waiting.
  counts: Partial<Record<SubmissionStatus, number>>;
};

export type SubmissionErrorCode =
  | 'not_signed_in' | 'not_verified' | 'not_admin'
  | 'invalid_kind' | 'title_required' | 'description_required' | 'condition_invalid'
  | 'text_too_long' | 'amount_invalid' | 'estimate_ordering'
  | 'photos_required' | 'too_many_photos' | 'photo_url_invalid'
  | 'too_many_open' | 'not_found' | 'not_yours' | 'not_editable'
  | 'invalid_decision' | 'note_required' | 'not_decidable' | 'not_accepted'
  | 'already_converted' | 'auction_not_found' | 'category_required'
  | 'start_price_invalid' | 'reserve_below_start' | 'rate_out_of_range'
  | 'invalid_commission_basis' | 'surplus_needs_reserve'
  // Raised by submit_auction_item when the consignor has not agreed to the
  // conditions of consignment currently in force.
  | 'terms_not_accepted'
  | 'unknown';

const CODES: string[] = [
  'not_signed_in', 'not_verified', 'not_admin',
  'invalid_kind', 'title_required', 'description_required', 'condition_invalid',
  'text_too_long', 'amount_invalid', 'estimate_ordering',
  'photos_required', 'too_many_photos', 'photo_url_invalid',
  'too_many_open', 'not_found', 'not_yours', 'not_editable',
  'invalid_decision', 'note_required', 'not_decidable', 'not_accepted',
  'already_converted', 'auction_not_found', 'category_required',
  'start_price_invalid', 'reserve_below_start', 'rate_out_of_range',
  'invalid_commission_basis', 'surplus_needs_reserve',
  'terms_not_accepted',
];

// A real Error, so anything generic that catches it -- a log line reading
// e.message, an unhandled-rejection handler -- gets a diagnostic rather
// than `{}`.
export class SubmissionError extends Error {
  code: SubmissionErrorCode;
  constructor(code: SubmissionErrorCode) {
    super(code);
    this.name = 'SubmissionError';
    this.code = code;
  }
}

function toError(error: { message?: string } | null): SubmissionError {
  const raw = String(error?.message || '').trim();
  const code = CODES.includes(raw) ? (raw as SubmissionErrorCode) : 'unknown';
  if (code === 'unknown') console.warn('[submissions] unmapped error:', error?.message);
  return new SubmissionError(code);
}

// Numbers arrive from Postgres as strings often enough that Number() on a
// null is the bug this exists to prevent: Number(null) is 0, and a lot
// with no reserve would read as a reserve of zero.
function num(v: any): number | null {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

function toDraft(r: any): SubmissionDraft {
  return {
    kind: r.kind ?? '',
    title: r.title ?? '',
    description: r.description ?? '',
    brand: r.brand ?? '',
    modelRef: r.model_ref ?? '',
    yearMade: r.year_made ?? '',
    sizeNotes: r.size_notes ?? '',
    condition: (r.condition ?? '') as DraftCondition,
    conditionNotes: r.condition_notes ?? '',
    provenance: r.provenance ?? '',
    hasBox: !!r.has_box,
    hasPapers: !!r.has_papers,
    hasAuthentication: !!r.has_authentication,
    ownsOutright: !!r.owns_outright,
    // Back to strings, because that is what the form edits. A null becomes
    // '' rather than '0' -- "did not say" must survive a round trip.
    estimateLow: r.estimate_low == null ? '' : String(r.estimate_low),
    estimateHigh: r.estimate_high == null ? '' : String(r.estimate_high),
    reserveExpectation: r.reserve_expectation == null ? '' : String(r.reserve_expectation),
    governorate: r.governorate ?? '',
    district: r.district ?? '',
    logisticsNotes: r.logistics_notes ?? '',
    photos: (r.photos || []).map((p: any) => ({
      url: p.url, thumbnailUrl: p.thumbnail_url ?? null,
    })),
  };
}

function toSubmission(r: any): Submission {
  return {
    ...toDraft(r),
    id: r.id,
    status: r.status as SubmissionStatus,
    kindLabelEn: r.kind_label_en ?? '',
    kindLabelAr: r.kind_label_ar ?? '',
    adminNote: r.admin_note ?? null,
    decidedAt: r.decided_at ?? null,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    editable: !!r.editable,
  };
}

function toAdminSubmission(r: any): AdminSubmission {
  const s = r.seller || {};
  const h = r.seller_history || {};
  const g = r.suggested || {};
  return {
    ...toSubmission(r),
    adminPrivateNote: r.admin_private_note ?? null,
    listingId: r.listing_id ?? null,
    lotId: r.lot_id ?? null,
    seller: {
      id: s.id,
      name: s.name || 'Vevaty user',
      phone: s.phone ?? null,
      whatsapp: s.whatsapp ?? null,
      isPhoneVerified: !!s.is_phone_verified,
      isIdVerified: !!s.is_id_verified,
      district: s.district ?? null,
      joinedAt: s.joined_at,
    },
    sellerHistory: {
      total: Number(h.total) || 0,
      accepted: Number(h.accepted) || 0,
      declined: Number(h.declined) || 0,
      converted: Number(h.converted) || 0,
    },
    suggested: {
      categoryId: g.category_id ?? null,
      titleEn: g.title_en ?? '',
      titleAr: g.title_ar ?? '',
      descriptionEn: g.description_en ?? '',
      descriptionAr: g.description_ar ?? '',
      district: g.district ?? null,
      // NOT `?? 'good'`. Deleting the default from the consignor's form
      // and leaving one here would put it back on the path that actually
      // prices the object -- the conversion, where nobody would see it.
      condition: (g.condition ?? '') as DraftCondition,
      reservePrice: num(g.reserve_price),
    },
  };
}

// The draft as the server wants it. Blank strings are sent as blank
// strings and the server turns them into nulls -- doing that mapping here
// as well would mean two places that decide what "empty" means.
function toPayload(d: SubmissionDraft): Record<string, unknown> {
  return {
    kind: d.kind,
    title: d.title,
    description: d.description,
    brand: d.brand,
    model_ref: d.modelRef,
    year_made: d.yearMade,
    size_notes: d.sizeNotes,
    condition: d.condition,
    condition_notes: d.conditionNotes,
    provenance: d.provenance,
    has_box: d.hasBox,
    has_papers: d.hasPapers,
    has_authentication: d.hasAuthentication,
    owns_outright: d.ownsOutright,
    estimate_low: d.estimateLow,
    estimate_high: d.estimateHigh,
    reserve_expectation: d.reserveExpectation,
    governorate: d.governorate,
    district: d.district,
    logistics_notes: d.logisticsNotes,
    photos: d.photos.map((p) => ({ url: p.url, thumbnail_url: p.thumbnailUrl })),
  };
}

// ---- The consignor's side -------------------------------------------

// The short auction-only list the form offers. Null on failure rather
// than an empty array: a form that renders "no categories" because the
// network blipped is one the consignor cannot use and cannot diagnose.
export async function fetchSubmissionKinds(): Promise<SubmissionKind[] | null> {
  const { data, error } = await supabase.rpc('auction_submission_kinds_list');
  if (error) {
    console.warn('[submissions] could not load kinds:', error.message);
    return null;
  }
  return (data || []).map((r: any) => ({
    kind: r.kind, labelEn: r.label_en, labelAr: r.label_ar,
  }));
}

export async function submitAuctionItem(draft: SubmissionDraft): Promise<Submission> {
  const { data, error } = await supabase.rpc('submit_auction_item', { p_payload: toPayload(draft) });
  if (error) throw toError(error);
  return toSubmission(data);
}

// Editing one that has not been decided -- or answering a question we
// asked. Answering RESUBMITS it: the status goes back to pending and its
// place in the queue is restamped, so it is waiting from now rather than
// from whenever it was first sent.
export async function updateAuctionSubmission(
  id: string, draft: SubmissionDraft
): Promise<Submission> {
  const { data, error } = await supabase.rpc('update_auction_submission', {
    p_id: id, p_payload: toPayload(draft),
  });
  if (error) throw toError(error);
  return toSubmission(data);
}

export async function withdrawAuctionSubmission(id: string): Promise<Submission> {
  const { data, error } = await supabase.rpc('withdraw_auction_submission', { p_id: id });
  if (error) throw toError(error);
  return toSubmission(data);
}

// Null on failure, never [] -- the screen has to be able to tell "you have
// not sent us anything" from "we could not ask".
export async function fetchMySubmissions(): Promise<Submission[] | null> {
  const { data, error } = await supabase.rpc('my_auction_submissions');
  if (error) {
    console.warn('[submissions] could not load mine:', error.message);
    return null;
  }
  return (data || []).map(toSubmission);
}

// ---- The admin's side -----------------------------------------------

export async function fetchSubmissionQueue(
  statuses: SubmissionStatus[] | null = null,
  limit = 100
): Promise<SubmissionQueue> {
  const { data, error } = await supabase.rpc('admin_auction_submissions', {
    p_statuses: statuses, p_limit: limit,
  });
  if (error) throw toError(error);
  const d = (data || {}) as any;
  return {
    rows: (d.rows || []).map(toAdminSubmission),
    counts: (d.counts || {}) as Partial<Record<SubmissionStatus, number>>,
  };
}

export type SubmissionDecision = 'accept' | 'decline' | 'needs_info' | 'reopen';

// `privateNote` omitted leaves the existing private note alone; a string
// (including '') replaces it. Deliberately `string | undefined` and not
// `| null`: null is the obvious way to write "clear it" and it meant the
// exact opposite here, so the type no longer lets it be written at all.
// Clearing is saveSubmissionNote(id, '').
export async function decideSubmission(
  id: string,
  decision: SubmissionDecision,
  note: string | null,
  privateNote?: string
): Promise<AdminSubmission> {
  const { data, error } = await supabase.rpc('admin_decide_auction_submission', {
    p_id: id,
    p_decision: decision,
    p_note: note && note.trim() ? note.trim() : null,
    p_private_note: privateNote === undefined ? null : privateNote,
  });
  if (error) throw toError(error);
  return toAdminSubmission(data);
}

// The private screening note, saved on its own.
//
// It used to ride along on a decision and nowhere else, which is the one
// place it must not live: the note exists to survive the days between
// screening an object and deciding on it, and a note only written by the
// decision is lost over exactly that gap. This also works on a converted
// or withdrawn submission, which decideSubmission refuses -- those rows
// are closed to decisions, not to notes.
export async function saveSubmissionNote(id: string, note: string): Promise<AdminSubmission> {
  const { data, error } = await supabase.rpc('admin_note_auction_submission', {
    p_id: id, p_private_note: note,
  });
  if (error) throw toError(error);
  return toAdminSubmission(data);
}

export type ConvertInput = {
  auctionId: string;
  categoryId: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  district: string;
  condition: string;
  startPrice: string;
  reservePrice: string;
  sellerCommissionPct: string;
  buyerPremiumPct: string;
  sellerCommissionBasis: 'hammer' | 'surplus' | '';
};

// The second act: the accepted object becomes a listing owned by the
// CONSIGNOR and a lot in a named sale. Everything blank here falls back to
// what they submitted, so a conversion that changes nothing still produces
// a complete lot.
export async function convertSubmission(
  id: string, input: ConvertInput
): Promise<AdminSubmission> {
  const { data, error } = await supabase.rpc('admin_convert_submission_to_lot', {
    p_id: id,
    p_auction_id: input.auctionId,
    p_payload: {
      category_id: input.categoryId,
      title_en: input.titleEn,
      title_ar: input.titleAr,
      description_en: input.descriptionEn,
      description_ar: input.descriptionAr,
      district: input.district,
      condition: input.condition,
      start_price: input.startPrice,
      reserve_price: input.reservePrice,
      seller_commission_pct: input.sellerCommissionPct,
      buyer_premium_pct: input.buyerPremiumPct,
      seller_commission_basis: input.sellerCommissionBasis,
    },
  });
  if (error) throw toError(error);
  return toAdminSubmission(data);
}
