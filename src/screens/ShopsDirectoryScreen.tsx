import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import { padRowsToFullColumns, gridRowKey } from '../lib/gridRows';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useGridColumns, useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { pickText } from '../lib/listingText';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { Shop } from '../types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';
import { mirrorRow } from '../lib/mirrorRow';
import ShopCategoryFilterModal from '../components/ShopCategoryFilterModal';

type Props = NativeStackScreenProps<RootStackParamList, 'Shops'>;

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
    coverUrl: null,
    governorate: row.governorate ?? null,
    caza: row.caza ?? null,
    addressLine: null,
    whatsapp: null,
    phone: null,
    primaryCategoryId: row.primary_category_id ?? null,
    // Not selected by this screen's query -- a merchant's own posting
    // setting is no business of a directory card.
    domainId: null,
    verifiedAt: row.verified_at ? new Date(row.verified_at).getTime() : null,
    verificationNote: null,
  };
}

// The public "browse every verified shop" directory -- the entry point
// storefronts never had before this: until now the only way to ever land
// on a shop's page was already knowing its slug (a shared link, or tapping
// through from one of its own listings). Reached from ProfileScreen's
// "Browse storefronts" row and HomeScreen's header icon (see those files).
//
// Mirrors AdminShopsScreen's fetch (same shops columns, same
// owner-agnostic list) but scoped to what shops_select's RLS already
// leaves a plain visitor: verified_at is not null -- there is no
// filter/status chip row here the way the admin queue has one, since a
// visitor never has any reason to see an unverified shop at all.
export default function ShopsDirectoryScreen({ navigation }: Props) {
  const goBack = useGoBack();
  const { listings } = useAppStore();
  const { childrenOf, categoryById } = useSettings();
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useGridColumns(2, 4);

  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('shops')
        .select('id, owner_id, slug, name_en, name_ar, tagline_en, tagline_ar, logo_url, governorate, caza, primary_category_id, verified_at')
        .not('verified_at', 'is', null)
        .order('name_en', { ascending: true });
      if (!cancelled) {
        setShops((data || []).map(dbShopToLocal));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-count each shop's own active listings from AppStore's already-
  // loaded site-wide listings cache (the same source HomeScreen browses)
  // rather than a second query per shop -- mirrors StorefrontScreen's own
  // shopListings computation, just keyed by every shop at once instead of
  // just one.
  const listingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of listings) {
      if (!l.shopId || l.status !== 'active') continue;
      counts.set(l.shopId, (counts.get(l.shopId) || 0) + 1);
    }
    return counts;
  }, [listings]);

  const topCategories = useMemo(() => childrenOf(null), [childrenOf]);
  // Only categories at least one verified shop actually uses show up as a
  // filter chip -- same dead-facet-suppression reasoning as
  // StorefrontScreen's own facets: a chip that would return zero shops is
  // worse than no chip at all.
  const categoriesInUse = useMemo(() => {
    const ids = new Set(shops.map((s) => s.primaryCategoryId).filter((id): id is string => !!id));
    return topCategories.filter((c) => ids.has(c.id));
  }, [shops, topCategories]);

  const activeCategory = activeCategoryId ? categoryById(activeCategoryId) : undefined;

  const filteredShops = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shops.filter((s) => {
      if (activeCategoryId && s.primaryCategoryId !== activeCategoryId) return false;
      if (!q) return true;
      const name = pickText(s.nameEn, s.nameAr || '', language).toLowerCase();
      const tagline = pickText(s.taglineEn || '', s.taglineAr || '', language).toLowerCase();
      return name.includes(q) || tagline.includes(q);
    });
  }, [shops, query, activeCategoryId, language]);

  const header = (
    <View style={styles.header}>
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <HomeMarkButton />
      <Text style={type.title}>{t('shopsDirectory.title')}</Text>
    </View>
  );

  const listHeader = (
    <>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.inkSoft} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('shopsDirectory.searchPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.searchInput, isRTL && styles.rtlInput]}
        />
      </View>
      {categoriesInUse.length > 0 && (
        <View style={[styles.filterRow, mirrorRow(isRTL)]}>
          <Pressy
            onPress={() => setFilterModalVisible(true)}
            style={[styles.filterBtn, !!activeCategory && styles.filterBtnActive, mirrorRow(isRTL)]}
          >
            <Icon name="filter" size={14} color={activeCategory ? colors.white : colors.ink} />
            <Text
              style={[styles.filterBtnText, !!activeCategory && styles.filterBtnTextActive]}
              numberOfLines={1}
            >
              {activeCategory ? pickText(activeCategory.nameEn, activeCategory.nameAr, language) : t('shopsDirectory.filterButton')}
            </Text>
          </Pressy>
          {!!activeCategory && (
            <Pressy onPress={() => setActiveCategoryId(null)} style={[styles.resetBtn, mirrorRow(isRTL)]}>
              <Icon name="close" size={11} color={colors.inkSoft} />
              <Text style={styles.resetBtnText}>{t('shopsDirectory.categoryAll')}</Text>
            </Pressy>
          )}
        </View>
      )}
      <ShopCategoryFilterModal
        visible={filterModalVisible}
        categories={categoriesInUse}
        activeCategoryId={activeCategoryId}
        onSelect={(id) => {
          setActiveCategoryId(id);
          setFilterModalVisible(false);
        }}
        onClose={() => setFilterModalVisible(false)}
      />
    </>
  );

  // Same gutter/width maths the shop card already used, lifted out so the
  // spacer that pads a short last row is exactly as wide as a card.
  const shopCardWidthPct = (): `${number}%` => {
    const gutterPct = columns > 2 ? 1.6 : 3;
    return `${Number(((100 - (columns - 1) * gutterPct) / columns).toFixed(3))}%`;
  };

  const renderShop = ({ item }: { item: Shop | null }) => {
    // Padding that keeps a short last row full -- see padRowsToFullColumns.
    // The listing grids hit this first, but this one has it too: six shops in
    // a four-column grid put the last two at opposite ends of the screen,
    // because space-between is doing exactly what it is told with a row that
    // is not full.
    if (!item) return <View style={{ width: shopCardWidthPct() }} />;
    const widthPct = shopCardWidthPct();
    const name = pickText(item.nameEn, item.nameAr || '', language);
    const tagline = pickText(item.taglineEn || '', item.taglineAr || '', language);
    const location = [item.caza, item.governorate].filter(Boolean).join(', ');
    const cat = item.primaryCategoryId ? categoryById(item.primaryCategoryId) : undefined;
    const count = listingCounts.get(item.id) || 0;
    return (
      <Pressy
        style={[styles.card, { width: widthPct }]}
        onPress={() => navigation.push('Storefront', { shopSlug: item.slug })}
      >
        <View style={styles.avatar}>
          {item.logoUrl ? (
            <Image source={{ uri: item.logoUrl }} style={styles.logoImg} />
          ) : (
            <Icon name="building" size={22} color={colors.inkSoft} />
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {!!tagline && <Text style={styles.tagline} numberOfLines={2}>{tagline}</Text>}
        <View style={styles.metaRow}>
          {!!cat && <Text style={styles.metaText} numberOfLines={1}>{pickText(cat.nameEn, cat.nameAr, language)}</Text>}
          {!!location && <Text style={styles.metaText} numberOfLines={1}> · {location}</Text>}
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{t('shopsDirectory.listingsCount', { count })}</Text>
        </View>
      </Pressy>
    );
  };

  if (loading) {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <FlatList
        key={columns}
        data={padRowsToFullColumns(filteredShops, columns)}
        keyExtractor={gridRowKey}
        numColumns={columns}
        // columns is 2 or 4 here, never 1, so unlike the listing grids this
        // cannot hit FlatList's "columnWrapperStyle not supported for single
        // column lists" invariant. Guarded anyway, and cheaply, so that a
        // future one-column shops layout cannot reintroduce it.
        columnWrapperStyle={columns > 1 && filteredShops.length > 0 ? { justifyContent: 'space-between' } : undefined}
        ListHeaderComponent={
          <>
            {header}
            {listHeader}
          </>
        }
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Text style={type.h3}>{t('shopsDirectory.emptyTitle')}</Text>
            <Text style={[type.soft, styles.emptyListBody]}>{t('shopsDirectory.emptyBody')}</Text>
          </View>
        }
        renderItem={renderShop}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 4, marginBottom: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, height: '100%' },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  // A single "Filter" button that opens ShopCategoryFilterModal's
  // scrollable list, plus (only once a category is chosen) a small "All
  // categories" pill next to it that clears the filter -- replaces the old
  // horizontally-scrolling chip row, which hid most of its options off the
  // right edge once there were more than a handful of categories in use,
  // with no hint there was more to swipe to.
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, marginBottom: 16 },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 32, paddingHorizontal: 14, maxWidth: '70%', borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  filterBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  filterBtnTextActive: { color: colors.white },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 32, paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  resetBtnText: { fontSize: 12, fontWeight: '600', color: colors.inkSoft },
  grid: { paddingHorizontal: 18, paddingBottom: 110 },
  gridDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  card: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    padding: 14, marginBottom: 14, alignItems: 'center',
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 1, borderColor: colors.line, marginBottom: 10,
  },
  logoImg: { width: '100%', height: '100%' },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  tagline: { fontSize: 12, color: colors.inkSoft, marginTop: 3, textAlign: 'center', lineHeight: 16 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 },
  metaText: { fontSize: 11, color: colors.inkSoft },
  countPill: {
    marginTop: 10, backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, alignItems: 'center', justifyContent: 'center',
  },
  countPillText: { fontSize: 10.5, fontWeight: '700', color: colors.ink },
  emptyList: { paddingHorizontal: 18, paddingVertical: 40, alignItems: 'center', gap: 6 },
  emptyListBody: { textAlign: 'center' },
});
