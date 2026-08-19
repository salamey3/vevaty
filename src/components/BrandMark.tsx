import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import VevatyMark from './VevatyMark';
import { colors } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';
import { mirrorRow } from '../lib/mirrorRow';

// Renders the Vevaty brand identity -- see BRANDING.md parts 1 and 2.
//
// If an admin has uploaded a logo image for the current language via the
// admin panel, that image wins and every use site (desktop sidebar,
// onboarding, language picker) picks it up with no rebuild. Otherwise this
// draws the lockup from the mark plus the wordmark.
//
// Two rules from the brand doc are enforced here rather than left to each
// caller: the wordmark is ALWAYS lowercase, including sentence-initial;
// and in Arabic the mark sits on the RIGHT, because the lockup mirrors
// with the language and is never left-aligned in an RTL layout.
//
// That mirror goes through mirrorRow() rather than a plain
// `isRTL && rowReverse`, which is what this used to do and what put the
// mark on the LEFT in Arabic on the website: the browser already reverses
// a row when the document is dir="rtl", so the manual reverse undid it.
// See mirrorRow.ts.
export default function BrandMark({
  variant = 'hero',
  onPress,
}: {
  variant?: 'hero' | 'sidebar';
  // When given, the whole lockup becomes a tap target -- which is how the
  // logo sends people home from anywhere in the app. Left off on the
  // language picker, where there is no home to go to yet.
  onPress?: () => void;
}) {
  const { language, isRTL } = useLanguage();
  const { siteSettings } = useSettings();
  const logoUrl = language === 'ar' ? siteSettings.logoArUrl : siteSettings.logoEnUrl;
  const isAr = language === 'ar';
  // Arabic is set a size down from the Latin: it reads optically larger at
  // the same nominal size, and matching the numbers makes the Arabic
  // lockup look inflated beside the English one.
  const wordmark = isAr ? 'ڤيڤاتي' : 'vevaty';

  // Built as one value rather than early returns, so the tap target below
  // wraps every variant -- an admin-uploaded logo image should be just as
  // clickable as the drawn lockup.
  const inner =
    variant === 'sidebar' ? (
      logoUrl ? (
        <Image source={{ uri: logoUrl }} style={styles.sidebarLogo} resizeMode="contain" />
      ) : (
        <View style={[styles.row, mirrorRow(isRTL)]}>
          <VevatyMark size={26} color={colors.primary} />
          <Text style={[styles.sidebarText, isAr && styles.sidebarTextAr]}>{wordmark}</Text>
        </View>
      )
    ) : logoUrl ? (
      <Image source={{ uri: logoUrl }} style={styles.heroLogo} resizeMode="contain" />
    ) : (
      // The hero sits on the dark green gradient, so the mark reverses to white.
      <View style={[styles.row, styles.heroRow, mirrorRow(isRTL)]}>
        <VevatyMark size={44} color={colors.white} />
        <Text style={[styles.heroText, isAr && styles.heroTextAr]}>{wordmark}</Text>
      </View>
    );

  if (!onPress) return inner;

  // Announced as a link rather than a button: it navigates, which is what
  // a screen reader user expects of a logo in a header. The label says
  // where it goes -- "vevaty" alone tells someone who cannot see it
  // nothing about what tapping it does.
  return (
    <Pressy
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={isAr ? 'ڤيڤاتي — الصفحة الرئيسية' : 'vevaty — home'}
    >
      {inner}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  // The gap is 0.30 x the mark height, per the lockup spec in BRANDING.md.
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroRow: { gap: 13 },
  sidebarText: { fontSize: 19, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
  sidebarTextAr: { fontSize: 17 },
  sidebarLogo: { width: 140, height: 32 },
  heroText: { fontSize: 31, fontWeight: '700', color: colors.white, letterSpacing: -0.5 },
  heroTextAr: { fontSize: 28 },
  heroLogo: { width: 220, height: 64 },
});
