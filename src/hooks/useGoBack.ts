import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

// A back button that always goes somewhere.
//
// `navigation.goBack()` walks the stack this session built, and on a fresh
// page load there is no stack: open a listing URL directly, or refresh
// while reading one, and the app starts with that screen as its only
// entry. The back arrow then does nothing at all -- it looks broken,
// because from the visitor's point of view it is. This is the single most
// likely way someone arrives at a listing, since it is what a shared link
// and a search result both do.
//
// So: go back if there is anywhere to go back TO, and otherwise go to the
// screen this one logically sits under. The fallback is per-screen because
// only the screen knows its own parent -- a listing belongs under its
// category, a chat thread under the messages list -- and "up" is a more
// useful answer than "home" when the two differ.
export function useGoBack(fallback?: () => void) {
  const navigation = useNavigation<any>();

  return useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (fallback) {
      fallback();
      return;
    }
    // Nothing more specific offered: the home tab is the one screen that
    // always exists and never needs parameters.
    navigation.navigate('MainTabs', { screen: 'HomeTab' });
  }, [navigation, fallback]);
}
