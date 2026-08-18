import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, type } from '../theme/theme';
import { Category } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

export default function CategoryCard({
  category,
  onPress,
  selected,
  columns = 3,
  width,
}: {
  category: Category;
  onPress: () => void;
  selected?: boolean;
  columns?: number;
  // Fixed pixel width, for use inside a horizontal-scrolling row (the
  // mobile category slider) instead of a wrapping percentage-based grid.
  // Overrides the columns-derived percentage when set.
  width?: number;
}) {
  const { language } = useLanguage();
  const widthPct = `${Math.floor((100 - (columns - 1) * 3) / columns)}%` as const;
  const label = language === 'ar' ? category.nameAr : category.nameEn;
  return (
    <Pressy onPress={onPress} style={[styles.card, { width: width ?? widthPct }]}>
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        {category.iconUrl ? (
          <Image source={{ uri: category.iconUrl }} style={styles.iconImg} resizeMode="contain" />
        ) : (
          <Icon name={category.icon as any} size={24} color={selected ? colors.accentInk : colors.bg} />
        )}
      </View>
      {/* Two lines, centred under the icon. On one line "Electronics &
          Appliances" either shrank to nothing or truncated to
          "Electronics & Appli..." -- in a row of chips the label is how you
          tell them apart, so losing the second half of it defeats the
          chip. */}
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>{label}</Text>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  // Borderless chip -- a plain circular icon with its label sitting
  // clearly underneath it, matching OLX's pattern (see the reference
  // video). This used to be a bordered/backgrounded "card" the icon and
  // label both sat inside, which read as the title being crammed inside
  // the icon rather than a clearly separate label below it. Selection is
  // now shown purely on the icon circle itself (iconWrapSelected /
  // labelSelected below) since there's no card surface left to recolor.
  card: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 12,
    gap: 8,
    // Reserve both label lines whether or not this particular name needs
    // them, so a row of chips lines its icons up instead of stepping up
    // and down with the length of each word.
    minHeight: 44 + 8 + 28,
  },
  // The icon circle carries the brand: forest green disc, cream glyph
  // (BRANDING.md part 3). It used to be a pale grey disc with a dark
  // glyph, which read as a disabled control rather than a category.
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Selection can no longer be "turn the circle green" -- every circle is
  // green now. It flips to the accent instead, which is legible at a
  // glance in a row of green discs and is exactly the kind of single
  // moment gold exists for.
  iconWrapSelected: {
    backgroundColor: colors.accent,
    // The gold fill reads clearly against its green siblings (5.4:1), but
    // only 2:1 against the cream page -- under the 3:1 WCAG asks of a
    // state indicator's own edge. The darker gold ring gives the disc a
    // defined boundary (5.7:1) without dulling the fill.
    borderWidth: 2,
    borderColor: colors.accentDeep,
  },
  // Inset rather than filling the disc: an admin-uploaded icon used to
  // cover the circle edge to edge, which would now paint over the brand
  // colour entirely. No category uses one today, so this only shapes what
  // happens the first time one does.
  iconImg: { width: '72%', height: '72%' },
  label: { ...type.tiny, fontWeight: '600', color: colors.ink, textAlign: 'center', lineHeight: 14 },
  labelSelected: { fontWeight: '700' },
});
