// What the admin dashboard's "Needs you" strip shows, and when it dares say
// nothing does.
//
// This lives here rather than inside AdminGateScreen because it is the one
// part of that screen with a decision in it, and the decision has a failure
// mode that is invisible on screen: a count that never came back is not a
// count of zero, and a panel that says "nothing needs you" over an unknown is
// telling a comfortable lie. Keeping it in the component would mean the only
// way to ask "what does the strip show?" is to read the JSX -- see AGENTS.md,
// "When a component derives something a whole feature depends on".
//
// Tested by scripts/test/admin-needs.test.mjs.

export type NeedKey = 'moderation' | 'reports' | 'shops' | 'problems' | 'consignments';

// Spelled out rather than `keyof RootStackParamList`: every one of these takes
// no params, and naming them is what makes adding a route that DOES take one a
// compile error rather than a blank screen.
export type NeedRoute =
  | 'AdminModeration'
  | 'AdminReports'
  | 'AdminShops'
  | 'AdminProblemReports'
  | 'AdminAuctionSubmissions';

// undefined means "not counted yet, or the count failed". Never 0 for either
// of those -- that is the whole point of the type being partial.
export type NeedCounts = Partial<Record<NeedKey, number>>;

export type Need = { key: NeedKey; label: string; route: NeedRoute; count: number };

// Ranked by what it costs to leave sitting, not by how many there are: a
// flagged listing is public and wrong, a shop waiting on verification is a
// customer who cannot start, a problem report is someone already waiting.
export const NEED_ORDER: readonly { key: NeedKey; label: string; route: NeedRoute }[] = [
  { key: 'moderation', label: 'admin.needs.moderation', route: 'AdminModeration' },
  { key: 'reports', label: 'admin.needs.reports', route: 'AdminReports' },
  { key: 'shops', label: 'admin.needs.shops', route: 'AdminShops' },
  { key: 'problems', label: 'admin.needs.problems', route: 'AdminProblemReports' },
  { key: 'consignments', label: 'admin.needs.consignments', route: 'AdminAuctionSubmissions' },
];

// Consignments only counts for anything while the auction section exists for
// buyers at all. With auctions off the dashboard never asks for it, so it must
// not be waited on either -- and a count left over in state from before the
// switch was flipped must not keep showing a line for a section nobody can see.
export function expectedNeeds(auctionsOn: boolean): NeedKey[] {
  return NEED_ORDER
    .filter((n) => auctionsOn || n.key !== 'consignments')
    .map((n) => n.key);
}

export function needsYou(counts: NeedCounts, auctionsOn: boolean): {
  needs: Need[];
  allClear: boolean;
} {
  const expected = expectedNeeds(auctionsOn);
  const needs = NEED_ORDER
    .filter((n) => expected.includes(n.key))
    .map((n) => ({ ...n, count: counts[n.key] ?? 0 }))
    .filter((n) => n.count > 0);

  // "Nothing needs you" is a claim about every queue, so it waits for every
  // queue to have answered. One refused count and the strip simply shows what
  // it knows and says nothing about the rest -- the pages are all still one
  // tap away inside their drawers.
  const allClear = needs.length === 0 && expected.every((k) => counts[k] !== undefined);

  return { needs, allClear };
}
