import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

export type FilterOption = { key: string; label: string };

// One always-visible sidebar section: a title, an optional inline search
// box (once there are more options than fit collapsed), a checkbox list,
// and a "Show all (N)" expander -- the Amazon/Airbnb-style facet block
// this whole redesign replaces the old one-facet-at-a-time chip row with.
// Selection is OR-semantics: any number of options can be checked at
// once, matching listings that have ANY of the checked values.
export default function FilterSection({
  title,
  options,
  selected,
  onToggle,
  searchable = false,
  maxCollapsed = 8,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
  maxCollapsed?: number;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const showSearch = searchable && options.length > maxCollapsed;
  const canExpand = filtered.length > maxCollapsed;
  const visible = expanded || !canExpand ? filtered : filtered.slice(0, maxCollapsed);

  if (options.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>

      {showSearch && (
        <View style={styles.searchRow}>
          <Icon name="search" size={13} color={colors.inkSoft} />
          <TextInput
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setExpanded(true); // searching implicitly wants the full set considered
            }}
            placeholder={t('home.filters.searchPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={styles.searchInput}
          />
        </View>
      )}

      {visible.map((o) => {
        const checked = selected.includes(o.key);
        return (
          <Pressy key={o.key} onPress={() => onToggle(o.key)} style={styles.optionRow}>
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
              {checked && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
            </View>
            <Text style={styles.optionLabel} numberOfLines={1}>{o.label}</Text>
          </Pressy>
        );
      })}

      {filtered.length === 0 && <Text style={[type.soft, styles.noMatches]}>{t('home.filters.noMatches')}</Text>}

      {canExpand && !expanded && (
        <Pressy onPress={() => setExpanded(true)} style={styles.expandBtn}>
          <Text style={styles.expandBtnText}>{t('home.filters.showAll', { n: filtered.length })}</Text>
        </Pressy>
      )}
      {canExpand && expanded && (
        <Pressy onPress={() => setExpanded(false)} style={styles.expandBtn}>
          <Text style={styles.expandBtnText}>{t('home.filters.showLess')}</Text>
        </Pressy>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  title: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, color: colors.ink },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 10, height: 34, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.ink },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  checkbox: {
    width: 17, height: 17, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkboxChecked: { backgroundColor: colors.ink, borderColor: colors.ink },
  optionLabel: { fontSize: 13.5, color: colors.ink, flex: 1 },
  noMatches: { paddingVertical: 4 },
  expandBtn: { marginTop: 4, paddingVertical: 4 },
  expandBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
