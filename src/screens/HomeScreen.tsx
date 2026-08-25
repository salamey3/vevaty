import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, View, TextInput, FlatList, ScrollView, ViewStyle } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import ListingCard from '../components/ListingCard';
import CategoryCard from '../components/CategoryCard';
import CarouselArrows from '../components/CarouselArrows';
import CategoryCarouselSection from '../components/CategoryCarouselSection';
import CollectionCarouselSection from '../components/CollectionCarouselSection';
import LanguageSwitch from '../components/LanguageSwitch';
import FilterSection, { FilterOption } from '../components/FilterSection';
import RangeSlider from '../components/RangeSlider';
import SaveSearchModal from '../components/SaveSearchModal';
import BrandMark from '../components/BrandMark';
import { mirrorRow } from '../lib/mirrorRow';
import { useGoHome } from '../hooks/useGoHome';
import * as Location from 'expo-location';
import { Alert } from '../lib/alertShim';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useScrollChrome } from '../store/ScrollChromeContext';
import { useSavedSearches } from '../store/SavedSearchesStore';
import { useCollections } from '../store/CollectionsStore';
import { RootStackParamList, HomeStackParamList } from '../navigation/types';
import { Category, CategoryAttribute, CategoryId, FilterFacet, Listing, SavedSearchCriteria } from '../types';
import { useIsDesktop, useGridColumns } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { haversineKm, LatLng } from '../lib/geo';
import { findPlaceByFreeText } from '../data/lebanonPlaces';
import { useRtlCarousel } from '../lib/useRtlCarousel';

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
  // New/used -- unlike facetValues, this isn't category-scoped (every
  // listing in every category has a condition, or doesn't), so it's its
  // own top-level field rather than living under a facet key, same
  // reasoning as priceMin/priceMax staying separate from facetValues.
  condition: string[];
};

function emptySelection(): SelectionState {
  return { subCatIds: [], facetValues: {}, priceMin: null, priceMax: null, distanceKm: null, condition: [] };
}

// Fallback height (px) for mobileChromeOverlay (mobile's floating greeting
// + search row + category slider) before its real, measured height is
// known -- see mobileChromeHeight below. A rough estimate of the combined
// height those actually render at (greeting+search row ~68 + category
// slider 80 + the overlay's own bottom padding 16), so the very first
// frame, before onLayout has fired, doesn't reserve zero space above the
// listing grid and let a card flash in from underneath the chrome.
const MOBILE_CHROME_DEFAULT_HEIGHT = 164;

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Same underlying navigation object as `navigation` above (useNavigation
  // always returns the current screen's navigator) -- this second, more
  // narrowly-typed handle is just for talking to the immediate parent, the
  // Home stack (see navigation/HomeStack.tsx), without fighting the other
  // hook's RootStackParamList typing.
  const homeNav = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, 'HomeCategory'>>();
  const { listings: allListings, profile, isVerified } = useAppStore();
  const { collections, resolveCollection } = useCollections();
  // Browse/search only ever wants to show published listings -- RLS already
  // keeps other sellers' non-active listings out of what's fetched, but the
  // signed-in seller's OWN rows of any status (pending_review, rejected,
  // expired, removed) are visible to them per RLS too, and this screen
  // never filtered by status before. Without this, a seller would see their
  // own still-under-review or rejected listing sitting in the main browse
  // grid -- confusing, and not where that belongs (ProfileScreen's "My
  // listings" already surfaces it clearly with a status badge).
  const listings = useMemo(() => allListings.filter((l) => l.status === 'active'), [allListings]);
  const { categories, categoryById, childrenOf, categoryMatches, resolveFilterFacetsForCategory } = useSettings();
  const { saveSearch } = useSavedSearches();
  const { t, language, isRTL } = useLanguage();
  const goHome = useGoHome();
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
  // The desktop category strip, driven by its own arrows. The offset is
  // tracked in a ref rather than state: it changes on every scroll frame
  // and nothing renders from it, so putting it in state would re-render
  // the whole screen sixty times a second for no visible reason.
  const catRowRef = useRef<ScrollView>(null);
  const catRowX = useRef(0);
  // The strip scrolls freely rather than by pages, so "is there more that
  // way?" is a comparison of offset against content width, not an index.
  // These three are state rather than refs because the arrows render from
  // them -- but they're only written when the answer actually changes (see
  // the setter below), so a scroll doesn't re-render on every frame.
  const [catRowEnds, setCatRowEnds] = useState({ back: false, forward: false });
  const catRowMetrics = useRef({ x: 0, viewport: 0, content: 0 });
  const updateCatRowEnds = useCallback(() => {
    const { x, viewport, content } = catRowMetrics.current;
    // A pixel of slack: sub-pixel layout means an offset that has reached
    // the end often lands a fraction short, which would leave a forward
    // arrow that does nothing.
    const next = { back: x > 1, forward: content - viewport - x > 1 };
    setCatRowEnds((prev) => (prev.back === next.back && prev.forward === next.forward ? prev : next));
  }, []);
  // Mobile-only auto-hide for the greeting/search/category-slider chrome
  // below (see ScrollChromeContext -- also drives the bottom tab bar in
  // TabBar.tsx, which can't see this screen's own scroll events directly).
  // beginChromeInteraction/endChromeInteraction are also passed down to
  // CategoryCarouselSection/CollectionCarouselSection so a horizontal swipe
  // through one of those keeps this chrome hidden too, same as scrolling
  // the page itself -- see this screen's carouselsCarousel/collections
  // render sites below.
  const { chromeVisible, chromeAnim, onChromeScroll, beginChromeInteraction, endChromeInteraction } = useScrollChrome();
  // Measured height of mobileChromeOverlay (greeting + search + category
  // slider stacked), reserved as paddingTop on the scrollable content below
  // it -- see that overlay's own style comment, and MOBILE_CHROME_DEFAULT_
  // HEIGHT above, for why this is measured rather than a fixed stylesheet
  // number.
  const [mobileChromeHeight, setMobileChromeHeight] = useState(MOBILE_CHROME_DEFAULT_HEIGHT);

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
      condition: criteria.condition,
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
  const toggleCondition = (value: string) => {
    setSelection((prev) => ({
      ...prev,
      condition: prev.condition.includes(value) ? prev.condition.filter((v) => v !== value) : [...prev.condition, value],
    }));
  };

  // Always New/Used, not gated by "does anything currently match" the way
  // areaOptions/attributeOptions are -- there are only ever these two
  // values, so hiding one because nothing in the current scope happens to
  // have it would look like a bug, not a real absence of that condition.
  const conditionOptions: FilterOption[] = [
    { key: 'new', label: t('home.filters.conditionNew') },
    { key: 'used', label: t('home.filters.conditionUsed') },
  ];

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
      // A listing with no condition on file (posted before this field
      // existed) never matches a non-empty selection here -- '' is never
      // one of the checked values, so `l.condition || ''` correctly falls
      // through to "excluded" rather than accidentally matching either
      // checkbox.
      if (selection.condition.length > 0 && !selection.condition.includes(l.condition || '')) return false;
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

  // Editor's Picks / Hot Deals / Just Listed rows -- same "all categories,
  // nothing searched" gate as the category carousels above, and same
  // "don't render an empty row" rule: a collection nobody's curated yet
  // (Editor's Picks with no items) or one that currently has nothing
  // qualifying (Hot Deals with no active price drops) simply doesn't
  // appear, rather than showing an empty section. Sorted by the
  // collection's own sortOrder (already applied server-side, see
  // CollectionsStore's fetch), and always placed ABOVE the per-category
  // rows -- these are the "look at this" surface, the category rows below
  // are "browse everything".
  const collectionCarousels = useMemo(() => {
    if (topCat !== 'all' || query.trim().length > 0) return [];
    return collections
      .filter((c) => c.active)
      .map((c) => ({ collection: c, items: resolveCollection(c) }))
      .filter((section) => section.items.length > 0);
  }, [topCat, query, collections, resolveCollection]);

  // The categories chip strip is one "All" chip followed by every top-level
  // category. Reversing that whole sequence (rather than transforming the
  // scroller) is what gives the strip its RTL swipe direction -- see the
  // comment at the render site.
  const catChips = useMemo<('all' | Category)[]>(() => ['all', ...categories], [categories]);
  const {
    ordered: orderedCatChips,
    scrollRef: catSliderRef,
    onContentSizeChange: onCatSliderContentSizeChange,
  } = useRtlCarousel(catChips, isRTL);

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
      condition: selection.condition,
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

      {/* New/used -- unlike the sections below (facets.map), this isn't
          scoped to a category, so it's rendered unconditionally rather
          than as one of the per-category FilterFacet entries. Placed
          first: it's a fundamental property of the listing itself, the
          same way price/distance are, and worth seeing before drilling
          into subcategory/area. */}
      <FilterSection
        title={t('home.filters.condition')}
        options={conditionOptions}
        selected={selection.condition}
        onToggle={toggleCondition}
      />

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

  // `header` rides inside the list rather than above it. On the web a
  // FlatList is its own scroll container, so the trackpad only scrolls
  // while the pointer is over it -- move the cursor onto the category row
  // or the page margin and the wheel does nothing, which is what made
  // scrolling the site feel broken unless you kept the pointer over the
  // cards. Anything that should scroll with the page has to be inside the
  // one scrollable, not a sibling of it.
  const renderGrid = (header?: React.ReactNode) => (
    <FlatList
      key={columns}
      ListHeaderComponent={header ? <>{header}</> : null}
      data={filtered}
      keyExtractor={(item) => item.id}
      numColumns={columns}
      style={styles.list}
      columnWrapperStyle={{ justifyContent: 'space-between' }}
      contentContainerStyle={[styles.grid, isDesktop ? styles.gridDesktop : { paddingTop: mobileChromeHeight }]}
      onScroll={!isDesktop ? onChromeScroll : undefined}
      onScrollBeginDrag={!isDesktop ? beginChromeInteraction : undefined}
      onScrollEndDrag={!isDesktop ? endChromeInteraction : undefined}
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

  const grid = renderGrid();

  // Mobile-only "all categories" home view: a vertical stack of per-
  // category carousels (see categoryCarousels above) instead of the
  // combined grid.
  //
  // Windowed FlatList instead of a plain ScrollView+map -- every section
  // used to mount (and start loading all ~10 of its full-size listing
  // photos) the instant the home screen rendered, regardless of whether
  // that section was anywhere near the visible viewport. With up to 13
  // top-level categories that's well over a hundred concurrent image
  // requests competing for the same handful of connections, which is what
  // was actually behind photos taking tens of seconds (or longer) to show
  // up and scrolling/swiping feeling heavy well after the screen first
  // painted -- not a one-time load blip. A conservative initial render +
  // one screen of look-ahead keeps far-off sections from mounting (and
  // fetching) until they're actually about to be scrolled into view.
  // Collection rows (Editor's Picks / Hot Deals / Just Listed) render as a
  // plain header on the same FlatList, above the windowed category rows --
  // there are at most 3 of them (one per collection kind), so they don't
  // need windowing of their own, and putting them in the header keeps them
  // pinned above every category row regardless of how many of those exist.
  const collectionRowsHeader = collectionCarousels.length > 0 ? (
    <>
      {collectionCarousels.map(({ collection, items }) => (
        <CollectionCarouselSection
          key={collection.id}
          collection={collection}
          items={items}
          onSeeAll={() => navigation.navigate('Collection', { slug: collection.slug })}
          onPressListing={(item) => navigation.navigate('ListingDetail', { listingId: item.id })}
        />
      ))}
    </>
  ) : null;

  const carousels = (
    <FlatList
      data={categoryCarousels}
      keyExtractor={({ category }) => category.id}
      style={styles.list}
      contentContainerStyle={[styles.carouselsContent, { paddingTop: mobileChromeHeight }]}
      ListHeaderComponent={collectionRowsHeader}
      onScroll={onChromeScroll}
      onScrollBeginDrag={beginChromeInteraction}
      onScrollEndDrag={endChromeInteraction}
      scrollEventThrottle={16}
      // Android's native ScrollView doesn't support nested scrolling by
      // default -- and every CategoryCarouselSection below nests its own
      // horizontal list inside this outer vertical one. Without this, a
      // vertical swipe that starts or passes over one of those horizontal
      // rows (Vehicles/Properties/Mobiles/...) gets fought over between the
      // two scrollables for gesture ownership, which is what was actually
      // behind the "scrolling acts up" jumping/flicker on-device -- a
      // platform-level Android gap, not a timing/animation issue (that's
      // also real, fixed separately in ScrollChromeContext, but wasn't the
      // cause of this). No-op on iOS/web, safe to always set.
      nestedScrollEnabled
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
      renderItem={({ item: { category, items } }) => (
        <CategoryCarouselSection
          category={category}
          items={items}
          onSeeAll={() => chooseTopCategory(category.id)}
          onPressListing={(item) => navigation.navigate('ListingDetail', { listingId: item.id })}
        />
      )}
    />
  );

  // The language toggle and the points pill. They live in the brand bar on
  // mobile and in the greeting row on desktop -- one place or the other,
  // never both, so they're declared once here rather than written out at
  // each site where the two copies could drift apart.
  const headerControls = (
    <View style={styles.headerActions}>
      {/* The one entry point into ShopsDirectoryScreen that doesn't require
          already knowing a shop's slug or visiting Profile first -- see
          that screen's own header comment for why it exists at all. */}
      <Pressy style={styles.storefrontsBadge} onPress={() => navigation.navigate('Shops')}>
        <Icon name="building" size={13} color={colors.ink} />
        <Text style={styles.pointsText}>{t('home.browseStorefronts')}</Text>
      </Pressy>
      <LanguageSwitch compact />
      <Pressy style={styles.pointsBadge} onPress={() => navigation.navigate('MainTabs')}>
        <Icon name="sparkle" size={13} color={colors.ink} />
        <Text style={styles.pointsText}>{profile.points}</Text>
      </Pressy>
    </View>
  );

  // Greeting ("Good to see you, X") and search bar markup -- shared between
  // desktop (static, normal document flow, unchanged) and mobile (folded
  // into the floating auto-hide chrome below, alongside the category
  // slider -- see mobileChromeHeight/onMobileChromeLayout) so the two
  // copies of this markup can never drift apart. The isDesktop checks
  // inside still do the right thing in both places: on mobile they're
  // simply always false.
  const greetingBlock = (
    <View style={[styles.header, isDesktop && styles.headerDesktop]}>
      <View>
        <Text style={type.soft}>{profile.name && profile.name !== 'You' ? t('home.greeting') : ''}</Text>
        <Text style={[styles.name, isDesktop && styles.nameDesktop]}>{profile.name && profile.name !== 'You' ? profile.name : t('home.welcome')}</Text>
      </View>
      {isDesktop && headerControls}
    </View>
  );

  const searchBlock = (
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
  );

  // Native: interpolate opacity/translateY straight off chromeAnim, which
  // ScrollChromeContext only ever drives via Animated.timing with
  // useNativeDriver -- runs on the UI thread, touches only this node, can't
  // collide with the FlatList's own cell-recycling layout commits the way
  // the old global LayoutAnimation call could (see that file's comment).
  // Web: unchanged from before -- a discrete style flip, animated by the
  // transitionProperty/transitionDuration CSS props already declared on
  // mobileChromeOverlay/mobileChromeOverlayHidden (react-native-web turns
  // those into real CSS transitions on its own); chromeAnim is never
  // driven or read on web, so this branch doesn't touch it.
  const mobileChromeOverlayAnimStyle =
    Platform.OS === 'web'
      ? !chromeVisible && styles.mobileChromeOverlayHidden
      : {
          opacity: chromeAnim,
          transform: [{ translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
        };

  // Mobile-only: greeting and search bar side by side on one row instead
  // of stacked on two (greetingBlock/searchBlock above stay as they are,
  // for desktop's separate stacked layout). Sharing one row -- rather than
  // the category slider simply moving up to fill the space a separate
  // search row used to occupy -- is what actually frees that vertical
  // space for it to move into; mirrorRow flips the row for Arabic the same
  // way brandBar above it does. numberOfLines=1 on both greeting lines is
  // a safety net now that they share the row with the search bar instead
  // of having the full width to themselves -- a long name truncates
  // instead of squeezing the search input down to nothing.
  const mobileGreetingSearchRow = (
    <View style={[styles.mobileGreetingRow, mirrorRow(isRTL)]}>
      <View style={styles.mobileGreetingText}>
        <Text style={type.soft} numberOfLines={1}>{profile.name && profile.name !== 'You' ? t('home.greeting') : ''}</Text>
        <Text style={styles.name} numberOfLines={1}>{profile.name && profile.name !== 'You' ? profile.name : t('home.welcome')}</Text>
      </View>
      <View style={styles.mobileSearchRow}>
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
    </View>
  );

  return (
    <Screen reserveSidebar maxWidth={1180}>
      {/* Mobile brand bar. Desktop has no equivalent because the sidebar
          already carries the lockup permanently -- on a phone there is no
          sidebar, so before this the brand was visible exactly once, on the
          first-run language picker, and never again. Mobile web is the
          weaker case of the two: no app icon on a home screen doing the
          remembering, just a browser tab.

          The language and points controls move up here on mobile so the
          bar earns its height rather than only holding a logo, which
          leaves the greeting below on a line of its own. */}
      {!isDesktop && (
        <View style={[styles.brandBar, mirrorRow(isRTL)]}>
          <BrandMark variant="sidebar" onPress={goHome} />
          {headerControls}
        </View>
      )}

      {/* On mobile, the greeting and search bar move into the floating
          auto-hide chrome below (with the category slider) instead of
          rendering here in normal flow -- see mobileChromeOverlay. Desktop
          keeps them exactly where they've always been; nothing there
          auto-hides. */}
      {isDesktop && (
        <>
          {greetingBlock}
          {searchBlock}
        </>
      )}

      {isDesktop ? (
        // Desktop is unchanged: a big tile grid at "all", a persistent
        // left sidebar of facet filters once a category is picked. Plenty
        // of vertical room there already -- this redesign is mobile-only.
        topCat === 'all' ? (
          renderGrid(
            /* One scrollable row, same as mobile, rather than a wrapping
               grid. Thirteen categories over six columns spilled onto a
               third row, which pushed the listings themselves below the
               fold on a laptop -- the categories are navigation, not the
               content, and they shouldn't cost half the first screen.

               collectionRowsHeader (Editor's Picks / Hot Deals / Just
               Listed) rides above this same header slot -- it was
               originally wired only into the MOBILE carousels composite
               below, which this desktop branch never touches at all (see
               "Desktop is unchanged" above), so on desktop the collection
               rows silently never rendered. Prepending it here is what
               actually puts them above the category strip on desktop too. */
            <>
              {collectionRowsHeader}
              <CarouselArrows
                onScrollBy={(delta) => {
                  catRowX.current = Math.max(0, catRowX.current + delta);
                  catRowRef.current?.scrollTo({ x: catRowX.current, animated: true });
                }}
                // Roughly three chips a press: enough to feel like progress,
                // little enough that nothing scrolls past unseen.
                step={88 * 3}
                canScrollBack={catRowEnds.back}
                canScrollForward={catRowEnds.forward}
                style={styles.catRowDesktop}
              >
                <ScrollView
                  ref={catRowRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  onScroll={(e) => {
                    catRowX.current = e.nativeEvent.contentOffset.x;
                    catRowMetrics.current.x = catRowX.current;
                    updateCatRowEnds();
                  }}
                  onLayout={(e) => {
                    catRowMetrics.current.viewport = e.nativeEvent.layout.width;
                    updateCatRowEnds();
                  }}
                  onContentSizeChange={(w) => {
                    catRowMetrics.current.content = w;
                    updateCatRowEnds();
                  }}
                  scrollEventThrottle={16}
                  style={styles.catRowDesktopScroll}
                  contentContainerStyle={styles.catRowDesktopContent}
                >
                  {categories.map((c) => (
                    <CategoryCard key={c.id} category={c} width={88} onPress={() => chooseTopCategory(c.id)} />
                  ))}
                </ScrollView>
              </CarouselArrows>
            </>
          )
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

          {/* carouselsAnchor is the positioning root for mobileChromeOverlay
              below (position: absolute positions relative to the nearest
              parent View regardless of whether it declares
              position:'relative' -- that's just how RN works, unlike web
              CSS -- so the overlay needs to share a parent with exactly the
              content it overlays, not the whole screen, or `top: 0` would
              land under the brand bar instead of at the top of the list). */}
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
                doesn't start out from under it while visible.

                Bundles the greeting+search row and the category slider into
                ONE overlay (rather than two separately floating pieces) so
                they hide and reappear as a single unit, and so there's one
                height to measure/reserve rather than two. Height isn't
                fixed in the stylesheet -- the greeting text's length varies
                by name/locale -- so it's measured on layout and mirrored
                into mobileChromeHeight, which carouselsContent/grid's
                paddingTop then matches. mobileChromeHeight starts at a
                reasonable estimate (MOBILE_CHROME_DEFAULT_HEIGHT) so the
                very first frame, before onLayout has fired, doesn't reserve
                zero space and let a card flash in from underneath. */}
            <Animated.View
              style={[styles.mobileChromeOverlay, mobileChromeOverlayAnimStyle]}
              pointerEvents={chromeVisible ? 'auto' : 'none'}
              onLayout={(e) => {
                const h = Math.round(e.nativeEvent.layout.height);
                if (h > 0 && h !== mobileChromeHeight) setMobileChromeHeight(h);
              }}
            >
              {mobileGreetingSearchRow}

              {/* RTL swipe direction here is done by reversing the chip
                  ORDER and parking the viewport at the far end, not by
                  mirroring the scroller with scaleX(-1) and counter-
                  flipping every chip -- see CategoryCarouselSection for the
                  full reasoning (transforms block Android view flattening
                  and invert the list clipping math). Same result: "All"
                  sits at the right edge and dragging rightward walks
                  leftward through the categories. */}
              <ScrollView
                ref={catSliderRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.catSlider}
                contentContainerStyle={styles.catSliderContent}
                onContentSizeChange={onCatSliderContentSizeChange}
              >
                {orderedCatChips.map((c) =>
                  c === 'all' ? (
                    <Pressy key="all" onPress={clearAllCategories} style={[styles.allChip, topCat === 'all' && styles.allChipActive]}>
                      <View style={[styles.allChipIconWrap, topCat === 'all' && styles.allChipIconWrapActive]}>
                        <Icon name="grip" size={20} color={topCat === 'all' ? colors.primary : colors.bg} />
                      </View>
                      <Text style={[styles.allChipText, topCat === 'all' && styles.allChipTextActive]} numberOfLines={1}>
                        {t('common.all')}
                      </Text>
                    </Pressy>
                  ) : (
                    <CategoryCard key={c.id} category={c} width={72} selected={topCat === c.id} onPress={() => chooseTopCategory(c.id)} />
                  )
                )}
              </ScrollView>
            </Animated.View>
          </View>

          <Modal visible={mobileFiltersOpen} animationType="slide" onRequestClose={() => setMobileFiltersOpen(false)}>
            <Screen>
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
  // Mobile only -- see mobileGreetingSearchRow. Greeting text and search
  // bar share this one row instead of stacking on two, freeing the height
  // a separate search row used to take up for the category slider to move
  // up into. justifyContent isn't needed here: mobileGreetingText doesn't
  // flex/grow, and mobileSearchRow's flex:1 is what actually claims
  // whatever width the greeting text (also capped via flexShrink) leaves
  // behind -- the two divide the row between them on their own.
  mobileGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
  },
  // flexShrink (not a fixed maxWidth) lets a short name give almost all
  // the row to the search bar and a long one give up only as much as it
  // has to -- numberOfLines=1 on both lines at the render site is what
  // actually stops an overlong name from wrapping instead of truncating.
  mobileGreetingText: { flexShrink: 1 },
  // Smaller/plainer variant of searchRow below (44 vs 46 tall, no
  // marginHorizontal/marginBottom of its own) -- it's sharing a row with
  // the greeting now instead of spanning the full width on its own line,
  // so its own spacing comes from mobileGreetingRow's padding/gap instead.
  mobileSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    height: 44,
  },
  // Mobile only -- see the render site. A hairline underneath rather than a
  // filled bar, so it reads as chrome sitting above the page instead of a
  // second surface competing with the cards below it.
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    marginBottom: 4,
  },
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
  storefrontsBadge: {
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
  // flexGrow:0 matters: a horizontal ScrollView with no height of its own
  // stretches to fill the parent and swallows the listings below it.
  catRowDesktop: { marginBottom: 6 },
  catRowDesktopScroll: { flexGrow: 0 },
  catRowDesktopContent: { gap: 18, paddingHorizontal: 2, paddingBottom: 4 },

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
  catSliderContent: { paddingHorizontal: 18, gap: 10, alignItems: 'flex-start' },
  // Positioning root shared by mobileChromeOverlay (absolute) and the
  // scrollable content it overlays -- see the render-side comment on
  // carouselsAnchor.
  carouselsAnchor: { flex: 1, position: 'relative' },
  // Auto-hide overlay (see ScrollChromeContext and the render-side comment
  // above) -- bundles the greeting+search row and the category slider into
  // one floating unit above carouselsAnchor's scrollable content instead of
  // either sitting in normal flow next to it, so hiding/showing them can
  // never resize that content's own box. No fixed height here (unlike the
  // old catSliderWrap this replaces) -- the greeting text's length varies
  // by name/locale, so the box sizes to its own content and that height is
  // measured on layout into mobileChromeHeight, which carouselsContent/
  // grid's paddingTop then matches, so content doesn't start out from
  // under it while visible. paddingBottom is breathing room after the
  // category chips (the last thing in the overlay) before its bottom edge
  // -- without it the chips sat flush against wherever the listing content
  // scrolls up to underneath, reported as feeling cramped. Opaque
  // background (matches the screen bg) since content now scrolls behind
  // it, not just below it. Web-only CSS transition props still drive the
  // fade/slide smoothly on the web build (react-native-web interprets
  // them); on native, this View is rendered as an Animated.View instead
  // (see mobileChromeOverlayAnimStyle) and chromeAnim takes over for the
  // same effect -- opacity/transform below are just this style's resting
  // (fully shown) values, overridden per-frame by whichever branch applies.
  mobileChromeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    zIndex: 5,
    backgroundColor: colors.bg,
    opacity: 1,
    transform: [{ translateY: 0 }],
    transitionProperty: 'opacity, transform',
    transitionDuration: '220ms',
    transitionTimingFunction: 'ease-out',
  } as ViewStyle,
  mobileChromeOverlayHidden: {
    opacity: 0,
    transform: [{ translateY: -16 }],
  },
  // Borderless, matching CategoryCard's redesigned chip below -- a plain
  // icon circle with its label underneath, no card enclosure.
  allChip: {
    width: 72, alignItems: 'center', justifyContent: 'flex-start', gap: 8,
  },
  allChipActive: {},
  // Matches CategoryCard's icon circle exactly -- these two sit side by
  // side in the same strip, so any drift between them is immediately
  // visible. Green disc, cream glyph, accent disc when selected.
  allChipIconWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  // Must stay identical to CategoryCard's iconWrapSelected -- these two sit
  // side by side in the same strip, so any drift between them is visible
  // as one chip selecting differently from the rest. See the note there.
  allChipIconWrapActive: { backgroundColor: colors.accentTint, borderWidth: 2, borderColor: colors.accentRing },
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
  //
  // The gutter is deliberately wide. At 28 the two columns read as one
  // block: the price row and the distance slider both run the full 240
  // and their right ends landed almost against the first card, so the
  // filters looked like they were being crowded out by the grid rather
  // than sitting beside it. Whitespace is what separates them -- there is
  // no divider or panel background here -- so it has to be enough to do
  // that job on its own. It costs the grid 44px, which the four columns
  // absorb as ~11px each.
  body: { flex: 1 },
  bodyDesktop: { flexDirection: 'row', gap: 72 },
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
  numberPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  numberPillText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  numberPillTextActive: { color: colors.white },

  fixedSection: { marginBottom: 24 },
  fixedTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, color: colors.ink },
  priceBoxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceBox: {
    // minWidth 0 is what makes `flex: 1` actually mean "share the row".
    // On the web a TextInput is an <input>, and an input's default
    // min-content width is about 198px -- with min-width:auto a flex item
    // refuses to shrink below that, so two of them plus the dash needed
    // ~410px inside a 240px sidebar. The overflow ran under the listings
    // grid, which is why the filters looked half-eaten.
    flex: 1, minWidth: 0,
    height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 10, fontSize: 13, color: colors.ink,
  },
  priceDash: { color: colors.inkSoft },
  setPriceBtn: {
    height: 36, paddingHorizontal: 14, borderRadius: radius.sm,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
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
  empty: { alignItems: 'center', paddingTop: 60, gap: 4 },
  // Per-category carousels (mobile "all categories" home view) -- each
  // CategoryCarouselSection carries its own horizontal padding, so this
  // only needs bottom breathing room (the same tab-bar clearance the
  // combined grid has). Top space for mobileChromeOverlay is added
  // separately as an inline paddingTop (mobileChromeHeight) at the render
  // site, on both this and `grid` -- it's measured rather than fixed here
  // since the overlay's height now varies (greeting text length), so a
  // static stylesheet number can't track it.
  carouselsContent: { paddingBottom: 110 },

  // Mobile filters modal.
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 52 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { paddingHorizontal: 18, paddingBottom: 30 },
  modalFooter: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line },
});
