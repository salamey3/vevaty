import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';

const MAX_SUGGESTIONS = 6;

export type CategorySuggestOption = { id: string; label: string; parent?: string };

// Ranks `options` by `label` against a free-typed `query`: prefix matches
// first, then anywhere-in-string matches, each group alphabetical by
// label. Capped at MAX_SUGGESTIONS. Unlike SuggestInput's rankSuggestions,
// an exact-label match is NOT dropped -- two different categories can
// share a label under different parents (see the `parent` sub-line below),
// so "matches exactly what's typed" doesn't mean "nothing left to pick".
function rankOptions(query: string, options: CategorySuggestOption[]): CategorySuggestOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, MAX_SUGGESTIONS);
  const starts: CategorySuggestOption[] = [];
  const contains: CategorySuggestOption[] = [];
  for (const opt of options) {
    const lower = opt.label.toLowerCase();
    if (lower.startsWith(q)) starts.push(opt);
    else if (lower.includes(q)) contains.push(opt);
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

// A sibling to SuggestInput, not an extension of it -- that component is
// deliberately string-only (value always equals exactly what was typed,
// picking a suggestion just fills the field) and is used elsewhere for
// free-text fields (vehicle Brand/Model, Region/Area) where that contract
// matters. A category picker needs the opposite: selection must resolve
// to one specific CategoryId, and two categories can share a label under
// different parents (e.g. "Spare Parts" could plausibly exist under more
// than one top-level category), so each row needs to disambiguate with
// its parent's name and `onSelect` reports an id, not text.
//
// Same inline-dropdown-not-overlay reasoning as SuggestInput (react-
// native-web flexbox/overflow quirks with absolutely-positioned lists),
// and the same blur→hide delay so a row tap registers before the list
// unmounts.
const BLUR_HIDE_MS = 150;

export default function CategorySuggestInput({
  query,
  onChangeQuery,
  options,
  onSelect,
  placeholder,
  testID,
}: {
  query: string;
  onChangeQuery: (v: string) => void;
  options: CategorySuggestOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => rankOptions(query, options), [query, options]);
  const showDropdown = focused && matches.length > 0;

  const handleBlur = () => {
    hideTimer.current = setTimeout(() => setFocused(false), BLUR_HIDE_MS);
  };
  const handleSelect = (opt: CategorySuggestOption) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    onSelect(opt.id);
    setFocused(false);
  };

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={onChangeQuery}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoCorrect={false}
        style={localStyles.input}
        testID={testID}
      />
      {showDropdown && (
        <View style={localStyles.dropdown}>
          {matches.map((opt, i) => (
            <Pressy
              key={opt.id}
              onPress={() => handleSelect(opt)}
              style={[localStyles.row, i === matches.length - 1 && localStyles.rowLast]}
            >
              <Text style={localStyles.rowText} numberOfLines={1}>{opt.label}</Text>
              {opt.parent && <Text style={localStyles.rowParent} numberOfLines={1}>{opt.parent}</Text>}
            </Pressy>
          ))}
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  dropdown: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, marginTop: 4, overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { fontSize: 14, color: colors.ink },
  rowParent: { ...type.tiny, color: colors.inkSoft, marginTop: 1 },
});
