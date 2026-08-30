import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

// "Take me back to the start", from anywhere in the app.
//
// Not `goBack()`: this is the logo, and a logo is a way OUT of wherever you
// are, not one step back through it. Someone three categories deep with
// filters set, or reading a listing they arrived at from a shared link,
// should land on the home screen in one tap.
//
// Targets HomeRoot specifically rather than the Home tab, because the tab
// remembers where it was -- navigating to it from a listing would drop you
// back into the category you were browsing, which is the one thing tapping
// the logo is meant to escape.
export function useGoHome() {
  const navigation = useNavigation<any>();
  return useCallback(() => {
    // `pop: true` at both levels, or this pushes rather than returns.
    // React Navigation 7's plain navigate only reuses a route that is
    // already focused; anything else gets a second copy -- so from a
    // category three levels in, the logo would stack a fresh gate ON TOP
    // of where you were, and one back press would drop you right back into
    // it. That is the exact thing this hook exists to prevent.
    navigation.navigate(
      'MainTabs',
      { screen: 'HomeTab', params: { screen: 'HomeRoot', pop: true } },
      { pop: true }
    );
  }, [navigation]);
}
