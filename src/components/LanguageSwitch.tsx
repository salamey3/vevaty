import React from 'react';
import { StyleSheet, Text, ViewStyle, StyleProp } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// Compact language toggle meant to be dropped into any screen's header --
// not just Profile -- so switching language is always one tap away. This
// matters most for a shared listing link: whoever it's sent to should be
// able to flip straight to their language right there on the listing page
// instead of hunting through the app for a settings screen first.
//
// Shows the label of the language you'd switch TO; tapping flips it
// immediately since there are only two options.
export default function LanguageSwitch({
  style,
  compact = false,
}: {
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const { language, setLanguage, t } = useLanguage();
  const other = language === 'ar' ? 'en' : 'ar';
  const label = compact ? other.toUpperCase() : other === 'ar' ? t('language.arabic') : t('language.english');

  return (
    <Pressy onPress={() => setLanguage(other)} style={[styles.pill, style]}>
      <Icon name="globe" size={13} color={colors.ink} />
      <Text style={styles.text}>{label}</Text>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  pill: {
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
  text: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
});
