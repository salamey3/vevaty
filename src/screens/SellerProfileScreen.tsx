import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, FlatList, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ListingCard, { ListingCardSpacer } from '../components/ListingCard';
import { padRowsToFullColumns, gridRowKey } from '../lib/gridRows';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useListingGridColumns, useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';
import { monthYear } from '../lib/relativeTime';
import { fetchSellerRating, fetchSellerReviews, SellerReview } from '../lib/reviews';

// How many a seller page shows before it says there are more.
const REVIEW_PAGE = 20;

type Props = NativeStackScreenProps<RootStackParamList, 'SellerProfile'>;

// Phase 5 (OLX-comparison follow-up) -- a dedicated, linkable page per
// seller: avatar, name, Verified badge, member-since, how many listings
// they currently have live, a grid of those listings, and a Share button.
// Reached by tapping the (now-tappable) seller panel on ListingDetail.
export default function SellerProfileScreen({ route, navigation }: Props) {
  const goBack = useGoBack();
  const { sellerId } = route.params;
  const { listings } = useAppStore();
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();

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
  const [fallbackSeller, setFallbackSeller] = useState<{ name: string; verified: boolean; memberSince: number; avatarUrl: string | null } | null>(null);
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
          .select('full_name, is_phone_verified, created_at, avatar_url')
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
                avatarUrl: data.avatar_url ?? null,
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

  // Reviews load on their own, after the page has already painted. They
  // are the one thing here that nothing else waits on, and a seller with
  // no reviews is the common case -- blocking the page on an empty list
  // would be paying for nothing.
  const [rating, setRating] = useState<{ average: number | null; count: number }>({ average: null, count: 0 });
  const [reviews, setReviews] = useState<SellerReview[]>([]);
  // Three states, not two. "Still loading" and "could not load" both
  // rendered as "No reviews yet" before, which put that sentence directly
  // under a header counting seven of them.
  const [reviewsState, setReviewsState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    setReviewsState('loading');
    (async () => {
      const [score, list] = await Promise.all([
        fetchSellerRating(sellerId),
        fetchSellerReviews(sellerId, REVIEW_PAGE),
      ]);
      if (cancelled) return;
      setRating(score);
      setReviews(list ?? []);
      setReviewsState(list ? 'ready' : 'failed');
    })();
    return () => { cancelled = true; };
  }, [sellerId]);

  const sellerName = sellerListings[0]?.sellerName ?? fallbackSeller?.name ?? '';
  const sellerVerified = sellerListings[0]?.sellerVerified ?? fallbackSeller?.verified ?? false;
  const sellerMemberSince = sellerListings[0]?.sellerMemberSince ?? fallbackSeller?.memberSince ?? null;
  const sellerAvatarUrl = sellerListings[0]?.sellerAvatarUrl ?? fallbackSeller?.avatarUrl ?? null;
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
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <HomeMarkButton />
      <Text style={type.title}>{t('sellerProfile.title')}</Text>
    </View>
  );

  const hero = (
    <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
      <View style={styles.avatar}>
        {sellerAvatarUrl ? (
          <Image source={{ uri: sellerAvatarUrl }} style={styles.avatarImg} />
        ) : (
          <Icon name="user" size={24} color={colors.white} />
        )}
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
        <Text style={styles.memberSince}>{t('listingDetail.memberSince', { date: monthYear(sellerMemberSince, language) })}</Text>
      )}
      <View style={styles.adsPill}>
        <Text style={styles.adsPillText}>{t('sellerProfile.publishedAds', { count: sellerListings.length })}</Text>
      </View>
      {/* Only once there is something to say. A row of five hollow stars
          over "no reviews" makes a new seller look rated badly rather
          than not yet rated. */}
      {rating.count > 0 && rating.average != null && (
        <View style={styles.scoreRow}>
          <View style={styles.scoreStars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Icon
                key={n}
                name="star"
                size={14}
                filled={n <= Math.round(rating.average!)}
                color={n <= Math.round(rating.average!) ? colors.accent : 'rgba(255,255,255,0.35)'}
              />
            ))}
          </View>
          <Text style={styles.scoreText}>
            {t('reviews.outOfFive', { avg: rating.average.toFixed(1) })}
            {' · '}
            {rating.count === 1 ? t('reviews.fromOne') : t('reviews.fromN', { count: rating.count })}
          </Text>
        </View>
      )}
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

  const reviewsSection = (
    <>
      <Text style={styles.sectionLabel}>{t('reviews.sectionTitle', { count: rating.count })}</Text>
      {reviewsState === 'loading' ? (
        <View style={styles.noReviews}>
          <ActivityIndicator size="small" color={colors.inkSoft} />
        </View>
      ) : reviewsState === 'failed' ? (
        <View style={styles.noReviews}>
          <Text style={type.soft}>{t('reviews.loadFailed')}</Text>
        </View>
      ) : reviews.length === 0 ? (
        <View style={styles.noReviews}>
          <Text style={type.soft}>{t('reviews.none')}</Text>
          <Text style={styles.noReviewsHint}>{t('reviews.noneHint')}</Text>
        </View>
      ) : (
        <View style={styles.reviewList}>
          {reviews.map((r) => (
            <View key={r.id} style={styles.review}>
              <View style={[styles.reviewTop, isRTL && styles.rowRTL]}>
                <View style={[styles.reviewStars, isRTL && styles.rowRTL]}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Icon
                      key={n}
                      name="star"
                      size={12}
                      filled={n <= r.rating}
                      color={n <= r.rating ? colors.accent : colors.line}
                    />
                  ))}
                </View>
                <Text style={styles.reviewWho} numberOfLines={1}>
                  {r.reviewerName || t('sellerProfile.unknownSeller')}
                </Text>
                {r.edited && <Text style={styles.reviewEdited}>{t('reviews.editedFlag')}</Text>}
              </View>
              {/* When it was written. On a trust surface recency is the
                  field most worth showing, and it was already in hand. */}
              <Text style={styles.reviewWhen}>
                {monthYear(new Date(r.createdAt).getTime(), language)}
              </Text>
              {r.comment ? <Text style={styles.reviewBody}>{r.comment}</Text> : null}
              {(r.listingTitleEn || r.listingTitleAr) && (
                <Text style={styles.reviewItem} numberOfLines={1}>
                  {language === 'ar'
                    ? r.listingTitleAr || r.listingTitleEn
                    : r.listingTitleEn || r.listingTitleAr}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      {/* A seller with forty reviews showed twenty and said nothing. */}
      {reviewsState === 'ready' && rating.count > reviews.length && (
        <Text style={styles.reviewsMore}>
          {t('reviews.showingN', { shown: reviews.length, total: rating.count })}
        </Text>
      )}
    </>
  );

  const listHeader = (
    <>
      {header}
      {hero}
      {reviewsSection}
      <Text style={styles.sectionLabel}>{t('sellerProfile.listings', { count: sellerListings.length })}</Text>
    </>
  );

  // Only the (rare) zero-active-listings case waits on a network call --
  // show a plain spinner instead of the hero flashing up with a blank
  // name and "0 published ads" while that fetch is still in flight.
  if (fallbackLoading && sellerListings.length === 0) {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {header}
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.ink} />
        </View>
      </Screen>
    );
  }

  if (!knowSeller) {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
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
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <FlatList
        key={columns}
        data={padRowsToFullColumns(sellerListings, columns)}
        keyExtractor={gridRowKey}
        numColumns={columns}
        // columnWrapperStyle is ONLY legal when numColumns > 1: FlatList's own
        // _checkProps throws "columnWrapperStyle not supported for single column
        // lists" via invariant(), which is NOT stripped in production. Without
        // this guard a one-column grid is a red screen on native and a blank
        // page on web -- on every listing surface in the app.
        columnWrapperStyle={columns > 1 && sellerListings.length > 0 ? { justifyContent: 'space-between' } : undefined}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.grid, isDesktop && styles.gridDesktop]}
        ListEmptyComponent={
          knowSeller ? (
            <View style={styles.emptyListings}>
              <Text style={[type.soft, styles.emptyListingsText]}>{t('sellerProfile.noActiveListings')}</Text>
            </View>
          ) : null
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  scoreRow: { alignItems: 'center', gap: 4, marginTop: 10 },
  scoreStars: { flexDirection: 'row', gap: 2 },
  scoreText: { fontSize: 12, color: 'rgba(255,255,255,0.86)', fontVariant: ['tabular-nums'] },

  // 18 to match sectionLabel and the grid below -- at 12 and 14 the review
  // cards sat proud of everything above and below them.
  noReviews: { paddingHorizontal: 18, paddingBottom: 6, gap: 3 },
  noReviewsHint: { ...type.tiny, color: colors.inkSoft, lineHeight: 16 },
  reviewList: { paddingHorizontal: 18, gap: 8 },
  reviewsMore: { ...type.tiny, color: colors.inkSoft, paddingHorizontal: 18, paddingTop: 8 },
  reviewWhen: { ...type.tiny, color: colors.inkSoft },
  // This app never flips I18nManager, so every mirrored row is spelled out
  // (see src/lib/mirrorRow.ts).
  rowRTL: { flexDirection: 'row-reverse' },
  review: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, gap: 5,
  },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewStars: { flexDirection: 'row', gap: 1.5 },
  reviewWho: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.ink },
  reviewEdited: { ...type.tiny, color: colors.inkSoft, fontStyle: 'italic' },
  reviewBody: { fontSize: 13.5, lineHeight: 19, color: colors.ink },
  reviewItem: { ...type.tiny, color: colors.inkSoft },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  hero: { marginHorizontal: 18, borderRadius: radius.xl, padding: 22, alignItems: 'center', marginTop: 4, marginBottom: 10 },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarImg: { width: 54, height: 54, borderRadius: 27 },
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
