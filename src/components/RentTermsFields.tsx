import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import {
  RENT_PAYMENT_FREQUENCIES,
  RENT_PERIODS,
  RentPaymentFrequency,
  RentPeriod,
  rentPaymentFrequencyLabelKey,
  rentPeriodLabelKey,
  requiresPaymentFrequency,
} from '../lib/rentTerms';

// The rent half of a Properties listing's money fields: how much, per
// what, and how far ahead the tenant pays. Extracted for the same reason
// ConditionPicker and CategorySpecsForm were -- both the single-item
// wizard's Details step and the batch flow's own per-item details screen
// need exactly this block, and a second hand-rolled copy of the pill
// markup in the batch screen would drift out of sync the moment either
// changed. The single-item screen owns the sale-price field itself (it
// has AI-fill state to attach to it); everything rent-specific lives
// here.
//
// Styles mirror CreateListingScreen's fieldStyles locally rather than
// importing them, same reasoning ConditionPicker gives: fieldStyles there
// is a module-private StyleSheet shared by several steps this component
// has no business depending on.
export default function RentTermsFields({
  rentPrice,
  onChangeRentPrice,
  rentPeriod,
  onChangeRentPeriod,
  rentPaymentFrequency,
  onChangeRentPaymentFrequency,
  onInputFocus,
}: {
  rentPrice: string;
  onChangeRentPrice: (v: string) => void;
  rentPeriod: RentPeriod | null;
  onChangeRentPeriod: (v: RentPeriod) => void;
  rentPaymentFrequency: RentPaymentFrequency | null;
  onChangeRentPaymentFrequency: (v: RentPaymentFrequency) => void;
  onInputFocus?: () => void;
}) {
  const { t } = useLanguage();

  return (
    <View>
      {/* The period sits directly under the amount rather than beside it.
          It shared a row with the input while there were only two options;
          at four (day and week were added for vehicle hire) the pills no
          longer fit any phone width, and because a pill row does not
          shrink they squeezed the amount field to nothing rather than
          wrapping. The period is deliberately not pre-selected -- $800 a
          month and $800 a year are a twelvefold difference, and a wrong
          default here misprices the listing by more than any other field
          could. */}
      <Text style={localStyles.fieldLabel}>
        {t('createListing.rentValueLabel')}
        <Text style={localStyles.required}> *</Text>
      </Text>
      <TextInput
        onFocus={onInputFocus}
        value={rentPrice}
        onChangeText={onChangeRentPrice}
        placeholder="0"
        placeholderTextColor={colors.inkSoft}
        keyboardType="numeric"
        style={[localStyles.input, !rentPrice.trim() && localStyles.inputRequired]}
      />
      <View style={[localStyles.pillRow, localStyles.periodRow, !rentPeriod && localStyles.pillRowRequired]}>
        {RENT_PERIODS.map((p) => (
          <Pressy
            key={p}
            onPress={() => onChangeRentPeriod(p)}
            style={[localStyles.optPill, rentPeriod === p && localStyles.optPillActive]}
          >
            <Text style={[localStyles.optPillText, rentPeriod === p && localStyles.optPillTextActive]}>
              {t(rentPeriodLabelKey(p))}
            </Text>
          </Pressy>
        ))}
      </View>

      {/* Skipped entirely for a day or week hire -- see
          requiresPaymentFrequency. */}
      {requiresPaymentFrequency(rentPeriod) && (
        <>
          <Text style={localStyles.fieldLabel}>
            {t('createListing.rentPaymentFrequencyLabel')}
            <Text style={localStyles.required}> *</Text>
          </Text>
          <View style={[localStyles.pillRow, !rentPaymentFrequency && localStyles.pillRowRequired]}>
            {RENT_PAYMENT_FREQUENCIES.map((f) => (
              <Pressy
                key={f}
                onPress={() => onChangeRentPaymentFrequency(f)}
                style={[localStyles.optPill, rentPaymentFrequency === f && localStyles.optPillActive]}
              >
                <Text style={[localStyles.optPillText, rentPaymentFrequency === f && localStyles.optPillTextActive]}>
                  {t(rentPaymentFrequencyLabelKey(f))}
                </Text>
              </Pressy>
            ))}
          </View>
          <Text style={localStyles.hint}>{t('createListing.rentPaymentFrequencyHint')}</Text>
        </>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  required: { color: colors.danger },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  // The period pills sit on their own line under the amount; marginTop
  // replaces the gap the shared row used to provide.
  periodRow: { marginTop: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pillRowRequired: {
    borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm,
    padding: 8, backgroundColor: '#f5e4e2',
  },
  optPill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  optPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  optPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optPillTextActive: { color: colors.white },
  hint: { ...type.tiny, textTransform: 'none', letterSpacing: 0, marginTop: 6 },
});
