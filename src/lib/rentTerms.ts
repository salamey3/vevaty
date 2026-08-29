import { Listing } from '../types';

// Shared vocabulary for Properties' rent terms, so the create wizard, the
// batch flow, the listing card and the detail screen can never drift on
// what the allowed values are or what order they're offered in. The
// values themselves are also what the database's own CHECK constraints
// allow (see the add_rent_pricing_to_listings migration) -- adding one
// here without widening the constraint would fail on save.
export type RentPeriod = NonNullable<Listing['rentPeriod']>;
export type RentPaymentFrequency = NonNullable<Listing['rentPaymentFrequency']>;

export const RENT_PERIODS: readonly RentPeriod[] = ['month', 'year'] as const;

// How far ahead the tenant pays, in ascending commitment. A real
// negotiating term in the Lebanese rental market -- "full year up front"
// and "month to month" are very different offers on the same apartment --
// which is why it sits beside the rent value rather than among the
// category specs.
export const RENT_PAYMENT_FREQUENCIES: readonly RentPaymentFrequency[] = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;

// Whether a given Sale/Rent/Both pick means the seller is offering the
// property for sale at all. Non-property listings ('new'/'used'/null)
// answer false to both of these -- callers gate on their own
// isPropertyCategory check first.
export function offersSale(condition: Listing['condition']): boolean {
  return condition === 'sale' || condition === 'both';
}

export function offersRent(condition: Listing['condition']): boolean {
  return condition === 'rent' || condition === 'both';
}

// True for a Properties listing's Sale/Rent/Both pick, as opposed to a
// New/Used condition or none at all. Used to suppress the listing card's
// condition pill on properties: the price lines there say "Buy for
// $450,000" / "Rent for $12,000/yr" outright, so a pill repeating
// "Sale or rent" beside them is redundant -- and it was wide enough to
// squeeze the price itself down to "$450,...".
export function isPropertyCondition(condition: Listing['condition']): boolean {
  return offersSale(condition) || offersRent(condition);
}

// Translation keys for the pill labels, kept next to the value lists so a
// new option can't be added without an obvious place to name it.
export function rentPeriodLabelKey(p: RentPeriod): string {
  return `createListing.rentPeriod.${p}`;
}

export function rentPaymentFrequencyLabelKey(f: RentPaymentFrequency): string {
  return `createListing.rentPaymentFrequency.${f}`;
}

// Whether a listing satisfies a Sale/Rent/Both (or New/Used) filter
// selection. Plain membership everywhere except the one case it can't
// cover: a property offered BOTH ways genuinely is for sale and genuinely
// is for rent, so a buyer who ticks "For rent" has to see it. Without
// this, marking a property as available either way quietly hides it from
// both of the filters a buyer actually uses.
export function matchesConditionFilter(
  condition: Listing['condition'],
  selected: string[]
): boolean {
  if (selected.length === 0) return true;
  const c = condition || '';
  return selected.some((s) => s === c || (c === 'both' && (s === 'sale' || s === 'rent')));
}

// Display form of a rent figure -- "$800 / month" rather than the form's
// own "Per month" pill wording, which reads wrong once it follows a
// number. Takes an {amount} variable; one key per period so each
// language can put the slash, the currency and the period word wherever
// its own grammar wants them.
export function rentPerPeriodLabelKey(p: RentPeriod): string {
  return `listingCard.rentPer.${p}`;
}

// The same figure abbreviated for a browse card -- "$12,000/yr" rather
// than "$12,000 / year". A two-column phone grid gives a card roughly
// 145pt of text width, and once the figure also carries a "Rent for"
// label the long form overruns it and ellipsises the number itself,
// which is the whole problem the label was added to solve.
export function rentPerPeriodShortLabelKey(p: RentPeriod): string {
  return `listingCard.rentPerShort.${p}`;
}
