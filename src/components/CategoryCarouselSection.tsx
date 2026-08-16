import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import ListingCard from './ListingCard';
import { colors, type } from '../theme/theme';
import { Category, Listing } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useRtlCarousel } from '../lib/useRtlCarousel';

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

  // RTL swipe direction: reversed order + viewport parked at the far end,
  // rather than a scaleX(-1) mirror on the scroller. See useRtlCarousel for
  // why the mirror was actively harmful on Android, and why this is a no-op
  // on web.
  const { ordered, scrollRef, onContentSizeChange } = useRtlCarousel(items, isRTL);

  return (
    <View style={styles.section}>
      <View style={[styles.headerRow, isRTL && styles.headerRowRTL]}>
        <Text style={[styles.title, isRTL && styles.titleRTL]} numberOfLines={1}>{label}</Text>
        <Pressy onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressy>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onContentSizeChange={onContentSizeChange}
        // Back to a plain ScrollView rather than a windowed FlatList: these
        // rows are capped at 10 items (see HomeScreen's categoryCarousels),
        // and a FlatList that hasn't rendered its tail yet reports a content
        // size that isn't final, which would make the scroll-to-end above
        // land in the wrong place. The reason the windowing was added --
        // stopping a hundred-plus full-size photos loading at once -- is
        // now handled where it belongs: the OUTER vertical list still only
        // mounts the sections near the viewport, and photos are requested
        // at card size instead of 900x1200 (see lib/photoSize.ts).
        //
        // This carousel nests inside HomeScreen's outer vertical list --
        // Android needs nestedScrollEnabled on both sides of a nested pair
        // to reliably hand off gesture ownership instead of the two
        // scrollables fighting over a swipe that starts or crosses over
        // this row. No-op on iOS/web.
        nestedScrollEnabled
      >
        {ordered.map((item) => (
          <ListingCard key={item.id} listing={item} width={148} onPress={() => onPressListing(item)} />
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
});
