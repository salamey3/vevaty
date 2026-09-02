import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
// react-native-gesture-handler's ScrollView, not core RN's -- this row
// nests inside HomeScreen's outer vertical FlatList (also migrated, see
// that file's renderCarousels comment), and both sides of a nested pair
// need to be gesture-handler components so ownership is negotiated
// through RNGH's own gesture recognizer instead of Android's
// nestedScrollEnabled protocol, which is what was causing the swipe
// jumping/flicker this migration fixes. Drop-in on iOS/web too.
import { ScrollView } from 'react-native-gesture-handler';
import Pressy from './Pressy';
import ListingCard from './ListingCard';
import { colors, type } from '../theme/theme';
import { Category, Listing } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useRtlCarousel } from '../lib/useRtlCarousel';
import { useIsDesktop, useCarouselCardWidth } from '../hooks/useResponsive';
import { CAROUSEL_ROW_INSET, CAROUSEL_ROW_GAP } from '../lib/cardWidth';
import { useScrollChrome } from '../store/ScrollChromeContext';

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
  // Set by the caller when the CONTAINER already provides the horizontal
  // inset -- a desktop grid (paddingHorizontal 0, Screen centres the
  // content) or, on mobile, this section being rendered inside a grid's
  // ListHeaderComponent, which already carries styles.grid's 18. Only the
  // caller knows which of those it just did.
  flush = false,
}: {
  category: Category;
  items: Listing[];
  onSeeAll: () => void;
  onPressListing: (listing: Listing) => void;
  flush?: boolean;
}) {
  const { language, t, isRTL } = useLanguage();
  const label = language === 'ar' ? category.nameAr : category.nameEn;

  // RTL swipe direction: reversed order + viewport parked at the far end,
  // rather than a scaleX(-1) mirror on the scroller. See useRtlCarousel for
  // why the mirror was actively harmful on Android, and why this is a no-op
  // on web.
  const { ordered, scrollRef, onContentSizeChange } = useRtlCarousel(items, isRTL);

  // This component renders on both layouts (HomeScreen's renderCarousels is used by the desktop branch too) (HomeScreen's "all
  // categories" carousels view -- see that screen's own comment), but
  // check isDesktop anyway rather than assume it: swiping through this
  // row's own horizontal scroller should keep the page's floating chrome
  // (greeting/search/category slider, bottom tab bar) hidden too, exactly
  // like scrolling the page itself does, and that's only meaningful where
  // the chrome exists to hide. This row isn't the vertical page scroller,
  // so it uses the gesture-lifecycle pair rather than onChromeScroll --
  // see that context's own comment on why TOP_SNAP_ZONE is vertical-only.
  const isDesktop = useIsDesktop();
  const { beginChromeInteraction, endChromeInteraction } = useScrollChrome();
  // Measured on the section box below, which is a full-width block child of
  // the page's vertical scroller -- NOT on the horizontal ScrollView's
  // content container, whose width is the sum of the cards themselves. The
  // inset the row will apply comes off inside the hook, which is why `flush`
  // has to be passed through: measuring the section says nothing about how
  // much of it the cards actually get.
  const { cardWidth, onLayout } = useCarouselCardWidth(flush ? 0 : CAROUSEL_ROW_INSET);

  return (
    <View style={styles.section} onLayout={onLayout}>
      <View style={[styles.headerRow, isRTL && styles.headerRowRTL, flush && styles.flush]}>
        <Text style={[styles.title, isRTL && styles.titleRTL]} numberOfLines={1}>{label}</Text>
        <Pressy onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressy>
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.row, flush && styles.flush]}
        onContentSizeChange={onContentSizeChange}
        onScrollBeginDrag={!isDesktop ? beginChromeInteraction : undefined}
        onScrollEndDrag={!isDesktop ? endChromeInteraction : undefined}
        // Back to a plain ScrollView rather than a windowed FlatList: these
        // rows are capped at 6 items (HomeScreen's CATEGORY_ROW_CAP),
        // and a FlatList that hasn't rendered its tail yet reports a content
        // size that isn't final, which would make the scroll-to-end above
        // land in the wrong place. The reason the windowing was added --
        // stopping a hundred-plus full-size photos loading at once -- is
        // now handled where it belongs: the OUTER vertical list still only
        // mounts the sections near the viewport, and photos are requested
        // at card size instead of 900x1200 (see lib/photoSize.ts).
        //
        // This carousel nests inside HomeScreen's outer vertical list.
        // Both are react-native-gesture-handler components (see this
        // file's import comment), which negotiate gesture ownership
        // themselves -- nestedScrollEnabled (the old, Android-only,
        // native-negotiation fix for this same problem) is no longer
        // needed and is intentionally not set here.
      >
        {/* One grid card wide, whatever that means at this window size --
            see useCarouselCardWidth. It was a flat 192 through several
            rounds of widening the grid, which is how a domain landing page
            ended up showing the same listing at half the size of the page
            it leads to. */}
        {ordered.map((item) => (
          <ListingCard key={item.id} listing={item} width={cardWidth} onPress={() => onPressListing(item)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: CAROUSEL_ROW_INSET, marginBottom: 10,
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
  // Tightened from 12 -- minimal space between cards, per request.
  row: { paddingHorizontal: CAROUSEL_ROW_INSET, gap: CAROUSEL_ROW_GAP },
  // Matches CollectionCarouselSection's `flush` -- see its comment for the
  // two containers that already provide the inset themselves.
  flush: { paddingHorizontal: 0 },
});
