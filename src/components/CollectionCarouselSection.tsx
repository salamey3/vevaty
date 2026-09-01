import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
// react-native-gesture-handler's ScrollView, not core RN's -- this row
// renders inside HomeScreen's outer vertical FlatList on both mobile and
// desktop (also migrated, see that file's renderCarousels comment), and
// both sides of a nested pair need to be gesture-handler components for
// ownership to negotiate through RNGH's own recognizer instead of
// Android's nestedScrollEnabled protocol. Drop-in on iOS/web too.
import { ScrollView } from 'react-native-gesture-handler';
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
  // Set by the caller when the CONTAINER already provides the horizontal
  // inset -- a desktop grid (paddingHorizontal 0, Screen centres the
  // content) or, on mobile, this section being rendered inside a grid's
  // ListHeaderComponent, which already carries styles.grid's 18. Only the
  // caller knows which of those it just did.
  flush = false,
}: {
  collection: Collection;
  items: Listing[];
  onSeeAll: () => void;
  onPressListing: (listing: Listing) => void;
  flush?: boolean;
}) {
  const { language, t, isRTL } = useLanguage();
  const { priceDropPercent } = useCollections();
  const label = language === 'ar' ? collection.titleAr : collection.titleEn;

  const { ordered, scrollRef, onContentSizeChange } = useRtlCarousel(items, isRTL);

  // This component renders on BOTH mobile (inside HomeScreen's floating
  // auto-hide carousels view) and desktop (folded into the "all
  // categories" grid header, which has no auto-hide chrome at all) --
  // as does CategoryCarouselSection, which is not mobile-only either (that was true once and is not now). isDesktop is
  // what makes this the same JSX safe to reuse in both places: swiping
  // this row's own horizontal scroller only touches the shared chrome
  // flag where that chrome actually exists. See CategoryCarouselSection's
  // matching comment for why this uses the gesture-lifecycle pair rather
  // than onChromeScroll.
  const isDesktop = useIsDesktop();
  const { width } = useWindowDimensions();
  const { beginChromeInteraction, endChromeInteraction } = useScrollChrome();

  // Card shape, per the approved "Editor's Picks / Hot Deals go
  // photo-left" mockup, extended to Just Listed on request. Hot Deals
  // (kind='price_drop') and Just Listed (kind='recent') both get the
  // wider side-by-side card everywhere -- mobile web, the app, and
  // desktop. Editor's Picks (kind='curated') only gets it on desktop
  // web; mobile and the app keep today's stacked card there, unchanged,
  // per an earlier, separate request. Anchored on `kind`, not `slug` or
  // title, for the same reason HomeScreen's renderCollectionRows is:
  // kind is the fixed curated/price_drop/recent enum, slug and title are
  // both admin-editable free text.
  const useHorizontalCards = collection.kind === 'price_drop' || collection.kind === 'recent' || (isDesktop && collection.kind === 'curated');

  // How wide a photo-left card is. It was a flat 300 everywhere, which is
  // where the truncation on this card came from: 300 minus a 128px photo, minus 24px
  // of padding and 2px of border, left 146px of text, and a two-line title, three specs and a
  // district all need more than that.
  //
  // On desktop there is room to simply give it more. On a phone there is not
  // -- 400 would run off the screen -- so it takes the screen width less a
  // margin and a peek of the next card, which is both as wide as it can
  // honestly be and a better carousel affordance than a card that ends
  // exactly at the edge.
  const horizontalCardWidth = isDesktop ? 400 : Math.min(width - 52, 380);
  // Just Listed gets two rows instead of one -- unlike Editor's Picks and
  // Hot Deals, which stay single-row everywhere. Columns of 2 (stacked
  // vertically) rather than a true 2-row grid, so the whole thing still
  // scrolls as one horizontal unit with the existing ScrollView/RTL
  // machinery instead of needing two independently-scrolling rows kept
  // in sync.
  const useTwoRows = collection.kind === 'recent';
  const twoRowColumns = useTwoRows
    ? Array.from({ length: Math.ceil(ordered.length / 2) }, (_, i) => ordered.slice(i * 2, i * 2 + 2))
    : null;

  return (
    <View style={styles.section}>
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
        // Nests inside HomeScreen's outer vertical FlatList, which is also
        // a react-native-gesture-handler component -- see this file's
        // import comment. nestedScrollEnabled is no longer needed.
      >
        {twoRowColumns
          ? twoRowColumns.map((pair) => (
              <View key={pair[0].id} style={styles.twoRowColumn}>
                {pair.map((item) => (
                  <ListingCard
                    key={item.id}
                    listing={item}
                    // 192 = 160 * 1.2 (down from an initial 1.5x/240,
                    // which read as too big), same widening as
                    // CategoryCarouselSection's cards -- only reachable
                    // for a vertical-layout card (useHorizontalCards
                    // false), which today is Editor's Picks on mobile;
                    // The photo-left card (Hot Deals, Just Listed, Editor's
                    // Picks on desktop) sizes itself -- see
                    // horizontalCardWidth above.
                    width={useHorizontalCards ? horizontalCardWidth : 192}
                    layout={useHorizontalCards ? 'horizontal' : 'vertical'}
                    onPress={() => onPressListing(item)}
                    cornerBadge={cornerBadgeFor(collection, item, priceDropPercent)}
                  />
                ))}
              </View>
            ))
          : ordered.map((item) => (
              <ListingCard
                key={item.id}
                listing={item}
                // 192 = 160 * 1.2 -- see the twoRowColumns branch above
                // for why, and why the photo-left branch is sized separately.
                width={useHorizontalCards ? horizontalCardWidth : 192}
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
  // Drops this section's own inset, for when the CONTAINER already provides
  // one. Two cases, and they are why this is a prop rather than an
  // isDesktop check in here: on desktop the browse grid sets
  // paddingHorizontal 0 (Screen is already centring the content), so an 18px
  // inset here left every carousel and its heading sitting 18px right of the
  // grid below it; and on mobile these sections are sometimes rendered inside
  // that grid's own ListHeaderComponent, where styles.grid's 18 is already
  // applied and this one doubled it to 36. Only the caller knows which
  // container it just put this in.
  flush: { paddingHorizontal: 0 },
  // Just Listed's two-row layout -- one column per pair of cards, stacked
  // vertically. Same 6px gap as `row` uses horizontally, for visual
  // consistency between the two axes.
  twoRowColumn: { gap: 6 },
});
