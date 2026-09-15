import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { EMPTY_DAY, ShopDay, dayIsQuiet, fetchShopDay } from '../lib/stock';

// The one line that makes a shop look.
//
// The shop's day is a screen behind a Profile row, and a screen nobody is
// pointed at gets opened once. This is the pointer: when something is
// actually waiting, one line at the top of the shop owner's Home, saying
// what and how many. When nothing is waiting it renders nothing at all --
// a card that is always there stops being read within a week.
//
// Only for somebody who works in a verified shop, so it never appears for
// the overwhelming majority of people, for whom Home is the buyer's screen
// and nothing else. Same treatment and the same slot as the "did you reach the
// seller?" prompt.

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ShopDayCard() {
  const navigation = useNavigation<Nav>();
  const { t, isRTL } = useLanguage();
  // workShop, not myShop: the person at the counter is as likely to be
  // somebody the owner took on as the owner, and the morning is theirs to
  // act on either way. myShop stays strictly "the shop I own" and is what
  // the storefront screens use.
  const { workShop } = useAppStore();
  const [day, setDay] = useState<ShopDay>(EMPTY_DAY);
  const trading = !!workShop?.verifiedAt;
  // Home is the landing screen and this fires on every pop back to it. A
  // shop's morning does not change between one tap and the next, so it is
  // re-read at most once a minute -- the screen behind the card refreshes
  // on its own focus, unthrottled, which is where the shop is actually
  // acting.
  const lastRead = useRef(0);

  // On focus rather than once: the shop takes an order off in the chat and
  // comes back here, and a line still counting it is a line they learn to
  // ignore.
  useFocusEffect(
    useCallback(() => {
      if (!trading) { setDay(EMPTY_DAY); return; }
      if (Date.now() - lastRead.current < 60_000) return;
      lastRead.current = Date.now();
      let alive = true;
      fetchShopDay()
        .then((d) => { if (alive) setDay(d); })
        // Silent. This is a card the shop did not ask for; a failure to
        // load it is not news worth interrupting anybody's Home with.
        .catch(() => { if (alive) setDay(EMPTY_DAY); });
      return () => { alive = false; };
    }, [trading])
  );

  if (!trading || dayIsQuiet(day)) return null;

  // Said in the order a shop would act on it. Orders first: somebody is
  // waiting on an answer. Then things at zero, which are costing sales
  // right now. Low last -- it is a warning, not a problem yet.
  const parts: string[] = [];
  if (day.orders.length) parts.push(t('shopDay.cardOrders', { n: day.orders.length }));
  if (day.out.length) parts.push(t('shopDay.cardOut', { n: day.out.length }));
  if (day.low.length) parts.push(t('shopDay.cardLow', { n: day.low.length }));

  return (
    <Pressy onPress={() => navigation.navigate('ShopDay')} style={[styles.card, mirrorRow(isRTL)]}>
      <View style={styles.mark}>
        <Icon name="bag" size={15} color={colors.accentInk} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{t('shopDay.cardTitle')}</Text>
        <Text style={styles.body} numberOfLines={2}>{parts.join(' · ')}</Text>
      </View>
      <Icon name="chevronRight" size={16} color={colors.inkSoft} />
    </Pressy>
  );
}

const styles = StyleSheet.create({
  // mirrorRow only supplies row-reverse on native RTL, so this keeps its
  // own flexDirection or it stacks vertically on the web.
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.accentRing, borderRadius: radius.md,
    backgroundColor: colors.accentTint, paddingHorizontal: 14, paddingVertical: 12,
  },
  mark: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  body: { ...type.tiny, color: colors.accentDeep, marginTop: 2 },
});
