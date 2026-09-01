import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import ListingCard, { ListingCardSpacer } from '../components/ListingCard';
import { padRowsToFullColumns, gridRowKey } from '../lib/gridRows';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useFavorites } from '../store/FavoritesStore';
import { useSavedSearches } from '../store/SavedSearchesStore';
import { useSettings } from '../store/SettingsStore';
import { useListingGridColumns, useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';
import { SavedSearch } from '../types';
import { useGoBack } from '../hooks/useGoBack';
import { absoluteDate } from '../lib/relativeTime';
import { openCategoryFromOutside } from '../lib/browseNav';

type Props = NativeStackScreenProps<RootStackParamList, 'Favorites'>;

// Phase 4 item 17 -- the "saved-listings list" half of favorites (the
// heart-toggle half lives on ListingCard/ListingDetailScreen). Reached from
// ProfileScreen's "Saved listings" row, not a bottom tab -- Admin is the
// only other stack-only (non-tab) destination in this app, same reasoning
// here: this doesn't need to be one of the four permanent tabs to be easy
// to find.
//
// Saved searches (added alongside Delete Account) share this screen as a
// second tab rather than a separate route -- both are "things a buyer
// bookmarked for later", and it keeps a single entry point off
// ProfileScreen instead of two nearly-identical rows.
export default function FavoritesScreen({ navigation }: Props) {
  const goBack = useGoBack();
  const { t, language } = useLanguage();
  const { listings, isVerified } = useAppStore();
  const { favoriteIds, loading, loaded, loadFavorites } = useFavorites();
  const { savedSearches, loading: searchesLoading, loaded: searchesLoaded, loadSavedSearches, deleteSavedSearch } = useSavedSearches();
  const { categoryById } = useSettings();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();
  const [tab, setTab] = useState<'saved' | 'searches'>('saved');

  useFocusEffect(
    useCallback(() => {
      if (isVerified) {
        loadFavorites();
        loadSavedSearches();
      }
    }, [isVerified])
  );

  const favoritedListings = listings.filter((l) => favoriteIds.has(l.id));

  const runSavedSearch = (search: SavedSearch) => {
    // Jump into the Home tab's HomeCategory route with the saved filter
    // state attached -- HomeScreen seeds itself from route.params on mount
    // (see its applyCriteria handling) and scrubs the param back out right
    // after, so this is a one-shot "restore this filter state" hand-off,
    // not a persistent link between the two screens.
    openCategoryFromOutside(navigation, search.cat, search.criteria);
  };

  const header = (
    <View style={styles.header}>
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={type.title}>{t('favorites.title')}</Text>
    </View>
  );

  const tabRow = isVerified && (
    <View style={styles.tabRow}>
      <Pressy onPress={() => setTab('saved')} style={[styles.tabBtn, tab === 'saved' && styles.tabBtnActive]}>
        <Text style={[styles.tabText, tab === 'saved' && styles.tabTextActive]}>{t('favorites.tabSaved')}</Text>
      </Pressy>
      <Pressy onPress={() => setTab('searches')} style={[styles.tabBtn, tab === 'searches' && styles.tabBtnActive]}>
        <Text style={[styles.tabText, tab === 'searches' && styles.tabTextActive]}>{t('favorites.tabSearches')}</Text>
      </Pressy>
    </View>
  );

  if (!isVerified) {
    return (
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="heart" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('favorites.loggedOutTitle')}</Text>
          <Text style={[type.soft, styles.sub]}>{t('favorites.loggedOutSub')}</Text>
          <Button label={t('profile.logIn')} onPress={() => navigation.navigate('Auth')} style={{ marginTop: 16, width: 200 }} />
        </View>
      </Screen>
    );
  }

  if (tab === 'searches') {
    if (searchesLoaded && !searchesLoading && savedSearches.length === 0) {
      return (
        <Screen maxWidth={1180}>
          {header}
          {tabRow}
          <View style={styles.empty}>
            <View style={styles.iconWrap}>
              <Icon name="search" size={24} color={colors.inkSoft} />
            </View>
            <Text style={type.h3}>{t('favorites.searchesEmptyTitle')}</Text>
            <Text style={[type.soft, styles.sub]}>{t('favorites.searchesEmptySub')}</Text>
          </View>
        </Screen>
      );
    }

    return (
      <Screen maxWidth={1180}>
        {header}
        {tabRow}
        <FlatList
          data={savedSearches}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.searchList}
          renderItem={({ item }) => {
            const cat = categoryById(item.cat);
            const catLabel = cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : item.cat;
            const dateLabel = absoluteDate(item.createdAt, language);
            return (
              <View style={styles.searchRow}>
                <Pressy style={styles.searchRowMain} onPress={() => runSavedSearch(item)}>
                  <Text style={styles.searchLabel} numberOfLines={1}>{item.label}</Text>
                  <Text style={styles.searchMeta} numberOfLines={1}>{catLabel} · {dateLabel}</Text>
                </Pressy>
                <Pressy
                  onPress={() => deleteSavedSearch(item.id)}
                  style={styles.searchDeleteBtn}
                  accessibilityLabel="Delete saved search"
                >
                  <Icon name="trash" size={16} color={colors.inkSoft} />
                </Pressy>
              </View>
            );
          }}
        />
      </Screen>
    );
  }

  if (loaded && !loading && favoritedListings.length === 0) {
    return (
      <Screen maxWidth={1180}>
        {header}
        {tabRow}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="heart" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('favorites.emptyTitle')}</Text>
          <Text style={[type.soft, styles.sub]}>{t('favorites.emptySub')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={1180}>
      {header}
      {tabRow}
      <FlatList
        key={columns}
        data={padRowsToFullColumns(favoritedListings, columns)}
        keyExtractor={gridRowKey}
        numColumns={columns}
        // columnWrapperStyle is ONLY legal when numColumns > 1: FlatList's own
        // _checkProps throws "columnWrapperStyle not supported for single column
        // lists" via invariant(), which is NOT stripped in production. Without
        // this guard a one-column grid is a red screen on native and a blank
        // page on web -- on every listing surface in the app.
        columnWrapperStyle={columns > 1 ? { justifyContent: 'space-between' } : undefined}
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        // A null item is the padding that keeps a short last row full --
        // see padRowsToFullColumns. It renders an empty box exactly one
        // card wide, so space-between spaces the row the same way it
        // spaces a full one instead of throwing two results to opposite
        // ends of the grid.
        renderItem={({ item }) =>
          item ? (
            <ListingCard columns={columns} listing={item} onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })} />
          ) : (
            <ListingCardSpacer columns={columns} />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  tabBtn: {
    paddingHorizontal: 16, height: 34, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  tabText: { ...type.tiny, fontWeight: '600', color: colors.inkSoft },
  tabTextActive: { color: colors.white },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  sub: { textAlign: 'center', lineHeight: 18 },
  grid: { paddingHorizontal: 18, paddingBottom: 110 },
  gridDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  searchList: { paddingHorizontal: 18, paddingBottom: 110, gap: 10 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  searchRowMain: { flex: 1, gap: 2 },
  searchLabel: { ...type.body, fontWeight: '600' },
  searchMeta: { ...type.tiny, color: colors.inkSoft },
  searchDeleteBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
