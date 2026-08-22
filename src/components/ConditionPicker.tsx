import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';

// Extracted verbatim (same styles, same required-empty red treatment) from
// the Classify step's condition block in CreateListingScreen.tsx, so the
// batch review screen's per-row condition fix can render the exact same
// control without a second copy of the pill-row markup drifting out of
// sync. See fieldStyles.pillRowRequired in CreateListingScreen.tsx for the
// original -- this mirrors it locally rather than importing it, since
// fieldStyles there is a module-private StyleSheet shared by several other
// steps this component has no business depending on.
export default function ConditionPicker({
  value,
  onChange,
  label,
  newLabel,
  usedLabel,
}: {
  value: 'new' | 'used' | null;
  onChange: (v: 'new' | 'used') => void;
  label: string;
  newLabel: string;
  usedLabel: string;
}) {
  return (
    <View>
      <Text style={localStyles.fieldLabel}>
        {label}
        <Text style={localStyles.required}> *</Text>
      </Text>
      <View style={[localStyles.pillRow, !value && localStyles.pillRowRequired]}>
        {(['new', 'used'] as const).map((c) => (
          <Pressy
            key={c}
            onPress={() => onChange(c)}
            style={[localStyles.optPill, value === c && localStyles.optPillActive]}
          >
            <Text style={[localStyles.optPillText, value === c && localStyles.optPillTextActive]}>
              {c === 'new' ? newLabel : usedLabel}
            </Text>
          </Pressy>
        ))}
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  required: { color: colors.danger },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Same reserved-for-required-missing red as everywhere else in the
  // create-listing form -- deliberately the ONLY thing in this feature
  // that uses colors.danger, so it stays unambiguous next to the
  // AI-guess gold highlight on the redesigned Classify field.
  pillRowRequired: { borderWidth: 1.5, borderColor: colors.danger, borderRadius: radius.sm, padding: 8, backgroundColor: '#f5e4e2' },
  optPill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  optPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  optPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optPillTextActive: { color: colors.white },
});
