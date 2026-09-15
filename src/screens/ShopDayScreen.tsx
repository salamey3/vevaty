import React, { useCallback, useMemo, useState } from 'react';
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
  EMPTY_DAY, ShopDay, ShopRow, StockGroup, dayIsQuiet, fetchShopDay, groupByListing,
  shopRowLabel, variantDimensions,
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
//
// One line per ITEM, opening onto its rows. Three sizes of the same lamp
// being out is one thing that happened, and printing the lamp's name three
// times says the shop has three problems.

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ShopDayScreen() {
  const navigation = useNavigation<Nav>();
  const { t, language, isRTL } = useLanguage();
  const { resolveAttributesForCategory } = useSettings();
  const [day, setDay] = useState<ShopDay>(EMPTY_DAY);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Which items are open. Keyed by section as well as listing, because the
  // same lamp can be two sizes out and a third running low, and opening it
  // in one list should not open it in the other.
  const [open, setOpen] = useState<Record<string, boolean>>({});

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

  const outGroups = useMemo(() => groupByListing(day.out), [day.out]);
  const lowGroups = useMemo(() => groupByListing(day.low), [day.low]);

  const titleOf = (r: { titleEn: string; titleAr: string }) =>
    language === 'ar' ? r.titleAr || r.titleEn : r.titleEn || r.titleAr;

  const whatOf = (r: ShopRow) =>
    shopRowLabel(r, variantDimensions(resolveAttributesForCategory(r.categoryId as any)), language);

  // One of an open item's rows, or a whole item that only has one thing
  // wrong with it. `lead` is what the line is called: the item's own name
  // when it stands alone, and just the size and colour when the name is
  // already on the line above it.
  const stockRow = (r: ShopRow, tone: 'low' | 'out', lead: string, inset: boolean) => (
    <Pressy
      key={r.id}
      onPress={() => navigation.navigate('ListingDetail', { listingId: r.listingId })}
      style={[styles.row, inset ? styles.childRow : styles.card, mirrorRow(isRTL)]}
    >
      {/* A spacer rather than directional padding, which resolves against
          I18nManager.isRTL -- never flipped in this app -- and so would
          indent from the left in Arabic too. */}
      {inset && <View style={styles.indent} />}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>{lead}</Text>
        {!!r.sku && <Text style={styles.rowSku}>{r.sku}</Text>}
        {tone === 'out' && r.waiting > 0 && (
          <Text style={styles.rowWaiting}>{t('shopDay.peopleWaiting', { n: r.waiting })}</Text>
        )}
      </View>
      <Text style={[styles.rowQty, tone === 'out' ? styles.rowQtyOut : styles.rowQtyLow]}>
        {tone === 'out' ? t('shopDay.none') : r.qty}
      </Text>
      {/* Empty, and the same width as the triangle on an item's own line
          above it, so the counts run straight down the card instead of
          stepping in and out by twenty pixels. */}
      <View style={styles.chevronSlot} />
    </Pressy>
  );

  // An item with more than one row in this list: its name once, how many of
  // its rows are in trouble, and what the whole item still holds -- which
  // is the number that says whether this is an emergency or a Tuesday.
  const stockGroup = (g: StockGroup, tone: 'low' | 'out') => {
    if (g.plain) {
      const r = g.rows[0];
      const what = whatOf(r);
      return stockRow(r, tone, what ? `${titleOf(g)} — ${what}` : titleOf(g), false);
    }
    const key = `${tone}:${g.listingId}`;
    const expanded = !!open[key];
    const waiting = g.rows.reduce((n, r) => n + r.waiting, 0);
    return (
      <View key={key} style={expanded ? styles.card : null}>
        <Pressy
          onPress={() => setOpen((p) => ({ ...p, [key]: !p[key] }))}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={titleOf(g)}
          // Shut, the head IS the card and wears the border itself, exactly
          // like the single-row items beside it: Pressy scales the element
          // it is on, so a border left on the wrapper would stay put while
          // the head shrank out from under it. Open, the wrapper owns the
          // border and the head becomes a heading.
          style={[styles.row, expanded ? styles.headRow : styles.card, mirrorRow(isRTL)]}
        >
          <View style={styles.rowText}>
            <Text style={styles.headTitle} numberOfLines={2}>{titleOf(g)}</Text>
            <Text style={styles.rowSku}>
              {t(tone === 'out' ? 'shopDay.outOfCount' : 'shopDay.lowOfCount',
                 { n: g.rows.length, m: g.rowCount })}
            </Text>
            {/* Only while it is shut -- open, every row says its own, and
                the same number twice reads as two different facts -- and
                only for the out list, matching the rows. Nobody waits on
                something that is still in stock, and shop_needs_me sends 0
                on every low row today; the guard is here so that if it ever
                sends the real number, a "running low" heading does not
                start claiming people are waiting on it. */}
            {tone === 'out' && !expanded && waiting > 0 && (
              <Text style={styles.rowWaiting}>{t('shopDay.peopleWaiting', { n: waiting })}</Text>
            )}
          </View>
          {/* Worded, where a row's is a bare number: a big 64 beside "3 of
              12 out of stock" reads as sixty-four of them being out. This
              is what the item still has, which is the difference between
              an emergency and a Tuesday. */}
          <Text style={[styles.headQty, g.total === 0 && styles.headQtyOut]}>
            {g.total === 0 ? t('shopDay.none') : t('stock.totalLeft', { n: g.total })}
          </Text>
          <View style={[styles.chevronSlot, expanded && styles.chevronOpen]}>
            <Icon name="chevronRight" size={15} color={colors.inkSoft} />
          </View>
        </Pressy>
        {expanded &&
          g.rows.map((r) => stockRow(r, tone, whatOf(r) || t('stock.plainRowLabel'), true))}
      </View>
    );
  };

  const section = (titleKey: string, hintKey: string, count: number, children: React.ReactNode) =>
    count === 0 ? null : (
      <View style={styles.block}>
        <View style={[styles.blockHead, mirrorRow(isRTL)]}>
          <Text style={styles.blockTitle}>{t(titleKey, { n: count })}</Text>
        </View>
        <Text style={styles.blockHint}>{t(hintKey)}</Text>
        <View style={styles.list}>{children}</View>
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
                  style={[styles.row, styles.card, mirrorRow(isRTL)]}
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

            {/* Counted in ROWS, not items: "4 out of stock" is four things
                a buyer cannot buy, whether they sit under one name or
                four. The folding is how they are read, not what they are. */}
            {section('shopDay.outTitle', 'shopDay.outHint', day.out.length,
              outGroups.map((g) => stockGroup(g, 'out')))}

            {section('shopDay.lowTitle', 'shopDay.lowHint', day.low.length,
              lowGroups.map((g) => stockGroup(g, 'low')))}
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
  // One card per ITEM, with air between them. They used to share a single
  // card, so a folded item's tinted heading ran straight into the next
  // item's row with only a hairline between -- and a hairline is what
  // separates an item's own sizes from each other, so the next item read
  // as one more size of the one above it.
  list: { gap: 12 },
  card: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    backgroundColor: colors.card, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  // Separated from the row ABOVE, so the last row in an item has no line
  // hanging under it against the card's own edge.
  childRow: { borderTopWidth: 1, borderTopColor: colors.line },
  // Tinted only once it is heading something. Shut, every card in the
  // section would be tinted, so the tint would separate nothing from
  // anything and just make the list read muddy against the page.
  headRow: { backgroundColor: colors.surface },
  headTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  indent: { width: 18 },
  chevronSlot: {
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, color: colors.ink },
  rowSku: { ...type.tiny, marginTop: 2 },
  rowWaiting: { ...type.tiny, color: colors.accentDeep, marginTop: 2, fontWeight: '700' },
  rowQty: { fontSize: 17, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  rowQtyLow: { color: colors.accentDeep },
  headQty: { ...type.tiny, color: colors.accentDeep, fontWeight: '700', minWidth: 48, textAlign: 'center' },
  headQtyOut: { color: colors.danger },
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
