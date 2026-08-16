import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import ListingCard from './ListingCard';
import { colors, type } from '../theme/theme';
import { Category, Listing } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

// One home-page section for a single top-level category: a
// "[Category name] · See all" header row followed by its own
// horizontal-scrolling carousel of that category's listings. Used on the
// mobile home screen (in place of one big combined grid) so listings from
// different categories are never mixed together -- matches the OLX
// reference layout the user asked for.
export default function CategoryCarouselSection({
  category,
  items,
  onSeeAll,
  onPressListing,
}: {
  category: Category;
  items: Listing[];
  onSeeAll: () => void;
  onPressListing: (listing: Listing) => void;
}) {
  const { language, t, isRTL } = useLanguage();
  const label = language === 'ar' ? category.nameAr : category.nameEn;

  return (
    <View style={styles.section}>
      <View style={[styles.headerRow, isRTL && styles.headerRowRTL]}>
        <Text style={[styles.title, isRTL && styles.titleRTL]} numberOfLines={1}>{label}</Text>
        <Pressy onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressy>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // This carousel nests inside HomeScreen's outer vertical ScrollView
        // (which also sets nestedScrollEnabled) -- Android needs it on both
        // sides of a nested pair to reliably hand off gesture ownership
        // instead of the two scrollables fighting over a swipe that starts
        // or crosses over this row. No-op on iOS/web.
        nestedScrollEnabled
        // Mirrors the entire scroller horizontally so swiping reads RTL --
        // the first card sits at the right edge, and dragging leftward
        // (the natural "continue reading" gesture in Arabic) reveals the
        // rest, instead of English's left-to-right order just being kept
        // with right-aligned text. Each card is counter-flipped
        // (rowItemRTL) so its own content still renders right-side-up --
        // without that second flip every photo/label on the card would
        // also come out mirrored.
        style={isRTL && styles.rowRTL}
      >
        {items.map((item) => (
          <View key={item.id} style={isRTL && styles.rowItemRTL}>
            <ListingCard listing={item} width={148} onPress={() => onPressListing(item)} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, marginBottom: 10,
  },
  // Puts the category name on the right and "See all" on the left,
  // matching Arabic reading order -- row-reverse alone flips which side
  // each child renders on without touching the space-between spacing.
  headerRowRTL: { flexDirection: 'row-reverse' },
  title: { ...type.h3, flex: 1 },
  // title's own text still defaults to flush-left inside its flex:1 box
  // even once headerRowRTL has moved that box to the right side of the
  // row -- this is the same class of bug as theme.ts's dead `textAlign:
  // 'auto'` (see ListingDetailScreen's rtlText comment for the full
  // story), so it needs the same explicit override.
  titleRTL: { textAlign: 'right', writingDirection: 'rtl' },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  row: { paddingHorizontal: 18, gap: 12 },
  rowRTL: { transform: [{ scaleX: -1 }] },
  rowItemRTL: { transform: [{ scaleX: -1 }] },
});
