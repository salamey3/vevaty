import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import Pressy from './Pressy';
import { colors, radius } from '../theme/theme';

const MAX_SUGGESTIONS = 6;

// Ranks `options` against a free-typed `query`: exact-typed matches are
// dropped (nothing to suggest once it's already been typed verbatim),
// prefix matches come first, then anywhere-in-string matches, each group
// alphabetical. Capped at MAX_SUGGESTIONS -- this is a lightweight typing
// aid, not a full picker, so it never needs to show everything at once.
function rankSuggestions(query: string, options: string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, MAX_SUGGESTIONS);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const opt of options) {
    const lower = opt.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) starts.push(opt);
    else if (lower.includes(q)) contains.push(opt);
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

// A plain TextInput with a "did you mean" style dropdown of suggestions
// underneath it -- NEVER restrictive. The typed value is always exactly
// what onChangeText reports; tapping a suggestion just fills the field
// with that string, same as if the seller had typed it themselves. Used
// for the vehicle Brand/Model fields and the Region/Area location fields
// on CreateListingScreen, where we want to help sellers who aren't sure
// how something is normally spelled without ever blocking a value that
// isn't on our list (a brand/town missing from our data, for instance).
//
// Renders the suggestion list inline (pushes following content down)
// rather than as an absolutely-positioned overlay -- this project has
// repeatedly hit react-native-web flexbox/overflow quirks with anything
// fancier, and an inline list is simple, reliable, and a familiar mobile
// pattern (e.g. map search-box suggestions).
//
// The blur→hide is delayed by BLUR_HIDE_MS so a tap on a suggestion row
// (which blurs the TextInput first) has time to register as a press
// before the list unmounts -- a standard web autocomplete pattern.
const BLUR_HIDE_MS = 150;

export default function SuggestInput({
  value,
  onChangeText,
  suggestions,
  placeholder,
  style,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => rankSuggestions(value, suggestions), [value, suggestions]);
  const showDropdown = focused && matches.length > 0;

  const handleBlur = () => {
    hideTimer.current = setTimeout(() => setFocused(false), BLUR_HIDE_MS);
  };
  const handleSelect = (v: string) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    onChangeText(v);
    setFocused(false);
  };

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoCorrect={false}
        style={[localStyles.input, style]}
        testID={testID}
      />
      {showDropdown && (
        <View style={localStyles.dropdown}>
          {matches.map((m, i) => (
            <Pressy
              key={m}
              onPress={() => handleSelect(m)}
              style={[localStyles.row, i === matches.length - 1 && localStyles.rowLast]}
            >
              <Text style={localStyles.rowText} numberOfLines={1}>{m}</Text>
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
});
