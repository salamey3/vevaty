import { Listing } from '../types';
import { offersRent, offersSale, rentPerPeriodLabelKey } from './rentTerms';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// What a listing's money actually reads as, in one place, so the card and
// the detail hero can never disagree about it.
//
// `primary` is the big number. `secondary` is the extra line a property
// offered for BOTH sale and rent needs -- the sale price is the headline,
// the rent sits under it -- and is null for everything else, which is the
// overwhelming majority of listings.
//
// A rent-only listing has its rent value mirrored into `price` (see
// Listing.price), so this reads rentPrice with a price fallback rather
// than assuming one or the other is populated.
export function listingPriceLines(
  listing: Listing,
  t: Translate
): { primary: string; secondary: string | null } {
  const rentAmount = listing.rentPrice ?? listing.price;
  // A rental saved through the create form always has a period (the form
  // requires one), so the bare-amount fallback only ever covers a row
  // written before these columns existed.
  const rentLine = listing.rentPeriod
    ? t(rentPerPeriodLabelKey(listing.rentPeriod), { amount: rentAmount.toLocaleString() })
    : `$${rentAmount.toLocaleString()}`;

  // Offered both ways: sale price leads, rent follows on its own line.
  if (offersSale(listing.condition) && offersRent(listing.condition)) {
    return { primary: `$${listing.price.toLocaleString()}`, secondary: rentLine };
  }
  // Rent only.
  if (offersRent(listing.condition)) {
    return { primary: rentLine, secondary: null };
  }
  // Everything else -- for sale, or any non-property listing.
  return { primary: `$${listing.price.toLocaleString()}`, secondary: null };
}
