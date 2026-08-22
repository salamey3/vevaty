import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import SuggestInput from './SuggestInput';
import { colors, radius, type } from '../theme/theme';
import { AttributeValue, CategoryAttribute } from '../types';
import { attrHasValue } from '../lib/attributeFormat';
import { getVehicleBrandNames, getModelsForBrand } from '../data/vehicleBrands';

// Extracted from CreateListingScreen's 'specs' step JSX (photos-first
// restructuring) so the batch per-item Details screen can render the same
// category-attribute fields -- including the vehicle brand/model
// suggestion-input special case -- without a second copy of AttributeField
// or the vehicleSlugKind classifier drifting out of sync with the
// single-item wizard.

// Classifies a category-attribute slug as a vehicle brand or model field
// (including the "compatible brand/model" slugs used on Spare
// Parts/Accessories), or null for anything else -- drives which specs get
// the Brand/Model suggestion UI instead of the generic field renderer
// below. Moved here verbatim from CreateListingScreen.tsx; this is now its
// only call site.
function vehicleSlugKind(slug: string): 'brand' | 'model' | null {
  const s = slug.toLowerCase();
  if (s === 'brand' || s === 'compatible_brand') return 'brand';
  if (s === 'model' || s === 'compatible_model') return 'model';
  return null;
}

function RequiredMark() {
  return <Text style={localStyles.requiredMark}> *</Text>;
}

function AttributeField({
  attribute,
  language,
  value,
  onChangeValue,
  onToggleMultiselect,
  onFocus,
}: {
  attribute: CategoryAttribute;
  language: 'en' | 'ar';
  value: AttributeValue | undefined;
  onChangeValue: (v: AttributeValue) => void;
  onToggleMultiselect: (optionValue: string) => void;
  onFocus?: () => void;
}) {
  const label = language === 'ar' ? attribute.labelAr : attribute.labelEn;
  const unit = language === 'ar' ? attribute.unitAr : attribute.unitEn;
  const fieldLabelNode = (
    <Text style={localStyles.fieldLabel}>
      {label}
      {attribute.required && <RequiredMark />}
      {unit ? ` (${unit})` : ''}
    </Text>
  );
  const isEmptyRequired = attribute.required && attribute.type !== 'boolean' && !attrHasValue(value);

  if (attribute.type === 'boolean') {
    return (
      <View style={localStyles.switchRow}>
        {fieldLabelNode}
        <Pressy onPress={() => onChangeValue(!value)} style={[localStyles.boolPill, !!value && localStyles.boolPillActive]}>
          <Text style={[localStyles.boolPillText, !!value && localStyles.boolPillTextActive]}>{value ? '✓' : ''}</Text>
        </Pressy>
      </View>
    );
  }

  if (attribute.type === 'select' || attribute.type === 'multiselect') {
    const selected: string[] = attribute.type === 'multiselect' ? (Array.isArray(value) ? (value as string[]) : []) : value ? [value as string] : [];
    return (
      <View>
        {fieldLabelNode}
        <View style={[localStyles.pillRow, isEmptyRequired && localStyles.pillRowRequired]}>
          {attribute.options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <Pressy
                key={opt.value}
                onPress={() => (attribute.type === 'multiselect' ? onToggleMultiselect(opt.value) : onChangeValue(opt.value))}
                style={[localStyles.optPill, isSelected && localStyles.optPillActive]}
              >
                <Text style={[localStyles.optPillText, isSelected && localStyles.optPillTextActive]}>
                  {language === 'ar' ? opt.labelAr : opt.labelEn}
                </Text>
              </Pressy>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View>
      {fieldLabelNode}
      <TextInput
        onFocus={onFocus}
        value={value === undefined ? '' : String(value)}
        onChangeText={(v) => onChangeValue(attribute.type === 'number' ? (v === '' ? '' : Number(v) || 0) : v)}
        keyboardType={attribute.type === 'number' ? 'numeric' : 'default'}
        style={[localStyles.input, isEmptyRequired && localStyles.inputRequired]}
      />
    </View>
  );
}

export default function CategorySpecsForm({
  specAttrs,
  attrValues,
  onSetValue,
  onToggleMultiselect,
  isVehicleCategory,
  language,
  onFocus,
  vehicleBrandModelPlaceholder,
}: {
  specAttrs: CategoryAttribute[];
  attrValues: Record<string, AttributeValue>;
  onSetValue: (slug: string, v: AttributeValue) => void;
  onToggleMultiselect: (slug: string, optionValue: string) => void;
  isVehicleCategory: boolean;
  language: 'en' | 'ar';
  onFocus?: () => void;
  vehicleBrandModelPlaceholder: string;
}) {
  return (
    <View>
      {specAttrs.map((a) => {
        const vehicleKind = isVehicleCategory ? vehicleSlugKind(a.slug) : null;
        if (vehicleKind) {
          const label = language === 'ar' ? a.labelAr : a.labelEn;
          const fieldLabel = `${label}${a.required ? ' *' : ''}`;
          const value = attrValues[a.slug];
          const brandSlug = vehicleKind === 'model' ? 'brand' : 'compatible_brand';
          const suggestions =
            vehicleKind === 'brand'
              ? getVehicleBrandNames()
              : getModelsForBrand(typeof attrValues[brandSlug] === 'string' ? (attrValues[brandSlug] as string) : '');
          return (
            <View key={a.id}>
              <Text style={localStyles.fieldLabel}>{fieldLabel}</Text>
              <SuggestInput
                onFocus={onFocus}
                value={value === undefined ? '' : String(value)}
                onChangeText={(v) => onSetValue(a.slug, v)}
                suggestions={suggestions}
                placeholder={vehicleBrandModelPlaceholder}
              />
            </View>
          );
        }
        return (
          <AttributeField
            key={a.id}
            onFocus={onFocus}
            attribute={a}
            language={language}
            value={attrValues[a.slug]}
            onChangeValue={(v) => onSetValue(a.slug, v)}
            onToggleMultiselect={(optionValue) => onToggleMultiselect(a.slug, optionValue)}
          />
        );
      })}
    </View>
  );
}

const localStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  requiredMark: { color: colors.danger },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  pillRowRequired: {
    borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm,
    padding: 8, backgroundColor: '#f5e4e2',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  boolPill: {
    width: 44, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  boolPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  boolPillText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  boolPillTextActive: { color: colors.white },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optPill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  optPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  optPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optPillTextActive: { color: colors.white },
});
