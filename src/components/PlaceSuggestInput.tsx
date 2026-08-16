import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import Pressy from './Pressy';
import { colors, radius } from '../theme/theme';
import { LebanonPlace, findPlaceByExactName, searchPlaces } from '../data/lebanonPlaces';

// A variant of SuggestInput (see that file) specifically for the location
// field: selection needs to carry back a whole LebanonPlace (governorate +
// caza + coordinates), not just the display string, and search needs to
// match Arabic names/alternate spellings, not just the one label shown.
// Same visual/interaction pattern as SuggestInput for consistency (inline
// dropdown, delayed blur-hide so a tap registers before it unmounts, capped
// result count) -- just backed by searchPlaces() instead of a plain string
// list, and each row shows "Town — Caza, Governorate" to disambiguate
// same-named villages in different districts.
//
// Deliberately non-blocking, matching SuggestInput's philosophy: the typed
// text always reaches onChangeText verbatim regardless of whether it
// matches anything, so a seller whose town isn't in the dataset can still
// post -- onSelectPlace only fires on an explicit tap or an exact-name
// match on blur.
const BLUR_HIDE_MS = 150;

export default function PlaceSuggestInput({
  value,
  onChangeText,
  onSelectPlace,
  onExactBlurMatch,
  placeholder,
  style,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSelectPlace: (place: LebanonPlace) => void;
  onExactBlurMatch?: (place: LebanonPlace | null) => void;
  placeholder?: string;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
}) {
  const [focused, setFocused] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => searchPlaces(value), [value]);
  const showDropdown = focused && matches.length > 0;

  const handleBlur = () => {
    // A seller who types the correct full name and tabs/clicks away
    // (without using the dropdown) still gets resolved -- checked on blur
    // so it doesn't fight the dropdown's own tap-to-select while focused.
    if (onExactBlurMatch) {
      const exact = findPlaceByExactName(value);
      if (exact) onExactBlurMatch(exact);
    }
    hideTimer.current = setTimeout(() => setFocused(false), BLUR_HIDE_MS);
  };
  const handleSelect = (place: LebanonPlace) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    onChangeText(place.name);
    onSelectPlace(place);
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
          {matches.map((p, i) => (
            <Pressy
              key={p.id}
              onPress={() => handleSelect(p)}
              style={[localStyles.row, i === matches.length - 1 && localStyles.rowLast]}
            >
              <Text style={localStyles.rowText} numberOfLines={1}>{p.name}</Text>
              <Text style={localStyles.rowSubText} numberOfLines={1}>{p.caza}, {p.governorate}</Text>
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
    paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { fontSize: 14, color: colors.ink },
  rowSubText: { fontSize: 11.5, color: colors.inkSoft, marginTop: 1 },
});
