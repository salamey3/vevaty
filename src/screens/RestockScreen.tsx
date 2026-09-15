import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';
import { Alert } from '../lib/alertShim';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import {
  MAX_QTY, ShopRow, StockGroup, fetchShopRows, groupByListing, moveStockMany, narrowGroups,
  shopRowLabel, stockErrorKey, variantDimensions,
} from '../lib/stock';

// A delivery arrives: twenty things across eight listings.
//
// Doing that one listing at a time is eight screens and eight saves, so it
// does not get done -- the box goes on the shelf and the numbers on the
// site quietly stop being true. This is the whole shop in one list with a
// box against each row, and ONE save.
//
// One line per ITEM, not per row. A shop selling three sizes in four
// colours has twelve rows carrying the same title, and twelve identical
// lines is a wall, not a list -- you cannot find the thing the delivery
// actually contained. So each item is one line with what it holds
// altogether, and opens on a tap onto its own sizes and colours. Anything
// with a single row -- a crib, a sofa -- skips the fold and shows its box
// straight away.
//
// All of it or none of it. moveStockMany is a single call for exactly this
// reason: half a box booked in because the connection dropped is worse
// than none of it, because nobody can tell which half.
//
// Only + here, never a count. This screen is the ADD verb -- "twelve more
// arrived" is right whatever the shelf said a minute ago. Correcting a
// number to what you just counted is the SET verb and lives on the listing,
// where it is one row at a time and harder to do by accident.

export default function RestockScreen() {
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
  // Which items the shop has opened or shut BY HAND, by listing. Collapsed
  // is the resting state: a shop opens this holding one box and wants to
  // find one item in it. Anything not in here follows whatever the search
  // box decides -- and it is emptied on every change to the search, so a
  // tap made while browsing cannot go on overruling searches for the rest
  // of the session (shut an item once, and every later search for it would
  // come back folded, with no box to type in).
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const changeQuery = (v: string) => {
    setQuery(v);
    setOpen({});
  };

  // Fetched once, whole. The filter runs here rather than on the server:
  // three hundred rows is nothing to hold, and a shop typing a code wants
  // the list to narrow as they type, not one round trip per letter.
  const load = useCallback(() => {
    setFailed(false);
    setLoading(true);
    fetchShopRows()
      .then((fresh) => {
        setRows(fresh);
        // A row somebody unticked while this screen was open has no box to
        // type into any more, so a number still held against it can never
        // be booked in -- it fails the whole save, every time, with nothing
        // on screen the shop can clear. Dropping it is the only way out;
        // the alert that sent us back here has already said what happened.
        const live = new Set(fresh.map((r) => r.id));
        setAdds((prev) => {
          const next: Record<string, string> = {};
          for (const [id, v] of Object.entries(prev)) if (live.has(id)) next[id] = v;
          return Object.keys(next).length === Object.keys(prev).length ? prev : next;
        });
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Row id -> what to call it and what to match a search against. Built
  // once for the whole list, with the category's dimensions resolved per
  // category rather than per row: twelve rows of one item asked the same
  // question twelve times.
  const meta = useMemo(() => {
    const byCategory = new Map<string, ReturnType<typeof variantDimensions>>();
    const m = new Map<string, { title: string; what: string; hay: string }>();
    for (const r of rows) {
      let dims = byCategory.get(r.categoryId);
      if (!dims) {
        dims = variantDimensions(resolveAttributesForCategory(r.categoryId as any));
        byCategory.set(r.categoryId, dims);
      }
      const what = shopRowLabel(r, dims, language);
      const title = language === 'ar' ? r.titleAr || r.titleEn : r.titleEn || r.titleAr;
      m.set(r.id, { title, what, hay: `${title} ${what} ${r.sku ?? ''}`.toLowerCase() });
    }
    return m;
  }, [rows, resolveAttributesForCategory, language]);

  const titleOf = (g: StockGroup) =>
    language === 'ar' ? g.titleAr || g.titleEn : g.titleEn || g.titleAr;

  const groups = useMemo(() => groupByListing(rows), [rows]);

  const searching = query.trim().length > 0;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return narrowGroups(groups, (r) => !!meta.get(r.id)?.hay.includes(q));
  }, [groups, meta, query]);

  // Counted across EVERY row, not just the visible ones: a shop that types
  // a code, adds 12, then types another code must not lose the first.
  const pending = useMemo(
    () => Object.entries(adds).map(([id, v]) => ({ id, delta: Number(v) || 0 })).filter((m) => m.delta > 0),
    [adds]
  );
  const pendingUnits = pending.reduce((n, m) => n + m.delta, 0);

  // What is typed inside each item, counted off the UNFILTERED groups. A
  // closed item, or one the search box is hiding half of, still says how
  // much is sitting inside it -- typed work that nothing on screen admits
  // to is typed work that gets typed again.
  const pendingIn = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of groups) {
      let n = 0;
      for (const r of g.rows) n += Number(adds[r.id]) || 0;
      if (n > 0) m[g.listingId] = n;
    }
    return m;
  }, [groups, adds]);

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
    setOpen({});
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

  // The box, and the two lines of text that say which row it belongs to.
  // Shared by a folded-open row and by a single-row item, which is why the
  // name it announces to a screen reader is passed in rather than rebuilt:
  // under an open item the title is already on the line above.
  const addBox = (row: ShopRow, label: string) => (
    <TextInput
      value={adds[row.id] ?? ''}
      onChangeText={(v) => setAdd(row.id, v)}
      keyboardType="numeric"
      onFocus={onInputFocus}
      placeholder="+"
      placeholderTextColor={colors.inkSoft}
      style={[styles.addBox, !!adds[row.id] && styles.addBoxOn]}
      accessibilityLabel={t('restock.addTo', { what: label })}
    />
  );

  // An item with one row: no triangle, no tap, the box right there.
  const flatRow = (g: StockGroup) => {
    const row = g.rows[0];
    const m = meta.get(row.id);
    const title = m?.title ?? titleOf(g);
    const sub = [m?.what, row.sku].filter(Boolean).join(' · ');
    return (
      <View key={g.listingId} style={[styles.card, styles.row, mirrorRow(isRTL)]}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
          {!!sub && <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>}
        </View>
        <Text style={styles.have}>{t('restock.have', { n: row.qty })}</Text>
        {addBox(row, [title, m?.what].filter(Boolean).join(' '))}
      </View>
    );
  };

  const item = (g: StockGroup) => {
    if (g.plain) return flatRow(g);
    const title = titleOf(g);
    // Anything the search box narrowed is open already: typing a code and
    // then having to tap the item it lives in is two steps where the shop
    // meant one. A tap still decides, though -- `??`, not `||` -- so the
    // triangle is never a control that does nothing.
    const expanded = open[g.listingId] ?? searching;
    const waiting = pendingIn[g.listingId] ?? 0;
    return (
      <View key={g.listingId} style={expanded ? styles.card : null}>
        <Pressy
          onPress={() => setOpen((p) => ({ ...p, [g.listingId]: !expanded }))}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={title}
          // Shut, the head IS the card and wears the border itself: Pressy
          // scales the element it is on, so a border left on the wrapper
          // would stay put while the head shrank out from under it, and a
          // shut item's whole card would hollow out on every tap. Open, the
          // wrapper owns the border and the head becomes a heading.
          style={[styles.row, expanded ? styles.headRow : styles.card, mirrorRow(isRTL)]}
        >
          <View style={styles.rowText}>
            <Text style={styles.headTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {g.rows.length === g.rowCount
                ? t('restock.optionCount', { n: g.rowCount })
                : t('restock.optionsShown', { n: g.rows.length, m: g.rowCount })}
            </Text>
          </View>
          <View style={styles.headRight}>
            <Text style={styles.have}>{t('restock.have', { n: g.total })}</Text>
            {waiting > 0 && (
              <Text
                style={styles.pending}
                accessibilityLabel={t('restock.waitingToBook', { n: waiting })}
              >
                +{waiting}
              </Text>
            )}
          </View>
          {/* Sits in the column the number boxes occupy on the rows below,
              so the counts line up down the whole card instead of the
              item's own count floating 70px to the side of its rows'. */}
          <View style={[styles.chevronSlot, expanded && styles.chevronOpen]}>
            <Icon name="chevronRight" size={15} color={colors.inkSoft} />
          </View>
        </Pressy>
        {expanded &&
          g.rows.map((row) => {
            const m = meta.get(row.id);
            return (
              <View key={row.id} style={[styles.row, styles.childRow, mirrorRow(isRTL)]}>
                {/* A spacer rather than paddingStart: directional padding
                    resolves against I18nManager.isRTL, which this app never
                    flips, so it would indent from the left in Arabic too.
                    A flex child is turned around by mirrorRow on native and
                    by the document's dir on web, like everything else in
                    the row. */}
                <View style={styles.indent} />
                <View style={styles.rowText}>
                  {/* Two lines, same as a single-row item: the size and
                      colour is what the shop is looking for, and running
                      the code in beside it makes both of them wrap. */}
                  <Text style={styles.childTitle} numberOfLines={2}>
                    {m?.what || t('stock.plainRowLabel')}
                  </Text>
                  {!!row.sku && <Text style={styles.rowSub} numberOfLines={1}>{row.sku}</Text>}
                </View>
                <Text style={styles.have}>{t('restock.have', { n: row.qty })}</Text>
                {addBox(row, [title, m?.what].filter(Boolean).join(' '))}
              </View>
            );
          })}
      </View>
    );
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
            onChangeText={changeQuery}
            placeholder={t('restock.findPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="characters"
          />
          {query.length > 0 && (
            <Pressy onPress={() => changeQuery('')} style={styles.clear}>
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
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('restock.nothingToStock')}</Text>
          </View>
        ) : shown.length === 0 ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('restock.noMatch', { q: query.trim() })}</Text>
          </View>
        ) : (
          <View style={styles.list}>{shown.map(item)}</View>
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

  // One card per ITEM, with air between them. They used to share a single
  // card, so a folded item's tinted heading ran straight into the next
  // item's row with only a hairline between -- and a hairline is what
  // separates an item's own sizes from each other, so the next item read
  // as one more size of the one above it.
  list: { marginTop: 14, gap: 12 },
  card: {
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  // Separated from the row ABOVE, so the last row in an item has no line
  // hanging under it against the card's own edge.
  childRow: { borderTopWidth: 1, borderTopColor: colors.line },
  // Tinted only once it is heading something. Shut, every card on the
  // screen would be tinted, so the tint would separate nothing from
  // anything and just make the list read muddy against the page.
  headRow: { backgroundColor: colors.surface },
  headTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  headRight: { alignItems: 'center', minWidth: 54 },
  childTitle: { fontSize: 14, color: colors.ink },
  // Indents an open item's rows, so the list reads as a list inside a list
  // and a shop can see where the next item starts.
  indent: { width: 18 },
  chevronSlot: {
    width: 62, height: 42, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, color: colors.ink },
  rowSub: { ...type.tiny, marginTop: 2 },
  have: { ...type.tiny, minWidth: 54, textAlign: 'center' },
  pending: { ...type.tiny, color: colors.accentDeep, fontWeight: '800', marginTop: 1 },
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
