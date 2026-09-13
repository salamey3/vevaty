import { supabase } from './supabase';

// Choices with prices: the seller's option groups, the buyer's picks, and
// the arithmetic that turns one into the other.
//
// The maths lives here rather than in either screen because three places
// need the same answer and must never disagree: the buyer's running total,
// the estimate carried into the chat, and the server's own recomputation
// in send_listing_order. The server is the authority -- it rebuilds every
// label and price from the live rows before writing the message -- but a
// total that jumps when the buyer taps Send is a total nobody trusts, so
// the client has to arrive at the same number.

export type Pick = 'one' | 'any';
export type Per = 'item' | 'order';

export interface OptionChoice {
  id: string;
  label: string;
  // What ticking this adds. Zero is normal and meaningful: "White wood +$0"
  // tells a buyer the plain option exists and costs nothing extra, which a
  // missing row does not.
  extra: number;
  // 'item' multiplies with the quantity, 'order' is charged once. Twelve
  // gift boxes at +$12 is fair; one delivery at +$30 twelve times is not.
  per: Per;
  // The label of the short question this choice asks the buyer, or null.
  // "Name engraved" without "Name to engrave" is an order the seller has
  // to chase.
  ask: string | null;
  askRequired: boolean;
}

export interface OptionGroup {
  id: string;
  title: string;
  pick: Pick;
  required: boolean;
  options: OptionChoice[];
}

export interface ListingOptions {
  minQty: number;
  groups: OptionGroup[];
}

// What the buyer has ticked: choice id -> their typed answer (or ''). A map
// rather than a list because every screen asks "is this one ticked?" far
// more often than it iterates, and because a set cannot hold the answers.
export type Picks = Record<string, string>;

// Rows carry a LOCAL id until the server assigns a real one on save. React
// needs a stable key while the seller is still typing, and the id a row
// eventually gets belongs to the database, not to the form. Kept here
// rather than in the builder because a saved set is copied in through
// bodyToGroups below, which needs the same ids and must not import a
// component to get them.
let seq = 0;
export const draftId = () => `draft-${++seq}`;

export function emptyChoice(): OptionChoice {
  return { id: draftId(), label: '', extra: 0, per: 'item', ask: null, askRequired: false };
}

export function emptyGroup(): OptionGroup {
  return { id: draftId(), title: '', pick: 'one', required: false, options: [emptyChoice()] };
}

export const MAX_GROUPS = 5;
export const MAX_CHOICES = 12;
export const MAX_QTY = 999;
export const MAX_SAVED_SETS = 12;

export const EMPTY_OPTIONS: ListingOptions = { minQty: 1, groups: [] };

function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// The server's jsonb, normalised. Defensive in the same way AppStore's
// listing normaliser is: this arrives over the wire from a function that
// may be newer or older than this build, and a missing field must produce
// a listing with no choices rather than a screen that throws.
export function parseListingOptions(raw: any): ListingOptions {
  const groups: OptionGroup[] = Array.isArray(raw?.groups)
    ? raw.groups
        .map((g: any): OptionGroup => ({
          id: String(g?.id ?? ''),
          title: String(g?.title ?? ''),
          pick: g?.pick === 'any' ? 'any' : 'one',
          required: !!g?.required,
          options: Array.isArray(g?.options)
            ? g.options
                .map((o: any): OptionChoice => ({
                  id: String(o?.id ?? ''),
                  label: String(o?.label ?? ''),
                  extra: Math.max(0, toNumber(o?.extra)),
                  per: o?.per === 'order' ? 'order' : 'item',
                  ask: o?.ask ? String(o.ask) : null,
                  askRequired: !!o?.ask_required,
                }))
                .filter((o: OptionChoice) => o.id && o.label)
            : [],
        }))
        .filter((g: OptionGroup) => g.id && g.options.length > 0)
    : [];
  return { minQty: Math.max(1, Math.round(toNumber(raw?.min_qty, 1))), groups };
}

export interface Totals {
  // What one piece costs with the per-item choices on it.
  perItem: number;
  // What is charged once, whatever the quantity.
  perOrder: number;
  qty: number;
  total: number;
}

// The one place the total is worked out. Mirrors send_listing_order's
// arithmetic exactly: qty x (base + per-item extras) + per-order extras.
export function totalsFor(basePrice: number, options: ListingOptions, picks: Picks, qty: number): Totals {
  let perItemExtras = 0;
  let perOrder = 0;
  for (const group of options.groups) {
    for (const choice of group.options) {
      if (!(choice.id in picks)) continue;
      if (choice.per === 'order') perOrder += choice.extra;
      else perItemExtras += choice.extra;
    }
  }
  const perItem = basePrice + perItemExtras;
  const n = Math.max(1, Math.round(qty) || 1);
  return { perItem, perOrder, qty: n, total: n * perItem + perOrder };
}

// Why Send is disabled, or null when it isn't. One function so the button's
// state and the message under it can never disagree about the reason.
export type OrderBlock =
  | { kind: 'group'; groupId: string; groupTitle: string }
  | { kind: 'answer'; choiceLabel: string; ask: string }
  | { kind: 'quantity'; minQty: number };

export function whyNotOrderable(options: ListingOptions, picks: Picks, qty: number): OrderBlock | null {
  if (!(qty >= options.minQty) || qty > MAX_QTY) return { kind: 'quantity', minQty: options.minQty };
  for (const group of options.groups) {
    if (group.required && !group.options.some((o) => o.id in picks)) {
      return { kind: 'group', groupId: group.id, groupTitle: group.title };
    }
    for (const choice of group.options) {
      if (!(choice.id in picks)) continue;
      if (choice.ask && choice.askRequired && !picks[choice.id].trim()) {
        return { kind: 'answer', choiceLabel: choice.label, ask: choice.ask };
      }
    }
  }
  return null;
}

// Ticking a choice. A pick-one group clears its siblings first -- radio
// behaviour, done here rather than in the component so the chooser and any
// future caller (a saved basket, a re-order button) behave the same way.
// Ticking a choice that is already ticked in an 'any' group unticks it; in
// a 'one' group it stays, because a radio you can turn off by tapping it
// again is a radio nobody can explain.
export function togglePick(options: ListingOptions, picks: Picks, choiceId: string): Picks {
  const group = options.groups.find((g) => g.options.some((o) => o.id === choiceId));
  if (!group) return picks;
  const next: Picks = { ...picks };
  if (group.pick === 'one') {
    for (const o of group.options) delete next[o.id];
    next[choiceId] = picks[choiceId] ?? '';
    return next;
  }
  if (choiceId in next) delete next[choiceId];
  else next[choiceId] = '';
  return next;
}

// Everything in `picks` that still exists in `options`. Needed after a
// re-fetch: the seller can edit their groups while a buyer has the page
// open, and a pick pointing at a deleted choice is one the server refuses
// forever while the running total quietly ignores it -- a Send button that
// stays lit over a request that can never go through.
export function prunePicks(options: ListingOptions, picks: Picks): Picks {
  const live = new Set(options.groups.flatMap((g) => g.options.map((o) => o.id)));
  const next: Picks = {};
  for (const [id, answer] of Object.entries(picks)) if (live.has(id)) next[id] = answer;
  return next;
}

export function setAnswer(picks: Picks, choiceId: string, answer: string): Picks {
  if (!(choiceId in picks)) return picks;
  return { ...picks, [choiceId]: answer };
}

// ---------------------------------------------------------------- server

export async function fetchListingOptions(listingId: string): Promise<ListingOptions> {
  const { data, error } = await supabase.rpc('listing_options', { p_listing_id: listingId });
  if (error) throw error;
  return parseListingOptions(data);
}

// The seller's whole set, saved in one call -- the form always holds all of
// it, so there is no partial update to get wrong.
//
// Returns what the server stored, ids and all. The posting form discards
// it (it is navigating away), which is why the draft ids in its own state
// are never replaced; a caller that stays on screen should keep it.
export async function saveListingOptions(
  listingId: string,
  groups: OptionGroup[],
  minQty: number
): Promise<ListingOptions> {
  const payload = groups.map((g) => ({
    title: g.title.trim(),
    pick: g.pick,
    required: g.required,
    options: g.options.map((o) => ({
      label: o.label.trim(),
      extra: o.extra,
      per: o.per,
      ask: o.ask?.trim() || null,
      ask_required: !!o.ask && o.askRequired,
    })),
  }));
  const { data, error } = await supabase.rpc('save_listing_options', {
    p_listing_id: listingId,
    p_groups: payload,
    p_min_qty: Math.max(1, Math.round(minQty) || 1),
  });
  if (error) throw error;
  return parseListingOptions(data);
}

// ---------------------------------------------------- the seller's library

// A named set, saved once and copied into any listing in a tap. A TEMPLATE:
// it holds no ids, and using one fills the form in rather than pointing the
// listing at it -- editing "my usual sizes" next month must not rewrite an
// order from last month.
export interface SavedSet {
  id: string;
  name: string;
  groups: OptionGroup[];
  minQty: number;
}

// The form's groups as the server stores them: labels, prices and
// questions, no ids. It TRIMS but does not tidy -- dropping blank rows and
// enforcing the five-of-twelve caps is tidyGroups' job, and the posting
// form runs that first. A caller that skips it will be refused by the
// server, which checks the same caps as the listing saver
// (myazar.check_option_groups).
export function groupsToBody(groups: OptionGroup[], minQty: number) {
  return {
    min_qty: Math.max(1, Math.round(minQty) || 1),
    groups: groups.map((g) => ({
      title: g.title.trim(),
      pick: g.pick,
      required: g.required,
      options: g.options.map((o) => ({
        label: o.label.trim(),
        extra: o.extra,
        per: o.per,
        ask: o.ask?.trim() || null,
        ask_required: !!o.ask && o.askRequired,
      })),
    })),
  };
}

// And back into form rows. The ids are draft ones because nothing in a
// template is allowed to look like a live choice id -- but they are NOT
// what keeps two uses of one set apart: the same SavedSet object is handed
// back on every tap, so useSet re-mints them at the moment of copying.
//
// Array-guarded the same way parseListingOptions is, and for the same
// reason: this parses a server payload, the caller swallows what it
// throws, and a `groups` that arrives as an object rather than an array
// would take the whole library down silently.
export function bodyToGroups(body: any): { groups: OptionGroup[]; minQty: number } {
  const rawGroups = Array.isArray(body?.groups) ? body.groups : [];
  const parsed = parseListingOptions({ min_qty: body?.min_qty, groups: rawGroups.map((g: any, i: number) => ({
    ...g,
    id: `t${i}`,
    options: (Array.isArray(g?.options) ? g.options : []).map((o: any, j: number) => ({ ...o, id: `t${i}-${j}` })),
  })) });
  return {
    minQty: parsed.minQty,
    groups: parsed.groups.map((g) => ({
      ...g,
      id: draftId(),
      options: g.options.map((o) => ({ ...o, id: draftId() })),
    })),
  };
}

function parseSavedSets(raw: any): SavedSet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any): SavedSet => {
      const { groups, minQty } = bodyToGroups(s?.body);
      return { id: String(s?.id ?? ''), name: String(s?.name ?? ''), groups, minQty };
    })
    .filter((s) => s.id && s.name && s.groups.length > 0);
}

export async function fetchMyOptionSets(): Promise<SavedSet[]> {
  const { data, error } = await supabase.rpc('my_option_sets');
  if (error) throw error;
  return parseSavedSets(data);
}

export async function saveOptionSet(name: string, groups: OptionGroup[], minQty: number): Promise<SavedSet[]> {
  const { data, error } = await supabase.rpc('save_option_set', {
    p_name: name.trim(),
    p_body: groupsToBody(groups, minQty),
  });
  if (error) throw error;
  return parseSavedSets(data);
}

export async function deleteOptionSet(id: string): Promise<SavedSet[]> {
  const { data, error } = await supabase.rpc('delete_option_set', { p_id: id });
  if (error) throw error;
  return parseSavedSets(data);
}

export async function sendListingOrder(
  threadId: string,
  qty: number,
  picks: Picks,
  language: 'en' | 'ar'
): Promise<any> {
  const { data, error } = await supabase.rpc('send_listing_order', {
    p_thread_id: threadId,
    p_qty: Math.round(qty),
    p_picks: Object.entries(picks).map(([id, answer]) => ({ id, answer: answer || null })),
    p_language: language,
  });
  if (error) throw error;
  return data;
}

// ------------------------------------------------------- the order card

export interface OrderLine {
  group: string;
  label: string;
  extra: number;
  per: Per;
  ask: string | null;
  answer: string | null;
}

export interface OrderSnapshot {
  qty: number;
  // The three figures the total was built FROM. Nothing renders them today
  // -- the card itemises `lines` instead -- but they are what makes an old
  // order auditable: "why was this $7,710" is answerable from the message
  // alone, without the listing, whose prices have moved since.
  base: number;
  perItem: number;
  perOrder: number;
  total: number;
  lines: OrderLine[];
}

// The frozen card on a chat message. Same defensive shape as the parser
// above: an order sent by a newer build must render as SOMETHING here, and
// the message's own `body` is the fallback the bubble already shows.
export function parseOrderSnapshot(raw: any): OrderSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const total = toNumber(raw.total, NaN);
  if (!Number.isFinite(total)) return null;
  return {
    qty: Math.max(1, Math.round(toNumber(raw.qty, 1))),
    base: toNumber(raw.base),
    perItem: toNumber(raw.per_item),
    perOrder: toNumber(raw.per_order),
    total,
    lines: Array.isArray(raw.lines)
      ? raw.lines.map((l: any): OrderLine => ({
          group: String(l?.group ?? ''),
          label: String(l?.label ?? ''),
          extra: toNumber(l?.extra),
          per: l?.per === 'order' ? 'order' : 'item',
          ask: l?.ask ? String(l.ask) : null,
          answer: l?.answer ? String(l.answer) : null,
        }))
      : [],
  };
}

export const money = (n: number): string => `$${n.toLocaleString(undefined, {
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  maximumFractionDigits: 2,
})}`;

// "+$8" / "+$30 once" -- the suffix is what stops a buyer reading a
// per-order fee as a per-piece one when the quantity is sixty.
export function extraLabel(choice: { extra: number; per: Per }, t: (k: string) => string): string {
  if (choice.extra <= 0) return '';
  const amount = `+${money(choice.extra)}`;
  return choice.per === 'order' ? `${amount} ${t('options.onceSuffix')}` : amount;
}
