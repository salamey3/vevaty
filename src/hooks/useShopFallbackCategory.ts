import { useMemo } from 'react';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { Category } from '../types';

// What a storefront's own category can answer when the photos cannot.
//
// A shop says what it sells (see MyStorefrontScreen); that is a top-level
// category, which usually covers many postable ones and so is a narrowing
// rather than an answer. Sometimes it covers exactly one -- a car dealer
// inside Vehicles, a broker inside Properties -- and then it IS an answer,
// and a better one than a blank required field.
//
// Used only where the classifier said, honestly, that it could not tell.
// Deliberately NOT used to:
//
//   - constrain what the classifier may return. A phone shop listing an
//     office chair would get a confident wrong answer instead of a right
//     one, and the seller cannot spot an error in a list they were never
//     shown.
//   - settle the category outright, the way a one-category DOMAIN does.
//     The domain is a hard wall; a shop's category is a pre-selection (see
//     DOMAINS.md), and a car dealer has to be able to list a spare part
//     without first editing their storefront settings.
//
// So: offered, never imposed, and only when nothing better is available.
// Both flows use this same hook, because a merchant photographing the same
// item through the single-item wizard and through a batch must not get two
// different answers.
export function useShopFallbackCategory(
  attachToShop: boolean,
  domainId: string | null | undefined
): Category | null {
  const { myShop } = useAppStore();
  const { allCategories, childrenOf, categoryMatches, domainOfCategory } = useSettings();

  return useMemo(() => {
    // verifiedAt, not just attachToShop: an unverified shop's listings are
    // saved with no shopId at all (see CreateListingScreen's buildPayload
    // and BatchPhotosScreen's shopId), so answering from a storefront the
    // listing is not actually being posted into would file it under a
    // shop that never claimed it. Checked here rather than at each call
    // site, since forgetting it is silent.
    const shopCat = attachToShop && myShop?.verifiedAt ? myShop.primaryCategoryId : null;
    if (!shopCat) return null;
    const under = allCategories.filter(
      (c) =>
        c.active &&
        childrenOf(c.id).length === 0 &&
        categoryMatches(c.id, shopCat) &&
        // No section in force -- the /sell deep link, which skips the
        // gate -- means there is no section to respect, not that the
        // check was forgotten. The classifier is unconstrained there too.
        (!domainId || domainOfCategory(c.id)?.id === domainId)
    );
    return under.length === 1 ? under[0] : null;
  }, [attachToShop, myShop, allCategories, childrenOf, categoryMatches, domainId, domainOfCategory]);
}
