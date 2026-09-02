import { supabase } from './supabase';
import {
  Auction, AuctionBidHistoryEntry, AuctionLot, AuctionLotStatus, AuctionStatus, SavedCard,
} from '../types';

// Everything the app knows about talking to the auction engine. See
// AUCTIONS.md for why the rules live in SQL rather than here.
//
// The shape of this file is deliberate: every WRITE is an RPC into a
// SECURITY DEFINER function, and every READ is a plain select against a
// table RLS already narrows. There is no path here that can place a bid,
// approve a registration or move a lot's clock by writing a row directly,
// because there is no such path in the database either.

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// The engine raises CODES, never sentences -- PostgREST's own text is an
// English diagnostic naming a column, which is unreadable under an Arabic
// interface and is not what a bidder needs to know anyway (@AGENTS.md).
export type AuctionErrorCode =
  | 'not_signed_in' | 'not_registered' | 'auction_not_live' | 'lot_not_live'
  | 'lot_closed' | 'lot_not_found' | 'bid_below_start' | 'bid_too_low'
  | 'max_not_higher' | 'bid_invalid' | 'cannot_bid_own_lot'
  | 'payment_method_invalid' | 'card_invalid' | 'phone_not_verified'
  | 'auction_not_found' | 'auction_not_open_for_registration'
  | 'not_admin' | 'already_published' | 'schedule_incomplete'
  | 'closes_before_opens' | 'no_lots'
  | 'unknown';

export class AuctionError extends Error {
  code: AuctionErrorCode;
  // For `bid_too_low` the engine returns the minimum that WOULD have been
  // accepted, so the UI can say the number rather than "too low".
  minimum: number | null;
  constructor(code: AuctionErrorCode, minimum: number | null = null) {
    super(code);
    this.code = code;
    this.minimum = minimum;
  }
}

// Kept in step with what the functions actually raise. A code missing here
// reaches the bidder as 'unknown', which is safe but useless -- hence the
// console.warn below, so an unmapped one is found in development rather
// than by a bidder reading "something went wrong" at the close.
const KNOWN_CODES = new Set<string>([
  'not_signed_in', 'not_registered', 'auction_not_live', 'lot_not_live',
  'lot_closed', 'lot_not_found', 'bid_below_start', 'bid_too_low',
  'max_not_higher', 'bid_invalid', 'cannot_bid_own_lot',
  'payment_method_invalid', 'card_invalid', 'phone_not_verified',
  'auction_not_found', 'auction_not_open_for_registration',
  'not_admin', 'already_published', 'schedule_incomplete',
  'closes_before_opens', 'no_lots',
]);

function toAuctionError(error: any): AuctionError {
  // Supabase puts a raise's message in `message` and its DETAIL in
  // `details`. Anything unrecognised becomes 'unknown' rather than being
  // shown raw: a code this file has not been taught is a bug here, and the
  // bidder should get a sentence rather than our diagnostic.
  const raw = String(error?.message || '').trim();
  const code = (KNOWN_CODES.has(raw) ? raw : 'unknown') as AuctionErrorCode;
  const detail = Number(error?.details);
  if (code === 'unknown') console.warn('[auctions] unmapped engine error:', error?.message, error?.details);
  return new AuctionError(code, Number.isFinite(detail) ? detail : null);
}

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

const AUCTION_COLUMNS =
  'id, title_en, title_ar, status, opens_at, first_lot_closes_at, ' +
  'lot_close_stagger_seconds, anti_snipe_seconds, seller_commission_pct, buyer_premium_pct';

function toAuction(row: any): Auction {
  return {
    id: row.id,
    titleEn: row.title_en,
    titleAr: row.title_ar,
    status: row.status as AuctionStatus,
    opensAt: row.opens_at,
    firstLotClosesAt: row.first_lot_closes_at,
    lotCloseStaggerSeconds: row.lot_close_stagger_seconds ?? 0,
    antiSnipeSeconds: row.anti_snipe_seconds ?? 0,
    sellerCommissionPct: Number(row.seller_commission_pct ?? 0),
    buyerPremiumPct: Number(row.buyer_premium_pct ?? 0),
  };
}

// `leadingLotIds` is the set of lots this viewer is winning, fetched
// separately. It is not derived from a leading_bidder_id on the row
// because that column is no longer readable by anyone: an auth.users id
// joins straight to a publicly readable profile name, which would have
// undone the whole point of the aliases in the bid history.
function toLot(row: any, leadingLotIds: Set<string>): AuctionLot {
  const current = row.current_price === null ? null : Number(row.current_price);
  return {
    id: row.id,
    auctionId: row.auction_id,
    listingId: row.listing_id,
    lotNumber: row.lot_number,
    startPrice: Number(row.start_price),
    // Both computed in the database. The reserve NUMBER is not granted to
    // any client role -- an earlier version selected it and reduced it to
    // these two booleans here, which left the figure on the wire for
    // anyone reading the network tab. A reserve everyone can see is not a
    // reserve.
    hasReserve: !!row.has_reserve,
    reserveMet: !!row.reserve_met,
    currentPrice: current,
    bidCount: row.bid_count ?? 0,
    closesAt: row.closes_at,
    status: row.status as AuctionLotStatus,
    winningAmount: row.winning_amount === null ? null : Number(row.winning_amount),
    viewerIsLeading: leadingLotIds.has(row.id),
  };
}

// Every auction a buyer may see, newest event first. Drafts are filtered
// by RLS rather than here -- a client-side filter on a status the server
// still returned would be a filter one refactor away from being dropped.
export async function fetchAuctions(): Promise<Auction[]> {
  const { data, error } = await supabase
    .from('auctions')
    .select(AUCTION_COLUMNS)
    // Drafts are hidden by RLS. 'cancelled' is not -- it is a real state a
    // bidder may need to see on an auction they registered for -- but it
    // does not belong in the browse list, so it is filtered here rather
    // than by widening the policy.
    .neq('status', 'cancelled')
    .order('first_lot_closes_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data || []).map(toAuction);
}

// `signedIn` gates the second round trip only. my_leading_lots returns
// nothing for an anonymous caller anyway, so this saves a call rather than
// enforcing anything.
export async function fetchAuctionLots(auctionId: string, signedIn: boolean): Promise<AuctionLot[]> {
  const [lots, leading] = await Promise.all([
    supabase
      .from('auction_lots')
      .select(
        'id, auction_id, listing_id, lot_number, start_price, has_reserve, ' +
        'reserve_met, current_price, bid_count, closes_at, status, winning_amount'
      )
      .eq('auction_id', auctionId)
      .order('lot_number', { ascending: true }),
    signedIn
      ? supabase.rpc('my_leading_lots', { p_auction_id: auctionId })
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (lots.error) throw lots.error;
  if (leading.error) throw leading.error;
  const leadingIds = new Set<string>((leading.data || []).map((r: any) => (typeof r === 'string' ? r : r.my_leading_lots)));
  return (lots.data || []).map((r) => toLot(r, leadingIds));
}

export async function fetchLotBidHistory(lotId: string, limit = 30): Promise<AuctionBidHistoryEntry[]> {
  const { data, error } = await supabase.rpc('auction_lot_bid_history', {
    p_lot_id: lotId,
    p_limit: limit,
  });
  if (error) throw toAuctionError(error);
  return (data || []).map((r: any) => ({
    bidAt: r.bid_at,
    amount: Number(r.amount),
    isAuto: !!r.is_auto,
    bidderAlias: r.bidder_alias,
    isMe: !!r.is_me,
  }));
}

// The caller's own ceiling on a lot.
//
// The `bidder_id` filter is NOT redundant with RLS, and assuming it was is
// how this was wrong: auction_bids also carries an "admins read all bids"
// policy, so for an admin an unfiltered query orders EVERY bidder's max
// descending and hands back a stranger's secret ceiling labelled as their
// own. RLS is the second lock here, not the only one.
export async function fetchMyMaxBid(lotId: string, viewerId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('auction_bids')
    .select('max_amount')
    .eq('lot_id', lotId)
    .eq('bidder_id', viewerId)
    .order('max_amount', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length ? Number(data[0].max_amount) : null;
}

// ---------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------

export type PlaceBidResult = {
  outcome: 'leading' | 'outbid';
  currentPrice: number;
  leading: boolean;
  reserveMet: boolean;
  closesAt: string;
  nextMinBid: number;
};

// `max` is the MOST the bidder will pay, not the amount they expect to
// pay. The distinction is the whole feature and the UI has to say it in
// those words -- somebody who reads this box as "your bid" and types the
// current price plus a dollar has not understood what they just agreed to.
export async function placeBid(lotId: string, max: number): Promise<PlaceBidResult> {
  const { data, error } = await supabase.rpc('place_bid', { p_lot_id: lotId, p_max: max });
  if (error) throw toAuctionError(error);
  return {
    outcome: data.outcome,
    currentPrice: Number(data.current_price),
    leading: !!data.leading,
    reserveMet: !!data.reserve_met,
    closesAt: data.closes_at,
    nextMinBid: Number(data.next_min_bid),
  };
}

// The same tiered table the engine uses, duplicated here ON PURPOSE and
// only ever to PREDICT -- the "next minimum" hint under the bid box, so it
// can update as someone types without a round trip. The database's copy is
// the one that decides. If the two ever disagree the engine simply refuses
// the bid and returns the real minimum, which the UI then shows: wrong by
// a step is a corrected hint, not an accepted bad bid.
export function bidIncrement(price: number): number {
  if (price < 100) return 5;
  if (price < 500) return 10;
  if (price < 1000) return 25;
  if (price < 5000) return 50;
  if (price < 10000) return 100;
  return 250;
}

export function nextMinimumBid(lot: AuctionLot): number {
  if (lot.currentPrice === null) return lot.startPrice;
  return lot.currentPrice + bidIncrement(lot.currentPrice);
}

// ---------------------------------------------------------------------
// Cards and registration
// ---------------------------------------------------------------------

// The demo provider's accepted numbers. Publishing the list is the point:
// a real card must be impossible to enter by accident while the feature is
// being demonstrated, and the only way to guarantee that is to accept
// nothing else. When a real gateway lands, this whole block is replaced by
// its client-side tokenise call and the rest of the file is untouched.
const DEMO_TEST_CARDS: Record<string, string> = {
  '4242424242424242': 'Visa',
  '4000056655665556': 'Visa Debit',
  '5555555555554444': 'Mastercard',
  '2223003122003222': 'Mastercard',
  '378282246310005': 'American Express',
};

export type DemoCardInput = { number: string; expMonth: number; expYear: number };

export function demoCardBrand(cardNumber: string): string | null {
  return DEMO_TEST_CARDS[cardNumber.replace(/[\s-]/g, '')] || null;
}

// Tokenises a test card the way a gateway would: the number is reduced to
// a brand, four digits and an opaque token HERE, on the client, and the
// number itself never goes near the network or the database.
export async function saveDemoCard(input: DemoCardInput): Promise<SavedCard> {
  const digits = input.number.replace(/[\s-]/g, '');
  const brand = demoCardBrand(digits);
  if (!brand) throw new AuctionError('payment_method_invalid');

  const token = `demo_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const { data, error } = await supabase.rpc('save_payment_method', {
    p_provider: 'demo',
    p_token: token,
    p_brand: brand,
    p_last4: digits.slice(-4),
    p_exp_month: input.expMonth,
    p_exp_year: input.expYear,
  });
  if (error) throw toAuctionError(error);
  return toSavedCard(data);
}

function toSavedCard(row: any): SavedCard {
  return {
    id: row.id,
    provider: row.provider,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    status: row.status,
  };
}

export async function fetchMyCards(): Promise<SavedCard[]> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, provider, brand, last4, exp_month, exp_year, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(toSavedCard);
}

export async function registerForAuction(auctionId: string, cardId: string): Promise<'approved' | 'pending' | 'blocked'> {
  const { data, error } = await supabase.rpc('register_for_auction', {
    p_auction_id: auctionId,
    p_payment_method_id: cardId,
  });
  if (error) throw toAuctionError(error);
  return data.status;
}

// Whether the viewer may bid in this auction. Its own round trip rather
// than something inferred from having a card saved: a saved card is not a
// registration, and a BLOCKED registration must read as "cannot bid"
// rather than as "not registered yet", which would offer a Register button
// that can only fail.
export async function fetchMyRegistration(
  auctionId: string,
  viewerId: string
): Promise<'approved' | 'pending' | 'blocked' | null> {
  const { data, error } = await supabase
    .from('auction_registrations')
    .select('status')
    .eq('auction_id', auctionId)
    // Same reason as fetchMyMaxBid: "admins manage registrations" means an
    // admin sees every row for the auction, and .maybeSingle() throws on
    // the second one -- so without this filter the registration check hard
    // fails for exactly the people running the auction.
    .eq('bidder_id', viewerId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.status as 'approved' | 'pending' | 'blocked') : null;
}
