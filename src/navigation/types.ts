import { CategoryId, SavedSearchCriteria } from '../types';

export type RootStackParamList = {
  LanguageSelect: undefined;
  MainTabs: undefined;
  ListingDetail: { listingId: string };
  // shopChoice is set when SellHubScreen's ShopChoiceGate already answered
  // "standalone or into my shop?" upfront -- see CreateListingScreen's own
  // shopChoiceResolved seeding. Omitted (undefined) for every other entry
  // point, which is what makes CreateListingScreen's own internal gate
  // fire exactly as it always has (e.g. a direct deep link).
  CreateListing: { initialCategory?: CategoryId; editListingId?: string; shopChoice?: { attachToShop: boolean } } | undefined;
  // "Sell on Vevaty" hub -- the new front door for posting (see
  // src/screens/SellHubScreen.tsx). No params: it always operates on the
  // signed-in seller's own myShop, same as MyStorefront.
  SellHub: undefined;
  // Batch listings ("sell a bunch of items") -- see src/screens/batch/*.tsx.
  // shopChoice on BatchPhotos only: SellHubScreen resolves it once, before
  // the batch even exists, and the batch's own listings rows are the only
  // place it needs to be threaded through from there.
  BatchPhotos: { batchId: string; shopChoice?: { attachToShop: boolean } };
  BatchReview: { batchId: string };
  BatchDetails: { batchId: string };
  BatchLocationContact: { batchId: string };
  BatchFinalReview: { batchId: string };
  // Phone-OTP login/signup. When returnTo is set, a successful login
  // replaces this screen with that route (e.g. "Sell an item" while
  // logged out); when omitted, it just goes back to whatever screen
  // opened it (e.g. the seller-contact reveal on ListingDetail, which
  // re-renders on its own once AppStore's isVerified flips true).
  Auth: { returnTo?: keyof RootStackParamList; returnToParams?: any } | undefined;
  // Swaps an already-verified account's phone number to a new,
  // freshly-OTP-verified one, keeping the same account (uid) and all its
  // history -- distinct from Auth above, which signs in/up. No params:
  // always operates on the current session, never someone else's.
  ChangePhone: undefined;
  Payment: { listingId: string };
  ChatThread: { threadId: string };
  Favorites: undefined;
  SellerProfile: { sellerId: string };
  // The public "browse every verified shop" directory -- no params, always
  // shows the full live set (see ShopsDirectoryScreen).
  Shops: undefined;
  Storefront: { shopSlug: string };
  // The signed-in seller's own shop -- create or manage. No params: it
  // always operates on AppStore's myShop, never someone else's.
  MyStorefront: undefined;
  AdminShops: undefined;
  Admin: undefined;
  AdminCategories: undefined;
  AdminCategoryAttributes: { categoryId: string; focusFilters?: boolean };
  AdminBranding: undefined;
  AdminModeration: undefined;
  AdminUsers: undefined;
  AdminReports: undefined;
};

export type MainTabParamList = {
  HomeTab: undefined;
  SellTab: undefined;
  ChatTab: undefined;
  ProfileTab: undefined;
};

// HomeTab is itself a small nested stack (see navigation/HomeStack.tsx),
// not a single screen. Both routes render the exact same HomeScreen
// component -- the only difference is whether `cat` is set -- but giving
// "a category is selected" its own real stack entry is what makes it a
// genuine back-stop: entering a category is an actual push (so hardware/
// browser back correctly pops back to "all categories" instead of local
// component state silently eating the back button and exiting the app).
export type HomeStackParamList = {
  HomeRoot: undefined;
  // applyCriteria is set when arriving via "Run" on a saved search --
  // HomeScreen seeds its filter state from it on mount, then scrubs it
  // back out via navigation.setParams so a later plain category tap
  // doesn't accidentally re-apply a stale saved search.
  HomeCategory: { cat: CategoryId; applyCriteria?: SavedSearchCriteria };
};
