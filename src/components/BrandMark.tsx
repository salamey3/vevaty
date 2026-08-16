import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons/Icon';
import { colors } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';

// Renders the Vevaty brand identity. If an admin has uploaded a logo image
// for the current language via the admin panel, that image is shown
// instead of the default diamond-mark + wordmark -- every place this
// component is used (desktop sidebar, onboarding, language picker) picks
// it up automatically, with no rebuild.
export default function BrandMark({ variant = 'hero' }: { variant?: 'hero' | 'sidebar' }) {
  const { language } = useLanguage();
  const { siteSettings } = useSettings();
  const logoUrl = language === 'ar' ? siteSettings.logoArUrl : siteSettings.logoEnUrl;

  if (variant === 'sidebar') {
    if (logoUrl) {
      return <Image source={{ uri: logoUrl }} style={styles.sidebarLogo} resizeMode="contain" />;
    }
    return (
      <View style={styles.sidebarRow}>
        <View style={styles.sidebarMark}>
          <Icon name="diamond" size={16} color={colors.white} />
        </View>
        <Text style={styles.sidebarText}>Vevaty</Text>
      </View>
    );
  }

  if (logoUrl) {
    return <Image source={{ uri: logoUrl }} style={styles.heroLogo} resizeMode="contain" />;
  }
  return (
    <>
      <View style={styles.heroMark}>
        <Icon name="diamond" size={26} color={colors.white} />
      </View>
      <Text style={styles.heroText}>Vevaty</Text>
    </>
  );
}

const styles = StyleSheet.create({
  sidebarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarMark: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sidebarText: { fontSize: 18, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
  sidebarLogo: { width: 140, height: 32 },
  heroMark: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  heroText: { fontSize: 30, fontWeight: '700', color: colors.white, letterSpacing: -0.5 },
  heroLogo: { width: 220, height: 64 },
});
