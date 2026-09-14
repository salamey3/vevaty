import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { CategoryAttribute } from '../types';
import { MAX_QTY, MAX_VARIANTS, Variant, isLow, variantLabel } from '../lib/stock';

// The size x colour table a shop fills in when it posts. Replaces the
// single column of quantities StockIntakeForm offered, which could only
// ever describe one dimension.
//
// Two rules run through the whole thing, and both come from the fact that
// Vevaty never sees the money, so nothing can tell the app a sale
// happened (see src/lib/stock.ts):
//
//   * A row that ALREADY EXISTS shows its count as plain text, not as a
//     box. The server ignores a quantity sent for an existing row on
//     purpose -- otherwise opening this form to fix a typo would put last
//     week's numbers back -- so offering an editable box here would be a
//     lie the seller only discovers when their stock is wrong. Counts
//     move from the listing itself, where the verbs are "sold one",
//     "a delivery came" and "I counted them".
//   * A brand-new combination gets one box, and it is labelled as the
//     opening count, because that is the only moment a number can simply
//     be stated.
//
// No picture is chosen here, deliberately. A first post's gallery is
// still local file:// URIs at the moment this saves -- the uploads land
// afterwards -- so anything tagged here would be tagged against a URL
// that does not exist yet and would silently save as nothing. Which
// photo belongs to which colour is asked on the listing itself, where
// every picture is already hosted.

export default function StockGrid({
  dims, picks, onTogglePick, rows, onChangeRow, language, isRTL, t, onFocus,
}: {
  dims: CategoryAttribute[];
  picks: Record<string, string[]>;
  onTogglePick: (slug: string, value: string) => void;
  rows: Variant[];
  // The whole row, not its id: a row the seller has typed into but not
  // saved has only a placeholder id, and the screen keys its record of
  // every known row on the combination instead.
  onChangeRow: (row: Variant, patch: Partial<Variant>) => void;
  language: 'en' | 'ar';
  isRTL: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  onFocus?: () => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const plain = dims.length === 0;
  const tooMany = rows.length > MAX_VARIANTS;

  const qtyText = (v: number) => String(v);
  const onQty = (row: Variant, raw: string) => {
    const n = Number(raw.replace(/[^0-9]/g, '') || '0');
    onChangeRow(row, { qty: Math.min(MAX_QTY, Number.isFinite(n) ? n : 0) });
  };

  return (
    <View>
      {/* 1. which sizes, which colours */}
      {dims.map((d, i) => {
        const ticked = picks[d.slug] ?? [];
        return (
          <View key={d.slug} style={i === 0 ? undefined : styles.dimGap}>
            <Text style={styles.fieldLabel}>{language === 'ar' ? d.labelAr : d.labelEn}</Text>
            <View style={[styles.pillRow, mirrorRow(isRTL)]}>
              {d.options.map((o) => {
                const on = ticked.includes(o.value);
                return (
                  <Pressy
                    key={o.value}
                    onPress={() => onTogglePick(d.slug, o.value)}
                    style={[styles.pill, on && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, on && styles.pillTextOn]}>
                      {language === 'ar' ? o.labelAr : o.labelEn}
                    </Text>
                  </Pressy>
                );
              })}
            </View>
          </View>
        );
      })}

      {plain && <Text style={type.soft}>{t('stock.plainIntro')}</Text>}
      {!plain && rows.length === 0 && (
        <Text style={[type.soft, styles.dimGap]}>
          {/* Named, when there are two: "tick the ones you carry" is no
              help to somebody who has ticked three colours and is looking
              at an empty table wondering what else it wants. */}
          {dims.length === 2
            ? t('stock.pickBoth', {
                first: language === 'ar' ? dims[0].labelAr : dims[0].labelEn,
                second: language === 'ar' ? dims[1].labelAr : dims[1].labelEn,
              })
            : t('stock.pickFirst')}
        </Text>
      )}

      {tooMany && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>{t('stock.tooManyRows', { max: MAX_VARIANTS, n: rows.length })}</Text>
        </View>
      )}

      {/* 2. the table */}
      {rows.length > 0 && (
        <View style={styles.grid}>
          {!plain && (
            <View style={[styles.gridHead, mirrorRow(isRTL)]}>
              <Text style={[styles.headText, styles.cellLabel]}>{t('stock.colCombination')}</Text>
              <Text style={[styles.headText, styles.cellQty]}>{t('stock.colCount')}</Text>
            </View>
          )}
          {rows.map((r) => {
            const isNew = r.id.startsWith('new:');
            return (
              <View key={r.id} style={styles.gridRow}>
                <View style={[styles.rowTop, mirrorRow(isRTL)]}>
                  <Text style={[styles.cellLabel, styles.rowLabel]} numberOfLines={2}>
                    {/* By the ROW, not by the category. A shop that posted
                        before its category gained a size keeps a row with
                        neither value; naming it off dims.length left it
                        blank. */}
                    {!r.a && !r.b ? t('stock.plainRowLabel') : variantLabel(r, dims, language)}
                  </Text>
                  {isNew ? (
                    <TextInput
                      onFocus={onFocus}
                      value={r.qty ? qtyText(r.qty) : ''}
                      onChangeText={(v) => onQty(r, v)}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.qtyInput, styles.cellQty]}
                      accessibilityLabel={t('stock.openingCountFor', {
                        what: !r.a && !r.b ? t('stock.plainRowLabel') : variantLabel(r, dims, language),
                      })}
                    />
                  ) : (
                    <View style={[styles.cellQty, styles.qtyFixed]}>
                      <Text style={[styles.qtyFixedText, isLow(r) && styles.qtyLow, r.qty === 0 && styles.qtyOut]}>
                        {r.qty}
                      </Text>
                    </View>
                  )}
                </View>
                {showMore && (
                  <View style={[styles.moreRow, mirrorRow(isRTL)]}>
                    <TextInput
                      onFocus={onFocus}
                      value={r.sku ?? ''}
                      onChangeText={(v) => onChangeRow(r, { sku: v.slice(0, 40) || null })}
                      placeholder={t('stock.skuPlaceholder')}
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.smallInput, styles.skuInput]}
                    />
                    <PriceCell
                      value={r.price}
                      onChange={(n) => onChangeRow(r, { price: n })}
                      onFocus={onFocus}
                      placeholder={t('stock.pricePlaceholder')}
                    />
                    <TextInput
                      onFocus={onFocus}
                      value={r.lowAt == null ? '' : String(r.lowAt)}
                      onChangeText={(v) => {
                        const clean = v.replace(/[^0-9]/g, '');
                        onChangeRow(r, { lowAt: clean === '' ? null : Math.min(MAX_QTY, Number(clean)) });
                      }}
                      keyboardType="numeric"
                      placeholder={t('stock.lowPlaceholder')}
                      placeholderTextColor={colors.inkSoft}
                      style={[styles.smallInput, styles.lowInput]}
                    />
                  </View>
                )}
              </View>
            );
          })}
          {rows.some((r) => !r.id.startsWith('new:')) && (
            <Text style={styles.footNote}>{t('stock.existingCountsNote')}</Text>
          )}
          <Pressy onPress={() => setShowMore((v) => !v)} style={styles.moreToggle}>
            <Text style={styles.moreToggleText}>{showMore ? t('stock.hideExtras') : t('stock.showExtras')}</Text>
          </Pressy>
        </View>
      )}

    </View>
  );
}

// A price box that can actually have a decimal point typed into it.
//
// Written as a controlled field over the number -- value={String(price)},
// onChangeText={Number(...)} -- it cannot: Number("18.") is 18, the
// re-render puts "18" back, and the point is eaten the instant it is
// pressed. Worse, Number(".") is NaN, which the box then displays as the
// literal text NaN and the save posts as the string "NaN", which the
// server refuses -- taking every other row in the same call down with it.
//
// So the text is its own state while the seller is in the field, and only
// a finite number is ever handed upwards.
function PriceCell({
  value, onChange, onFocus, placeholder,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  onFocus?: () => void;
  placeholder: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(value == null ? '' : String(value));
  }, [value]);
  return (
    <TextInput
      onFocus={() => { typing.current = true; onFocus?.(); }}
      onBlur={() => { typing.current = false; setText(value == null ? '' : String(value)); }}
      value={text}
      onChangeText={(v) => {
        // One leading digit group, one point, digits after it. Anything
        // else the seller types simply does not appear.
        const clean = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        setText(clean);
        const n = Number(clean);
        onChange(clean === '' || !Number.isFinite(n) ? null : n);
      }}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={colors.inkSoft}
      style={[styles.smallInput, styles.priceInput]}
    />
  );
}

const styles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  dimGap: { marginTop: 4 },
  // mirrorRow only supplies row-reverse on native RTL, so every row still
  // needs its own flexDirection or it stacks vertically on the web.
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.ink },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  pillTextOn: { color: colors.white },

  warn: {
    marginTop: 12, padding: 10, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.danger, backgroundColor: '#f5e4e2',
  },
  warnText: { fontSize: 13, color: colors.ink },

  grid: { marginTop: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
  gridHead: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5 },
  gridRow: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cellLabel: { flex: 1 },
  cellQty: { width: 78 },
  rowLabel: { fontSize: 14.5, color: colors.ink },
  qtyInput: {
    height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, textAlign: 'center', fontSize: 14.5, color: colors.ink,
  },
  qtyFixed: { height: 40, alignItems: 'center', justifyContent: 'center' },
  qtyFixedText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  qtyLow: { color: colors.accentDeep },
  qtyOut: { color: colors.inkSoft },

  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  smallInput: {
    height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 8, fontSize: 13, color: colors.ink,
  },
  skuInput: { flex: 1.4 },
  priceInput: { flex: 1, textAlign: 'center' },
  lowInput: { flex: 1, textAlign: 'center' },

  footNote: { ...type.tiny, paddingHorizontal: 12, paddingTop: 8, lineHeight: 16 },
  moreToggle: { paddingHorizontal: 12, paddingVertical: 10 },
  moreToggleText: { fontSize: 13, fontWeight: '700', color: colors.ink, textDecorationLine: 'underline' },

});
