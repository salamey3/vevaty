import React from 'react';
import { StyleSheet, View } from 'react-native';
import Pressy from './Pressy';
import VevatyMark from './VevatyMark';
import { colors } from '../theme/theme';
import { useGoHome } from '../hooks/useGoHome';
import { useLanguage } from '../i18n/LanguageContext';

// The mark on its own, as a way home, for screens that sit outside the
// tabs and therefore have neither the desktop sidebar's lockup nor the
// mobile home screen's brand bar.
//
// A listing page is where most people arrive -- it is what a shared link
// and a search result both open -- and until now the only way onward from
// one was a back button that, on a cold load, has nothing to go back to.
// The mark alone rather than the full lockup: these top bars already carry
// a back arrow, a two-level category breadcrumb and the language toggle,
// and the wordmark would push the breadcrumb into an ellipsis on a phone.
//
// Deliberately NOT added to the create-listing, payment or auth screens.
// Leaving those mid-way loses work or abandons a transaction, so a
// one-tap exit dressed as a logo would be a trap rather than a shortcut;
// those screens keep an explicit close button that says what it does.
export default function HomeMarkButton() {
  const goHome = useGoHome();
  const { language } = useLanguage();
  return (
    <Pressy
      onPress={goHome}
      style={styles.btn}
      accessibilityRole="link"
      accessibilityLabel={language === 'ar' ? 'ڤيڤاتي — الصفحة الرئيسية' : 'vevaty — home'}
    >
      <View style={styles.inner}>
        <VevatyMark size={22} color={colors.primary} />
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  // Matches the 34px icon buttons it sits beside, so the row keeps one
  // rhythm rather than the mark floating at a different size.
  btn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  inner: { alignItems: 'center', justifyContent: 'center' },
});
