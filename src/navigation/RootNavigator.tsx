import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import LanguageSelectScreen from '../screens/LanguageSelectScreen';
import MainTabs from './MainTabs';
import ListingDetailScreen from '../screens/ListingDetailScreen';
import CreateListingScreen from '../screens/CreateListingScreen';
import SellHubScreen from '../screens/SellHubScreen';
import BatchPhotosScreen from '../screens/batch/BatchPhotosScreen';
import BatchReviewScreen from '../screens/batch/BatchReviewScreen';
import BatchVerificationShotsScreen from '../screens/batch/BatchVerificationShotsScreen';
import BatchDetailsScreen from '../screens/batch/BatchDetailsScreen';
import BatchLocationContactScreen from '../screens/batch/BatchLocationContactScreen';
import BatchFinalReviewScreen from '../screens/batch/BatchFinalReviewScreen';
import AuthScreen from '../screens/AuthScreen';
import ChangePhoneScreen from '../screens/ChangePhoneScreen';
import EditNameScreen from '../screens/EditNameScreen';
import EditLocationScreen from '../screens/EditLocationScreen';
import EditContactScreen from '../screens/EditContactScreen';
import PaymentScreen from '../screens/PaymentScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import MyListingsScreen from '../screens/MyListingsScreen';
import SellerProfileScreen from '../screens/SellerProfileScreen';
import ShopsDirectoryScreen from '../screens/ShopsDirectoryScreen';
import StorefrontScreen from '../screens/StorefrontScreen';
import CollectionScreen from '../screens/CollectionScreen';
import MyStorefrontScreen from '../screens/MyStorefrontScreen';
import AdminShopsScreen from '../screens/admin/AdminShopsScreen';
import AdminGateScreen from '../screens/admin/AdminGateScreen';
import AdminCategoriesScreen from '../screens/admin/AdminCategoriesScreen';
import AdminCategoryAttributesScreen from '../screens/admin/AdminCategoryAttributesScreen';
import AdminBrandingScreen from '../screens/admin/AdminBrandingScreen';
import AdminModerationScreen from '../screens/admin/AdminModerationScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminCollectionsScreen from '../screens/admin/AdminCollectionsScreen';
import AdminBannersScreen from '../screens/admin/AdminBannersScreen';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Real, shareable URLs for the pieces of the app that make sense to link
// to directly -- a listing page, browse, messages, profile -- instead of
// everything living behind one unchanging root URL. This is a plain
// client-side stack, so linking here is what actually gives each screen
// its own browser history entry / address-bar URL / reload-safe deep link.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [],
  config: {
    screens: {
      LanguageSelect: 'language',
      MainTabs: {
        screens: {
          HomeTab: {
            screens: {
              HomeRoot: '',
              // Not a bare ':domain' at the root: that would swallow
              // 'shops', 'favorites' and every other top-level path.
              HomeDomain: 'section/:domain',
              HomeCategory: 'category/:cat',
            },
          },
          ChatTab: 'messages',
          ProfileTab: 'profile',
        },
      },
      ListingDetail: 'listing/:listingId',
      CreateListing: 'sell',
      // The hub gets its own link rather than taking over 'sell' -- an
      // existing bookmark/deep link to 'sell' keeps landing straight in
      // the single-item wizard, unbroken. The batch screens themselves
      // aren't given linking entries: every one after the first requires a
      // live batchId from an in-progress session (created by the capture
      // screen, the first time an item is actually captured), so there's
      // no meaningful bare URL to deep-link into mid-batch -- they're
      // still reachable via in-app navigation.navigate() as usual.
      SellHub: 'sell/start',
      Auth: 'login',
      ChangePhone: 'change-phone',
      EditName: 'edit-name',
      EditLocation: 'edit-location',
      EditContact: 'edit-contact',
      Payment: 'listing/:listingId/payment',
      ChatThread: 'messages/:threadId',
      Favorites: 'favorites',
      MyListings: 'my-listings',
      SellerProfile: 'seller/:sellerId',
      Shops: 'shops',
      Storefront: 'shop/:shopSlug',
      Collection: 'collection/:slug',
      MyStorefront: 'storefront/manage',
      AdminShops: 'admin/storefronts',
      Admin: 'admin',
      AdminCategories: 'admin/categories',
      AdminCategoryAttributes: 'admin/categories/:categoryId/attributes',
      AdminBranding: 'admin/branding',
      AdminModeration: 'admin/moderation',
      AdminUsers: 'admin/users',
      AdminReports: 'admin/reports',
      AdminCollections: 'admin/collections',
      AdminBanners: 'admin/banners',
    },
  },
};

export default function RootNavigator() {
  const { ready } = useAppStore();
  const { ready: langReady, chosen } = useLanguage();
  if (!ready || !langReady) return null;

  // Browsing is fully anonymous now -- no forced name/district screen
  // before Home. The only remaining first-run choice is language.
  const initialRouteName = !chosen ? 'LanguageSelect' : 'MainTabs';

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="LanguageSelect" component={LanguageSelectScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="ListingDetail" component={ListingDetailScreen} />
        <Stack.Screen name="CreateListing" component={CreateListingScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="SellHub" component={SellHubScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchPhotos" component={BatchPhotosScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchReview" component={BatchReviewScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchVerificationShots" component={BatchVerificationShotsScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchDetails" component={BatchDetailsScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchLocationContact" component={BatchLocationContactScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="BatchFinalReview" component={BatchFinalReviewScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Auth" component={AuthScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="ChangePhone" component={ChangePhoneScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="EditName" component={EditNameScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="EditLocation" component={EditLocationScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="EditContact" component={EditContactScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Payment" component={PaymentScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="ChatThread" component={ChatThreadScreen} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} />
        <Stack.Screen name="MyListings" component={MyListingsScreen} />
        <Stack.Screen name="SellerProfile" component={SellerProfileScreen} />
        <Stack.Screen name="Shops" component={ShopsDirectoryScreen} />
        <Stack.Screen name="Storefront" component={StorefrontScreen} />
        <Stack.Screen name="Collection" component={CollectionScreen} />
        <Stack.Screen name="MyStorefront" component={MyStorefrontScreen} />
        <Stack.Screen name="AdminShops" component={AdminShopsScreen} />
        <Stack.Screen name="Admin" component={AdminGateScreen} />
        <Stack.Screen name="AdminCategories" component={AdminCategoriesScreen} />
        <Stack.Screen name="AdminCategoryAttributes" component={AdminCategoryAttributesScreen} />
        <Stack.Screen name="AdminBranding" component={AdminBrandingScreen} />
        <Stack.Screen name="AdminModeration" component={AdminModerationScreen} />
        <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
        <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
        <Stack.Screen name="AdminCollections" component={AdminCollectionsScreen} />
        <Stack.Screen name="AdminBanners" component={AdminBannersScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
