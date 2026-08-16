import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Icon from '../icons/Icon';
import Pressy from '../components/Pressy';
import Button from '../components/Button';
import Glass from '../components/Glass';
import BrandMark from '../components/BrandMark';
import { colors, type, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { Language } from '../i18n/translations';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LanguageSelect'>;

// Shown once, before anything else -- so the whole experience is already
// in the language you picked, rather than defaulting to English and only
// offering Arabic as an afterthought later. Browsing is anonymous, so
// this goes straight to Home; there's no separate onboarding step to
// chain into anymore (real accounts are created via phone login, only
// when posting a listing or contacting a seller -- see AuthScreen).
export default function LanguageSelectScreen({ navigation }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const [picked, setPicked] = useState<Language>(language);

  const confirm = () => {
    setLanguage(picked);
    navigation.replace('MainTabs');
  };

  return (
    <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.fill}>
      <View style={styles.top}>
        <BrandMark variant="hero" />
      </View>

      <Glass style={styles.card} tint="dark" intensity={30}>
        <Text style={styles.title}>{t('language.title')}</Text>
        <Text style={styles.subtitle}>{t('language.subtitle')}</Text>

        <Pressy
          onPress={() => setPicked('en')}
          style={[styles.option, picked === 'en' && styles.optionActive]}
        >
          <Text style={styles.optionLabel}>{t('language.english')}</Text>
          {picked === 'en' && <Icon name="check" size={18} color={colors.white} />}
        </Pressy>
        <Pressy
          onPress={() => setPicked('ar')}
          style={[styles.option, picked === 'ar' && styles.optionActive]}
        >
          <Text style={styles.optionLabel}>{t('language.arabic')}</Text>
          {picked === 'ar' && <Icon name="check" size={18} color={colors.white} />}
        </Pressy>

        <Button label={t('language.continue')} onPress={confirm} variant="secondary" style={styles.cta} />
      </Glass>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'center', gap: 12, marginBottom: 30 },
  mark: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  brand: { fontSize: 30, fontWeight: '700', color: colors.white, letterSpacing: -0.5 },
  card: { width: 380, maxWidth: '86%', padding: 22 },
  title: { fontSize: 19, fontWeight: '700', color: colors.white, marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.md, paddingHorizontal: 16, height: 52, marginBottom: 10,
  },
  optionActive: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.5)' },
  optionLabel: { fontSize: 15.5, fontWeight: '600', color: colors.white },
  cta: { marginTop: 14 },
});
