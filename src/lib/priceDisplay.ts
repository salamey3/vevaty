import { Listing } from '../types';
import { offersRent, offersSale, rentPerPeriodLabelKey, rentPerPeriodShortLabelKey } from './rentTerms';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// One line of a listing's money, split so a caller can render the label
// and the figure at different sizes. Keeping them apart is what lets the
// browse card set "Buy for" a few points smaller than "$450,000" -- the
// number is the thing the buyer came for, and it must never be the half
// that gets ellipsised.
export interface PriceLine {
  // null on most lines. Set on a card-variant line for a listing that
  // carries an offer type ("Buy for", "Rent for"), and on BOTH variants
  // for a made-to-order listing ("From"), where the label is not
  // decoration but the difference between a price and a starting price.
  label: string | null;
  amount: string;
}

// The flat "Buy for $450,000" form, for callers with room for one plain
// string and no need to size the halves differently.
export function priceLineText(line: PriceLine): string {
  return line.label ? `${line.label} ${line.amount}` : line.amount;
}

// What a listing's money actually reads as, in one place, so the card and
// the detail hero can never disagree about it.
//
// `primary` is the headline. `secondary` is the extra line a property
// offered for BOTH sale and rent needs -- the sale price leads, the rent
// sits under it -- and is null for everything else, which is the
// overwhelming majority of listings.
//
// A rent-only listing has its rent value mirrored into `price` (see
// Listing.price), so this reads rentPrice with a price fallback rather
// than assuming one or the other is populated.
//
// The two variants differ only for properties, and only in how much room
// they assume:
//
//   'card'   Labels each figure ("Buy for", "Rent for") and abbreviates
//            the period ("$12,000/yr"). The label says what the figure
//            IS, which lets a browse card drop the condition pill
//            altogether -- clearer than a bare number beside a "SALE OR
//            RENT" badge, and narrower, which matters because that badge
//            was squeezing the price itself into "$450,...".
//
//   'detail' Bare figures with the period spelled out ("$12,000 / year").
//            The default: a full-width price line with its own rent-terms
//            block underneath needs neither the label nor the shortening.
//
// An OFFER-TYPE label is never applied to a listing without an offer type,
// where "Buy for $500" on a used phone would be noise -- anything that
// isn't offered both ways is for sale, so saying so adds nothing.
//
// The made-to-order "From" is the one label that is not an offer-type
// label, and it therefore breaks both of those rules on purpose: it
// appears on a listing with no offer type, and in both variants. It is
// not saying what kind of deal this is; it is saying the figure is not
// the whole figure, which no other line on either screen says.
export function listingPriceLines(
  listing: Listing,
  t: Translate,
  opts?: { variant?: 'card' | 'detail' }
): { primary: PriceLine; secondary: PriceLine | null } {
  // Given away rather than sold. The figure IS the answer here, and "$0"
  // reads as a placeholder or a mistake rather than as a gift -- so the
  // word replaces the number outright, in both variants.
  if (listing.condition === 'free') {
    return { primary: { label: null, amount: t('listingCard.freeAmount') }, secondary: null };
  }

  // Made to order: the figure is where the price STARTS. What the buyer
  // actually pays depends on the size, the base and the add-ons they
  // choose, so a bare "$45" over a listing whose real total is $140 is a
  // number the seller spends every conversation correcting -- and the
  // buyer who only reads the card never gets as far as the conversation.
  //
  // Labelled in BOTH variants, unlike the sale/rent labels below. Those
  // are card-only because a card is the one place with no room to say it
  // any other way -- the detail page has a rent-terms block under the
  // hero doing the same work in full sentences. Nothing on the detail
  // page says "this is a starting price", so this label has to.
  if (listing.condition === 'to_order') {
    return {
      primary: { label: t('listingCard.fromLabel'), amount: `$${listing.price.toLocaleString()}` },
      secondary: null,
    };
  }

  const isCard = opts?.variant === 'card';
  const isSale = offersSale(listing.condition);
  const isRent = offersRent(listing.condition);

  const saleAmount = `$${listing.price.toLocaleString()}`;
  const rentValue = listing.rentPrice ?? listing.price;
  // A rental saved through the create form always has a period (the form
  // requires one), so the bare-amount fallback only ever covers a row
  // written before these columns existed.
  const rentAmount = listing.rentPeriod
    ? t(isCard ? rentPerPeriodShortLabelKey(listing.rentPeriod) : rentPerPeriodLabelKey(listing.rentPeriod), {
        amount: rentValue.toLocaleString(),
      })
    : `$${rentValue.toLocaleString()}`;

  const saleLine: PriceLine = {
    label: isCard && isSale ? t('listingCard.saleForLabel') : null,
    amount: saleAmount,
  };
  const rentLine: PriceLine = {
    label: isCard && isRent ? t('listingCard.rentForLabel') : null,
    amount: rentAmount,
  };

  // Offered both ways: sale leads, rent follows on its own line.
  if (isSale && isRent) return { primary: saleLine, secondary: rentLine };
  if (isRent) return { primary: rentLine, secondary: null };
  // For sale, or any non-property listing.
  return { primary: saleLine, secondary: null };
}
