import { supabase } from './supabase';
import { CategoryAttribute } from '../types';

// Stock for shops that buy in bulk: one record per sellable combination,
// and every change to a number recorded with who made it.
//
// The thing that shapes all of this: Vevaty never sees the money, so
// nothing can tell the app a sale happened. A quantity only ever moves
// because a person said so. That makes two rules non-negotiable —
//
//   * saying so must be almost free, or the shop stops after a week and
//     the numbers become worse than no numbers, and
//   * ADD and SET are different verbs. "+12" is right whatever happened
//     while the seller was typing; "it is 7" quietly swallows a sale made
//     in the same minute. Muddling them into one editable box is how a
//     shop stops trusting its own stock.
//
// The server owns every number (see myazar.stock_move): it locks the row,
// refuses to go below zero rather than clamping, and writes the history.
// Nothing here computes a new quantity and sends it.

export type MoveReason = 'sold' | 'restock' | 'count' | 'damaged' | 'returned' | 'setup';

export interface Variant {
  id: string;
  // The two dimensions, in rank order. `a` is rank 1 (size on clothing,
  // colour on bags), `b` is rank 2 or null. Named by position rather than
  // by meaning because the meaning is the category's to decide.
  a: string | null;
  b: string | null;
  sku: string | null;
  // null means "whatever the listing costs".
  price: number | null;
  photo: string | null;
  qty: number;
  lowAt: number | null;
}

export const MAX_VARIANTS = 200;
export const MAX_QTY = 999999;

function toNum(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseVariants(raw: any): Variant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: any): Variant => ({
      id: String(v?.id ?? ''),
      a: v?.size ? String(v.size) : null,
      b: v?.colour ? String(v.colour) : null,
      sku: v?.sku ? String(v.sku) : null,
      price: toNum(v?.price),
      photo: v?.photo ? String(v.photo) : null,
      qty: Math.max(0, toNum(v?.qty, 0) ?? 0),
      lowAt: toNum(v?.low_at),
    }))
    // Only an id is required. A row with NEITHER value is the real,
    // deliberate shape for a category with no dimensions -- a shop selling
    // bracelets -- and filtering it out here made those shops invisible to
    // their own stock panel while the posting form kept offering them an
    // opening-count box the server would discard.
    .filter((v) => v.id);
}

// The (at most two) dimensions a category breaks stock down by, in the
// order the database put them in. Read through this, never by looking for
// a slug called "size": rank 1 is size on clothing and colour on bags.
export function variantDimensions(attrs: CategoryAttribute[]): CategoryAttribute[] {
  const byRank = new Map<number, CategoryAttribute>();
  for (const a of attrs) {
    // First one wins per rank, rather than slicing the sorted list to two.
    // The database stops a category holding two rank-1 attributes, but the
    // list this reads is the resolved ANCESTOR CHAIN, so a parent and a
    // child can each contribute one -- and slicing then dropped the
    // genuine second dimension in favour of the duplicate first.
    if (a.isVariant && a.variantRank && !byRank.has(a.variantRank)) byRank.set(a.variantRank, a);
  }
  return [byRank.get(1), byRank.get(2)].filter(Boolean) as CategoryAttribute[];
}

// Every combination of the values the seller ticked, in a stable order.
// Three sizes and four colours is twelve rows; three sizes alone is three.
export function combinationsOf(aValues: string[], bValues: string[]): { a: string | null; b: string | null }[] {
  if (aValues.length === 0 && bValues.length === 0) return [];
  if (bValues.length === 0) return aValues.map((a) => ({ a, b: null }));
  if (aValues.length === 0) return bValues.map((b) => ({ a: null, b }));
  const out: { a: string | null; b: string | null }[] = [];
  for (const a of aValues) for (const b of bValues) out.push({ a, b });
  return out;
}

// A separator no option value can contain. It used to be "/", and option
// values are free text an admin types -- so a trousers category with EU
// sizes written as "38/40" collided with a plain "38" in navy, merging two
// combinations onto one row and duplicating React keys. U+001F is the
// unit separator; nothing types it. myazar.save_listing_variants uses the
// same character for the same reason.
const SEP = '\u001f';
const keyOf = (a: string | null, b: string | null) => `${a ?? ''}${SEP}${b ?? ''}`;
export const variantKey = (v: { a: string | null; b: string | null }) => keyOf(v.a, v.b);

// The grid the seller edits, built from what they ticked and whatever the
// listing already has. An existing combination keeps its numbers; a new
// one starts empty. Nothing is dropped silently: a combination that is no
// longer ticked simply is not in the result, and the server turns its row
// off rather than deleting it.
export function buildGrid(
  aValues: string[],
  bValues: string[],
  existing: Variant[]
): Variant[] {
  const byKey = new Map(existing.map((v) => [variantKey(v), v]));
  return combinationsOf(aValues, bValues).map(({ a, b }) => {
    const had = byKey.get(keyOf(a, b));
    return had
      ? { ...had, a, b }
      : { id: `new:${keyOf(a, b)}`, a, b, sku: null, price: null, photo: null, qty: 0, lowAt: null };
  });
}

// One picture per COLOUR, not per combination. A shop photographs the navy
// shirt once, not once per size -- so the grid edits it against the second
// dimension and it is written onto every row that shares that value.
export function photoByDimension(rows: Variant[], which: 'a' | 'b'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const v = which === 'a' ? r.a : r.b;
    if (v && r.photo && !out[v]) out[v] = r.photo;
  }
  return out;
}

export function applyPhotoToDimension(rows: Variant[], which: 'a' | 'b', value: string, photo: string | null): Variant[] {
  return rows.map((r) => ((which === 'a' ? r.a : r.b) === value ? { ...r, photo } : r));
}

// The grid the screen actually asks for, in one call: the dimensions the
// category defines, the values the seller ticked, and whatever the listing
// already has.
//
// A category with no dimensions at all -- bracelets, lipstick, a jar of
// honey -- gets ONE row with neither value set. That row is a real stock
// row like any other, so those shops get the same minus button, the same
// history and the same low mark as a clothing shop, instead of being left
// on a bare number nobody can move. The server refuses to mix it with
// sized rows under one listing.
export function gridFor(
  dims: CategoryAttribute[],
  picks: Record<string, string[]>,
  existing: Variant[]
): Variant[] {
  if (dims.length === 0) {
    const had = existing.find((v) => !v.a && !v.b);
    // ONE, not zero. A shop posting a sofa has one sofa, and that is the
    // answer for the overwhelming majority of listings outside clothing --
    // so the box is already right and the seller reads it rather than
    // filling it in. A brand-new size x colour row still starts at zero,
    // because twelve combinations pre-filled with 1 is twelve units the
    // shop never said it had.
    return [had ?? { id: `new:${keyOf(null, null)}`, a: null, b: null, sku: null, price: null, photo: null, qty: 1, lowAt: null }];
  }
  const ordered = (d: CategoryAttribute | undefined) => {
    if (!d) return [];
    const ticked = new Set(picks[d.slug] ?? []);
    // The category's own option order, never the order they were tapped:
    // a seller who ticks M then S still reads S, M down the page.
    return d.options.map((o) => o.value).filter((v) => ticked.has(v));
  };
  const a = ordered(dims[0]);
  const b = ordered(dims[1]);
  // On a two-dimension category, BOTH halves are needed before there is a
  // row to show. Without this, ticking only the colours -- which is what
  // happens, because the colour names are the ones a seller recognises --
  // produced rows with no size at all: real-looking rows with opening-
  // count boxes, saved as {size: null, colour: 'navy'} that no size filter
  // can answer, and thrown away the moment a size WAS ticked, because the
  // combination key changes and the numbers were keyed to the old one.
  if (dims.length === 2 && (a.length === 0 || b.length === 0)) return [];
  return buildGrid(a, b, existing);
}

// Every row the form knows about, with one of them replaced. Keyed on the
// COMBINATION, not on the id, because a row the seller has typed into but
// not yet saved has only a placeholder id.
//
// This is what makes unticking non-destructive. The grid the seller sees
// is derived from the ticks; the set this updates is everything the form
// has ever seen or built. Untick S and its row leaves the grid but stays
// here, so re-ticking it brings back the same twelve units -- rather than
// a fresh row at zero, next to an editable box whose number the server
// then discards because the row already exists on the server.
export function rememberRow(all: Variant[], row: Variant): Variant[] {
  const key = variantKey(row);
  const at = all.findIndex((v) => variantKey(v) === key);
  if (at < 0) return [...all, row];
  const next = all.slice();
  next[at] = row;
  return next;
}

// Which values are ticked, read back off a listing that already has rows.
// Keyed by slug so it drops straight into the picks map above.
export function picksFromRows(dims: CategoryAttribute[], rows: Variant[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  dims.forEach((d, i) => {
    const seen = new Set(rows.map((r) => (i === 0 ? r.a : r.b)).filter(Boolean) as string[]);
    out[d.slug] = d.options.map((o) => o.value).filter((v) => seen.has(v));
  });
  return out;
}

// Which dimension carries the pictures: the last one. On clothing that is
// colour, which is the whole point -- a shop photographs the navy shirt
// once, not once per size. On a category whose only dimension is colour it
// is that one. On a category with no dimensions there is nothing to
// photograph separately and this is null.
export function photoDimension(dims: CategoryAttribute[]): { attr: CategoryAttribute; which: 'a' | 'b' } | null {
  if (dims.length === 0) return null;
  return dims.length === 1 ? { attr: dims[0], which: 'a' } : { attr: dims[1], which: 'b' };
}

// What goes into listings.attributes under each dimension's slug, and so
// into every existing size/colour filter.
//
// This is what the listing OFFERS, not what is in stock this minute. It
// used to be the in-stock list, which was honest when quantities only ever
// changed in the posting form -- but a number that moves ten times a day
// would drag the search index behind it, and a shirt that sells out at
// noon would quietly stop answering "Size: M" while its page still shows
// M with a sold-out mark. Offered is the stable answer, and the listing's
// own total reaching zero is what puts the SOLD OUT ribbon on the card.
export function offeredValues(dims: CategoryAttribute[], rows: Variant[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  dims.forEach((d, i) => {
    const seen = new Set(rows.map((r) => (i === 0 ? r.a : r.b)).filter(Boolean) as string[]);
    if (seen.size > 0) out[d.slug] = d.options.map((o) => o.value).filter((v) => seen.has(v));
  });
  return out;
}

export const totalOf = (rows: Variant[]): number => rows.reduce((n, r) => n + (r.qty || 0), 0);

export const isLow = (v: Variant): boolean => v.lowAt != null && v.qty > 0 && v.qty <= v.lowAt;

// What the seller sees written next to a combination.
export function variantLabel(
  v: { a: string | null; b: string | null },
  dims: CategoryAttribute[],
  language: 'en' | 'ar'
): string {
  const label = (dim: CategoryAttribute | undefined, value: string | null) => {
    if (!dim || !value) return null;
    const opt = dim.options.find((o) => o.value === value);
    return opt ? (language === 'ar' ? opt.labelAr : opt.labelEn) : value;
  };
  return [label(dims[0], v.a), label(dims[1], v.b)].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- server

export async function fetchVariants(listingId: string): Promise<Variant[]> {
  const { data, error } = await supabase.rpc('listing_variants', { p_listing_id: listingId });
  if (error) throw error;
  return parseVariants(data);
}

// The grid, saved. Quantities are NOT sent for rows that already exist --
// the server ignores them anyway, deliberately, so that editing a title
// cannot restore last week's numbers. A brand-new combination sends its
// opening count and the server files it as 'setup'.
export async function saveVariants(listingId: string, rows: Variant[]): Promise<Variant[]> {
  const { data, error } = await supabase.rpc('save_listing_variants', {
    p_listing_id: listingId,
    p_rows: rows.map((r) => ({
      size: r.a,
      colour: r.b,
      sku: r.sku?.trim() || null,
      // Number.isFinite, not a null check. A half-typed price reaches
      // this as NaN, and String(NaN) is the text "NaN", which the server
      // either stores as a NaN numeric or refuses outright -- taking every
      // other row in the same call down with it.
      price: r.price != null && Number.isFinite(r.price) ? String(r.price) : null,
      photo: r.photo || null,
      low_at: r.lowAt != null && Number.isFinite(r.lowAt) ? String(Math.round(r.lowAt)) : null,
      qty: r.id.startsWith('new:') ? Math.max(0, Math.min(MAX_QTY, Math.round(r.qty) || 0)) : undefined,
    })),
  });
  if (error) throw error;
  return parseVariants(data);
}

export async function moveStock(
  variantId: string,
  delta: number,
  reason: MoveReason,
  opts?: { note?: string; threadId?: string }
): Promise<{ before: number; after: number; listingTotal: number }> {
  const { data, error } = await supabase.rpc('stock_move', {
    p_variant_id: variantId,
    p_delta: Math.round(delta),
    p_reason: reason,
    p_note: opts?.note ?? null,
    p_thread_id: opts?.threadId ?? null,
  });
  if (error) throw error;
  return {
    before: toNum((data as any)?.before, 0) ?? 0,
    after: toNum((data as any)?.after, 0) ?? 0,
    listingTotal: toNum((data as any)?.listing_total, 0) ?? 0,
  };
}

export async function countStock(variantId: string, qty: number, note?: string): Promise<void> {
  const { error } = await supabase.rpc('stock_count', {
    p_variant_id: variantId,
    p_qty: Math.max(0, Math.round(qty)),
    p_note: note ?? null,
  });
  if (error) throw error;
}

// A delivery: many rows, one call, all or nothing. Half a box booked in
// because the connection dropped is worse than none of it.
export async function moveStockMany(
  moves: { id: string; delta: number }[],
  reason: MoveReason = 'restock'
): Promise<number> {
  const real = moves.filter((m) => Math.round(m.delta) !== 0);
  if (real.length === 0) return 0;
  const { data, error } = await supabase.rpc('stock_move_many', {
    p_moves: real.map((m) => ({ id: m.id, delta: Math.round(m.delta) })),
    p_reason: reason,
  });
  if (error) throw error;
  return toNum((data as any)?.moved, 0) ?? 0;
}

// ------------------------------------------------------ the buyer's half

// Which combinations a buyer can actually be offered, and what each costs.
// Sold-out rows are KEPT and marked, never hidden: "M is out until Friday"
// is what the buyer came to find out, and a size that quietly vanishes
// reads as a listing that never had it.
export function pickable(rows: Variant[], which: 'a' | 'b', other: string | null, otherWhich: 'a' | 'b'): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (other !== null && (otherWhich === 'a' ? r.a : r.b) !== other) continue;
    const v = which === 'a' ? r.a : r.b;
    if (v) out.add(v);
  }
  return out;
}

// The row a pair of picks lands on, or null while the buyer is halfway
// through choosing.
export function rowFor(rows: Variant[], a: string | null, b: string | null): Variant | null {
  return rows.find((r) => r.a === a && r.b === b) ?? null;
}

// What this row costs: its own price when the shop set one (XXL can be
// dearer), the listing's otherwise.
export const priceOf = (row: Variant | null, listingPrice: number): number =>
  row && row.price != null ? row.price : listingPrice;

// The buyer's order, posted into the thread as the first thing said. The
// server re-reads the row, refuses more than there are, freezes the labels
// in the buyer's language and prices it -- nothing here is trusted.
export async function sendStockOrder(
  threadId: string, variantId: string, qty: number, language: 'en' | 'ar'
): Promise<any> {
  const { data, error } = await supabase.rpc('send_stock_order', {
    p_thread_id: threadId,
    p_variant_id: variantId,
    p_qty: Math.max(1, Math.round(qty)),
    p_language: language,
  });
  if (error) throw error;
  return data;
}

// The seller's one tap on an order card. Idempotent at the database: a
// unique index on the message means a second tap moves nothing.
export async function stockSoldFromOrder(messageId: string): Promise<{ after: number; listingTotal: number }> {
  const { data, error } = await supabase.rpc('stock_sold_from_order', { p_message_id: messageId });
  if (error) throw error;
  return {
    after: toNum((data as any)?.after, 0) ?? 0,
    listingTotal: toNum((data as any)?.listing_total, 0) ?? 0,
  };
}

// Which orders in this thread have already been taken off the shelf, so
// the button knows what to say before anyone presses it.
export async function threadStockTaken(threadId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('thread_stock_taken', { p_thread_id: threadId });
  if (error) throw error;
  return new Set(Array.isArray(data) ? data.map((x: any) => String(x)) : []);
}

// ------------------------------------------------------- the shop's day

// One row of the shop's stock, wherever it lives. Carries its listing with
// it, because every screen in the shop's day is a list ACROSS listings --
// the whole point of them is not having to open one at a time.
export interface ShopRow extends Variant {
  listingId: string;
  titleEn: string;
  titleAr: string;
  categoryId: string;
  // How many people asked to be told when this one comes back. Zero on
  // anything that is in stock.
  waiting: number;
}

// An order card a buyer sent that nobody has taken off the shelf yet.
export interface WaitingOrder {
  messageId: string;
  threadId: string;
  listingId: string;
  titleEn: string;
  titleAr: string;
  qty: number;
  // The frozen labels, already in the language the buyer was reading.
  what: string;
  at: number;
}

export interface ShopDay {
  orders: WaitingOrder[];
  low: ShopRow[];
  out: ShopRow[];
}

export const EMPTY_DAY: ShopDay = { orders: [], low: [], out: [] };

// Is there anything at all? What the Home card asks before it decides to
// exist.
export const dayIsQuiet = (d: ShopDay): boolean =>
  d.orders.length === 0 && d.low.length === 0 && d.out.length === 0;

export const dayCount = (d: ShopDay): number => d.orders.length + d.low.length + d.out.length;

function parseRow(raw: any): ShopRow {
  return {
    id: String(raw?.id ?? ''),
    a: raw?.size ? String(raw.size) : null,
    b: raw?.colour ? String(raw.colour) : null,
    sku: raw?.sku ? String(raw.sku) : null,
    price: toNum(raw?.price),
    photo: null,
    qty: Math.max(0, toNum(raw?.qty, 0) ?? 0),
    lowAt: toNum(raw?.low_at),
    listingId: String(raw?.listing_id ?? ''),
    titleEn: String(raw?.title_en ?? ''),
    titleAr: String(raw?.title_ar ?? ''),
    categoryId: String(raw?.category_id ?? ''),
    waiting: Math.max(0, toNum(raw?.waiting, 0) ?? 0),
  };
}

export function parseShopRows(raw: any): ShopRow[] {
  return Array.isArray(raw) ? raw.map(parseRow).filter((r) => r.id) : [];
}

export function parseShopDay(raw: any): ShopDay {
  if (!raw || typeof raw !== 'object') return EMPTY_DAY;
  return {
    orders: Array.isArray(raw.orders)
      ? raw.orders
          .map((o: any): WaitingOrder => ({
            messageId: String(o?.message_id ?? ''),
            threadId: String(o?.thread_id ?? ''),
            listingId: String(o?.listing_id ?? ''),
            titleEn: String(o?.title_en ?? ''),
            titleAr: String(o?.title_ar ?? ''),
            qty: Math.max(1, toNum(o?.qty, 1) ?? 1),
            // Built from the frozen lines rather than resolved again: the
            // labels on an old order are what the seller published then.
            what: Array.isArray(o?.lines)
              ? o.lines.map((l: any) => String(l?.label ?? '')).filter(Boolean).join(' · ')
              : '',
            at: Date.parse(String(o?.at ?? '')) || 0,
          }))
          .filter((o: WaitingOrder) => o.messageId)
      : [],
    low: parseShopRows(raw.low),
    out: parseShopRows(raw.out),
  };
}

export function shopRowLabel(
  r: { a: string | null; b: string | null },
  dims: CategoryAttribute[],
  language: 'en' | 'ar'
): string {
  return !r.a && !r.b ? '' : variantLabel(r, dims, language);
}

export async function fetchShopDay(): Promise<ShopDay> {
  const { data, error } = await supabase.rpc('shop_needs_me');
  if (error) throw error;
  return parseShopDay(data);
}

// Every row the shop has, optionally narrowed by a code or a title.
export async function fetchShopRows(query?: string): Promise<ShopRow[]> {
  const { data, error } = await supabase.rpc('shop_stock_rows', {
    p_query: query?.trim() || null,
    p_limit: 300,
  });
  if (error) throw error;
  return parseShopRows(data);
}

// ---------------------------------------------------------- the waiting

export async function joinWaitlist(variantId: string, language: 'en' | 'ar'): Promise<void> {
  const { error } = await supabase.rpc('join_stock_waitlist', {
    p_variant_id: variantId,
    p_language: language,
  });
  if (error) throw error;
}

export async function leaveWaitlist(variantId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_stock_waitlist', { p_variant_id: variantId });
  if (error) throw error;
}

export async function fetchMyWaitlist(listingId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('my_waitlist', { p_listing_id: listingId });
  if (error) throw error;
  return new Set(Array.isArray(data) ? data.map((x: any) => String(x)) : []);
}

// Why the server refused, in the seller's own words.
export function stockErrorKey(e: any): string {
  const code = String(e?.message ?? '').trim();
  switch (code) {
    case 'none_left': return 'stock.errNoneLeft';
    case 'not_your_listing': return 'stock.errNotYours';
    case 'no_such_variant': return 'stock.errGone';
    case 'too_many_variants': return 'stock.errTooMany';
    // The per-row ceiling, which the delivery screen is the first thing
    // that makes easy to hit: six digits in a box, and the refusal takes
    // the whole batch with it.
    case 'too_many': return 'stock.errTooBig';
    case 'variant_needs_a_dimension': return 'stock.errNoDimension';
    case 'mixed_dimensions': return 'stock.errMixed';
    case 'not_that_many': return 'stock.errNotThatMany';
    case 'already_taken_off': return 'stock.errAlreadyTaken';
    case 'not_your_thread': return 'stock.errNotYourThread';
    case 'already_in_stock': return 'stock.errBackAlready';
    case 'your_own_listing': return 'stock.errYourOwn';
    case 'waitlist_full': return 'stock.errWaitlistFull';
    default:
      console.warn('[stock]', code || e);
      return 'stock.errFailed';
  }
}
