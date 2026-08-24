import { Linking, Platform } from 'react-native';
import { NavigationProp } from '@react-navigation/native';
import { Banner } from '../types';
import { RootStackParamList } from '../navigation/types';

// What happens when someone taps a banner -- one function shared by every
// BannerSlot, so the platform/tab-behavior logic (see the design spec's
// Section 4) lives in exactly one place instead of being re-decided at
// each render site.
//
// Internal destinations (collection/category/listing) always navigate
// within the app, on every platform -- there's no reason to leave an app
// that already has the destination, and "open in new tab" has no
// meaning for a screen that's already part of this app's own stack.
//
// External URLs: on native there is no browser-tab concept at all, so
// Linking.openURL always hands off to the device's default browser
// regardless of openNewTab (mirrors legalLinks.ts's openLegalPage). On
// web, openNewTab actually changes behavior -- react-native-web's
// Linking.openURL opens a new tab (window.open), so that path is reused
// for openNewTab=true; openNewTab=false instead navigates the current
// tab directly (window.location), which Linking.openURL cannot do.
export function openBannerLink(banner: Banner, navigation: NavigationProp<RootStackParamList>) {
  if (banner.linkType === 'collection') {
    navigation.navigate('Collection', { slug: banner.linkTarget });
    return;
  }
  if (banner.linkType === 'listing') {
    // push, not navigate -- a banner on ListingDetailScreen itself (the
    // desktop rail / mobile placements) points at ANOTHER listing, and
    // navigate() to a route name that's already focused reuses that same
    // screen instance (just merging in the new listingId as a param)
    // rather than mounting a fresh one, which left the page's scroll
    // position exactly where the banner was tapped instead of resetting
    // to the top for the new listing. push always mounts a new instance,
    // matching how every other listing-card tap on this screen already
    // navigates (see relatedSection/editorsPicksSection/hotDealsSection
    // in ListingDetailScreen.tsx). Guarded, not called unconditionally --
    // TabBar's sidebar banner shares this same function, and the tab
    // navigator's own navigation prop (what useNavigation() resolves to
    // there -- see BannerSlotView's comment) has no push of its own, only
    // navigate's bubble-to-parent behavior.
    const nav = navigation as any;
    if (typeof nav.push === 'function') {
      nav.push('ListingDetail', { listingId: banner.linkTarget });
    } else {
      nav.navigate('ListingDetail', { listingId: banner.linkTarget });
    }
    return;
  }
  if (banner.linkType === 'category') {
    // HomeCategory lives inside the HomeTab's own nested stack (see
    // navigation/types.ts) -- reached from outside that stack with the
    // nested { screen, params } form, same as every other cross-stack
    // jump to a category in this app.
    (navigation as any).navigate('HomeTab', { screen: 'HomeCategory', params: { cat: banner.linkTarget } });
    return;
  }

  // 'external'
  if (Platform.OS === 'web' && !banner.openNewTab && typeof window !== 'undefined') {
    window.location.href = banner.linkTarget;
    return;
  }
  Linking.openURL(banner.linkTarget);
}
