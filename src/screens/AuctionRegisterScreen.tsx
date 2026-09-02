import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Button from '../components/Button';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { SavedCard } from '../types';
import {
  AuctionError, demoCardBrand, fetchMyCards, registerForAuction, saveDemoCard,
} from '../lib/auctions';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';

// Registering to bid: save a card, then register for this auction.
//
// The card half is a DEMO. No card number reaches the network or the
// database from here -- the number is reduced to a brand, four digits and
// an opaque token on this device, which is exactly what a real gateway's
// client-side tokenise call returns. The demo provider accepts published
// test numbers only, so a real card cannot be entered by accident while
// the feature is being shown; that constraint is the whole reason the
// accepted list is visible on screen rather than hidden in a validator.
const TEST_CARDS = ['4242 4242 4242 4242', '5555 5555 5555 4444'];

export default function AuctionRegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { auctionId } = useRoute<RouteProp<RootStackParamList, 'AuctionRegister'>>().params;
  const { t, isRTL } = useLanguage();

  const [cards, setCards] = useState<SavedCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');

  const load = useCallback(async () => {
    try {
      const mine = await fetchMyCards();
      setCards(mine);
      setSelected((prev) => prev ?? mine[0]?.id ?? null);
    } catch {
      setError(t('auctions.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const addCard = async () => {
    const digits = number.replace(/[^0-9]/g, '');
    const brand = demoCardBrand(digits);
    if (!brand) { setError(t('auctions.err.testCardOnly')); return; }
    const m = expiry.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
    if (!m) { setError(t('auctions.err.expiry')); return; }
    const month = Number(m[1]);
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    if (month < 1 || month > 12) { setError(t('auctions.err.expiry')); return; }

    setBusy(true);
    setError(null);
    try {
      const saved = await saveDemoCard({ number: digits, expMonth: month, expYear: year });
      setCards((prev) => [saved, ...prev]);
      setSelected(saved.id);
      setNumber('');
      setExpiry('');
    } catch (e: any) {
      const code = e instanceof AuctionError ? e.code : 'unknown';
      setError(code === 'not_signed_in' ? t('auctions.err.signIn') : t('auctions.err.testCardOnly'));
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!selected) { setError(t('auctions.err.pickCard')); return; }
    setBusy(true);
    setError(null);
    try {
      const status = await registerForAuction(auctionId, selected);
      // A blocked registration is never healed by re-registering (the
      // engine's conflict arm leaves the status alone), so exiting as
      // though it succeeded would send someone back to an auction that
      // then tells them they cannot bid. Say it here instead.
      if (status !== 'approved') {
        setError(status === 'blocked' ? t('auctions.blockedSub') : t('auctions.pendingSub'));
        return;
      }
      navigation.goBack();
    } catch (e: any) {
      const code = e instanceof AuctionError ? e.code : 'unknown';
      setError(
        code === 'phone_not_verified' ? t('auctions.err.verifyPhone')
          : code === 'auction_not_open_for_registration' ? t('auctions.err.auctionClosed')
          : code === 'not_signed_in' ? t('auctions.err.signIn')
          : code === 'payment_method_invalid' ? t('auctions.err.cardUnusable')
          : code === 'auction_not_found' ? t('auctions.notFound')
          : t('auctions.err.generic')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[styles.topBar, mirrorRow(isRTL)]}>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('auctions.registerTitle')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.lede, isRTL && styles.rtl]}>{t('auctions.registerLede')}</Text>

          <View style={[styles.demoNote, mirrorRow(isRTL)]}>
            <Icon name="lock" size={15} color={colors.accentDeep} />
            <Text style={[styles.demoNoteText, isRTL && styles.rtl]}>
              {t('auctions.demoCardNote', { cards: TEST_CARDS.join('  ·  ') })}
            </Text>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
          ) : (
            <>
              {cards.length > 0 && (
                <View style={styles.block}>
                  <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auctions.yourCards')}</Text>
                  {cards.map((c) => (
                    <Pressy
                      key={c.id}
                      onPress={() => setSelected(c.id)}
                      style={[styles.cardRow, mirrorRow(isRTL), selected === c.id && styles.cardRowOn]}
                    >
                      <Icon name="card" size={17} color={selected === c.id ? colors.primary : colors.inkSoft} />
                      <Text style={[styles.cardText, isRTL && styles.rtl]}>
                        {c.brand} ···· {c.last4}
                      </Text>
                      <Text style={type.tiny}>
                        {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                      </Text>
                      {selected === c.id && <Icon name="checkCircle" size={16} color={colors.primary} />}
                    </Pressy>
                  ))}
                </View>
              )}

              <View style={styles.block}>
                <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auctions.addCard')}</Text>
                <TextInput
                  value={number}
                  onChangeText={setNumber}
                  placeholder={TEST_CARDS[0]}
                  placeholderTextColor={colors.inkSoft}
                  keyboardType="numeric"
                  style={[styles.input, isRTL && styles.rtl]}
                />
                <TextInput
                  value={expiry}
                  onChangeText={setExpiry}
                  placeholder="12/30"
                  placeholderTextColor={colors.inkSoft}
                  keyboardType="numbers-and-punctuation"
                  style={[styles.input, { marginTop: 10 }, isRTL && styles.rtl]}
                />
                <Pressy onPress={addCard} style={styles.addBtn} disabled={busy}>
                  <Text style={styles.addBtnText}>{t('auctions.saveCard')}</Text>
                </Pressy>
              </View>

              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}

              <Button
                label={t('auctions.registerCta')}
                onPress={register}
                loading={busy}
                disabled={!selected}
                style={{ marginTop: 16 }}
              />
              <Text style={[styles.footNote, isRTL && styles.rtl]}>{t('auctions.registerFootnote')}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 50 },
  lede: { ...type.soft, lineHeight: 20, marginBottom: 14 },
  demoNote: {
    flexDirection: 'row', gap: 9, alignItems: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.md, padding: 12, marginBottom: 20,
  },
  demoNoteText: { flex: 1, fontSize: 12, color: colors.accentDeep, lineHeight: 17 },
  block: { marginBottom: 20 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    borderRadius: radius.md, paddingHorizontal: 13, height: 52, marginBottom: 8,
  },
  cardRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  cardText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  input: {
    height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 14, fontSize: 16, color: colors.ink,
  },
  addBtn: {
    marginTop: 10, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 4 },
  footNote: { ...type.tiny, marginTop: 12, lineHeight: 16 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
