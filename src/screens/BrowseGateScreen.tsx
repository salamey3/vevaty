import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not core RN's: the rows below nest their
// own horizontal scrollers inside this vertical one, and gesture ownership
// between an outer scroller and its nested horizontal ones only negotiates
// correctly when both sides are gesture-handler components. Same reasoning
// as HomeScreen's renderCarousels -- see that file for the full story.
import { ScrollView } from 'react-native-gesture-handler';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import BrandMark from '../components/BrandMark';
import BrowseHeaderControls from '../components/BrowseHeaderControls';
import DomainTiles from '../components/DomainTiles';
import ListingCard from '../components/ListingCard';
import { mirrorRow } from '../lib/mirrorRow';
import { useGoHome } from '../hooks/useGoHome';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { useRtlCarousel } from '../lib/useRtlCarousel';
import { RootStackParamList, HomeStackParamList } from '../navigation/types';
import { Listing, ListingDomain } from '../types';

// The buyer's gate, and the app's home screen: which section are you
// shopping in? Asked every launch and never remembered, so nobody is ever
// browsing a section they did not just pick and all of them stay equally
// visible -- see DOMAINS.md's browsing decisions for why that cost is
// worth paying while the marketplace is young.
//
// Two things sit on it that are not the tiles, and both are there to stop
// a gate from reading as a menu in front of an empty shop: a live count on
// each tile, so a thin section is honest rather than a surprise waiting
// behind a tap; and one row of the newest listings from everywhere.
//
// That row is deliberately NOT a collection. Collections filter to their
// section (see HomeScreen); this row is the one place the catalogue is
// shown whole, which it can only be on the one screen that sits above the
// sections. Building it as a collection would leave a cross-section row
// one admin toggle away from appearing inside a section, where it would
// undo the whole design.
const NEWEST_ROW_CAP = 10;
const SEARCH_ROW_CAP = 8;

// A horizontal row of cards under a heading -- the newest row and each
// search group are the same shape, so they are the same component. It is a
// component rather than a render function because of useRtlCarousel: the
// app never flips I18nManager, so on the native builds an Arabic row only
// reads right-to-left if its items are reversed and the viewport parked at
// the far end, and a hook cannot be called from inside a .map.
function GateRow({
  heading,
  items,
  onSeeAll,
  onPressListing,
  tagFor,
}: {
  heading: string;
  items: Listing[];
  onSeeAll?: () => void;
  onPressListing: (listing: Listing) => void;
  // Which section a card belongs to, on the one row that mixes them.
  // Inside a search group the heading already says it and repeating it on
  // every card is noise, so that row passes nothing.
  tagFor?: (listing: Listing) => string | null;
}) {
  const { t, isRTL } = useLanguage();
  const { ordered, scrollRef, onContentSizeChange } = useRtlCarousel(items, isRTL);

  return (
    <View style={styles.section}>
      <View style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}>
        <Text style={[styles.sectionTitle, isRTL && styles.sectionTitleRTL]} numberOfLines={1}>
          {heading}
        </Text>
        {!!onSeeAll && (
          <Pressy onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
          </Pressy>
        )}
      </View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        onContentSizeChange={onContentSizeChange}
      >
        {ordered.map((l) => {
          const tag = tagFor?.(l) ?? null;
          return (
            <View key={l.id} style={styles.taggedCard}>
              {!!tag && <Text style={styles.sectionTag} numberOfLines={1}>{tag}</Text>}
              <ListingCard listing={l} width={192} onPress={() => onPressListing(l)} />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function BrowseGateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const homeNav = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'HomeRoot'>>();
  const { listings: allListings, profile } = useAppStore();
  const { domains, domainOfCategory } = useSettings();
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const goHome = useGoHome();

  // Seeded from the param so the "results in other sections" line inside a
  // section can hand its words back here (see HomeScreen). Plain state
  // after that -- typing here never touches the route.
  const [query, setQuery] = useState(() => route.params?.q ?? '');

  // The initialiser above only runs on mount, and this screen is never
  // unmounted while a section sits on top of it -- so a search handed back
  // from inside a section would otherwise arrive as a param nobody reads,
  // leaving the buyer on a gate showing tiles, or worse, still showing
  // whatever they had searched here earlier. Consumed and scrubbed, so
  // returning later does not re-apply a search they have since cleared.
  const handedQuery = route.params?.q;
  useEffect(() => {
    if (handedQuery === undefined) return;
    setQuery(handedQuery);
    homeNav.setParams({ q: undefined });
  }, [handedQuery, homeNav]);

  const listings = useMemo(() => allListings.filter((l) => l.status === 'active'), [allListings]);

  // One pass, reused by the counts, the newest row and the search results.
  const byDomain = useMemo(() => {
    const map = new Map<string, Listing[]>();
    for (const l of listings) {
      const id = domainOfCategory(l.cat)?.id;
      if (!id) continue;
      const bucket = map.get(id);
      if (bucket) bucket.push(l);
      else map.set(id, [l]);
    }
    return map;
  }, [listings, domainOfCategory]);

  const countLabel = (d: ListingDomain) => {
    const n = byDomain.get(d.id)?.length ?? 0;
    if (n === 0) return t('home.gate.countNone');
    if (n === 1) return t('home.gate.countOne');
    return t('home.gate.countMany', { n });
  };

  const newest = useMemo(
    () => [...listings].sort((a, b) => b.createdAt - a.createdAt).slice(0, NEWEST_ROW_CAP),
    [listings]
  );

  // Search here spans everything -- it is the one path that does not get
  // split three ways, which matters most while each section is thin. Same
  // title-only match HomeScreen's own search uses, so a word that finds
  // something here finds it there too.
  const q = query.trim().toLowerCase();
  const searchGroups = useMemo(() => {
    if (!q) return [];
    return domains
      .map((d) => ({
        domain: d,
        items: (byDomain.get(d.id) ?? []).filter(
          (l) => l.titleEn.toLowerCase().includes(q) || l.titleAr.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [q, domains, byDomain]);

  const openDomain = (domainId: string) =>
    homeNav.navigate('HomeDomain', { domain: domainId, ...(q ? { q: query } : {}) });

  const domainName = (d: ListingDomain) => (language === 'ar' ? d.nameAr : d.nameEn);
  const openListing = (l: Listing) => navigation.navigate('ListingDetail', { listingId: l.id });

  const searchBox = (
    <View style={[styles.searchRow, isDesktop && styles.searchRowDesktop]}>
      <Icon name="search" size={17} color={colors.inkSoft} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('home.gate.searchPlaceholder')}
        placeholderTextColor={colors.inkSoft}
        style={[styles.searchInput, isRTL && styles.searchInputRTL]}
        autoComplete="off"
      />
      {query.length > 0 && (
        <Pressy onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="close" size={15} color={colors.inkSoft} />
        </Pressy>
      )}
    </View>
  );


  return (
    <Screen reserveSidebar maxWidth={1180}>
      {!isDesktop && (
        <View style={[styles.brandBar, mirrorRow(isRTL)]}>
          <BrandMark variant="sidebar" onPress={goHome} />
          <BrowseHeaderControls />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.header, isDesktop && styles.headerDesktop]}>
          <View style={styles.headerText}>
            <Text style={type.soft}>
              {profile.name && profile.name !== 'You' ? t('home.greeting') : ''}
            </Text>
            <Text style={[styles.title, isDesktop && styles.titleDesktop]}>{t('home.gate.title')}</Text>
          </View>
          {isDesktop && <BrowseHeaderControls />}
        </View>

        {searchBox}

        {q ? (
          searchGroups.length > 0 ? (
            searchGroups.map((g) => (
              <GateRow
                key={g.domain.id}
                heading={t('home.gate.searchGroup', { section: domainName(g.domain), n: g.items.length })}
                items={g.items.slice(0, SEARCH_ROW_CAP)}
                onSeeAll={() => openDomain(g.domain.id)}
                onPressListing={openListing}
              />
            ))
          ) : (
            <View style={styles.empty}>
              <Text style={type.body}>{t('home.emptyTitle')}</Text>
              <Text style={type.soft}>{t('home.emptySub')}</Text>
            </View>
          )
        ) : (
          <>
            <Text style={styles.lede}>{t('home.gate.subtitle')}</Text>
            <DomainTiles domains={domains} onChoose={openDomain} noteFor={countLabel} style={styles.tiles} />
            {newest.length > 0 && (
              <GateRow
                heading={t('home.gate.newest')}
                items={newest}
                onPressListing={openListing}
                tagFor={(l) => {
                  const d = domainOfCategory(l.cat);
                  return d ? domainName(d) : null;
                }}
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 4,
  },
  content: { paddingBottom: 120 },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
  headerDesktop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 18 },
  headerText: { flex: 1 },
  title: { ...type.title, fontSize: 21 },
  titleDesktop: { fontSize: 28 },
  lede: { ...type.soft, paddingHorizontal: 18, marginTop: 4, marginBottom: 16 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 18, marginTop: 10, marginBottom: 4,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.pill, paddingHorizontal: 14, height: 44,
  },
  searchRowDesktop: { height: 48 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.ink },
  searchInputRTL: { textAlign: 'right', writingDirection: 'rtl' },
  tiles: { marginBottom: 24 },
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, marginBottom: 10,
  },
  sectionHeaderRTL: { flexDirection: 'row-reverse' },
  sectionTitle: { ...type.h3, flex: 1 },
  sectionTitleRTL: { textAlign: 'right', writingDirection: 'rtl' },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  row: { paddingHorizontal: 18, gap: 6 },
  taggedCard: { gap: 4 },
  sectionTag: {
    fontSize: 11, fontWeight: '700', color: colors.inkSoft,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 48, paddingHorizontal: 18 },
});
