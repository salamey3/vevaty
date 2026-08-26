import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import ListingCard from './ListingCard';
import { colors, type } from '../theme/theme';
import { Collection, Listing } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useCollections } from '../store/CollectionsStore';
import { cornerBadgeFor } from '../lib/collectionBadge';
import { useRtlCarousel } from '../lib/useRtlCarousel';
import { useIsDesktop } from '../hooks/useResponsive';
import { useScrollChrome } from '../store/ScrollChromeContext';

// Home-screen row for one Collection (Editor's Picks / Hot Deals / Just
// Listed) -- same header+horizontal-scroll shape as
// CategoryCarouselSection, so a collection row reads as a peer of the
// category rows below it rather than a visually different kind of thing.
// Kept as its own component (not a mode flag on CategoryCarouselSection)
// because the two pull their `items` from different places and a
// collection card additionally carries a cornerBadge.
export default function CollectionCarouselSection({
  collection,
  items,
  onSeeAll,
  onPressListing,
}: {
  collection: Collection;
  items: Listing[];
  onSeeAll: () => void;
  onPressListing: (listing: Listing) => void;
}) {
  const { language, t, isRTL } = useLanguage();
  const { priceDropPercent } = useCollections();
  const label = language === 'ar' ? collection.titleAr : collection.titleEn;

  const { ordered, scrollRef, onContentSizeChange } = useRtlCarousel(items, isRTL);

  // This component renders on BOTH mobile (inside HomeScreen's floating
  // auto-hide carousels view) and desktop (folded into the "all
  // categories" grid header, which has no auto-hide chrome at all) --
  // unlike CategoryCarouselSection, which is mobile-only. isDesktop is
  // what makes this the same JSX safe to reuse in both places: swiping
  // this row's own horizontal scroller only touches the shared chrome
  // flag where that chrome actually exists. See CategoryCarouselSection's
  // matching comment for why this uses the gesture-lifecycle pair rather
  // than onChromeScroll.
  const isDesktop = useIsDesktop();
  const { beginChromeInteraction, endChromeInteraction } = useScrollChrome();

  // Card shape, per the approved "Editor's Picks / Hot Deals go
  // photo-left" mockup. Hot Deals (kind='price_drop') gets the wider
  // side-by-side card everywhere -- mobile web, the app, and desktop.
  // Editor's Picks (kind='curated') only gets it on desktop web; mobile
  // and the app keep today's stacked card there, unchanged, per request.
  // Just Listed (kind='recent') was never asked for a change, so it stays
  // stacked everywhere regardless of platform. Anchored on `kind`, not
  // `slug` or title, for the same reason HomeScreen's renderCollectionRows
  // is: kind is the fixed curated/price_drop/recent enum, slug and title
  // are both admin-editable free text.
  const useHorizontalCards = collection.kind === 'price_drop' || (isDesktop && collection.kind === 'curated');

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
        onScrollBeginDrag={!isDesktop ? beginChromeInteraction : undefined}
        onScrollEndDrag={!isDesktop ? endChromeInteraction : undefined}
        nestedScrollEnabled
      >
        {ordered.map((item) => (
          <ListingCard
            key={item.id}
            listing={item}
            width={useHorizontalCards ? 300 : 160}
            layout={useHorizontalCards ? 'horizontal' : 'vertical'}
            onPress={() => onPressListing(item)}
            cornerBadge={cornerBadgeFor(collection, item, priceDropPercent)}
          />
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
  headerRowRTL: { flexDirection: 'row-reverse' },
  title: { ...type.h3, flex: 1 },
  titleRTL: { textAlign: 'right', writingDirection: 'rtl' },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  // Tightened from 12 -- minimal space between cards, per request.
  row: { paddingHorizontal: 18, gap: 6 },
});
