import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { PaymentMethod } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { listingTitle } from '../lib/listingText';
import { useGoBack } from '../hooks/useGoBack';

type Props = NativeStackScreenProps<RootStackParamList, 'Payment'>;

export default function PaymentScreen({ route, navigation }: Props) {
  const goBack = useGoBack();
  const { listings } = useAppStore();
  const { t, language } = useLanguage();
  const listing = useMemo(() => listings.find((l) => l.id === route.params.listingId), [listings, route.params.listingId]);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const OPTIONS: { id: PaymentMethod; label: string; sub: string; icon: any; disabled?: boolean }[] = [
    { id: 'whish', label: t('payment.whishLabel'), sub: t('payment.whishSub'), icon: 'wallet' },
    { id: 'cash_confirmation', label: t('payment.cashLabel'), sub: t('payment.cashSub'), icon: 'banknote' },
    { id: 'card', label: t('payment.cardLabel'), sub: t('payment.cardSub'), icon: 'card', disabled: true },
  ];

  if (!listing) return null;

  if (confirmed) {
    return (
      <Screen maxWidth={560}>
        <View style={styles.successWrap}>
          <View style={styles.successCircle}>
            <Icon name="checkCircle" size={40} color={colors.white} />
          </View>
          <Text style={styles.successTitle}>{t('payment.requestSent')}</Text>
          <Text style={[type.soft, { textAlign: 'center', paddingHorizontal: 30 }]}>
            {method === 'whish' ? t('payment.whishConfirm') : t('payment.cashConfirm')}
          </Text>
          <Button label={t('payment.backToBrowsing')} onPress={() => navigation.popToTop()} style={{ marginTop: 28, width: 220 }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={560}>
      <View style={styles.topBar}>
        <Pressy onPress={goBack} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('payment.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.summary}>
        <Text style={type.soft}>{listingTitle(listing, language)}</Text>
        <Text style={styles.price}>${listing.price.toLocaleString()}</Text>
      </View>

      <View style={styles.options}>
        {OPTIONS.map((opt) => (
          <Pressy
            key={opt.id}
            onPress={opt.disabled ? undefined : () => setMethod(opt.id)}
            style={[styles.option, method === opt.id && styles.optionActive, opt.disabled && styles.optionDisabled]}
          >
            <View style={styles.optionIcon}>
              <Icon name={opt.icon} size={19} color={opt.disabled ? colors.inkSoft : colors.ink} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, opt.disabled && { color: colors.inkSoft }]}>{opt.label}</Text>
              <Text style={type.tiny}>{opt.sub}</Text>
            </View>
            {method === opt.id && <Icon name="check" size={18} color={colors.ink} />}
          </Pressy>
        ))}
      </View>

      <View style={styles.footer}>
        <Button label={t('payment.confirm')} disabled={!method} onPress={() => setConfirmed(true)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  summary: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 20 },
  price: { fontSize: 26, fontWeight: '700', color: colors.ink, marginTop: 2 },
  options: { paddingHorizontal: 18, gap: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14,
  },
  optionActive: { borderColor: colors.ink, borderWidth: 1.5 },
  optionDisabled: { opacity: 0.5 },
  optionIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { marginTop: 'auto', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  successCircle: {
    width: 74, height: 74, borderRadius: 37, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  successTitle: { ...type.title, fontSize: 21 },
});
