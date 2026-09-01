import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, FlatList, Image, Modal, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import ListingCard, { ListingCardSpacer } from '../components/ListingCard';
import { padRowsToFullColumns, gridRowKey } from '../lib/gridRows';
import FacetChipGroup, { ChipOption } from '../components/FacetChipGroup';
import RangeSlider from '../components/RangeSlider';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useListingGridColumns, useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { pickText } from '../lib/listingText';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { CategoryAttribute, Listing, Shop } from '../types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';
import { shareLink } from '../lib/share';

type Props = NativeStackScreenProps<RootStackParamList, 'Storefront'>;

function dbShopToLocal(row: any): Shop {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    nameEn: row.name_en,
    nameAr: row.name_ar ?? null,
    taglineEn: row.tagline_en ?? null,
    taglineAr: row.tagline_ar ?? null,
    logoUrl: row.logo_url ?? null,
    coverUrl: row.cover_url ?? null,
    governorate: row.governorate ?? null,
    caza: row.caza ?? null,
    addressLine: row.address_line ?? null,
    whatsapp: row.whatsapp ?? null,
    phone: row.phone ?? null,
    primaryCategoryId: row.primary_category_id ?? null,
    // Not selected by this screen's query -- a merchant's own posting
    // setting is no business of a visitor's view, and myazar.shops is
    // granted per column: asking for a column this page never reads is
    // one missed grant away from every storefront reading as not-found.
    domainId: null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).getTime() : null,
    // Not selected by this screen's query -- see the query comment above.
    // Private bookkeeping for the owner, not something a public storefront
    // view has any use for.
    verificationNote: null,
  };
}

// A merchant-authored saved filter (shop_collections) -- e.g. "Under
// $50" or "New arrivals". Display/apply-only here: there is no authoring
// UI for these yet, so `collections` below is simply empty for every shop
// today and this whole row quietly doesn't render. The `filter` shape is
// this screen's own guess at what an eventual authoring UI would write --
// deliberately just facetValues + price (no number-range facets), since a
// saved preset is meant to be a small, stable bookmark, not a snapshot of
// every control on the page.
type CollectionRow = {
  id: string;
  labelEn: string;
  labelAr: string;
  filter: { facetValues?: Record<string, string[]>; priceMin?: number; priceMax?: number };
};

// One rendered filter control, already resolved against this shop's own
// active stock. 'chips' covers select/multiselect/text/boolean (all OR-
// matched the same way HomeScreen's facet engine already does); 'number'
// gets a min/max RangeSlider instead of the fixed "N+" pill row
// HomeScreen uses, since a single shop's own attribute spread is small
// enough that a real range reads better than one fixed threshold.
type ResolvedFacet =
  | { kind: 'chips'; attr: CategoryAttribute; options: ChipOption[] }
  | { kind: 'number'; attr: CategoryAttribute; min: number; max: number };

// A dedicated, linkable page per storefront -- reached by tapping a
// storefront listing card's name pill, or the storefront panel on
// ListingDetail. Mirrors SellerProfileScreen (avatar/hero -> grid -> share)
// one-for-one, since a shop is the same "here's everything this identity
// has live" shape as a seller, just with shop-specific fields (logo,
// tagline, location) instead of a plain avatar.
//
// Filtering follows the storefronts plan's specific layout rules: only
// the top two filter_priority attribute facets (by category admin
// config) stay inline on screen, everything else lives behind an "All
// filters" drawer; a facet with fewer than two distinct values among
// this shop's own active stock doesn't render at all; price is always
// inline, platform-level, not part of that priority list. Uses
// FacetChipGroup (chip visual language, per the approved mockup) rather
// than HomeScreen's FilterSection sidebar -- a deliberate divergence, see
// FacetChipGroup's own header comment.
export default function StorefrontScreen({ route, navigation }: Props) {
  const goBack = useGoBack();
  const { shopSlug } = route.params;
  const { listings } = useAppStore();
  const { resolveAttributesForCategory } = useSettings();
  const { t, language } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setShop(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    (async () => {
      try {
        // shops isn't part of AppStore's cache (unlike listings/profile) --
        // there's no standing reason to keep every shop in memory for the
        // rare visit to one storefront, so this is a plain direct read
        // every time, the same shape as SellerProfileScreen's fallback
        // profiles read. RLS (shops_select) already limits this to
        // verified shops (or the owner's own, or an admin's) -- an
        // unverified shop's slug simply comes back as "not found" to
        // anyone but its owner, exactly the behaviour this screen wants.
        const { data } = await supabase
          .from('shops')
          .select('id, owner_id, slug, name_en, name_ar, tagline_en, tagline_ar, logo_url, cover_url, governorate, caza, address_line, whatsapp, phone, primary_category_id, verified_at')
          .eq('slug', shopSlug)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (cancelled) return;
        setShop(data ? dbShopToLocal(data) : null);
      } catch {
        // Offline, backend unreachable, or the 8s timeout above fired --
        // notFoundTitle is shown below.
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [shopSlug]);

  // The listings this shop currently has live -- same "what a buyer can
  // actually see" filter as SellerProfileScreen's sellerListings.
  const shopListings = useMemo(
    () => (shop ? listings.filter((l) => l.shopId === shop.id && l.status === 'active') : []),
    [listings, shop]
  );

  // Only this category's admin-configured filter_priority attributes, in
  // priority order -- the same source HomeScreen's own facet engine
  // reads (resolveAttributesForCategory), reused rather than duplicated.
  // A shop with no primary category (shouldn't happen for a verified
  // shop, but the field is nullable) simply gets no attribute facets.
  const filterableAttrs = useMemo(
    () =>
      shop?.primaryCategoryId
        ? resolveAttributesForCategory(shop.primaryCategoryId)
            .filter((a) => a.filterPriority != null)
            .sort((a, b) => (a.filterPriority as number) - (b.filterPriority as number))
        : [],
    [shop, resolveAttributesForCategory]
  );

  // Chip options (and their counts) are derived from THIS shop's own
  // active listings, never a fixed global option list -- so a chip is
  // never shown that would return zero results, and its count is always
  // literally true. Mirrors HomeScreen's attributeOptions, generalized
  // from "options present in this scope" to "options present in this
  // shop's stock, with counts".
  const optionsForAttr = (attr: CategoryAttribute): ChipOption[] => {
    const labelFor = (v: string) => {
      const opt = attr.options.find((o) => o.value === v);
      return opt ? pickText(opt.labelEn, opt.labelAr, language) : v;
    };
    const counts = new Map<string, number>();
    if (attr.type === 'boolean') {
      for (const l of shopListings) {
        if (l.attributes[attr.slug] === undefined) continue;
        const key = String(!!l.attributes[attr.slug]);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const opts: ChipOption[] = [];
      if (counts.has('true')) opts.push({ key: 'true', label: t('common.yes'), count: counts.get('true')! });
      if (counts.has('false')) opts.push({ key: 'false', label: t('common.no'), count: counts.get('false')! });
      return opts;
    }
    if (attr.type === 'multiselect') {
      for (const l of shopListings) {
        const v = l.attributes[attr.slug];
        const arr = Array.isArray(v) ? v.map(String) : [];
        for (const val of arr) counts.set(val, (counts.get(val) || 0) + 1);
      }
    } else {
      // select / text
      for (const l of shopListings) {
        const v = l.attributes[attr.slug];
        if (v === undefined || v === null || v === '') continue;
        counts.set(String(v), (counts.get(String(v)) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: labelFor(key), count }))
      .sort((a, b) => b.count - a.count);
  };

  // The plan's dead-facet-suppression rule applied in one pass: fewer
  // than two distinct values among this shop's own active stock means
  // there's nothing to actually filter, so the facet doesn't render.
  const resolvedFacets = useMemo<ResolvedFacet[]>(() => {
    const out: ResolvedFacet[] = [];
    for (const attr of filterableAttrs) {
      if (attr.type === 'number') {
        const values = shopListings
          .map((l) => l.attributes[attr.slug])
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const distinct = new Set(values);
        if (distinct.size < 2) continue;
        out.push({ kind: 'number', attr, min: Math.min(...values), max: Math.max(...values) });
      } else {
        const options = optionsForAttr(attr);
        if (options.length < 2) continue;
        out.push({ kind: 'chips', attr, options });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterableAttrs, shopListings, language]);

  // Only the top two stay on screen; the rest live behind "All filters".
  const inlineFacets = resolvedFacets.slice(0, 2);
  const drawerFacets = resolvedFacets.slice(2);

  const priceBounds = useMemo(() => {
    const prices = shopListings.map((l) => l.price).filter((p) => Number.isFinite(p) && p > 0);
    const max = prices.length > 0 ? Math.max(...prices) : 1000;
    return { min: 0, max: Math.max(100, Math.ceil(max / 50) * 50) };
  }, [shopListings]);

  const [facetValues, setFacetValues] = useState<Record<string, string[]>>({});
  const [numberRanges, setNumberRanges] = useState<Record<string, { min: number; max: number }>>({});
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionRow[]>([]);

  useEffect(() => {
    if (!shop) {
      setCollections([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // shop_collections_select already scopes this to verified (or the
      // owner's own) shops -- same RLS shape as everything else this
      // screen reads. There's no authoring UI yet, so today this is
      // always empty and the collections row simply doesn't render.
      const { data } = await supabase
        .from('shop_collections')
        .select('id, label_en, label_ar, filter')
        .eq('shop_id', shop.id)
        .order('sort_order');
      if (!cancelled) {
        setCollections(
          (data || []).map((r: any) => ({
            id: r.id,
            labelEn: r.label_en,
            labelAr: r.label_ar,
            filter: r.filter || {},
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop?.id]);

  const toggleFacetValue = (slug: string, value: string) => {
    setActiveCollectionId(null);
    setFacetValues((prev) => {
      const cur = prev[slug] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [slug]: next };
    });
  };

  const setNumberRange = (slug: string, lo: number, hi: number) => {
    setActiveCollectionId(null);
    setNumberRanges((prev) => ({ ...prev, [slug]: { min: lo, max: hi } }));
  };

  const setPriceRange = (lo: number, hi: number) => {
    setActiveCollectionId(null);
    setPriceMin(lo);
    setPriceMax(hi);
  };

  const clearAll = () => {
    setActiveCollectionId(null);
    setFacetValues({});
    setNumberRanges({});
    setPriceMin(null);
    setPriceMax(null);
  };

  const applyCollection = (c: CollectionRow) => {
    setActiveCollectionId(c.id);
    setFacetValues(c.filter.facetValues || {});
    setNumberRanges({});
    setPriceMin(c.filter.priceMin ?? null);
    setPriceMax(c.filter.priceMax ?? null);
  };

  const matchesFacets = (l: Listing): boolean => {
    for (const f of resolvedFacets) {
      const attr = f.attr;
      if (f.kind === 'number') {
        const range = numberRanges[attr.slug];
        if (!range) continue;
        const raw = l.attributes[attr.slug];
        const num = typeof raw === 'number' ? raw : NaN;
        if (!(num >= range.min && num <= range.max)) return false;
        continue;
      }
      const vals = facetValues[attr.slug];
      if (!vals || vals.length === 0) continue;
      if (attr.type === 'boolean') {
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

  const filteredListings = useMemo(
    () =>
      shopListings.filter((l) => {
        if (!matchesFacets(l)) return false;
        if (priceMin != null && l.price < priceMin) return false;
        if (priceMax != null && l.price > priceMax) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shopListings, resolvedFacets, facetValues, numberRanges, priceMin, priceMax]
  );

  const hasAnyActiveFilter =
    Object.values(facetValues).some((v) => v.length > 0) ||
    Object.keys(numberRanges).length > 0 ||
    priceMin != null ||
    priceMax != null;

  const hiddenActiveCount = drawerFacets.filter((f) =>
    f.kind === 'number' ? !!numberRanges[f.attr.slug] : (facetValues[f.attr.slug] || []).length > 0
  ).length;

  const renderFacet = (f: ResolvedFacet) => {
    const attr = f.attr;
    const label = pickText(attr.labelEn, attr.labelAr, language);
    if (f.kind === 'number') {
      const range = numberRanges[attr.slug] || { min: f.min, max: f.max };
      const unit = pickText(attr.unitEn || '', attr.unitAr || '', language);
      return (
        <View key={attr.slug} style={styles.numberSection}>
          <Text style={styles.numberTitle}>{label}</Text>
          <RangeSlider
            mode="range"
            min={f.min}
            max={f.max}
            valueMin={range.min}
            valueMax={range.max}
            onChange={(lo, hi) => setNumberRange(attr.slug, lo, hi)}
          />
          <Text style={styles.numberRangeText}>
            {range.min}
            {unit ? ` ${unit}` : ''} – {range.max}
            {unit ? ` ${unit}` : ''}
          </Text>
        </View>
      );
    }
    return (
      <FacetChipGroup
        key={attr.slug}
        title={label}
        options={f.options}
        selected={facetValues[attr.slug] || []}
        onToggle={(v) => toggleFacetValue(attr.slug, v)}
        mode={attr.type === 'select' ? 'single' : 'multi'}
      />
    );
  };

  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle');

  // Was a hand-rolled web-only implementation (window.location.origin +
  // navigator.share/clipboard) that silently no-op'd on native -- none of
  // those globals exist in React Native, so tapping this on the app always
  // fell through to the "error" branch without ever opening anything. See
  // shareLink (src/lib/share.ts) for the shared cross-platform version:
  // RN's own Share module on native, the same web-API branches as before
  // on web. Only 'copied'/'error' still drive this screen's own inline
  // button-text feedback -- 'shared'/'dismissed' mean the native share
  // sheet (native) or the browser's share sheet (web) already gave the
  // user their own feedback, so there's nothing left for this state to do.
  const handleShare = async () => {
    if (!shop) return;
    const shopName = pickText(shop.nameEn, shop.nameAr || '', language);
    const outcome = await shareLink({
      path: `/shop/${shop.slug}`,
      title: shopName,
      text: t('storefront.shareText', { name: shopName }),
    });
    if (outcome === 'copied' || outcome === 'error') {
      setShareState(outcome);
      setTimeout(() => setShareState('idle'), 2000);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <HomeMarkButton />
      <Text style={type.title}>{t('listingDetail.storefront')}</Text>
    </View>
  );

  if (loading) {
    return (
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  if (!shop) {
    return (
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="building" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('storefront.notFoundTitle')}</Text>
        </View>
      </Screen>
    );
  }

  const shopName = pickText(shop.nameEn, shop.nameAr || '', language);
  const tagline = pickText(shop.taglineEn || '', shop.taglineAr || '', language);
  const location = [shop.caza, shop.governorate].filter(Boolean).join(', ');

  const hero = (
    <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
      <View style={styles.avatar}>
        {shop.logoUrl ? (
          <Image source={{ uri: shop.logoUrl }} style={styles.logoImg} />
        ) : (
          <Icon name="building" size={24} color={colors.white} />
        )}
      </View>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{shopName}</Text>
        {shop.verifiedAt != null && (
          <View style={styles.verifiedBadge}>
            <Icon name="checkCircle" size={11} color={colors.success} />
            <Text style={styles.verifiedBadgeText}>{t('listingDetail.verifiedSeller')}</Text>
          </View>
        )}
      </View>
      {!!tagline && <Text style={styles.tagline} numberOfLines={2}>{tagline}</Text>}
      {!!location && (
        <View style={styles.locationRow}>
          <Icon name="location" size={12} color="rgba(255,255,255,0.65)" />
          <Text style={styles.locationText}>{location}</Text>
        </View>
      )}
      <View style={styles.adsPill}>
        <Text style={styles.adsPillText}>{t('storefront.inStock', { count: shopListings.length })}</Text>
      </View>
      <Pressy onPress={handleShare} style={styles.shareBtn}>
        <Icon name="share" size={14} color={colors.white} />
        <Text style={styles.shareBtnText}>
          {shareState === 'copied'
            ? t('storefront.linkCopied')
            : shareState === 'error'
              ? t('storefront.shareFailed')
              : t('storefront.shareStorefront')}
        </Text>
      </Pressy>
    </LinearGradient>
  );

  // Collections row + inline facets (top two + always-inline price) +
  // the "All filters" drawer trigger. Only renders when this shop has
  // active stock at all -- an empty shop has nothing to filter.
  const filterBar = shopListings.length > 0 && (
    <View style={styles.filterBar}>
      {collections.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionsScroll}>
          {collections.map((c) => {
            const active = activeCollectionId === c.id;
            return (
              <Pressy
                key={c.id}
                onPress={() => (active ? clearAll() : applyCollection(c))}
                style={[styles.collectionChip, active && styles.collectionChipActive]}
              >
                <Text style={[styles.collectionChipText, active && styles.collectionChipTextActive]}>
                  {pickText(c.labelEn, c.labelAr, language)}
                </Text>
              </Pressy>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.inlineFacetsRow}>
        {inlineFacets.map(renderFacet)}
        <View style={styles.numberSection}>
          <Text style={styles.numberTitle}>{t('home.filters.price')}</Text>
          <RangeSlider
            mode="range"
            min={priceBounds.min}
            max={priceBounds.max}
            step={Math.max(1, Math.round(priceBounds.max / 100))}
            valueMin={priceMin ?? priceBounds.min}
            valueMax={priceMax ?? priceBounds.max}
            onChange={setPriceRange}
          />
        </View>
      </View>
      <View style={styles.filterBarActions}>
        {drawerFacets.length > 0 && (
          <Pressy onPress={() => setFiltersModalOpen(true)} style={styles.allFiltersBtn}>
            <Icon name="gear" size={13} color={colors.ink} />
            <Text style={styles.allFiltersBtnText}>
              {hiddenActiveCount > 0 ? t('storefront.allFiltersCount', { n: hiddenActiveCount }) : t('storefront.allFilters')}
            </Text>
          </Pressy>
        )}
        {(hasAnyActiveFilter || activeCollectionId) && (
          <Pressy onPress={clearAll}>
            <Text style={styles.clearLink}>{t('home.filters.clearAll')}</Text>
          </Pressy>
        )}
      </View>
    </View>
  );

  const listHeader = (
    <>
      {header}
      {hero}
      {filterBar}
      <Text style={styles.sectionLabel}>{t('storefront.listings', { count: filteredListings.length })}</Text>
    </>
  );

  return (
    <Screen maxWidth={1180}>
      <FlatList
        key={columns}
        data={padRowsToFullColumns(filteredListings, columns)}
        keyExtractor={gridRowKey}
        numColumns={columns}
        // columnWrapperStyle is ONLY legal when numColumns > 1: FlatList's own
        // _checkProps throws "columnWrapperStyle not supported for single column
        // lists" via invariant(), which is NOT stripped in production. Without
        // this guard a one-column grid is a red screen on native and a blank
        // page on web -- on every listing surface in the app.
        columnWrapperStyle={columns > 1 && filteredListings.length > 0 ? { justifyContent: 'space-between' } : undefined}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        ListEmptyComponent={
          <View style={styles.emptyListings}>
            <Text style={[type.soft, styles.emptyListingsText]}>
              {shopListings.length === 0 ? t('storefront.noActiveListings') : t('storefront.noFilterMatches')}
            </Text>
          </View>
        }
        // A null item is the padding that keeps a short last row full --
        // see padRowsToFullColumns. It renders an empty box exactly one
        // card wide, so space-between spaces the row the same way it
        // spaces a full one instead of throwing two results to opposite
        // ends of the grid.
        renderItem={({ item }) =>
          item ? (
            <ListingCard columns={columns} listing={item} onPress={() => navigation.push('ListingDetail', { listingId: item.id })} />
          ) : (
            <ListingCardSpacer columns={columns} />
          )
        }
      />

      <Modal visible={filtersModalOpen} animationType="slide" onRequestClose={() => setFiltersModalOpen(false)}>
        <Screen>
          <View style={styles.modalTopBar}>
            <Text style={type.h3}>{t('home.filters.filters')}</Text>
            <Pressy onPress={() => setFiltersModalOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll}>{drawerFacets.map(renderFacet)}</ScrollView>
          <View style={styles.modalFooter}>
            <Button
              label={t('home.filters.showResultsCount', { n: filteredListings.length })}
              onPress={() => setFiltersModalOpen(false)}
              style={{ flex: 1 }}
            />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hero: { marginHorizontal: 18, borderRadius: radius.xl, padding: 22, alignItems: 'center', marginTop: 4, marginBottom: 10 },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  name: { fontSize: 19, fontWeight: '700', color: colors.white },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: radius.pill, paddingHorizontal: 8, height: 20,
  },
  verifiedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.success },
  tagline: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center', paddingHorizontal: 10 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locationText: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  adsPill: {
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill,
    paddingHorizontal: 12, height: 26, justifyContent: 'center', marginTop: 14,
  },
  adsPillText: { fontSize: 12, fontWeight: '700', color: colors.white },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: radius.pill,
    paddingHorizontal: 16, height: 36, marginTop: 16,
  },
  shareBtnText: { fontSize: 13, fontWeight: '700', color: colors.white },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, paddingHorizontal: 18 },
  grid: { paddingHorizontal: 18, paddingBottom: 110 },
  gridDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptyListings: { paddingHorizontal: 18, paddingVertical: 20 },
  emptyListingsText: { textAlign: 'center' },

  filterBar: { paddingHorizontal: 18, marginBottom: 16 },
  collectionsScroll: { gap: 8, paddingBottom: 12 },
  collectionChip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  collectionChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  collectionChipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  collectionChipTextActive: { color: colors.white },
  inlineFacetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  filterBarActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  allFiltersBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  allFiltersBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  clearLink: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
  numberSection: { minWidth: 200, flexGrow: 1 },
  numberTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, color: colors.ink },
  numberRangeText: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 52 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { paddingHorizontal: 18, paddingBottom: 30 },
  modalFooter: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line },
});
