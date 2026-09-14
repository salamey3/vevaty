import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { CategoryAttribute } from '../types';
import { money } from '../lib/listingOptions';
import { Variant, isLow, pickable, priceOf, rowFor } from '../lib/stock';

// What a buyer taps to say which one they want: this size, in this colour.
//
// Sold-out combinations are shown and marked, never hidden. "Medium is out
// until Friday" is what the buyer came to find out, and a size that
// quietly disappears reads as a listing that never carried it -- so they
// message to ask, and the shop answers the same question all day.
//
// A combination the shop has never offered at all is a different thing and
// IS absent: a listing with navy in S and M and red only in L should not
// invite anybody to ask for red in S.

export default function VariantChooser({
  rows, dims, a, b, qty, onA, onB, onQty, listingPrice, language, isRTL, t,
}: {
  rows: Variant[];
  dims: CategoryAttribute[];
  a: string | null;
  b: string | null;
  qty: number;
  onA: (v: string | null) => void;
  onB: (v: string | null) => void;
  onQty: (n: number) => void;
  listingPrice: number;
  language: 'en' | 'ar';
  isRTL: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  // "Nothing to pick" is a property of the ROWS, not of the category. A
  // listing posted before its category gained a size still has one row
  // with neither value on it, and keying this off dims.length showed that
  // buyer a size chooser with no rows behind it and a permanently dead
  // send button.
  const plain = rows.length === 1 && !rows[0].a && !rows[0].b;
  // Only the dimensions the rows actually use, for the same reason.
  const useDims = plain ? [] : dims.slice(0, rows.some((r) => r.b) ? 2 : 1);
  const chosen = plain ? rows[0] ?? null : rowFor(rows, a, useDims.length === 2 ? b : null);
  const price = priceOf(chosen, listingPrice);
  const left = chosen?.qty ?? 0;

  const label = (dim: CategoryAttribute, value: string) => {
    const o = dim.options.find((x) => x.value === value);
    return o ? (language === 'ar' ? o.labelAr : o.labelEn) : value;
  };

  // Rank 1 offers everything the listing carries. Rank 2 offers only what
  // exists in the rank-1 value already chosen, which is what stops a buyer
  // landing on a pair the shop never made.
  const firstValues = pickable(rows, 'a', null, 'b');
  const secondValues = pickable(rows, 'b', a, 'a');

  const stepper = (
    <View style={[styles.qtyRow, mirrorRow(isRTL)]}>
      <Pressy
        onPress={() => onQty(Math.max(1, qty - 1))}
        disabled={qty <= 1}
        style={[styles.step, qty <= 1 && styles.stepOff]}
        accessibilityLabel={t('options.fewer')}
      >
        <Text style={styles.stepGlyph}>−</Text>
      </Pressy>
      <Text style={styles.qtyText}>{qty}</Text>
      <Pressy
        onPress={() => onQty(Math.min(Math.max(1, left), qty + 1))}
        disabled={qty >= left}
        style={[styles.step, qty >= left && styles.stepOff]}
        accessibilityLabel={t('options.more')}
      >
        <Text style={styles.stepGlyph}>+</Text>
      </Pressy>
    </View>
  );

  return (
    <View>
      {useDims.map((dim, i) => {
        const offered = i === 0 ? firstValues : secondValues;
        const picked = i === 0 ? a : b;
        // Rank 2 is meaningless until rank 1 has been answered -- what is
        // in stock in navy depends on which size you meant.
        const waiting = i === 1 && a === null;
        return (
          <View key={dim.slug} style={styles.dim}>
            <Text style={styles.fieldLabel}>{language === 'ar' ? dim.labelAr : dim.labelEn}</Text>
            {waiting ? (
              <Text style={type.soft}>
                {t('stock.pickTheFirst', { first: language === 'ar' ? useDims[0].labelAr : useDims[0].labelEn })}
              </Text>
            ) : (
              <View style={[styles.pillRow, mirrorRow(isRTL)]}>
                {dim.options
                  .filter((o) => offered.has(o.value))
                  .map((o) => {
                    const on = picked === o.value;
                    // Out of stock in every combination still open to this
                    // buyer -- not out of stock everywhere.
                    const any = rows.some(
                      (r) =>
                        (i === 0 ? r.a : r.b) === o.value &&
                        (i === 0 || a === null || r.a === a) &&
                        r.qty > 0
                    );
                    return (
                      <Pressy
                        key={o.value}
                        onPress={() => {
                          if (i === 0) {
                            onA(on ? null : o.value);
                            // The colour that was chosen may not exist in
                            // the new size. Cleared rather than silently
                            // left pointing at a row that is not there.
                            onB(null);
                          } else {
                            onB(on ? null : o.value);
                          }
                        }}
                        style={[styles.pill, on && styles.pillOn, !any && styles.pillOut]}
                      >
                        <Text style={[styles.pillText, on && styles.pillTextOn, !any && styles.pillTextOut]}>
                          {language === 'ar' ? o.labelAr : o.labelEn}
                        </Text>
                        {!any && <Text style={styles.pillOutMark}>{t('stock.outMark')}</Text>}
                      </Pressy>
                    );
                  })}
              </View>
            )}
          </View>
        );
      })}

      {/* What the pick actually means: the price for this exact one, and
          how many of it there are. */}
      <View style={[styles.summary, mirrorRow(isRTL)]}>
        <View style={{ flex: 1 }}>
          {chosen ? (
            <>
              <Text style={styles.summaryPrice}>{money(price * Math.max(1, qty))}</Text>
              {/* The unit price only once it stops being the whole story.
                  The big number is what the buyer is about to ask for, and
                  showing $18 next to a stepper reading 3 meant the first
                  time $54 appeared anywhere was in the chat. */}
              {qty > 1 && (
                <Text style={styles.summaryEach}>{t('options.breakdownMany', { n: qty, each: money(price) })}</Text>
              )}
              <Text style={[styles.summaryLeft, left === 0 && styles.summaryGone, isLow(chosen) && styles.summaryLow]}>
                {left === 0
                  ? t('stock.thisOneIsOut')
                  : isLow(chosen)
                  ? t('stock.runningLow', { n: left })
                  : t('stock.leftOfThis', { n: left })}
              </Text>
              {!!chosen.sku && <Text style={styles.summarySku}>{chosen.sku}</Text>}
            </>
          ) : (
            <Text style={type.soft}>
              {plain ? t('stock.thisOneIsOut') : t('stock.chooseToSeePrice')}
            </Text>
          )}
        </View>
        {!!chosen && left > 0 && stepper}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { marginTop: 4 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    justifyContent: 'center',
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.ink },
  pillOut: { backgroundColor: colors.bg, borderStyle: 'dashed' },
  pillText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  pillTextOn: { color: colors.white },
  pillTextOut: { color: colors.inkSoft },
  pillOutMark: { ...type.tiny, color: colors.inkSoft },

  summary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    marginTop: 14, padding: 12, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  summaryPrice: { fontSize: 20, fontWeight: '800', color: colors.ink },
  summaryEach: { ...type.tiny, marginTop: 1 },
  summaryLeft: { ...type.tiny, marginTop: 2 },
  summaryLow: { color: colors.accentDeep },
  summaryGone: { color: colors.danger },
  summarySku: { ...type.tiny, marginTop: 2 },

  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  stepOff: { opacity: 0.4 },
  stepGlyph: { fontSize: 20, lineHeight: 22, fontWeight: '700', color: colors.ink },
  qtyText: { fontSize: 17, fontWeight: '800', color: colors.ink, minWidth: 22, textAlign: 'center' },
});
