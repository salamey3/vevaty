import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, type } from '../theme/theme';
import { CategoryAttribute } from '../types';

// Extracted verbatim from CreateListingScreen's 'stock' step JSX (photos-
// first restructuring), so the batch per-item Details screen can offer the
// same variant/plain stock intake for a 'multiple'-stockMode category
// without a second copy of this markup. See Category.stockMode's own doc
// comment (src/types/index.ts) for what a variant vs. plain-quantity
// category is.
export default function StockIntakeForm({
  variantAttr,
  variantStock,
  onChangeVariantStock,
  plainStockQty,
  onChangePlainStockQty,
  language,
  onFocus,
  variantIntro,
  plainIntro,
  stockQtyLabel,
}: {
  variantAttr: CategoryAttribute | null | undefined;
  variantStock: Record<string, string>;
  onChangeVariantStock: (optionValue: string, qty: string) => void;
  plainStockQty: string;
  onChangePlainStockQty: (qty: string) => void;
  language: 'en' | 'ar';
  onFocus?: () => void;
  variantIntro: string;
  plainIntro: string;
  stockQtyLabel: string;
}) {
  return (
    <View>
      <Text style={type.soft}>{variantAttr ? variantIntro : plainIntro}</Text>
      {variantAttr ? (
        <View style={localStyles.stockVariantList}>
          {variantAttr.options.map((o) => {
            const label = language === 'ar' ? o.labelAr : o.labelEn;
            return (
              <View key={o.value} style={localStyles.stockVariantRow}>
                <Text style={localStyles.stockVariantLabel}>{label}</Text>
                <TextInput
                  onFocus={onFocus}
                  value={variantStock[o.value] ?? ''}
                  onChangeText={(v) => onChangeVariantStock(o.value, v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  style={localStyles.stockVariantInput}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <>
          <Text style={localStyles.fieldLabel}>{stockQtyLabel}</Text>
          <TextInput
            onFocus={onFocus}
            value={plainStockQty}
            onChangeText={(v) => onChangePlainStockQty(v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            placeholder="1"
            style={localStyles.input}
          />
        </>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  stockVariantList: { marginTop: 8, gap: 10 },
  stockVariantRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stockVariantLabel: { fontSize: 14.5, color: colors.ink, flex: 1 },
  stockVariantInput: {
    width: 72, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, textAlign: 'center', fontSize: 14.5, color: colors.ink,
  },
});
