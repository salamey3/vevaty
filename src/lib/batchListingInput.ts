import { Listing } from '../types';
import { ListingInput } from '../store/AppStore';

// Turns an already-loaded Listing back into the shape updateListing
// expects, for the batch screens' common "patch a couple of fields on an
// existing batch item" pattern (confirm a category, fill in specs/stock,
// fix the shared location, park it as a draft, etc.). updateListing takes
// a full ListingInput, not a partial, so every batch screen that only
// means to change one or two fields still has to resupply the rest of
// the item's current state alongside them -- keeping that translation in
// one place means the field list can only drift out of sync with
// ListingInput in one spot, not once per screen.
//
// `patch` fields win over what's read off `listing` -- pass only what
// changed. Defaults `status` to 'draft' (keeps the item parked-in-progress,
// the right default for every batch screen except the final "Post N
// items" submit loop) -- BatchFinalReviewScreen overrides it explicitly
// with `status: undefined` to get the real draft->pending_review
// transition updateListing gives any OTHER listing being submitted for
// the first time (see updateListing's own `asDraft`/`submittingDraft`
// logic in AppStore.tsx).
//
// batchId is carried over for completeness even though updateListing's
// own SQL update never actually writes batch_id back -- see Listing.
// batchId's doc comment for why an item can never be moved out of its
// batch this way regardless.
export function listingToInput(listing: Listing, patch: Partial<ListingInput> = {}): ListingInput {
  return {
    cat: listing.cat,
    condition: listing.condition,
    titleEn: listing.titleEn,
    titleAr: listing.titleAr,
    descriptionEn: listing.descriptionEn,
    descriptionAr: listing.descriptionAr,
    price: listing.price,
    rentPrice: listing.rentPrice,
    rentPeriod: listing.rentPeriod,
    rentPaymentFrequency: listing.rentPaymentFrequency,
    district: listing.district,
    governorate: listing.governorate,
    caza: listing.caza,
    geonameId: listing.geonameId,
    lat: listing.lat,
    lng: listing.lng,
    photos: listing.photos,
    spinSets: listing.spinSets,
    video: listing.video,
    aiGenerated: listing.aiGenerated,
    attributes: listing.attributes,
    contactMethod: listing.contactMethod,
    shopId: listing.shopId,
    stockQty: listing.stockQty,
    variants: listing.variants,
    batchId: listing.batchId,
    batchParked: listing.batchParked,
    status: 'draft',
    ...patch,
  };
}
