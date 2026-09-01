import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ListingCard from '../components/ListingCard';
import { colors, type, radius } from '../theme/theme';
import { useCollections } from '../store/CollectionsStore';
import { useSettings } from '../store/SettingsStore';
import { useListingGridColumns, useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { pickText } from '../lib/listingText';
import { cornerBadgeFor } from '../lib/collectionBadge';
import { RootStackParamList } from '../navigation/types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';

type Props = NativeStackScreenProps<RootStackParamList, 'Collection'>;

// Public landing page for one collection (Editor's Picks / Hot Deals /
// Just Listed) -- reached from a Home carousel's "See all", or directly
// via a shared /collection/:slug link. Mirrors StorefrontScreen's
// hero-then-grid shape (same header/back button, same gradient hero with
// a share button, same FlatList-with-ListHeaderComponent grid) since a
// collection is the same kind of thing to a visitor: a themed page of
// listings with something worth sharing about it.
export default function CollectionScreen({ route, navigation }: Props) {
  const { slug, domain } = route.params;
  const { loaded, collectionBySlug, resolveCollection, priceDropPercent } = useCollections();
  const { domainOfCategory } = useSettings();
  const { language, t } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();
  const goBack = useGoBack();

  const collection = collectionBySlug(slug);
  // Scoped to the section it was opened from, if any -- a Just Listed row
  // inside Properties that opens onto cars and phones would undo the
  // scoping the row itself just did. See DOMAINS.md.
  const items = collection
    ? resolveCollection(collection, domain ? (l) => domainOfCategory(l.cat)?.id === domain : undefined)
    : [];

  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    if (!collection) return;
    const title = pickText(collection.titleEn, collection.titleAr, language);
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/share/collection/${collection.slug}` : '';
    const shareData = { title, text: t('collection.shareText', { name: title }), url: shareUrl };
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share(shareData);
      } catch {
        // Cancelled -- the native sheet already gave the user the choice.
      }
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareState('copied');
      } else {
        setShareState('error');
      }
    } catch {
      setShareState('error');
    }
    setTimeout(() => setShareState('idle'), 2000);
  };

  const header = (
    <View style={styles.header}>
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <HomeMarkButton />
      <Text style={type.title}>{t('collection.header')}</Text>
    </View>
  );

  if (!loaded) {
    return (
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  if (!collection) {
    return (
      <Screen maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="sparkle" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('collection.notFoundTitle')}</Text>
        </View>
      </Screen>
    );
  }

  const title = pickText(collection.titleEn, collection.titleAr, language);
  const description = pickText(collection.descriptionEn || '', collection.descriptionAr || '', language);

  const hero = (
    <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
      <View style={styles.iconBadge}>
        <Icon
          name={collection.kind === 'price_drop' ? 'wallet' : collection.kind === 'recent' ? 'plus' : 'sparkle'}
          size={22}
          color={colors.white}
        />
      </View>
      <Text style={styles.name} numberOfLines={2}>{title}</Text>
      {!!description && <Text style={styles.tagline} numberOfLines={2}>{description}</Text>}
      <View style={styles.adsPill}>
        <Text style={styles.adsPillText}>{t('collection.count', { count: items.length })}</Text>
      </View>
      <Pressy onPress={handleShare} style={styles.shareBtn}>
        <Icon name="share" size={14} color={colors.white} />
        <Text style={styles.shareBtnText}>
          {shareState === 'copied' ? t('collection.linkCopied') : shareState === 'error' ? t('collection.shareFailed') : t('collection.share')}
        </Text>
      </Pressy>
    </LinearGradient>
  );

  const listHeader = (
    <>
      {header}
      {hero}
    </>
  );

  return (
    <Screen maxWidth={1180}>
      <FlatList
        key={columns}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        // columnWrapperStyle is ONLY legal when numColumns > 1: FlatList's own
        // _checkProps throws "columnWrapperStyle not supported for single column
        // lists" via invariant(), which is NOT stripped in production. Without
        // this guard a one-column grid is a red screen on native and a blank
        // page on web -- on every listing surface in the app.
        columnWrapperStyle={columns > 1 && items.length > 0 ? { justifyContent: 'space-between' } : undefined}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        ListEmptyComponent={
          <View style={styles.emptyListings}>
            <Text style={[type.soft, styles.emptyListingsText]}>{t('collection.empty')}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard
            columns={columns}
            listing={item}
            onPress={() => navigation.push('ListingDetail', { listingId: item.id })}
            cornerBadge={cornerBadgeFor(collection, item, priceDropPercent)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hero: { marginHorizontal: 18, borderRadius: radius.xl, padding: 22, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  iconBadge: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  name: { fontSize: 19, fontWeight: '700', color: colors.white, textAlign: 'center' },
  tagline: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center', paddingHorizontal: 10 },
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
  grid: { paddingHorizontal: 18, paddingBottom: 110 },
  gridDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptyListings: { paddingHorizontal: 18, paddingVertical: 20 },
  emptyListingsText: { textAlign: 'center' },
});
