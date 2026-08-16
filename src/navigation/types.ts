import { CategoryId, SavedSearchCriteria } from '../types';

export type RootStackParamList = {
  LanguageSelect: undefined;
  MainTabs: undefined;
  ListingDetail: { listingId: string };
  CreateListing: { initialCategory?: CategoryId; editListingId?: string } | undefined;
  // Phone-OTP login/signup. When returnTo is set, a successful login
  // replaces this screen with that route (e.g. "Sell an item" while
  // logged out); when omitted, it just goes back to whatever screen
  // opened it (e.g. the seller-contact reveal on ListingDetail, which
  // re-renders on its own once AppStore's isVerified flips true).
  Auth: { returnTo?: keyof RootStackParamList; returnToParams?: any } | undefined;
  Payment: { listingId: string };
  ChatThread: { threadId: string };
  Favorites: undefined;
  SellerProfile: { sellerId: string };
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
