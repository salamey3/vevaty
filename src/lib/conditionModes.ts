import { ConditionMode, Listing } from '../types';

export type ConditionValue = NonNullable<Listing['condition']>;

// The one place that knows what each condition mode offers.
//
// `listings.condition` carries four different questions depending on the
// category (see ConditionMode): is it new or used, is it for sale or for
// rent, is it being sold or rehomed, and what wear grade is it in. Before
// this file, every consumer re-typed its own copy of the answer list as a
// nested ternary -- the create form, the batch review row, the batch
// row's cross-category clear, the browse filter, the card badge, and the
// whitelist in AppStore that decides which values survive a round trip
// through the database.
//
// That cost a real bug: when 'rehome' was added, two of those lists were
// hand-written and never updated, so a listing saved as 'free' came back
// out as null. The seller saw "Free" and everyone else saw "$0". A fifth
// mode would have had six more chances to do the same thing. Everything
// below derives from ONE table, so adding a mode is a single edit and the
// whitelist can no longer disagree with the pickers.
export const CONDITION_VALUES_BY_MODE: Record<ConditionMode, ConditionValue[]> = {
  new_used: ['new', 'used'],
  offer_type: ['sale', 'rent', 'both'],
  rehome: ['sale', 'free'],
  graded: ['new', 'like_new', 'good', 'fair'],
};

// Every value any mode can produce -- what AppStore checks a database row
// against before trusting it. Derived, never typed out again: a value a
// picker can offer is by construction a value that survives the round
// trip. Note the overlaps are real and intended: 'new' belongs to both
// new_used and graded, 'sale' to both offer_type and rehome.
export const ALL_CONDITION_VALUES: string[] = Array.from(
  new Set(Object.values(CONDITION_VALUES_BY_MODE).flat())
);

// The seller-facing pill label, on the create form and the batch rows.
const PICKER_LABEL_KEY: Record<ConditionValue, string> = {
  new: 'createListing.condition.new',
  used: 'createListing.condition.used',
  sale: 'createListing.condition.sale',
  rent: 'createListing.condition.rent',
  both: 'createListing.condition.both',
  free: 'createListing.condition.free',
  like_new: 'createListing.condition.likeNew',
  good: 'createListing.condition.good',
  fair: 'createListing.condition.fair',
};

// The badge on a listing card. A separate set from the picker labels
// because they are read in different places and can differ: the picker
// says "Both", the card has room to say "Sale or rent".
const CARD_LABEL_KEY: Record<ConditionValue, string> = {
  new: 'listingCard.conditionNew',
  used: 'listingCard.conditionUsed',
  sale: 'listingCard.conditionSale',
  rent: 'listingCard.conditionRent',
  both: 'listingCard.conditionBoth',
  free: 'listingCard.conditionFree',
  like_new: 'listingCard.conditionLikeNew',
  good: 'listingCard.conditionGood',
  fair: 'listingCard.conditionFair',
};

// The browse filter's own labels, which are phrased for a checkbox list
// rather than a pill.
const FILTER_LABEL_KEY: Record<ConditionValue, string> = {
  new: 'home.filters.conditionNew',
  used: 'home.filters.conditionUsed',
  sale: 'home.filters.conditionSale',
  rent: 'home.filters.conditionRent',
  both: 'home.filters.conditionBoth',
  free: 'home.filters.conditionFree',
  like_new: 'home.filters.conditionLikeNew',
  good: 'home.filters.conditionGood',
  fair: 'home.filters.conditionFair',
};

// What the field itself is called. "Item condition" is wrong for a
// property and "Sale or rent" is wrong for a puppy, so the question
// travels with its answers rather than being chosen separately at each
// site and drifting.
const FIELD_LABEL_KEY: Record<ConditionMode, string> = {
  new_used: 'createListing.conditionLabel',
  offer_type: 'createListing.saleRentLabel',
  rehome: 'createListing.rehomeLabel',
  graded: 'createListing.gradedLabel',
};

// The wizard step's own name, shown when the category is already settled
// and the step has nothing left to ask but this.
const STEP_LABEL_KEY: Record<ConditionMode, string> = {
  new_used: 'createListing.stepCondition',
  offer_type: 'createListing.stepSaleOrRent',
  rehome: 'createListing.stepRehome',
  graded: 'createListing.stepCondition',
};

// The browse filter's section heading. Separate from FIELD_LABEL_KEY
// because the seller's question and the buyer's are phrased differently
// -- "Item condition" when posting, plain "Condition" when filtering --
// and because a graded section is still headed "Condition" even though
// the field asks for a grade.
export const CONDITION_FILTER_TITLE_KEY: Record<ConditionMode, string> = {
  new_used: 'home.filters.condition',
  offer_type: 'home.filters.saleRentTitle',
  rehome: 'home.filters.rehomeTitle',
  graded: 'home.filters.condition',
};

type T = (key: string) => string;

export const conditionOptionsFor = (mode: ConditionMode, t: T) =>
  CONDITION_VALUES_BY_MODE[mode].map((value) => ({ value, label: t(PICKER_LABEL_KEY[value]) }));

export const conditionFilterOptionsFor = (mode: ConditionMode, t: T) =>
  CONDITION_VALUES_BY_MODE[mode].map((value) => ({ value, label: t(FILTER_LABEL_KEY[value]) }));

export const conditionFieldLabel = (mode: ConditionMode, t: T) => t(FIELD_LABEL_KEY[mode]);

export const conditionStepLabel = (mode: ConditionMode, t: T) => t(STEP_LABEL_KEY[mode]);

export const conditionCardLabel = (value: ConditionValue, t: T) => t(CARD_LABEL_KEY[value]);

// Whether a value still means something under a given mode -- used when a
// listing's category changes across a mode boundary and its existing
// answer has to be kept or cleared. Checked against the mode's own list
// rather than a hand-written one, because the overlaps make the intuitive
// answer wrong: 'sale' belongs to two modes and 'new' to two others, so a
// re-listed value is often still perfectly valid.
export const conditionValidUnder = (mode: ConditionMode, value: string | null | undefined): boolean =>
  !!value && (CONDITION_VALUES_BY_MODE[mode] as string[]).includes(value);
