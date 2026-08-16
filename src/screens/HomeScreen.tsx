import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View, TextInput, FlatList, ScrollView, ViewStyle } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import ListingCard from '../components/ListingCard';
import CategoryCard from '../components/CategoryCard';
import CategoryCarouselSection from '../components/CategoryCarouselSection';
import LanguageSwitch from '../components/LanguageSwitch';
import FilterSection, { FilterOption } from '../components/FilterSection';
import RangeSlider from '../components/RangeSlider';
import SaveSearchModal from '../components/SaveSearchModal';
import * as Location from 'expo-location';
import { Alert } from '../lib/alertShim';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useScrollChrome } from '../store/ScrollChromeContext';
import { useSavedSearches } from '../store/SavedSearchesStore';
import { RootStackParamList, HomeStackParamList } from '../navigation/types';
import { CategoryAttribute, CategoryId, FilterFacet, Listing, SavedSearchCriteria } from '../types';
import { useIsDesktop, useGridColumns } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { haversineKm, LatLng } from '../lib/geo';
import { findPlaceByFreeText } from '../data/lebanonPlaces';

// Parallel, always-visible selection state -- replaces the old one-facet-
// at-a-time drill-down. Every enabled facet is its own sidebar section;
// the shopper can check/uncheck any combination of them in any order.
// `facetValues` covers both the OR-checkbox facets (area, select,
// multiselect, boolean -- any number of checked values, matched with OR
// semantics) AND number-type attributes, which instead store at most one
// value (the chosen "N+" radio threshold) -- see matchesFacets below.
// Structurally identical to SavedSearchCriteria (minus `query`, which
// HomeScreen tracks as its own separate piece of state) -- see the
// route.params?.applyCriteria handling below for why they stay in sync.
type SelectionState = {
  subCatIds: string[];
  facetValues: Record<string, string[]>;
  priceMin: number | null;
  priceMax: number | null;
  distanceKm: number | null;
};

function emptySelection(): SelectionState {
  return { subCatIds: [], facetValues: {}, priceMin: null, priceMax: null, distanceKm: null };
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Same underlying navigation object as `navigation` above (useNavigation
  // always returns the current screen's navigator) -- this second, more
  // narrowly-typed handle is just for talking to the immediate parent, the
  // Home stack (see navigation/HomeStack.tsx), without fighting the other
  // hook's RootStackParamList typing.
  const homeNav = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'HomeCategory'>>();
  const { listings, profile, isVerified } = useAppStore();
  const { categories, categoryById, childrenOf, categoryMatches, resolveFilterFacetsForCategory } = useSettings();
  const { saveSearch } = useSavedSearches();
  const { t, language, isRTL } = useLanguage();
  // True for exactly the render right after this screen instance mounted
  // with a saved search's criteria to apply (see applyCriteria below) --
  // set once by the lazy state initializers and consumed by the very next
  // topCat-reset effect run so it doesn't immediately wipe the criteria
  // that same effect would otherwise treat as "just switched category".
  const skipNextResetRef = useRef(false);
  const [query, setQuery] = useState(() => route.params?.applyCriteria?.query ?? '');
  const isDesktop = useIsDesktop();
  const columns = useGridColumns(2, 4);
  const catColumns = useGridColumns(3, 6);
  // Mobile-only auto-hide for the category slider below (see
  // ScrollChromeContext -- also drives the bottom tab bar in TabBar.tsx,
  // which can't see this screen's own scroll events directly).
  const { chromeVisible, onChromeScroll } = useScrollChrome();

  // `topCat === 'all'` is the entry state: a big category grid (this is
  // where Browse's one distinct value over the old Home lived -- folded
  // in here now that the two screens are merged) and, below it, every
  // listing unfiltered except by the search box. Picking a category
  // switches to the filtered view (sidebar on desktop, a horizontal chip
  // slider + the same listings grid on mobile).
  //
  // This used to be local `useState` -- invisible to the browser/hardware
  // back button, which is why pressing back while browsing a category used
  // to exit the whole app instead of returning to "all categories" (see
  // HomeStack.tsx). It's now derived from the Home stack's own route
  // params: HomeRoot has none (-> 'all'), HomeCategory always carries `cat`.
  const topCat: CategoryId | 'all' = route.params?.cat ?? 'all';
  const [selection, setSelection] = useState<SelectionState>(() => {
    const criteria = route.params?.applyCriteria;
    if (!criteria) return emptySelection();
    // Arriving via "Run" on a saved search -- seed the filter state from
    // it and tell the reset effect below to skip its very next run (it
    // would otherwise immediately wipe this back to empty, since from its
    // point of view topCat just "changed" to whatever this saved search's
    // category was).
    skipNextResetRef.current = true;
    return {
      subCatIds: criteria.subCatIds,
      facetValues: criteria.facetValues,
      priceMin: criteria.priceMin,
      priceMax: criteria.priceMax,
      distanceKm: criteria.distanceKm,
    };
  });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [saveSearchModalOpen, setSaveSearchModalOpen] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);

  // Distance-filter anchor point: defaults to the buyer's profile district
  // (resolved via the Lebanon locality dataset), can be upgraded to precise
  // device geolocation (expo-location, works on native + web) if they tap
  // "Use my location".
  const [anchor, setAnchor] = useState<LatLng | null>(() => {
    const p = findPlaceByFreeText(profile.district);
    return p ? { lat: p.lat, lng: p.lng } : null;
  });
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    setAnchor((prev) => {
      if (prev) return prev;
      const p = findPlaceByFreeText(profile.district);
      return p ? { lat: p.lat, lng: p.lng } : null;
    });
  }, [profile.district]);

  const useMyLocationForFilter = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access for this app to use your current location.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setAnchor({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert('Could not get your location', 'Check your location permission for this app.');
    } finally {
      setLocating(false);
    }
  };

  const chooseTopCategory = (id: CategoryId) => {
    if (topCat === 'all') {
      // Entering a category from "all" is a real stack push -- this is
      // what gives it its own back-stop (see HomeStack.tsx / topCat above).
      homeNav.navigate('HomeCategory', { cat: id });
    } else {
      // Switching directly between two categories replaces the current
      // entry in place -- no extra back-stop needed, one "back" from any
      // category always returns straight to "all", not through every
      // category visited along the way.
      homeNav.setParams({ cat: id });
    }
  };
  const clearAllCategories = () => {
    // Mirrors the hardware/browser back button exactly: pop the pushed
    // HomeCategory entry if there is one (the normal case), or just go to
    // HomeRoot directly if this screen was reached some other way (e.g. a
    // direct deep link straight into a category, with nothing to pop).
    if (homeNav.canGoBack()) homeNav.goBack();
    else homeNav.navigate('HomeRoot');
  };
  const clearFilters = () => setSelection(emptySelection());

  // Selection (subcategory checkboxes + facet filters) is scoped to
  // whichever category is active -- reset it whenever topCat changes, no
  // matter how it changed (a tap above, the back button, browser
  // forward/back, a direct link). Single source of truth, instead of
  // every call site remembering to clear it itself.
  useEffect(() => {
    if (skipNextResetRef.current) {
      // This run corresponds to the criteria this instance was just seeded
      // with (see the selection/query lazy initializers) -- consume the
      // flag instead of wiping what was just applied.
      skipNextResetRef.current = false;
      return;
    }
    setSelection(emptySelection());
  }, [topCat]);

  // Arrived via "Run" on a saved search -- scrub the consumed param back
  // out once, right after mount, so a later plain category tap on this
  // same screen instance (setParams, not a fresh navigate) doesn't
  // accidentally see a stale applyCriteria and re-seed itself again.
  useEffect(() => {
    if (route.params?.applyCriteria) {
      homeNav.setParams({ applyCriteria: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which category's OWN facets govern the sidebar right now. Exactly one
  // checked subcategory narrows to its own (leaf) facets; zero or several
  // checked falls back to the top-level category's shared facets only --
  // unioning multiple subcategories' facets would incorrectly filter out
  // listings from one that lack another's leaf-only attribute (e.g.
  // checking both Phones and Laptops, then filtering on Phones' storage_gb,
  // would wrongly exclude every Laptop listing).
  const effectiveCategoryId: CategoryId | null =
    topCat === 'all' ? null : selection.subCatIds.length === 1 ? selection.subCatIds[0] : topCat;

  const facets: FilterFacet[] = effectiveCategoryId ? resolveFilterFacetsForCategory(effectiveCategoryId) : [];

  // Listings scoped to category + chosen subcategory only -- the base for
  // both the results grid (further filtered below) and each section's
  // "only show reachable values" options. Options are intentionally
  // computed from this (not the fully-filtered set) so sections stay
  // stable and don't shrink/flicker as a shopper checks other boxes --
  // the same simplification most faceted-search sidebars make.
  const categoryScoped = useMemo(() => {
    if (topCat === 'all' || !effectiveCategoryId) return listings;
    return listings.filter((l) => {
      if (!categoryMatches(l.cat, effectiveCategoryId)) return false;
      if (selection.subCatIds.length > 0 && !selection.subCatIds.some((id) => categoryMatches(l.cat, id))) return false;
      return true;
    });
  }, [listings, topCat, effectiveCategoryId, selection.subCatIds, categoryMatches]);

  const toggleFacetValue = (key: string, value: string) => {
    setSelection((prev) => {
      const cur = prev.facetValues[key] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, facetValues: { ...prev.facetValues, [key]: next } };
    });
  };
  const setNumberFacet = (key: string, value: string | null) => {
    setSelection((prev) => ({ ...prev, facetValues: { ...prev.facetValues, [key]: value ? [value] : [] } }));
  };
  const toggleSubCat = (id: string) => {
    setSelection((prev) => ({
      ...prev,
      subCatIds: prev.subCatIds.includes(id) ? prev.subCatIds.filter((v) => v !== id) : [...prev.subCatIds, id],
    }));
  };

  const subCategoryOptions: FilterOption[] = useMemo(() => {
    if (topCat === 'all') return [];
    return childrenOf(topCat).map((c) => ({ key: c.id, label: language === 'ar' ? c.nameAr : c.nameEn }));
  }, [topCat, childrenOf, language]);

  const areaOptions: FilterOption[] = useMemo(() => {
    const districts = Array.from(new Set(categoryScoped.map((l) => l.district).filter(Boolean))).sort();
    return districts.map((d) => ({ key: d, label: d }));
  }, [categoryScoped]);

  const attributeOptions = (attr: CategoryAttribute): FilterOption[] => {
    if (attr.type === 'boolean') {
      return [
        { key: 'true', label: t('common.yes') },
        { key: 'false', label: t('common.no') },
      ];
    }
    if (attr.type === 'multiselect') {
      const present = new Set(
        categoryScoped.flatMap((l) => (Array.isArray(l.attributes[attr.slug]) ? (l.attributes[attr.slug] as string[]).map(String) : []))
      );
      return attr.options.filter((o) => present.has(o.value)).map((o) => ({ key: o.value, label: language === 'ar' ? o.labelAr : o.labelEn }));
    }
    const present = new Set(categoryScoped.map((l) => l.attributes[attr.slug]).filter((v) => v !== undefined).map(String));
    return attr.options.filter((o) => present.has(o.value)).map((o) => ({ key: o.value, label: language === 'ar' ? o.labelAr : o.labelEn }));
  };

  const matchesFacets = (l: Listing): boolean => {
    for (const f of facets) {
      if (f.kind === 'subcategory') continue; // already applied via categoryScoped
      if (f.kind === 'area') {
        const vals = selection.facetValues.area;
        if (vals && vals.length > 0 && !vals.includes(l.district)) return false;
        continue;
      }
      const attr = f.attribute;
      const vals = selection.facetValues[attr.slug];
      if (!vals || vals.length === 0) continue;
      if (attr.type === 'number') {
        const raw = l.attributes[attr.slug];
        const num = raw !== undefined && raw !== null ? Number(raw) : NaN;
        if (!(num >= Number(vals[0]))) return false;
      } else if (attr.type === 'boolean') {
        if (!vals.includes(String(!!l.attributes[attr.slug]))) return false;
      } else if (attr.type === 'multiselect') {
        const have = l.attributes[attr.slug];
        const haveArr = Array.isArray(have) ? have.map(String) : have != null ? [String(have)] : [];
        if (!vals.some((v) => haveArr.includes(v))) return false;
      } else if (!vals.includes(String(l.attributes[attr.slug]))) {
        return false;
      }
    }
    return true;
  };

  const priceBounds = useMemo(() => {
    const prices = categoryScoped.map((l) => l.price).filter((p) => Number.isFinite(p) && p > 0);
    const max = prices.length > 0 ? Math.max(...prices) : 1000;
    return { min: 0, max: Math.max(100, Math.ceil(max / 50) * 50) };
  }, [categoryScoped]);

  const [priceMinText, setPriceMinText] = useState('');
  const [priceMaxText, setPriceMaxText] = useState('');
  useEffect(() => {
    setPriceMinText(selection.priceMin != null ? String(selection.priceMin) : '');
    setPriceMaxText(selection.priceMax != null ? String(selection.priceMax) : '');
  }, [selection.priceMin, selection.priceMax]);
  const applyPriceBoxes = () => {
    const lo = priceMinText.trim() ? Number(priceMinText) : null;
    const hi = priceMaxText.trim() ? Number(priceMaxText) : null;
    setSelection((prev) => ({
      ...prev,
      priceMin: lo != null && Number.isFinite(lo) ? Math.max(priceBounds.min, lo) : null,
      priceMax: hi != null && Number.isFinite(hi) ? Math.min(priceBounds.max, hi) : null,
    }));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categoryScoped.filter((l) => {
      if (!matchesFacets(l)) return false;
      if (selection.priceMin != null && l.price < selection.priceMin) return false;
      if (selection.priceMax != null && l.price > selection.priceMax) return false;
      if (selection.distanceKm != null) {
        if (!anchor || l.lat == null || l.lng == null) return false;
        if (haversineKm(anchor, { lat: l.lat, lng: l.lng }) > selection.distanceKm) return false;
      }
      return q.length === 0 || l.titleEn.toLowerCase().includes(q) || l.titleAr.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryScoped, selection, query, anchor, facets]);

  // Mobile home ("all categories", nothing searched yet) groups listings
  // into one horizontal carousel per top-level category instead of a
  // single combined grid -- matches the OLX reference the user attached,
  // and keeps listings from different categories from being mixed
  // together randomly. Falls back to the plain combined grid the moment
  // the shopper searches or drills into a specific category (search
  // results and a single category's listings both read better as one
  // flat list), or if there happen to be no listings anywhere yet.
  // Capped at 10 per category so one huge category can't turn the home
  // screen into an endless scroll before the shopper even sees the rest.
  const categoryCarousels = useMemo(() => {
    if (topCat !== 'all' || query.trim().length > 0) return [];
    return categories
      .map((c) => ({ category: c, items: listings.filter((l) => categoryMatches(l.cat, c.id)).slice(0, 10) }))
      .filter((section) => section.items.length > 0);
  }, [topCat, query, categories, listings, categoryMatches]);
  const showCarousels = categoryCarousels.length > 0;

  const categoryLabel = topCat !== 'all' ? (() => {
    const cat = categoryById(topCat);
    return cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : topCat;
  })() : '';

  const openSaveSearch = () => {
    if (!isVerified) {
      navigation.navigate('Auth');
      return;
    }
    setSaveSearchModalOpen(true);
  };

  const handleSaveSearch = async (label: string) => {
    if (topCat === 'all' || !label) return;
    const criteria: SavedSearchCriteria = {
      query,
      subCatIds: selection.subCatIds,
      facetValues: selection.facetValues,
      priceMin: selection.priceMin,
      priceMax: selection.priceMax,
      distanceKm: selection.distanceKm,
    };
    setSavingSearch(true);
    try {
      await saveSearch(topCat, label, criteria);
      setSaveSearchModalOpen(false);
      Alert.alert(t('home.savedSearches.saved'));
    } catch (e) {
      Alert.alert(t('home.savedSearches.saveFailed'));
    } finally {
      setSavingSearch(false);
    }
  };

  const renderFilterSections = () => (
    <>
      <View style={styles.filtersHeaderRow}>
        <Text style={styles.filtersHeaderTitle}>{t('home.filters.filters')}</Text>
        <View style={styles.filtersHeaderActions}>
          <Pressy onPress={openSaveSearch}>
            <Text style={styles.saveSearchLink}>{t('home.filters.saveSearch')}</Text>
          </Pressy>
          <Pressy onPress={clearFilters}>
            <Text style={styles.clearLink}>{t('home.filters.clearAll')}</Text>
          </Pressy>
        </View>
      </View>

      {facets.map((f) => {
        if (f.kind === 'subcategory') {
          return (
            <FilterSection
              key="subcategory"
              title={t('home.filters.subcategory')}
              options={subCategoryOptions}
              selected={selection.subCatIds}
              onToggle={toggleSubCat}
            />
          );
        }
        if (f.kind === 'area') {
          return (
            <FilterSection
              key="area"
              title={t('home.filters.area')}
              options={areaOptions}
              selected={selection.facetValues.area || []}
              onToggle={(v) => toggleFacetValue('area', v)}
              searchable
            />
          );
        }
        const attr = f.attribute;
        const attrLabel = language === 'ar' ? attr.labelAr : attr.labelEn;
        if (attr.type === 'number') {
          const current = (selection.facetValues[attr.slug] || [])[0] || null;
          return (
            <View key={attr.slug} style={styles.numberSection}>
              <Text style={styles.numberTitle}>{attrLabel}</Text>
              <View style={styles.numberRow}>
                <Pressy onPress={() => setNumberFacet(attr.slug, null)} style={[styles.numberPill, current === null && styles.numberPillActive]}>
                  <Text style={[styles.numberPillText, current === null && styles.numberPillTextActive]}>{t('common.all')}</Text>
                </Pressy>
                {[1, 2, 3, 4].map((n) => (
                  <Pressy
                    key={n}
                    onPress={() => setNumberFacet(attr.slug, String(n))}
                    style={[styles.numberPill, current === String(n) && styles.numberPillActive]}
                  >
                    <Text style={[styles.numberPillText, current === String(n) && styles.numberPillTextActive]}>{n}+</Text>
                  </Pressy>
                ))}
              </View>
            </View>
          );
        }
        return (
          <FilterSection
            key={attr.slug}
            title={attrLabel}
            options={attributeOptions(attr)}
            selected={selection.facetValues[attr.slug] || []}
            onToggle={(v) => toggleFacetValue(attr.slug, v)}
            searchable={attributeOptions(attr).length > 8}
          />
        );
      })}

      <View style={styles.fixedSection}>
        <Text style={styles.fixedTitle}>{t('home.filters.price')}</Text>
        <RangeSlider
          mode="range"
          min={priceBounds.min}
          max={priceBounds.max}
          step={Math.max(1, Math.round(priceBounds.max / 100))}
          valueMin={selection.priceMin ?? priceBounds.min}
          valueMax={selection.priceMax ?? priceBounds.max}
          onChange={(lo, hi) => setSelection((prev) => ({ ...prev, priceMin: lo, priceMax: hi }))}
        />
        <View style={styles.priceBoxRow}>
          <TextInput
            value={priceMinText}
            onChangeText={setPriceMinText}
            keyboardType="numeric"
            placeholder={t('home.filters.priceMinPlaceholder')}
            style={styles.priceBox}
          />
          <Text style={styles.priceDash}>–</Text>
          <TextInput
            value={priceMaxText}
            onChangeText={setPriceMaxText}
            keyboardType="numeric"
            placeholder={t('home.filters.priceMaxPlaceholder')}
            style={styles.priceBox}
          />
          <Pressy onPress={applyPriceBoxes} style={styles.setPriceBtn}>
            <Text style={styles.setPriceBtnText}>{t('home.filters.setPrice')}</Text>
          </Pressy>
        </View>
      </View>

      <View style={styles.fixedSection}>
        <Text style={styles.fixedTitle}>{t('home.filters.distance')}</Text>
        {anchor ? (
          <>
            <View style={styles.distanceHeaderRow}>
              <Text style={styles.distanceValue}>
                {selection.distanceKm == null ? t('home.filters.distanceAny') : t('home.filters.distanceWithin', { n: selection.distanceKm })}
              </Text>
              {selection.distanceKm != null && (
                <Pressy onPress={() => setSelection((prev) => ({ ...prev, distanceKm: null }))}>
                  <Icon name="close" size={12} color={colors.inkSoft} />
                </Pressy>
              )}
            </View>
            <RangeSlider
              mode="single"
              min={0}
              max={50}
              value={selection.distanceKm ?? 0}
              onChange={(v) => setSelection((prev) => ({ ...prev, distanceKm: v }))}
            />
          </>
        ) : (
          <Text style={[type.soft, styles.distanceHint]}>{t('home.filters.distanceNeedsArea')}</Text>
        )}
        <Pressy onPress={useMyLocationForFilter} style={styles.locationLink}>
          <Icon name="location" size={13} color={colors.ink} />
          <Text style={styles.locationLinkText}>{locating ? t('common.loading') : t('home.filters.useMyLocation')}</Text>
        </Pressy>
      </View>
    </>
  );

  const grid = (
    <FlatList
      key={columns}
      data={filtered}
      keyExtractor={(item) => item.id}
      numColumns={columns}
      style={styles.list}
      columnWrapperStyle={{ justifyContent: 'space-between' }}
      contentContainerStyle={[styles.grid, isDesktop ? styles.gridDesktop : styles.gridMobileTopReserve]}
      onScroll={!isDesktop ? onChromeScroll : undefined}
      scrollEventThrottle={16}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={type.body}>{t('home.emptyTitle')}</Text>
          <Text style={type.soft}>{t('home.emptySub')}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <ListingCard columns={columns} listing={item} onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })} />
      )}
    />
  );

  // Mobile-only "all categories" home view: a vertical stack of per-
  // category carousels (see categoryCarousels above) instead of the
  // combined grid.
  const carousels = (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.carouselsContent}
      onScroll={onChromeScroll}
      scrollEventThrottle={16}
      // Android's native ScrollView doesn't support nested scrolling by
      // default -- and every CategoryCarouselSection below nests its own
      // horizontal ScrollView inside this outer vertical one. Without this,
      // a vertical swipe that starts or passes over one of those horizontal
      // rows (Vehicles/Properties/Mobiles/...) gets fought over between the
      // two scrollables for gesture ownership, which is what was actually
      // behind the "scrolling acts up" jumping/flicker on-device -- a
      // platform-level Android gap, not a timing/animation issue (that's
      // also real, fixed separately in ScrollChromeContext, but wasn't the
      // cause of this). No-op on iOS/web, safe to always set.
      nestedScrollEnabled
    >
      {categoryCarousels.map(({ category, items }) => (
        <CategoryCarouselSection
          key={category.id}
          category={category}
          items={items}
          onSeeAll={() => chooseTopCategory(category.id)}
          onPressListing={(item) => navigation.navigate('ListingDetail', { listingId: item.id })}
        />
      ))}
    </ScrollView>
  );

  return (
    <Screen reserveSidebar maxWidth={1180}>
      <View style={[styles.header, isDesktop && styles.headerDesktop]}>
        <View>
          <Text style={type.soft}>{profile.name && profile.name !== 'You' ? t('home.greeting') : ''}</Text>
          <Text style={[styles.name, isDesktop && styles.nameDesktop]}>{profile.name && profile.name !== 'You' ? profile.name : t('home.welcome')}</Text>
        </View>
        <View style={styles.headerActions}>
          <LanguageSwitch compact />
          <Pressy style={styles.pointsBadge} onPress={() => navigation.navigate('MainTabs')}>
            <Icon name="sparkle" size={13} color={colors.ink} />
            <Text style={styles.pointsText}>{profile.points}</Text>
          </Pressy>
        </View>
      </View>

      <View style={[styles.searchRow, isDesktop && styles.searchRowDesktop]}>
        <Icon name="search" size={17} color={colors.inkSoft} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('home.search')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.searchInput, isRTL && styles.searchInputRTL]}
          autoComplete="off"
        />
      </View>

      {isDesktop ? (
        // Desktop is unchanged: a big tile grid at "all", a persistent
        // left sidebar of facet filters once a category is picked. Plenty
        // of vertical room there already -- this redesign is mobile-only.
        topCat === 'all' ? (
          <>
            <View style={[styles.catGrid, styles.catGridDesktop]}>
              {categories.map((c) => (
                <CategoryCard key={c.id} category={c} columns={catColumns} onPress={() => chooseTopCategory(c.id)} />
              ))}
            </View>
            {grid}
          </>
        ) : (
          <>
            <View style={[styles.categoryBar, styles.categoryBarDesktop]}>
              <Pressy onPress={clearAllCategories} style={styles.backRow}>
                <Icon name="back" size={14} color={colors.inkSoft} />
                <Text style={styles.backText}>{t('home.categoryBack')}</Text>
              </Pressy>
              <Text style={styles.categoryTitle} numberOfLines={1}>{categoryLabel}</Text>
            </View>
            <View style={[styles.body, styles.bodyDesktop]}>
              <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent}>
                {renderFilterSections()}
              </ScrollView>
              {grid}
            </View>
          </>
        )
      ) : (
        // Mobile: categories are always a compact horizontal slider right
        // under the search bar (an "All" chip plus every top-level
        // category), never a wall of big tiles -- and the listings grid
        // (search-filtered, and category-filtered once a chip is picked)
        // always renders directly under it, same page, no separate
        // "choose a category first" step. Matches the OLX-style layout
        // the user asked for, and as a side effect fixes the search box
        // feeling broken on mobile -- it always filtered correctly, it
        // was just buried below a full-screen wall of category tiles with
        // nothing else visible above the fold.
        <>
          {topCat !== 'all' && (
            <View style={styles.mobileCatRow}>
              <Text style={styles.categoryTitle} numberOfLines={1}>{categoryLabel}</Text>
              <Pressy onPress={() => setMobileFiltersOpen(true)} style={styles.filtersBtn}>
                <Icon name="gear" size={13} color={colors.ink} />
                <Text style={styles.filtersBtnText}>{t('home.filters.filters')}</Text>
              </Pressy>
            </View>
          )}

          {/* carouselsAnchor is the positioning root for catSliderWrap below
              (position: absolute positions relative to the nearest parent
              View regardless of whether it declares position:'relative' --
              that's just how RN works, unlike web CSS -- so catSliderWrap
              needs to share a parent with exactly the content it overlays,
              not the whole screen, or `top: 0` would land under the
              greeting/search row instead of at the top of the list). */}
          <View style={styles.carouselsAnchor}>
            {showCarousels ? carousels : grid}

            {/* Floats ABOVE the scrollable content (position: absolute)
                instead of sitting in normal flow next to it. It used to be
                a normal sibling that grew/shrank the space above the list
                on every auto-hide toggle (see ScrollChromeContext) --
                collapsing/expanding a view directly adjacent to an
                actively-scrolling list, even smoothly animated, was still
                enough to visibly disturb that list's own scroll position on
                Android (reported repeatedly as "scrolling acts up"/
                flickering, and survived both an animation-timing fix and a
                nestedScrollEnabled fix, which ruled those out as the actual
                cause). Floating it instead -- the same pattern TabBar
                already uses successfully for the bottom pill -- means the
                list's own box never resizes when this hides/shows; hiding
                it just slides/fades the overlay itself, full stop.
                carouselsContent/grid's paddingTop reserves space so content
                doesn't start out from under it while visible. */}
            <View
              style={[styles.catSliderWrap, !chromeVisible && styles.catSliderWrapHidden]}
              pointerEvents={chromeVisible ? 'auto' : 'none'}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.catSlider, isRTL && styles.catSliderRTL]}
                contentContainerStyle={styles.catSliderContent}
              >
                {/* Same scaleX mirror-the-scroller-then-counter-flip-each-
                    item technique as CategoryCarouselSection's listing row
                    -- swiping this categories menu should read RTL too
                    ("All" anchored at the right, dragging leftward walks
                    through the rest), not just keep English's left-to-
                    right chip order with right-aligned labels. */}
                <View style={isRTL && styles.catSliderItemRTL}>
                  <Pressy onPress={clearAllCategories} style={[styles.allChip, topCat === 'all' && styles.allChipActive]}>
                    <View style={[styles.allChipIconWrap, topCat === 'all' && styles.allChipIconWrapActive]}>
                      <Icon name="grip" size={20} color={topCat === 'all' ? colors.white : colors.ink} />
                    </View>
                    <Text style={[styles.allChipText, topCat === 'all' && styles.allChipTextActive]} numberOfLines={1}>
                      {t('common.all')}
                    </Text>
                  </Pressy>
                </View>
                {categories.map((c) => (
                  <View key={c.id} style={isRTL && styles.catSliderItemRTL}>
                    <CategoryCard category={c} width={72} selected={topCat === c.id} onPress={() => chooseTopCategory(c.id)} />
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>

          <Modal visible={mobileFiltersOpen} animationType="slide" onRequestClose={() => setMobileFiltersOpen(false)}>
            <Screen edges={['top', 'left', 'right', 'bottom']}>
              <View style={styles.modalTopBar}>
                <Text style={type.h3}>{t('home.filters.filters')}</Text>
                <Pressy onPress={() => setMobileFiltersOpen(false)} style={styles.iconBtn}>
                  <Icon name="close" size={18} />
                </Pressy>
              </View>
              <ScrollView contentContainerStyle={styles.modalScroll}>{renderFilterSections()}</ScrollView>
              <View style={styles.modalFooter}>
                <Button label={t('home.filters.showResultsCount', { n: filtered.length })} onPress={() => setMobileFiltersOpen(false)} style={{ flex: 1 }} />
              </View>
            </Screen>
          </Modal>
        </>
      )}

      <SaveSearchModal
        visible={saveSearchModalOpen}
        defaultLabel={categoryLabel}
        loading={savingSearch}
        onSave={handleSaveSearch}
        onCancel={() => setSaveSearchModalOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerDesktop: { paddingHorizontal: 0, paddingTop: 26 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...type.title, fontSize: 21 },
  nameDesktop: { fontSize: 28 },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    height: 34,
  },
  pointsText: { ...type.h3, fontSize: 13.5 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    height: 46,
    marginBottom: 14,
  },
  searchRowDesktop: { marginHorizontal: 0, height: 50 },
  // `width: '100%'` alongside `flex: 1` is defense-in-depth for the same
  // bug described below -- guarantees the underlying web <input> always
  // fills its row rather than ever falling back to an intrinsic/auto
  // content width.
  searchInput: { flex: 1, width: '100%', fontSize: 14.5, color: colors.ink },
  // Without this, the underlying web <input> keeps its default LTR text
  // direction even while its RTL flex-row parent visually reverses the
  // icon/input layout -- the mismatch made the browser's native focus
  // outline hug only the (LTR-measured) text-content box instead of the
  // full pill, leaving an untappable/untypable gap on one side. Matches
  // the same textAlign/writingDirection pattern CreateListingScreen's
  // rtlInput style already uses for RTL text fields.
  searchInputRTL: { textAlign: 'right', writingDirection: 'rtl' },

  // Desktop-only entry state: big category grid (folded in from the old
  // Browse tab). Mobile uses the horizontal catSlider below instead.
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 6 },
  catGridDesktop: { paddingHorizontal: 0 },

  // Mobile: compact horizontal category slider, always visible right
  // under the search bar (an "All" chip + every top-level category),
  // instead of a full-screen wall of tiles gating everything below it.
  // Explicit height + flex-start is required here, not cosmetic: a
  // horizontal ScrollView with no height of its own stretches to fill
  // whatever vertical space its flex parent has available, and RN's
  // flexbox defaults row children to alignItems:'stretch' -- together
  // that silently turns every square chip into a full-height column
  // (reported by the user as the slider "taking up too much space").
  // Pinning the ScrollView's own height to the chip height and opting
  // the row out of stretch is what keeps chips square regardless of
  // how tall the surrounding screen is.
  catSlider: { height: 80, flexGrow: 0, flexShrink: 0 },
  // Mirrors the whole scroller so its swipe direction reads RTL -- see the
  // render-side comment above. catSliderItemRTL (applied per-chip below)
  // undoes the mirror on each individual chip so its icon/label still
  // renders right-side-up.
  catSliderRTL: { transform: [{ scaleX: -1 }] },
  catSliderItemRTL: { transform: [{ scaleX: -1 }] },
  catSliderContent: { paddingHorizontal: 18, gap: 10, alignItems: 'flex-start' },
  // Positioning root shared by catSliderWrap (absolute) and the scrollable
  // content it overlays -- see the render-side comment on carouselsAnchor.
  carouselsAnchor: { flex: 1, position: 'relative' },
  // Auto-hide overlay (see ScrollChromeContext and the render-side comment
  // above) -- floats above carouselsAnchor's scrollable content instead of
  // sitting in normal flow next to it, so hiding/showing it can never
  // resize that content's own box. CAT_SLIDER_HEIGHT (94 = 80 chip height +
  // 14 spacing) is also reserved as paddingTop on carouselsContent/grid
  // below so content doesn't start out from under it while visible. Opaque
  // background (matches the screen bg) since content now scrolls behind
  // it, not just below it. Web-only CSS transition props still drive the
  // fade/slide smoothly on the web build (react-native-web interprets
  // them); on native, ScrollChromeContext's LayoutAnimation.configureNext
  // call takes over for the same effect.
  catSliderWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // 94 = 80 chip height + 14 bottom breathing room before the overlaid
    // content -- carouselsContent/grid's paddingTop matches this exactly so
    // the first row of listings lines up right below the chips, not
    // underneath them.
    height: 94,
    zIndex: 5,
    backgroundColor: colors.bg,
    opacity: 1,
    transform: [{ translateY: 0 }],
    transitionProperty: 'opacity, transform',
    transitionDuration: '220ms',
    transitionTimingFunction: 'ease-out',
  } as ViewStyle,
  catSliderWrapHidden: {
    opacity: 0,
    transform: [{ translateY: -16 }],
  },
  // Borderless, matching CategoryCard's redesigned chip below -- a plain
  // icon circle with its label underneath, no card enclosure.
  allChip: {
    width: 72, alignItems: 'center', justifyContent: 'flex-start', gap: 8,
  },
  allChipActive: {},
  allChipIconWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  allChipIconWrapActive: { backgroundColor: colors.ink },
  allChipText: { ...type.tiny, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  allChipTextActive: { fontWeight: '700' },

  // Mobile: small title + Filters button row, shown under the slider only
  // once a category chip is active (the slider itself stays visible and
  // shows which chip is selected, so no separate "< back" link is needed
  // here the way desktop's categoryBar has one).
  mobileCatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 12, gap: 10 },

  // Desktop-only category header bar shown once a category is picked.
  categoryBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, marginBottom: 12, gap: 10 },
  categoryBarDesktop: { paddingHorizontal: 0 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  categoryTitle: { ...type.h3, flex: 1 },
  filtersBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  filtersBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },

  // Desktop: persistent left sidebar next to the listings grid.
  body: { flex: 1 },
  bodyDesktop: { flexDirection: 'row', gap: 28 },
  sidebar: { width: 240, flexGrow: 0, flexShrink: 0 },
  sidebarContent: { paddingBottom: 60 },
  filtersHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  filtersHeaderTitle: { ...type.h3, fontSize: 15 },
  filtersHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  saveSearchLink: { fontSize: 12.5, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  clearLink: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },

  numberSection: { marginBottom: 22 },
  numberTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, color: colors.ink },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numberPill: {
    paddingHorizontal: 12, height: 30, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  numberPillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  numberPillText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  numberPillTextActive: { color: colors.white },

  fixedSection: { marginBottom: 24 },
  fixedTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, color: colors.ink },
  priceBoxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceBox: {
    flex: 1, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 10, fontSize: 13, color: colors.ink,
  },
  priceDash: { color: colors.inkSoft },
  setPriceBtn: {
    height: 36, paddingHorizontal: 14, borderRadius: radius.sm,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
  },
  setPriceBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.white },
  distanceHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  distanceValue: { fontSize: 13, fontWeight: '600', color: colors.ink },
  distanceHint: { lineHeight: 17 },
  locationLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  locationLinkText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },

  // FlatList needs flex: 1 (flexBasis: 0, not "auto") so it only ever
  // claims the space left over after everything above it, and scrolls
  // its own (potentially very long) content internally instead of
  // ballooning the whole screen's layout to its full height.
  list: { flex: 1 },
  grid: { paddingHorizontal: 18, paddingBottom: 110 },
  gridDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  // Mobile-only: `grid` is also used (unmodified) on desktop, which has no
  // catSliderWrap overlay at all -- this reserves space for it only when
  // actually needed. 94 matches catSliderWrap's height exactly.
  gridMobileTopReserve: { paddingTop: 94 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 4 },
  // Per-category carousels (mobile "all categories" home view) -- each
  // CategoryCarouselSection carries its own horizontal padding, so this
  // only needs bottom breathing room (the same tab-bar clearance the
  // combined grid has) plus catSliderWrap's reserved top space (94, see
  // that style) since it now floats over this content instead of sitting
  // beside it.
  carouselsContent: { paddingTop: 94, paddingBottom: 110 },

  // Mobile filters modal.
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 52 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { paddingHorizontal: 18, paddingBottom: 30 },
  modalFooter: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line },
});
