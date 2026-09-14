import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';
import { Alert } from '../lib/alertShim';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { RootStackParamList } from '../navigation/types';
import {
  MAX_QTY, ShopRow, fetchShopRows, moveStockMany, shopRowLabel, stockErrorKey, variantDimensions,
} from '../lib/stock';

// A delivery arrives: twenty things across eight listings.
//
// Doing that one listing at a time is eight screens and eight saves, so it
// does not get done -- the box goes on the shelf and the numbers on the
// site quietly stop being true. This is the whole shop in one list with a
// box against each row, and ONE save.
//
// All of it or none of it. moveStockMany is a single call for exactly this
// reason: half a box booked in because the connection dropped is worse
// than none of it, because nobody can tell which half.
//
// Only + here, never a count. This screen is the ADD verb -- "twelve more
// arrived" is right whatever the shelf said a minute ago. Correcting a
// number to what you just counted is the SET verb and lives on the listing,
// where it is one row at a time and harder to do by accident.

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function RestockScreen() {
  const navigation = useNavigation<Nav>();
  const { t, language, isRTL } = useLanguage();
  const { resolveAttributesForCategory } = useSettings();
  // The one screen in the app made entirely of number boxes in a long
  // list. Expo's edge-to-edge mode stops the window resizing when the
  // keyboard opens, so without this the keyboard covers both the box
  // being typed into and the Save button under it -- see the hook.
  const { scrollRef, onScroll, onInputFocus, keyboardHeight } = useKeyboardAwareScroll();

  const [rows, setRows] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [adds, setAdds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Fetched once, whole. The filter runs here rather than on the server:
  // three hundred rows is nothing to hold, and a shop typing a code wants
  // the list to narrow as they type, not one round trip per letter.
  const load = useCallback(() => {
    setFailed(false);
    setLoading(true);
    fetchShopRows()
      .then(setRows)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const named = useMemo(
    () =>
      rows.map((r) => {
        const dims = variantDimensions(resolveAttributesForCategory(r.categoryId as any));
        const what = shopRowLabel(r, dims, language);
        const title = language === 'ar' ? r.titleAr || r.titleEn : r.titleEn || r.titleAr;
        return { row: r, title, what, hay: `${title} ${what} ${r.sku ?? ''}`.toLowerCase() };
      }),
    [rows, resolveAttributesForCategory, language]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? named.filter((n) => n.hay.includes(q)) : named;
  }, [named, query]);

  // Counted across EVERY row, not just the visible ones: a shop that types
  // a code, adds 12, then types another code must not lose the first.
  const pending = useMemo(
    () => Object.entries(adds).map(([id, v]) => ({ id, delta: Number(v) || 0 })).filter((m) => m.delta > 0),
    [adds]
  );
  const pendingUnits = pending.reduce((n, m) => n + m.delta, 0);

  const save = async () => {
    if (pending.length === 0 || saving) return;
    setSaving(true);
    const units = pendingUnits;
    try {
      await moveStockMany(pending, 'restock');
    } catch (e: any) {
      // The move itself. Nothing was written -- it is one all-or-nothing
      // call -- so the boxes stay exactly as typed and the seller can fix
      // whatever it was and press again.
      setSaving(false);
      // A row somebody unticked between loading this screen and saving it
      // cannot be fixed by pressing again, so the list is re-read for
      // them rather than leaving a Save that fails for ever.
      if (String(e?.message) === 'no_such_variant') load();
      Alert.alert(t('restock.failedTitle'), t(stockErrorKey(e)));
      return;
    }
    // Past here the delivery IS booked in, and nothing below may say
    // otherwise. The refetch used to sit in the same try: when it failed
    // -- a dropped connection on a phone -- the seller was told "nothing
    // was booked in" over a delivery that had just landed, with their
    // typed numbers already cleared. Retyping it books the whole box in
    // twice.
    setAdds({});
    setQuery('');
    Alert.alert(t('restock.doneTitle'), t('restock.doneBody', { n: units }));
    try {
      // Re-read rather than adding the numbers here: the shop may have
      // been selling from the counter while this screen was open, and the
      // server's answer is the only true one.
      setRows(await fetchShopRows());
    } catch {
      // The numbers on screen are now behind. Not worth a second alert
      // over an alert that just said it worked -- the next open is right.
    } finally {
      setSaving(false);
    }
  };

  const setAdd = (id: string, raw: string) => {
    const clean = raw.replace(/[^0-9]/g, '').slice(0, 6);
    setAdds((prev) => {
      const next = { ...prev };
      if (clean === '' || Number(clean) === 0) delete next[id];
      else next[id] = String(Math.min(MAX_QTY, Number(clean)));
      return next;
    });
  };

  return (
    <Screen>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + keyboardHeight }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={type.title}>{t('restock.title')}</Text>
        <Text style={type.soft}>{t('restock.intro')}</Text>

        <View style={[styles.searchWrap, mirrorRow(isRTL)]}>
          <Icon name="search" size={16} color={colors.inkSoft} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('restock.findPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="characters"
          />
          {query.length > 0 && (
            <Pressy onPress={() => setQuery('')} style={styles.clear}>
              <Icon name="close" size={14} color={colors.inkSoft} />
            </Pressy>
          )}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.ink} />
        ) : failed ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('restock.loadFailed')}</Text>
            <Pressy onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          </View>
        ) : named.length === 0 ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('restock.nothingToStock')}</Text>
          </View>
        ) : shown.length === 0 ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('restock.noMatch', { q: query.trim() })}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {shown.map(({ row, title, what }) => (
              <View key={row.id} style={[styles.row, mirrorRow(isRTL)]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {[what, row.sku].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.have}>{t('restock.have', { n: row.qty })}</Text>
                <TextInput
                  value={adds[row.id] ?? ''}
                  onChangeText={(v) => setAdd(row.id, v)}
                  keyboardType="numeric"
                  onFocus={onInputFocus}
                  placeholder="+"
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.addBox, !!adds[row.id] && styles.addBoxOn]}
                  accessibilityLabel={t('restock.addTo', { what: [title, what].filter(Boolean).join(' ') })}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Held out of the scroll so it is reachable with ninety rows above
          it and a keyboard up. */}
      {pending.length > 0 && (
        <View style={[styles.footer, { bottom: keyboardHeight }]}>
          <Pressy
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && styles.saveBtnBusy]}
          >
            <Text style={styles.saveBtnText}>
              {saving
                ? t('common.loading')
                : t('restock.bookIn', { n: pendingUnits, rows: pending.length })}
            </Text>
          </Pressy>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 120 },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    backgroundColor: colors.card, paddingHorizontal: 14, height: 46,
  },
  search: { flex: 1, minWidth: 0, fontSize: 14.5, color: colors.ink },
  clear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  card: {
    marginTop: 14, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, color: colors.ink },
  rowSub: { ...type.tiny, marginTop: 2 },
  have: { ...type.tiny, minWidth: 54, textAlign: 'center' },
  addBox: {
    width: 62, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, textAlign: 'center', fontSize: 15, color: colors.ink,
  },
  addBoxOn: { borderColor: colors.ink, backgroundColor: colors.card, fontWeight: '800' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  retry: {
    paddingHorizontal: 18, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.primary, justifyContent: 'center',
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.white },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 16, paddingBottom: 24,
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.line,
  },
  saveBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
