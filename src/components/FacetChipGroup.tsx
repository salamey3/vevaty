import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

export type ChipOption = { key: string; label: string; count: number };

// The storefront's compact chip-row facet control -- deliberately NOT
// FilterSection (HomeScreen's checkbox-list sidebar section): the
// storefronts plan calls for pill/chip controls here ("chips, one-of" /
// "chips, any-of" in the per-type table), matching the approved mockup's
// visual language, and a single shop's own stock is a small enough set
// that a wrapped chip row reads better than a scrollable checkbox list.
//
// Layout rules straight from the plan doc's "how one layout serves a shop
// with 2 attributes and a shop with 19" section: caps at 6 chips then a
// "+N more" chip that reveals the rest in place (no separate expand
// state to manage beyond this component); the caller is responsible for
// the OTHER two rules (a facet with fewer than two distinct values isn't
// passed in at all, and only the top two filter_priority facets render
// inline -- see StorefrontScreen).
const CHIP_CAP = 6;

export default function FacetChipGroup({
  title,
  options,
  selected,
  onToggle,
  mode = 'multi',
}: {
  title: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  // 'multi' = any number of chips can be active at once (OR match --
  // select/multiselect/text/boolean-with-both-values). 'single' = picking
  // one clears any other (used for a boolean facet with a genuine
  // either/or meaning, kept as a caller option rather than inferred).
  mode?: 'multi' | 'single';
}) {
  const { isRTL } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  if (options.length === 0) return null;
  const visible = expanded ? options : options.slice(0, CHIP_CAP);
  const hiddenCount = options.length - visible.length;

  return (
    <View style={styles.section}>
      <Text style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
      <View style={[styles.row, isRTL && styles.rowRTL]}>
        {visible.map((o) => {
          const active = selected.includes(o.key);
          return (
            <Pressy key={o.key} onPress={() => onToggle(o.key)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {o.label}
              </Text>
              <Text style={[styles.chipCount, active && styles.chipCountActive]}>{o.count}</Text>
            </Pressy>
          );
        })}
        {!expanded && hiddenCount > 0 && (
          <Pressy onPress={() => setExpanded(true)} style={styles.moreChip}>
            <Text style={styles.moreChipText}>+{hiddenCount}</Text>
          </Pressy>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 14 },
  title: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowRTL: { flexDirection: 'row-reverse' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 34, paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.white },
  chipCount: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  chipCountActive: { color: 'rgba(255,255,255,0.75)' },
  moreChip: {
    height: 34, paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  moreChipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
});
