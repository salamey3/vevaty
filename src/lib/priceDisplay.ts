import { Listing } from '../types';
import { offersRent, offersSale, rentPerPeriodLabelKey, rentPerPeriodShortLabelKey } from './rentTerms';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// One line of a listing's money, split so a caller can render the label
// and the figure at different sizes. Keeping them apart is what lets the
// browse card set "Buy for" a few points smaller than "$450,000" -- the
// number is the thing the buyer came for, and it must never be the half
// that gets ellipsised.
export interface PriceLine {
  // null for every non-property listing, and on the detail variant.
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
// A label is never applied to a non-property listing, where "Buy for
// $500" on a used phone would be noise -- everything on the marketplace
// that isn't a property is for sale, so saying so adds nothing.
export function listingPriceLines(
  listing: Listing,
  t: Translate,
  opts?: { variant?: 'card' | 'detail' }
): { primary: PriceLine; secondary: PriceLine | null } {
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
