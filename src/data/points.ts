export const POINTS_RULES = {
  postListing: 15,
  completeSale: 40,
  leaveReview: 10,
};

export const TIER_THRESHOLDS: { tier: 'Bronze' | 'Silver' | 'Gold'; min: number }[] = [
  { tier: 'Bronze', min: 0 },
  { tier: 'Silver', min: 150 },
  { tier: 'Gold', min: 400 },
];

export function tierForPoints(points: number): 'Bronze' | 'Silver' | 'Gold' {
  let t: 'Bronze' | 'Silver' | 'Gold' = 'Bronze';
  for (const step of TIER_THRESHOLDS) {
    if (points >= step.min) t = step.tier;
  }
  return t;
}
