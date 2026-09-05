// Display-only. The database is the sole source of truth for what actually
// gets credited (myazar.claim_posting_points, myazar.claim_sale_points,
// myazar.tier_for_points) -- these constants exist so the UI can show the
// right numbers ahead of time, and must be kept in sync with those
// functions by hand. See AppStore.tsx's claimPostingPoints/claimSalePoints
// for why the actual awarded amount always comes back from the server call
// rather than being computed here.
export const POINTS_RULES = {
  postListingFirst: 50, // one-time, a seller's first-ever listing
  postListingAdditional: 5, // every listing after that
  spinBonus: 25, // a listing that includes a 360 spin set, on top of the above
  completeSale: 40, // marking a listing sold (Vevaty or elsewhere)
  monthlyCap: 300, // ceiling on 'recurring'-category points per rolling 30 days

  // Designed, not yet wired to a real trigger -- see NEXT.md. Kept here so
  // the schedule is documented in one place; do not surface these in the UI
  // as if they fire today.
  leaveReview: 20,
  referral: 100,
  verification: 150,
  cleanRecordBonus: 50,
};

export const BOOST_COSTS = {
  bump: 50,
  featured3d: 150, // 3-day Featured
  featured7d: 275, // 7-day Featured
  // Homepage Spotlight is deliberately absent -- purchase-only, held back
  // until real point-purchasing exists. See myazar.redeem_boost.
};

export const TIER_THRESHOLDS: { tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond'; min: number }[] = [
  { tier: 'Bronze', min: 0 },
  { tier: 'Silver', min: 300 },
  { tier: 'Gold', min: 900 },
  { tier: 'Diamond', min: 2500 },
];

export function tierForPoints(points: number): 'Bronze' | 'Silver' | 'Gold' | 'Diamond' {
  let t: 'Bronze' | 'Silver' | 'Gold' | 'Diamond' = 'Bronze';
  for (const step of TIER_THRESHOLDS) {
    if (points >= step.min) t = step.tier;
  }
  return t;
}
