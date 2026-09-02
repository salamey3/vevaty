import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import AuctionCountdown from '../components/AuctionCountdown';
import AuctionLotCard from '../components/AuctionLotCard';
import { colors, radius, type } from '../theme/theme';
import { Auction, AuctionLot, Listing } from '../types';
import {
  fetchAuction, fetchAuctionLots, fetchLotListings, fetchMyRegistration, formatBidAmount,
} from '../lib/auctions';
import { pickText } from '../lib/listingText';
import { mirrorRow } from '../lib/mirrorRow';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { useIsDesktop, useListingGridColumns, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';

// How often a live auction re-reads its lots.
//
// Polling, not Supabase Realtime, and that is a deliberate choice rather
// than a shortcut. Realtime would need the lots table in a publication and
// would push row payloads shaped by RLS -- on a table where three columns
// are revoked precisely because they must never reach a client, a channel
// that silently starts carrying them is a bigger risk than a refetch. Six
// seconds is well inside the two-minute anti-snipe window, so nobody can
// be outbid and not know before the extension that outbidding causes.
const LIVE_POLL_MS = 6000;

export default function AuctionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { auctionId } = useRoute<RouteProp<RootStackParamList, 'Auction'>>().params;
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const columns = useListingGridColumns();
  // authChecked, not just isVerified: a cold web load of /auction/:id can
  // render before ensureSession resolves, and without it a registered
  // bidder is bounced to sign-in on the first tap (see AppStore).
  const { profile, isVerified, authChecked } = useAppStore();

  const [auction, setAuction] = useState<Auction | null>(null);
  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [registration, setRegistration] = useState<'approved' | 'pending' | 'blocked' | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // A ref, not the state variable: `load` is memoised on [auctionId,
  // isVerified, profile.id], so reading `auction` inside it would read the
  // mount-time null forever and mark every failed POLL as a failed first
  // load. The distinction is the whole point of the flag.
  const loadedRef = useRef(false);
  const [width, setWidth] = useState(0);

  const load = useCallback(async (withListings: boolean) => {
    try {
      // By id. Fetching every auction and finding this one is what
      // fetchAuctionLot's own comment says was removed for being O(n)
      // round trips on a poll -- and it also hid a CANCELLED auction
      // behind "not found", which a registered bidder needs to be told
      // about rather than shielded from.
      const [found, lotRows] = await Promise.all([
        fetchAuction(auctionId),
        fetchAuctionLots(auctionId, isVerified),
      ]);
      setAuction(found);
      loadedRef.current = true;
      setFailed(false);
      setLots(lotRows);
      // The listings behind the lots change only when the admin edits a
      // lot, so they are fetched once rather than on every poll -- the
      // poll exists for prices and clocks.
      if (withListings && lotRows.length) {
        const rows = await fetchLotListings(lotRows.map((l) => l.listingId));
        setListings(Object.fromEntries(rows.map((r) => [r.id, r])));
      }
      if (isVerified && profile.id) {
        setRegistration(await fetchMyRegistration(auctionId, profile.id));
      }
    } catch {
      // A failed POLL is left to the existing state on purpose -- it must
      // not blank prices somebody is watching. A failed FIRST load is
      // different: without this it renders as "this auction is no longer
      // available", which the viewer cannot tell from the truth.
      if (!loadedRef.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [auctionId, isVerified, profile.id]);

  // Polls only while the screen is focused AND the auction is live. A
  // timer that keeps running behind a pushed lot screen would double the
  // requests for nothing, and one that runs on a closed auction would ask
  // forever about a result that cannot change.
  useFocusEffect(
    useCallback(() => {
      // 'scheduled' polls too, or an auction never notices it opened: the
      // countdown reaches zero and the page sits on "Opens in — Ended"
      // until the viewer navigates away and back. advance_auctions flips
      // it within a minute, so a slower tick is enough to catch it.
      // The focus effect owns the first load as well as the refresh, so a
      // mount does not fire load twice (once from an effect, once here)
      // and then a third time when `auction?.status` first resolves.
      // Listings are only fetched on that first pass.
      const first = !loadedRef.current;
      load(first);
      const status = auction?.status;
      if (status !== 'live' && status !== 'scheduled') return;
      const id = setInterval(() => load(false), status === 'live' ? LIVE_POLL_MS : 30000);
      return () => clearInterval(id);
    }, [auction?.status, load])
  );

  const cardWidth = useMemo(() => {
    if (!width) return 0;
    const gap = 10;
    return Math.floor((width - gap * (columns - 1)) / columns);
  }, [width, columns]);

  const live = auction?.status === 'live';
  const canBid = registration === 'approved';

  const blocked = registration === 'blocked';
  // 'pending' cannot be produced by register_for_auction (it inserts
  // 'approved' and its conflict arm preserves whatever is there), so it
  // only exists if somebody sets it by hand -- but it is a real value in
  // the CHECK constraint, and a state the UI models but cannot render is
  // how a screen ends up offering a button that quietly does nothing.
  const awaitingReview = registration === 'pending';
  // Neither gets a Pressy: tapping through to a register screen whose only
  // possible outcome is the message already on screen is a control that
  // exists to fail.
  const BannerBox: any = blocked || awaitingReview ? View : Pressy;
  const registerBanner = auction && (live || auction.status === 'scheduled') && !canBid && (
    <BannerBox
      onPress={blocked || awaitingReview ? undefined : () => {
        if (authChecked && !isVerified) navigation.navigate('Auth', { returnTo: 'AuctionRegister', returnToParams: { auctionId } });
        else navigation.navigate('AuctionRegister', { auctionId });
      }}
      style={styles.banner}
    >
      <View style={[styles.bannerRow, mirrorRow(isRTL)]}>
        <Icon name="card" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.bannerTitle, isRTL && styles.rtl]}>
            {blocked ? t('auctions.blockedTitle')
              : awaitingReview ? t('auctions.pendingTitle')
              : t('auctions.registerTitle')}
          </Text>
          <Text style={[styles.bannerSub, isRTL && styles.rtl]}>
            {blocked ? t('auctions.blockedSub')
              : awaitingReview ? t('auctions.pendingSub')
              : t('auctions.registerSub')}
          </Text>
        </View>
        {!blocked && !awaitingReview && <Icon name="chevronRight" size={16} color={colors.inkSoft} />}
      </View>
    </BannerBox>
  );

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={[styles.topBar, mirrorRow(isRTL)]}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3} numberOfLines={1}>
          {auction ? pickText(auction.titleEn, auction.titleAr, language) : t('auctions.title')}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : !auction ? (
          <View style={styles.empty}>
            <Text style={type.body}>{failed ? t('auctions.loadFailed') : t('auctions.notFound')}</Text>
            {failed && (
              <Pressy onPress={() => load(true)} style={styles.retry}>
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Pressy>
            )}
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              {live ? (
                <>
                  <Text style={[styles.heroLabel, isRTL && styles.rtl]}>{t('auctions.biddingOpen')}</Text>
                  <AuctionCountdown
                    closesAt={auction.firstLotClosesAt}
                    prefix={t('auctions.firstLotClosesIn')}
                    style={[styles.heroClock, isRTL && styles.rtl] as any}
                    urgentStyle={{ color: colors.white }}
                  />
                </>
              ) : auction.status === 'scheduled' ? (
                <>
                  <Text style={[styles.heroLabel, isRTL && styles.rtl]}>{t('auctions.openingSoon')}</Text>
                  <AuctionCountdown closesAt={auction.opensAt} prefix={t('auctions.opensIn')} style={[styles.heroClock, isRTL && styles.rtl] as any} />
                </>
              ) : auction.status === 'cancelled' ? (
                // The one reason fetchAuction returns a cancelled auction
                // at all: somebody who registered for it has to be told,
                // not shown "Finished" as though it had run.
                <>
                  <Text style={[styles.heroLabel, isRTL && styles.rtl]}>{t('auctions.cancelledTitle')}</Text>
                  <Text style={[styles.heroFees, isRTL && styles.rtl]}>{t('auctions.cancelledSub')}</Text>
                </>
              ) : (
                <Text style={[styles.heroLabel, isRTL && styles.rtl]}>{t('auctions.finished')}</Text>
              )}
              {/* Both fees, stated on the event rather than buried in
                  terms. A buyer's premium a bidder discovers at checkout is
                  the fastest way to lose the bidder and the trust. Not on a
                  cancelled sale, where it would sit directly under
                  "nothing has been charged" and read as one paragraph. */}
              {auction.status !== 'cancelled' && (
              <Text style={[styles.heroFees, isRTL && styles.rtl]}>
                {t('auctions.feesLine', {
                  buyer: String(auction.buyerPremiumPct),
                  seller: String(auction.sellerCommissionPct),
                })}
              </Text>
              )}
            </View>

            {registerBanner}
            {canBid && (
              <View style={[styles.okRow, mirrorRow(isRTL)]}>
                <Icon name="checkCircle" size={15} color={colors.primary} />
                <Text style={styles.okText}>{t('auctions.registered')}</Text>
              </View>
            )}

            <View style={[styles.grid, mirrorRow(isRTL)]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
              {cardWidth > 0 &&
                lots.map((lot) => (
                  <AuctionLotCard
                    key={lot.id}
                    lot={lot}
                    listing={listings[lot.listingId]}
                    width={cardWidth}
                    onPress={() => navigation.navigate('AuctionLot', { lotId: lot.id })}
                  />
                ))}
            </View>

            {lots.length === 0 && (
              <View style={styles.empty}><Text style={type.soft}>{t('auctions.noLots')}</Text></View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 120 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  hero: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: 16, paddingVertical: 16, marginBottom: 14, gap: 4,
  },
  heroLabel: { fontSize: 11, fontWeight: '800', color: colors.white, opacity: 0.8, letterSpacing: 0.7 },
  heroClock: { fontSize: 20, fontWeight: '800', color: colors.white },
  heroFees: { fontSize: 11.5, color: colors.white, opacity: 0.75, marginTop: 6, lineHeight: 16 },
  banner: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, marginBottom: 14,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  bannerTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  bannerSub: { ...type.tiny, marginTop: 2, lineHeight: 16 },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  okText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 4 },
  retry: {
    marginTop: 14, paddingHorizontal: 18, height: 40, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  retryText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
