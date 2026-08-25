import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useGridColumns, useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { pickText } from '../lib/listingText';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { Category, Shop } from '../types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';
import { useRtlCarousel } from '../lib/useRtlCarousel';

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

  // One horizontally-scrolling row instead of the old flexWrap chip grid,
  // which stacked into several full-width rows once there were more than a
  // handful of categories in use -- the same "All" + wrapping-chips shape
  // HomeScreen's own category slider already uses, for the same reason
  // (see that screen's catChips/orderedCatChips). useRtlCarousel handles
  // the Arabic swipe-direction reversal the same way it does there.
  const catChips = useMemo<('all' | Category)[]>(() => ['all', ...categoriesInUse], [categoriesInUse]);
  const { ordered: orderedCatChips, scrollRef: chipScrollRef, onContentSizeChange: onChipContentSizeChange } = useRtlCarousel(
    catChips,
    isRTL,
  );

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
        <ScrollView
          ref={chipScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          onContentSizeChange={onChipContentSizeChange}
        >
          {orderedCatChips.map((c) =>
            c === 'all' ? (
              <Pressy
                key="all"
                onPress={() => setActiveCategoryId(null)}
                style={[styles.chip, activeCategoryId === null && styles.chipActive]}
              >
                <Text style={[styles.chipText, activeCategoryId === null && styles.chipTextActive]}>
                  {t('shopsDirectory.categoryAll')}
                </Text>
              </Pressy>
            ) : (
              <Pressy
                key={c.id}
                onPress={() => setActiveCategoryId(c.id)}
                style={[styles.chip, activeCategoryId === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipText, activeCategoryId === c.id && styles.chipTextActive]} numberOfLines={1}>
                  {pickText(c.nameEn, c.nameAr, language)}
                </Text>
              </Pressy>
            )
          )}
        </ScrollView>
      )}
    </>
  );

  const renderShop = ({ item }: { item: Shop }) => {
    const gutterPct = columns > 2 ? 1.6 : 3;
    const widthPct: `${number}%` = `${Number(((100 - (columns - 1) * gutterPct) / columns).toFixed(3))}%`;
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
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={1180}>
      <FlatList
        key={columns}
        data={filteredShops}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        columnWrapperStyle={filteredShops.length > 0 ? { justifyContent: 'space-between' } : undefined}
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
  // contentContainerStyle of the horizontal chip ScrollView -- no flexWrap
  // now that it scrolls in one row instead of wrapping onto several
  // full-width ones. alignItems:'flex-start' matches HomeScreen's own chip
  // strip: without it, a horizontal ScrollView with no height of its own
  // stretches its row to the parent's cross-axis space and RN's default
  // alignItems:'stretch' would pull every chip to that same height instead
  // of leaving them their own natural pill height.
  chipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 18, marginBottom: 16 },
  chip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.white },
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
