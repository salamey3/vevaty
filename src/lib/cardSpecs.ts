import { AttributeValue, Category, CategoryAttribute, Listing } from '../types';
import { IconName } from '../icons/Icon';
import { attrHasValue, formatAttrValue } from './attributeFormat';
import { conditionShownInPrice } from './rentTerms';
import { conditionCardLabel } from './conditionModes';
import { resolveVisibleAttrs } from './attributeVisibility';

// Everything a listing card says about WHAT the thing is, decided in one
// place: the label on its pill, and the two-or-three specs printed under
// the price.
//
// One consumer today, ListingCard, which is exactly why it is here rather
// than inside it. The version this replaced
// derived its specs inline in ListingCard with "take the required
// attributes, first two, in form order", and nothing but that component
// knew the rule.
//
// Why that rule had to go. `required` answers "would I refuse to publish
// this listing without it?", which is a completeness question. A card asks
// something quite different: "what would make a buyer stop scrolling?".
// They coincide often enough to look fine and diverge exactly where it
// costs most. Properties' required list begins property type, floor number,
// floors in building, total units -- so a Jounieh apartment card printed the
// floor number and never reached bedrooms, bathrooms or area, which sit
// fifth, sixth and seventh. The answer is an explicit editorial choice per
// category (`card_priority`), not a cleverer heuristic.

export type CardSpec = {
  slug: string;
  // Null for attributes whose value speaks for itself -- "Male", "Female",
  // "Seats 5". The card prints a short label in place of the glyph rather
  // than reaching for an approximate one; see SPEC_ICON_NAMES.
  icon: IconName | null;
  // Shown only when there is no icon, so the number is never orphaned.
  label: string;
  // Already formatted for display: options resolved to their labels in the
  // right language, units appended.
  value: string;
};

// How many specs a card shows. Three, matching the number a person can take
// in from a grid without reading -- and the number the reference cards that
// prompted this all landed on independently. A card with fewer simply shows
// fewer; nothing is padded to fill the row.
export const MAX_CARD_SPECS = 3;

// How many values of a multiselect a card prints before summarising the
// rest. A shoe listed in five sizes is real and common, and
// "38, 39, 40, 41, 42" is not a spec -- it is a paragraph in a slot meant
// for a glance. Two plus a count says the same thing in the same space.
const MAX_MULTISELECT_VALUES_ON_CARD = 2;

function formatCardValue(
  attr: CategoryAttribute,
  value: AttributeValue | undefined,
  language: 'en' | 'ar'
): string {
  if (attr.type === 'multiselect' && Array.isArray(value) && value.length > MAX_MULTISELECT_VALUES_ON_CARD) {
    const shown = value.slice(0, MAX_MULTISELECT_VALUES_ON_CARD);
    const rest = value.length - shown.length;
    // formatAttrValue does the option-label resolution; this only decides
    // how many of them to hand it.
    return `${formatAttrValue(attr, shown, language).trim()} +${rest}`;
  }
  return formatAttrValue(attr, value, language).trim();
}


// The pill: what KIND of thing this is.
//
// Normally the category's own name, which is what a buyer would call it.
// The exception is a category that was collapsed into a single postable
// leaf with its real kind moved into an attribute -- Properties and
// Vehicles -- where the category name has become a section heading rather
// than a description. "Properties" over a photo of an apartment is a label
// that tells nobody anything; "Apartment" is the answer.
//
// `cardKindSlug` must be resolved by the CALLER through the store's
// nearest-ancestor walk, not read off the category row, for the same reason
// conditionMode is: a leaf inherits it from the branch it hangs off.
export function cardKindLabel(
  category: Category | undefined,
  cardKindSlug: string | null,
  attrs: CategoryAttribute[],
  listing: Listing,
  language: 'en' | 'ar'
): string | null {
  if (cardKindSlug) {
    const attr = attrs.find((a) => a.slug === cardKindSlug);
    const value = attr ? listing.attributes?.[attr.slug] : undefined;
    // A multiselect cannot be the kind: it joins with commas and would
    // overflow a pill meant to hold one word. Tested on the TYPE, not on
    // whether the rendered text happens to contain a comma -- that test got
    // it wrong in both directions, accepting a multiselect with exactly one
    // value selected, and rejecting a plain select whose option label
    // legitimately reads "Yes, unopened".
    if (attr && attr.type !== 'multiselect' && attrHasValue(value)) {
      const text = formatAttrValue(attr, value, language).trim();
      // And the value has to be one the attribute actually offers.
      // formatAttrValue falls back to String(value) for a select whose
      // option an admin has since renamed or deleted, which would print the
      // raw slug -- "vacation_rental" -- in the pill. The category name is a
      // less specific label; a snake_case slug is a broken one.
      const known = attr.type !== 'select' || attr.options.some((o) => o.value === value);
      if (text && known) return text;
    }
    // Deliberately falls through rather than returning null. A listing
    // posted before the attribute existed, or one whose seller never
    // answered it, still deserves a pill -- the category name is a worse
    // label, not a wrong one.
  }
  if (!category) return null;
  return (language === 'ar' ? category.nameAr : category.nameEn) || null;
}

// The condition badge: what STATE the thing is in.
//
// Normally `listings.condition` itself, which is what every ordinary
// category answers New/Used (or, on Fashion, with a wear grade).
//
// The exception is the categories where that column is not answering a
// condition question at all. It carries four different questions depending
// on the category's conditionMode (see ConditionMode), and two of them are
// about the OFFER rather than the item: Vehicles and Properties are
// `offer_type`, so their column holds sale/rent/both, and Pets are `rehome`,
// holding sale/free. The card already refuses to print those, because the
// price lines say the same thing in more words -- "Buy for $22,000" beside a
// "For sale" pill is one sentence twice.
//
// The cost of that was invisible until someone looked for it: a car card had
// no New/Used on it anywhere, though every seller had answered the question
// -- into `vehicle_condition`, an attribute nothing on the card read. Same
// for a property's construction_status. `cardConditionSlug` points at
// whichever attribute holds the real answer, and it is resolved by the
// caller through the store's nearest-ancestor walk for the same reason
// cardKindSlug is: a leaf inherits it from the branch it hangs off.
//
// Pets get nothing from this and should: a puppy is not new or used. The
// mechanism is opt-in per category rather than a fallback that hunts for
// something condition-shaped, precisely so that stays true.
export function cardConditionLabel(
  listing: Listing,
  cardConditionSlug: string | null,
  attrs: CategoryAttribute[],
  language: 'en' | 'ar',
  t: (key: string) => string
): string | null {
  // The universal column wins wherever it is genuinely about condition. It
  // is the only one of the two that is guaranteed present on every listing
  // in its category, so a category that has both keeps the reliable one.
  if (listing.condition && !conditionShownInPrice(listing.condition)) {
    return conditionCardLabel(listing.condition, t);
  }
  if (!cardConditionSlug || !listing.attributes) return null;
  // resolveVisibleAttrs, NOT a plain find. construction_status is hidden for
  // a plot of land, a room and a vacation rental (depends_on_slug), and a
  // seller who picks Apartment, answers it, then switches to Land leaves the
  // value behind in the row -- the form stops asking, but nothing deletes
  // what was already typed. Reading the raw attribute would print SECONDARY
  // on a card for a field of dirt, and this would be the only surface in the
  // app doing so: the create form, the AI schema, the review summary and the
  // spec row all go through this same filter.
  const attr = resolveVisibleAttrs(attrs, listing.attributes, listing.condition)
    .find((a) => a.slug === cardConditionSlug);
  if (!attr) return null;
  const value = listing.attributes[attr.slug];
  // Same two guards cardKindLabel applies, and for the same reasons: a
  // multiselect joins with commas and would overflow a pill sized for one
  // word, and formatAttrValue falls back to String(value) for a select whose
  // option an admin has since renamed, which would print a raw snake_case
  // slug where a buyer expects a word.
  //
  // Only multiselect is rejected outright, not every non-select. A boolean
  // would print a tick, a number "94,975 km", a text field whatever the
  // seller typed -- all wrong in a badge, none of them reachable from the
  // admin, whose switch is select-only and clears itself when a field's type
  // changes. Same gap cardKindLabel has, named here rather than defended
  // against twice.
  if (attr.type === 'multiselect' || !attrHasValue(value)) return null;
  if (attr.type === 'select' && !attr.options.some((o) => o.value === value)) return null;
  const text = formatAttrValue(attr, value, language).trim();
  return text || null;
}

// The spec row.
//
// Order is `cardPriority` ascending, and ONLY attributes that have one --
// an attribute with no priority is not a card attribute, however important
// it looks. A category nobody has curated yet therefore shows no spec row
// at all, which is the honest state: better an empty row than three fields
// picked by an algorithm that does not know what a buyer cares about.
export function resolveCardSpecs(
  attrs: CategoryAttribute[],
  listing: Listing,
  language: 'en' | 'ar',
  // The listing's own title, to suppress specs that merely repeat it. A car
  // titled "Honda Civic 2018" showing "2018" beside it wastes one of three
  // slots restating what the line above already said.
  title: string,
  // The attribute this category NOMINATES for the condition badge, if any.
  // Excluded here for the same reason the title is: the badge sits four
  // lines above the spec row, so a category whose admin gives that attribute
  // a cardPriority as well would spend one of three slots saying "Secondary"
  // twice. Neither category does today; both could tomorrow, from a screen
  // where the two settings are separate switches.
  //
  // Dropped whether or not the badge actually printed -- when the universal
  // column won it, when the value is missing, when the option was renamed.
  // The alternative is threading the badge's rendered source down here, and
  // "the field this category treats as its condition" is a better thing for
  // the spec row to be blind to than "the field that happened to render".
  cardConditionSlug: string | null = null
): CardSpec[] {
  if (!listing.attributes) return [];
  const haystack = title.toLowerCase();

  // Conditional visibility first, and it does real work here rather than
  // being a formality: bedrooms and bathrooms are hidden for a plot of
  // land, so a land listing falls through to area and view instead of
  // printing two blanks or, worse, values left behind by a seller who
  // changed the property type halfway through posting.
  return resolveVisibleAttrs(attrs, listing.attributes, listing.condition)
    // Whatever the badge above is for -- see this function's own parameter
    // doc for why it goes whether or not the badge printed.
    .filter((a) => a.slug !== cardConditionSlug)
    // `!= null`, not `!== null`: an attribute reaching here with an
    // UNDEFINED cardPriority (a fixture, a future mapper that forgets the
    // field) would otherwise pass this filter and then make the comparator
    // return NaN, which leaves the whole spec row in an arbitrary order
    // rather than failing in any way anyone would notice.
    .filter((a) => a.cardPriority != null && attrHasValue(listing.attributes[a.slug]))
    .sort((a, b) => (a.cardPriority as number) - (b.cardPriority as number))
    .map((attr) => ({
      slug: attr.slug,
      icon: attr.icon,
      label: language === 'ar' ? attr.labelAr : attr.labelEn,
      value: formatCardValue(attr, listing.attributes[attr.slug], language),
    }))
    .filter((s) => !!s.value && !repeatsTitle(s.value, haystack))
    .slice(0, MAX_CARD_SPECS);
}

// Does this spec merely restate the title?
//
// Two conditions, and both are load-bearing.
//
// WHOLE WORD, because the values here are often one or two characters and a
// bare substring test misfires on them: "Male" is inside "female", and a
// seats value of "5" is inside any title containing a 5. A card that
// randomly drops a spec depending on the seller's wording is worse than one
// that occasionally repeats itself.
//
// AT LEAST FOUR CHARACTERS, because that is what separates a coincidence
// from a repetition. "2018" under "Honda Civic 2018" is a wasted slot out of
// three. "3" under "3 bedroom apartment" is not -- the glyph beside it is
// doing different work from the sentence, and suppressing it would leave a
// property card showing bathrooms and area with a conspicuous hole where the
// bedrooms belong.
//
// The rule this replaced keyed off whether the spec had an ICON, which was
// the wrong axis entirely: it made the year on every car card exempt, so the
// one worked example the design was written around never actually happened.
const MIN_REPEAT_LENGTH = 4;

function repeatsTitle(value: string, lowercaseTitle: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length < MIN_REPEAT_LENGTH) return false;
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(lowercaseTitle);
}
