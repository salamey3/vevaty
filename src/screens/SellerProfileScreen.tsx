import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ListingCard from '../components/ListingCard';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useGridColumns, useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';

// Same coarse "Month Year" formatting as the member-since line on
// ListingDetailScreen's seller panel -- kept as its own local copy rather
// than a shared import since it's a two-line function and this is the only
// other place it's needed.
function formatMemberSince(ts: number, language: 'en' | 'ar'): string {
  return new Date(ts).toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', { month: 'long', year: 'numeric' });
}

type Props = NativeStackScreenProps<RootStackParamList, 'SellerProfile'>;

// Phase 5 (OLX-comparison follow-up) -- a dedicated, linkable page per
// seller: avatar, name, Verified badge, member-since, how many listings
// they currently have live, a grid of those listings, and a Share button.
// Reached by tapping the (now-tappable) seller panel on ListingDetail.
export default function SellerProfileScreen({ route, navigation }: Props) {
  const { sellerId } = route.params;
  const { listings } = useAppStore();
  const { t, language } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useGridColumns(2, 4);

  // The listings this seller currently has live -- the same "what a buyer
  // can actually see" set every other screen in the app already shows
  // (RLS itself only ever hands back other people's *active* rows to
  // begin with; filtering by status here also keeps a seller from seeing
  // their own drafts/expired rows if they ever land on their own profile
  // page, matching what a stranger visiting the same link would see).
  const sellerListings = useMemo(
    () => listings.filter((l) => l.sellerId === sellerId && l.status === 'active'),
    [listings, sellerId]
  );

  // The common case -- reached by tapping a listing's seller panel --
  // always has at least one active listing to read the seller's
  // name/verified/member-since straight off (Listing already carries all
  // three, no extra round trip). The only time that's not true is a
  // direct/shared link to a seller who has zero active listings right
  // now, so fall back to a direct (public-column-only) profiles read.
  const [fallbackSeller, setFallbackSeller] = useState<{ name: string; verified: boolean; memberSince: number } | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (sellerListings.length > 0) return;
    let cancelled = false;
    setFallbackLoading(true);
    // Bounded so a dead connection can't leave this screen spinning
    // forever -- past this, it settles into the same "not found" state a
    // genuinely-nonexistent seller id would show.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    (async () => {
      try {
        // Supabase's query builder is a thenable, not a full Promise (no
        // .catch/.finally) -- awaiting it inside a try/catch is the
        // portable way to handle both branches.
        const { data } = await supabase
          .from('profiles')
          .select('full_name, is_phone_verified, created_at')
          .eq('id', sellerId)
          .abortSignal(controller.signal)
          .maybeSingle();
        if (cancelled) return;
        setFallbackSeller(
          data
            ? {
                name: data.full_name || 'Vevaty user',
                verified: !!data.is_phone_verified,
                memberSince: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
              }
            : null
        );
      } catch {
        // Offline, backend unreachable, or the 8s timeout above fired --
        // notFoundTitle is shown below.
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setFallbackLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [sellerId, sellerListings.length]);

  const sellerName = sellerListings[0]?.sellerName ?? fallbackSeller?.name ?? '';
  const sellerVerified = sellerListings[0]?.sellerVerified ?? fallbackSeller?.verified ?? false;
  const sellerMemberSince = sellerListings[0]?.sellerMemberSince ?? fallbackSeller?.memberSince ?? null;
  const knowSeller = sellerListings.length > 0 || !!fallbackSeller;

  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/seller/${sellerId}` : '';
    const shareData = {
      title: sellerName || t('sellerProfile.title'),
      text: t('sellerProfile.shareText', { name: sellerName || t('sellerProfile.title') }),
      url: shareUrl,
    };
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share(shareData);
      } catch {
        // Cancelled (or unsupported for this data) -- the native sheet
        // already gave the user the choice, nothing else to do here.
      }
      return;
    }
    // No native share sheet available (most desktop browsers) -- copy the
    // link to the clipboard instead, matching the app's other "web API
    // directly, no wrapper library" conventions (see geolocation calls).
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
      <Pressy onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={type.title}>{t('sellerProfile.title')}</Text>
    </View>
  );

  const hero = (
    <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
      <View style={styles.avatar}>
        <Icon name="user" size={24} color={colors.white} />
      </View>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>
          {sellerName || t('sellerProfile.unknownSeller')}
        </Text>
        {sellerVerified && (
          <View style={styles.verifiedBadge}>
            <Icon name="checkCircle" size={11} color={colors.success} />
            <Text style={styles.verifiedBadgeText}>{t('listingDetail.verifiedSeller')}</Text>
          </View>
        )}
      </View>
      {sellerMemberSince != null && (
        <Text style={styles.memberSince}>{t('listingDetail.memberSince', { date: formatMemberSince(sellerMemberSince, language) })}</Text>
      )}
      <View style={styles.adsPill}>
        <Text style={styles.adsPillText}>{t('sellerProfile.publishedAds', { count: sellerListings.length })}</Text>
      </View>
      <Pressy onPress={handleShare} style={styles.shareBtn}>
        <Icon name="share" size={14} color={colors.white} />
        <Text style={styles.shareBtnText}>
          {shareState === 'copied'
            ? t('sellerProfile.linkCopied')
            : shareState === 'error'
              ? t('sellerProfile.shareFailed')
              : t('sellerProfile.shareProfile')}
        </Text>
      </Pressy>
    </LinearGradient>
  );

  const listHeader = (
    <>
      {header}
      {hero}
      <Text style={styles.sectionLabel}>{t('sellerProfile.listings', { count: sellerListings.length })}</Text>
    </>
  );

  // Only the (rare) zero-active-listings case waits on a network call --
  // show a plain spinner instead of the hero flashing up with a blank
  // name and "0 published ads" while that fetch is still in flight.
  if (fallbackLoading && sellerListings.length === 0) {
    return (
      <Screen edges={['top', 'left', 'right']} maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  if (!knowSeller) {
    return (
      <Screen edges={['top', 'left', 'right']} maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="user" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('sellerProfile.notFoundTitle')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']} maxWidth={1180}>
      <FlatList
        key={columns}
        data={sellerListings}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        columnWrapperStyle={sellerListings.length > 0 ? { justifyContent: 'space-between' } : undefined}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        ListEmptyComponent={
          knowSeller ? (
            <View style={styles.emptyListings}>
              <Text style={[type.soft, styles.emptyListingsText]}>{t('sellerProfile.noActiveListings')}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ListingCard columns={columns} listing={item} onPress={() => navigation.push('ListingDetail', { listingId: item.id })} />
        )}
      />
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
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  name: { fontSize: 19, fontWeight: '700', color: colors.white },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: radius.pill, paddingHorizontal: 8, height: 20,
  },
  verifiedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.success },
  memberSince: { fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
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
});
