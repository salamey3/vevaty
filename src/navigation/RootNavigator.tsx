import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import LanguageSelectScreen from '../screens/LanguageSelectScreen';
import MainTabs from './MainTabs';
import ListingDetailScreen from '../screens/ListingDetailScreen';
import CreateListingScreen from '../screens/CreateListingScreen';
import AuthScreen from '../screens/AuthScreen';
import PaymentScreen from '../screens/PaymentScreen';
import ChatThreadScreen from '../screens/ChatThreadScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import SellerProfileScreen from '../screens/SellerProfileScreen';
import ShopsDirectoryScreen from '../screens/ShopsDirectoryScreen';
import StorefrontScreen from '../screens/StorefrontScreen';
import MyStorefrontScreen from '../screens/MyStorefrontScreen';
import AdminShopsScreen from '../screens/admin/AdminShopsScreen';
import AdminGateScreen from '../screens/admin/AdminGateScreen';
import AdminCategoriesScreen from '../screens/admin/AdminCategoriesScreen';
import AdminCategoryAttributesScreen from '../screens/admin/AdminCategoryAttributesScreen';
import AdminBrandingScreen from '../screens/admin/AdminBrandingScreen';
import AdminModerationScreen from '../screens/admin/AdminModerationScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
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
              HomeCategory: 'category/:cat',
            },
          },
          ChatTab: 'messages',
          ProfileTab: 'profile',
        },
      },
      ListingDetail: 'listing/:listingId',
      CreateListing: 'sell',
      Auth: 'login',
      Payment: 'listing/:listingId/payment',
      ChatThread: 'messages/:threadId',
      Favorites: 'favorites',
      SellerProfile: 'seller/:sellerId',
      Shops: 'shops',
      Storefront: 'shop/:shopSlug',
      MyStorefront: 'storefront/manage',
      AdminShops: 'admin/storefronts',
      Admin: 'admin',
      AdminCategories: 'admin/categories',
      AdminCategoryAttributes: 'admin/categories/:categoryId/attributes',
      AdminBranding: 'admin/branding',
      AdminModeration: 'admin/moderation',
      AdminUsers: 'admin/users',
      AdminReports: 'admin/reports',
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
        <Stack.Screen name="Auth" component={AuthScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="Payment" component={PaymentScreen} options={{ presentation: 'modal' }} />
        <Stack.Screen name="ChatThread" component={ChatThreadScreen} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} />
        <Stack.Screen name="SellerProfile" component={SellerProfileScreen} />
        <Stack.Screen name="Shops" component={ShopsDirectoryScreen} />
        <Stack.Screen name="Storefront" component={StorefrontScreen} />
        <Stack.Screen name="MyStorefront" component={MyStorefrontScreen} />
        <Stack.Screen name="AdminShops" component={AdminShopsScreen} />
        <Stack.Screen name="Admin" component={AdminGateScreen} />
        <Stack.Screen name="AdminCategories" component={AdminCategoriesScreen} />
        <Stack.Screen name="AdminCategoryAttributes" component={AdminCategoryAttributesScreen} />
        <Stack.Screen name="AdminBranding" component={AdminBrandingScreen} />
        <Stack.Screen name="AdminModeration" component={AdminModerationScreen} />
        <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
        <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
