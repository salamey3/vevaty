import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import LanguageSwitch from './LanguageSwitch';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';

// Storefronts, language, points -- the three controls that ride in the
// brand bar on mobile and the greeting row on desktop. Extracted from
// HomeScreen when the buyer's gate became a second screen that needs the
// identical row: two copies of this markup would have drifted the first
// time either grew a fourth control.
export default function BrowseHeaderControls() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile } = useAppStore();
  const { t } = useLanguage();

  return (
    <View style={styles.headerActions}>
      {/* The one entry point into ShopsDirectoryScreen that doesn't require
          already knowing a shop's slug or visiting Profile first -- see
          that screen's own header comment for why it exists at all. */}
      <Pressy style={styles.badge} onPress={() => navigation.navigate('Shops')}>
        <Icon name="building" size={13} color={colors.ink} />
        <Text style={styles.badgeText}>{t('home.browseStorefronts')}</Text>
      </Pressy>
      <LanguageSwitch compact />
      <Pressy style={styles.badge} onPress={() => navigation.navigate('MainTabs')}>
        <Icon name="sparkle" size={13} color={colors.ink} />
        <Text style={styles.badgeText}>{profile.points}</Text>
      </Pressy>
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 34,
  },
  badgeText: { ...type.h3, fontSize: 13.5 },
});
