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
    navigation.navigate('MainTabs', { screen: 'HomeTab', params: { screen: 'HomeRoot' } });
  }, [navigation]);
}
