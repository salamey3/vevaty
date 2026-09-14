import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';
import { RootStackParamList } from '../navigation/types';
import {
  EMPTY_DAY, ShopDay, ShopRow, dayIsQuiet, fetchShopDay, shopRowLabel, variantDimensions,
} from '../lib/stock';

// What needs the shop this morning.
//
// A shop with ninety rows across twenty listings cannot answer "is there
// anything I should be doing" by opening twenty listings, so it stops
// asking -- and a stock system nobody looks at is worse than none, because
// the numbers on the site are then confidently wrong. This screen is the
// answer to that one question and nothing else: three lists, each one a
// thing a person can act on today.
//
// Deliberately NOT a dashboard. No totals, no charts, no "this month". A
// shop opens this while unlocking the door.

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ShopDayScreen() {
  const navigation = useNavigation<Nav>();
  const { t, language, isRTL } = useLanguage();
  const { resolveAttributesForCategory } = useSettings();
  const [day, setDay] = useState<ShopDay>(EMPTY_DAY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchShopDay()
      .then(setDay)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // On every focus, not once on mount: the shop comes back here after
  // taking an order off in the chat, and a list still showing that order
  // is a list they stop trusting.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rowName = (r: ShopRow) => {
    const dims = variantDimensions(resolveAttributesForCategory(r.categoryId as any));
    const what = shopRowLabel(r, dims, language);
    const title = language === 'ar' ? r.titleAr || r.titleEn : r.titleEn || r.titleAr;
    return what ? `${title} — ${what}` : title;
  };

  const stockRow = (r: ShopRow, tone: 'low' | 'out') => (
    <Pressy
      key={r.id}
      onPress={() => navigation.navigate('ListingDetail', { listingId: r.listingId })}
      style={[styles.row, mirrorRow(isRTL)]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>{rowName(r)}</Text>
        {!!r.sku && <Text style={styles.rowSku}>{r.sku}</Text>}
        {tone === 'out' && r.waiting > 0 && (
          <Text style={styles.rowWaiting}>{t('shopDay.peopleWaiting', { n: r.waiting })}</Text>
        )}
      </View>
      <Text style={[styles.rowQty, tone === 'out' ? styles.rowQtyOut : styles.rowQtyLow]}>
        {tone === 'out' ? t('shopDay.none') : r.qty}
      </Text>
    </Pressy>
  );

  const section = (titleKey: string, hintKey: string, count: number, children: React.ReactNode) =>
    count === 0 ? null : (
      <View style={styles.block}>
        <View style={[styles.blockHead, mirrorRow(isRTL)]}>
          <Text style={styles.blockTitle}>{t(titleKey, { n: count })}</Text>
        </View>
        <Text style={styles.blockHint}>{t(hintKey)}</Text>
        <View style={styles.card}>{children}</View>
      </View>
    );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={type.title}>{t('shopDay.title')}</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.ink} />
        ) : failed ? (
          <View style={styles.quiet}>
            <Text style={type.soft}>{t('shopDay.loadFailed')}</Text>
            <Pressy onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          </View>
        ) : dayIsQuiet(day) ? (
          <View style={styles.quiet}>
            <Icon name="checkCircle" size={28} color={colors.success} />
            <Text style={styles.quietTitle}>{t('shopDay.allClear')}</Text>
            <Text style={type.soft}>{t('shopDay.allClearHint')}</Text>
          </View>
        ) : (
          <>
            {section('shopDay.ordersTitle', 'shopDay.ordersHint', day.orders.length,
              day.orders.map((o) => (
                <Pressy
                  key={o.messageId}
                  onPress={() => navigation.navigate('ChatThread', { threadId: o.threadId })}
                  style={[styles.row, mirrorRow(isRTL)]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {language === 'ar' ? o.titleAr || o.titleEn : o.titleEn || o.titleAr}
                    </Text>
                    <Text style={styles.rowSku}>
                      {o.what ? `${o.what} · ` : ''}{t('shopDay.orderQty', { n: o.qty })}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.inkSoft} />
                </Pressy>
              )))}

            {section('shopDay.outTitle', 'shopDay.outHint', day.out.length,
              day.out.map((r) => stockRow(r, 'out')))}

            {section('shopDay.lowTitle', 'shopDay.lowHint', day.low.length,
              day.low.map((r) => stockRow(r, 'low')))}
          </>
        )}

        {/* Always offered, even on a quiet morning -- a delivery arriving
            is not something the list can know about in advance. */}
        <Pressy onPress={() => navigation.navigate('Restock')} style={styles.deliveryBtn}>
          <Icon name="plus" size={16} color={colors.white} />
          <Text style={styles.deliveryBtnText}>{t('shopDay.bookDelivery')}</Text>
        </Pressy>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48 },
  block: { marginTop: 22 },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blockTitle: { ...type.h3 },
  blockHint: { ...type.soft, marginTop: 2, marginBottom: 8 },
  card: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    backgroundColor: colors.card, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, color: colors.ink },
  rowSku: { ...type.tiny, marginTop: 2 },
  rowWaiting: { ...type.tiny, color: colors.accentDeep, marginTop: 2, fontWeight: '700' },
  rowQty: { fontSize: 17, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  rowQtyLow: { color: colors.accentDeep },
  rowQtyOut: { color: colors.danger, fontSize: 13, fontWeight: '700' },

  quiet: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  quietTitle: { ...type.h3 },
  retry: {
    marginTop: 8, paddingHorizontal: 18, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.primary, justifyContent: 'center',
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.white },

  deliveryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 28, height: 52, borderRadius: radius.pill, backgroundColor: colors.primary,
  },
  deliveryBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
