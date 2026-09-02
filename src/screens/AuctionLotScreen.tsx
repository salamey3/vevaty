import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Button from '../components/Button';
import Icon from '../icons/Icon';
import AuctionCountdown from '../components/AuctionCountdown';
import SpinViewer from '../components/SpinViewer';
import VideoPlayer from '../components/VideoPlayer';
import { colors, radius, type } from '../theme/theme';
import { Alert } from '../lib/alertShim';
import { Auction, AuctionBidHistoryEntry, AuctionLot, Listing } from '../types';
import {
  AuctionError, bidIncrement, fetchAuctionLot, fetchLotBidHistory,
  fetchLotListings, fetchMyMaxBid, fetchMyRegistration, formatBidAmount, nextMinimumBid, placeBid,
} from '../lib/auctions';
import { listingTitle, listingDescription } from '../lib/listingText';
import { sizedPhotoUrl } from '../lib/photoSize';
import { relativeTimeFrom } from '../lib/relativeTime';
import { mirrorRow } from '../lib/mirrorRow';
import { useRtlCarousel } from '../lib/useRtlCarousel';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';

const LIVE_POLL_MS = 5000;

// Every rejection the engine can raise, turned into a sentence a bidder
// can act on. Mapped by CODE -- the database deliberately raises codes
// rather than messages, because PostgREST's own text is an English
// diagnostic naming a column and this interface is bilingual.
function bidErrorKey(e: AuctionError): string {
  switch (e.code) {
    case 'bid_too_low': return 'auctions.err.tooLow';
    case 'bid_below_start': return 'auctions.err.belowStart';
    case 'max_not_higher': return 'auctions.err.notHigher';
    case 'not_registered': return 'auctions.err.notRegistered';
    case 'cannot_bid_own_lot': return 'auctions.err.ownLot';
    case 'lot_closed':
    case 'lot_not_live': return 'auctions.err.closed';
    case 'auction_not_live': return 'auctions.err.auctionClosed';
    case 'not_signed_in': return 'auctions.err.signIn';
    default: return 'auctions.err.generic';
  }
}

export default function AuctionLotScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { lotId } = useRoute<RouteProp<RootStackParamList, 'AuctionLot'>>().params;
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  // authChecked for the same reason AuctionScreen reads it: /auction/lot/:id
  // is a real URL now, so a cold load can render before the session
  // resolves and bounce a registered bidder to sign-in.
  const { profile, isVerified, authChecked } = useAppStore();

  const [lot, setLot] = useState<AuctionLot | null>(null);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [history, setHistory] = useState<AuctionBidHistoryEntry[]>([]);
  const [myMax, setMyMax] = useState<number | null>(null);
  const [registration, setRegistration] = useState<'approved' | 'pending' | 'blocked' | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // See AuctionScreen: reading `lot` inside the memoised loader would read
  // the mount-time null forever, so every failed poll would look like a
  // failed first load.
  const loadedRef = useRef(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  // Null until the listing lands, then settled once from what the lot
  // actually carries. A lot can have a 24-frame spin and no stills -- the
  // create form does not require photos -- and opening such a page on the
  // Photos tab shows the grey placeholder as the first thing a bidder
  // sees, on a feature whose whole pitch is the photography.
  const [mediaTab, setMediaTab] = useState<'photos' | 'spin' | 'video' | null>(null);
  const [spinIndex, setSpinIndex] = useState(0);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [bidText, setBidText] = useState('');
  const [placing, setPlacing] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const load = useCallback(async (full: boolean) => {
    try {
      const found = await fetchAuctionLot(lotId, isVerified);
      if (!found) { setFailed(false); setLoading(false); return; }
      setFailed(false);
      loadedRef.current = true;
      setLot(found.lot);
      setAuction(found.auction);
      // Its own try: this RPC raises for a lot whose auction is still a
      // draft, and letting that abort `load` would leave a lot page with a
      // price and no photo, title or description.
      try {
        setHistory(await fetchLotBidHistory(lotId, 30));
      } catch {
        setHistory([]);
      }
      if (isVerified && profile.id) {
        setMyMax(await fetchMyMaxBid(lotId, profile.id));
        setRegistration(await fetchMyRegistration(found.auction.id, profile.id));
      }
      // The item behind the lot cannot change while the lot is live, so it
      // is fetched once. The poll exists for the price and the clock.
      if (full) {
        const rows = await fetchLotListings([found.lot.listingId]);
        setListing(rows[0] || null);
      }
    } catch {
      // Never blank a live price because one poll failed -- but a FIRST
      // load that failed must not render as "this lot no longer exists",
      // which is a lie the viewer cannot tell from the truth.
      if (!loadedRef.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [lotId, isVerified, profile.id]);

  useFocusEffect(
    useCallback(() => {
      // Focus owns the first load and the refresh: without the reload,
      // returning from the register modal leaves `registration` stale for
      // a poll cycle, so the next tap on Place a bid sends the bidder
      // straight back to the registration they just completed.
      const first = !loadedRef.current;
      load(first);
      // 'pending' polls too (slower): without it the countdown on a lot
      // that has not opened reaches zero and the page sits there with no
      // bid button until the viewer navigates away and back.
      const s = lot?.status;
      if (s !== 'live' && s !== 'pending') return;
      const id = setInterval(() => load(false), s === 'live' ? LIVE_POLL_MS : 30000);
      return () => clearInterval(id);
    }, [lot?.status, load])
  );

  // myMax is passed in: for the current leader the engine compares against
  // their own ceiling, not the price, so without it the sheet offers a
  // number place_bid then refuses. See nextMinimumBid.
  const minimum = lot ? nextMinimumBid(lot, myMax) : 0;

  const openSheet = () => {
    if (authChecked && !isVerified) {
      // navigate, matching AuctionScreen. `replace` was wrong here for a
      // reason worth recording: it pops THIS screen, so after signing in
      // the bidder lands back on the grid rather than on the lot they were
      // about to bid on. AuthScreen finishes with replace(returnTo), so
      // the stack ends correctly either way.
      navigation.navigate('Auth', { returnTo: 'AuctionLot', returnToParams: { lotId } });
      return;
    }
    if (registration !== 'approved' && auction) {
      navigation.navigate('AuctionRegister', { auctionId: auction.id });
      return;
    }
    setBidText(String(minimum));
    setSheetError(null);
    setSheetOpen(true);
  };

  const submit = async () => {
    const value = Number(bidText.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value <= 0) { setSheetError(t('auctions.err.generic')); return; }
    setPlacing(true);
    setSheetError(null);
    try {
      const result = await placeBid(lotId, value);
      setSheetOpen(false);
      await load(false);
      // Outbid-on-arrival is the outcome people find most confusing about
      // proxy bidding, so it gets said explicitly rather than being left
      // for the bidder to work out from a price that moved past them.
      Alert.alert(
        result.leading ? t('auctions.bidPlaced') : t('auctions.outbidTitle'),
        result.leading
          ? t('auctions.bidPlacedBody', { price: formatBidAmount(result.currentPrice) })
          : t('auctions.outbidBody', { price: formatBidAmount(result.currentPrice) })
      );
    } catch (e: any) {
      const err = e instanceof AuctionError ? e : new AuctionError('unknown');
      setSheetError(
        err.code === 'bid_too_low' && err.minimum
          ? t('auctions.err.tooLow', { min: formatBidAmount(err.minimum) })
          : t(bidErrorKey(err), { min: formatBidAmount(minimum) })
      );
      await load(false);
    } finally {
      setPlacing(false);
    }
  };

  // A lot in a published-but-not-yet-open auction is 'pending', not
  // 'live'. Treating anything that is not 'live' as finished made its own
  // page read "Did not sell" for the whole pre-open window -- which for a
  // fortnightly sale is most of the time, and is exactly when the
  // catalogue gets browsed. Same predicate the card uses.
  const running = lot?.status === 'live' || lot?.status === 'pending';
  const photos = listing?.photos ?? [];
  // The other two kinds of media a lot can carry. This page showed neither
  // for its whole first life, which made the 360 spin -- the single most
  // persuasive thing the auction has to show, and the reason we take the
  // items into custody at all -- invisible on the only page that sells
  // them. `photos` cannot carry them: it is sortedByKind(rows,'gallery'),
  // so spin frames are filtered out of it by construction.
  const spinSets = listing?.spinSets ?? [];
  // 'ready' is the only status a buyer may ever see, and RLS enforces the
  // same thing from the other side -- this is the UI half of that rule.
  const playableVideo = listing?.video && listing.video.status === 'ready' ? listing.video : null;
  // Tabs appear only for media that exists, so an ordinary lot with photos
  // alone renders exactly as it did before.
  const hasTabs = spinSets.length > 0 || !!playableVideo;
  // Settled, not defaulted: `mediaTab` stays null until there is something
  // to decide from, so this never picks 'photos' off an empty first render
  // and then sticks with it.
  const tab: 'photos' | 'spin' | 'video' =
    mediaTab ?? (photos.length > 0 ? 'photos' : spinSets.length > 0 ? 'spin' : playableVideo ? 'video' : 'photos');
  // Every horizontal strip in the app goes through this: on native there
  // is no ambient direction, so an Arabic strip would open mid-row with
  // photo 1 on the left, while the web one opens correctly from the right.
  const { ordered: orderedPhotos, scrollRef: thumbRef, onContentSizeChange: onThumbsSized } =
    useRtlCarousel(photos, isRTL);
  const live = lot?.status === 'live';
  const price = lot ? lot.currentPrice ?? lot.startPrice : 0;

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={[styles.topBar, mirrorRow(isRTL)]}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{lot ? t('auctions.lotN', { n: lot.lotNumber }) : ''}</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : !lot ? (
        <View style={styles.empty}>
          <Text style={type.body}>{failed ? t('auctions.loadFailed') : t('auctions.notFound')}</Text>
          {failed && (
            <Pressy onPress={() => load(true)} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}>
          {/* Only rendered when there is something to switch TO. A lot with
              photos alone looks exactly as it did before this existed. */}
          {hasTabs && (
            <View style={[styles.mediaTabs, mirrorRow(isRTL)]}>
              <Pressy
                onPress={() => setMediaTab('photos')}
                style={[styles.mediaTab, tab === 'photos' && styles.mediaTabOn]}
              >
                <Icon name="image" size={14} color={tab === 'photos' ? colors.white : colors.inkSoft} />
                <Text style={[styles.mediaTabText, tab === 'photos' && styles.mediaTabTextOn]}>
                  {t('listingDetail.photosTab')}
                </Text>
              </Pressy>
              {spinSets.length > 0 && (
                <Pressy
                  onPress={() => setMediaTab('spin')}
                  style={[styles.mediaTab, tab === 'spin' && styles.mediaTabOn]}
                >
                  <Icon name="rotate" size={14} color={tab === 'spin' ? colors.white : colors.inkSoft} />
                  <Text style={[styles.mediaTabText, tab === 'spin' && styles.mediaTabTextOn]}>
                    {t('listingDetail.spinViewTab')}
                  </Text>
                </Pressy>
              )}
              {!!playableVideo && (
                <Pressy
                  onPress={() => setMediaTab('video')}
                  style={[styles.mediaTab, tab === 'video' && styles.mediaTabOn]}
                >
                  <Icon name="camera" size={14} color={tab === 'video' ? colors.white : colors.inkSoft} />
                  <Text style={[styles.mediaTabText, tab === 'video' && styles.mediaTabTextOn]}>
                    {t('listingDetail.videosTab')}
                  </Text>
                </Pressy>
              )}
            </View>
          )}

          <View style={styles.photoBox}>
            {tab === 'spin' && spinSets.length > 0 ? (
              // Keyed per set: without it React reuses the same instance
              // across a chip tap, and its internal frame index carries
              // over into a shorter array.
              <SpinViewer
                key={(spinSets[spinIndex] ?? spinSets[0]).id}
                frames={(spinSets[spinIndex] ?? spinSets[0]).frames}
              />
            ) : tab === 'video' && playableVideo ? (
              <VideoPlayer guid={playableVideo.guid} resolutions={playableVideo.resolutions} />
            ) : photos.length > 0 ? (
              <Image
                source={{ uri: sizedPhotoUrl(photos[photoIndex] ?? photos[0], 900)! }}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : (
              <Icon name="gavel" size={36} color={colors.inkSoft} />
            )}
          </View>

          {/* A lot can carry more than one spin -- the watch and its
              movement, the car and its cabin -- so they get their own
              chips rather than being flattened into the photo strip. */}
          {tab === 'spin' && spinSets.length > 1 && (
            <View style={[styles.spinChips, mirrorRow(isRTL)]}>
              {spinSets.map((set, i) => (
                <Pressy
                  key={set.id}
                  onPress={() => setSpinIndex(i)}
                  style={[styles.spinChip, i === spinIndex && styles.spinChipOn]}
                >
                  <Text style={[styles.spinChipText, i === spinIndex && styles.spinChipTextOn]} numberOfLines={1}>
                    {set.label}
                  </Text>
                </Pressy>
              ))}
            </View>
          )}

          {tab === 'photos' && photos.length > 1 && (
            <ScrollView
              ref={thumbRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbs}
              onContentSizeChange={onThumbsSized}
            >
              {orderedPhotos.map((p) => {
                // Indexed against the ORIGINAL array, not the possibly
                // reversed one, or tapping a thumbnail in Arabic would
                // select a different photo than the one touched.
                const i = photos.indexOf(p);
                return (
                  <Pressy key={`${p}-${i}`} onPress={() => setPhotoIndex(i)}>
                    <Image
                      source={{ uri: sizedPhotoUrl(p, 160)! }}
                      style={[styles.thumb, i === photoIndex && styles.thumbActive]}
                    />
                  </Pressy>
                );
              })}
            </ScrollView>
          )}

          <Text style={[styles.title, isRTL && styles.rtl]}>
            {listing ? listingTitle(listing, language) : ''}
          </Text>

          <View style={styles.priceBox}>
            <Text style={[styles.priceLabel, isRTL && styles.rtl]}>
              {lot.currentPrice === null ? t('auctions.startsAt') : t('auctions.currentBid')}
            </Text>
            <Text style={[styles.price, isRTL && styles.rtl]}>{formatBidAmount(price)}</Text>
            <View style={[styles.priceMeta, mirrorRow(isRTL)]}>
              <Text style={type.tiny}>
                {lot.bidCount === 0 ? t('auctions.bidCountNone')
                  : lot.bidCount === 1 ? t('auctions.bidCountOne')
                  : t('auctions.bidCount', { n: lot.bidCount })}
              </Text>
              {lot.hasReserve && (
                <Text style={[type.tiny, lot.reserveMet ? styles.reserveOk : styles.reserveWarn]}>
                  {lot.reserveMet ? t('auctions.reserveMet') : t('auctions.reserveNotMet')}
                </Text>
              )}
            </View>
            {running ? (
              <AuctionCountdown
                closesAt={lot.closesAt}
                prefix={t('auctions.closesIn')}
                style={[styles.clock, isRTL && styles.rtl] as any}
              />
            ) : (
              <Text style={[styles.clock, isRTL && styles.rtl]}>
                {lot.status === 'won' || lot.status === 'settled'
                  ? t('auctions.soldFor', { amount: formatBidAmount(lot.winningAmount ?? price) })
                  : lot.status === 'cancelled'
                  ? t('auctions.withdrawn')
                  : t('auctions.unsold')}
              </Text>
            )}
            {lot.viewerIsLeading && live && (
              <View style={[styles.leadRow, mirrorRow(isRTL)]}>
                <Icon name="checkCircle" size={15} color={colors.primary} />
                <Text style={styles.leadText}>{t('auctions.youLeadLong')}</Text>
              </View>
            )}
            {myMax !== null && live && (
              <Text style={[styles.myMax, isRTL && styles.rtl]}>
                {t('auctions.yourMax', { amount: formatBidAmount(myMax) })}
              </Text>
            )}
          </View>

          {live && (
            <Button label={t('auctions.placeBid')} onPress={openSheet} style={{ marginTop: 4 }} />
          )}

          {!!listing && !!listingDescription(listing, language) && (
            <View style={styles.block}>
              <Text style={[styles.blockTitle, isRTL && styles.rtl]}>{t('auctions.aboutLot')}</Text>
              <Text style={[styles.desc, isRTL && styles.rtl]}>{listingDescription(listing, language)}</Text>
            </View>
          )}

          <View style={styles.block}>
            <Text style={[styles.blockTitle, isRTL && styles.rtl]}>{t('auctions.bidHistory')}</Text>
            {history.length === 0 ? (
              <Text style={type.soft}>{t('auctions.noBids')}</Text>
            ) : (
              history.map((h, i) => (
                <View key={`${h.bidAt}-${i}`} style={[styles.histRow, mirrorRow(isRTL)]}>
                  <Text style={[styles.histWho, h.isMe && styles.histMe, isRTL && styles.rtl]} numberOfLines={1}>
                    {h.isMe ? t('auctions.you') : t('auctions.bidderN', { n: h.bidderAlias })}
                    {h.isAuto ? ` · ${t('auctions.autoBid')}` : ''}
                  </Text>
                  <Text style={[styles.histAmount, isRTL && styles.rtl]}>{formatBidAmount(h.amount)}</Text>
                  <Text style={[styles.histWhen, isRTL && styles.histWhenRTL]}>{relativeTimeFrom(new Date(h.bidAt).getTime(), language)}</Text>
                </View>
              ))
            )}
          </View>

          {!!auction && (
            <Text style={[styles.feesNote, isRTL && styles.rtl]}>
              {t('auctions.feesLine', {
                buyer: String(auction.buyerPremiumPct),
                seller: String(auction.sellerCommissionPct),
              })}
            </Text>
          )}
        </ScrollView>
      )}

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior="padding">
            <View style={styles.sheet}>
              <View style={[styles.sheetBar, mirrorRow(isRTL)]}>
                <Text style={type.h3}>{t('auctions.placeBid')}</Text>
                <Pressy onPress={() => setSheetOpen(false)} style={styles.iconBtn}>
                  <Icon name="close" size={18} />
                </Pressy>
              </View>

              {/* The single most important sentence on this screen. Someone
                  who reads this box as "your bid" and types the current
                  price plus a dollar has not understood what they just
                  agreed to -- so it says maximum, explains that the house
                  bids up to it, and never uses the bare word "bid". */}
              <Text style={[styles.sheetLede, isRTL && styles.rtl]}>{t('auctions.maxExplainer')}</Text>
              {/* The reserve lift can move the price in one jump rather
                  than in the "small steps" above, so the one case where
                  that can happen says so before the bidder commits. */}
              {!!lot?.hasReserve && !lot.reserveMet && (
                <Text style={[styles.sheetLede, isRTL && styles.rtl]}>{t('auctions.reserveExplainer')}</Text>
              )}

              <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auctions.yourMaximum')}</Text>
              <TextInput
                value={bidText}
                onChangeText={setBidText}
                keyboardType="numeric"
                placeholder={String(minimum)}
                placeholderTextColor={colors.inkSoft}
                style={[styles.input, isRTL && styles.rtl]}
              />
              <Text style={[styles.hint, isRTL && styles.rtl]}>
                {lot?.viewerIsLeading && myMax !== null
                  ? t('auctions.raiseMaxHint', { min: formatBidAmount(myMax) })
                  : t('auctions.minimumHint', { min: formatBidAmount(minimum) })}
              </Text>

              <View style={[styles.quickRow, mirrorRow(isRTL)]}>
                {[0, 1, 2].map((step) => {
                  let v = minimum;
                  for (let i = 0; i < step; i++) v += bidIncrement(v);
                  return (
                    <Pressy key={step} onPress={() => setBidText(String(v))} style={styles.quick}>
                      <Text style={styles.quickText}>{formatBidAmount(v)}</Text>
                    </Pressy>
                  );
                })}
              </View>

              {!!sheetError && <Text style={[styles.error, isRTL && styles.rtl]}>{sheetError}</Text>}

              <Button label={t('auctions.confirmBid')} onPress={submit} loading={placing} style={{ marginTop: 14 }} />
              <Text style={[styles.binding, isRTL && styles.rtl]}>{t('auctions.bindingNote')}</Text>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 140 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  photoBox: {
    aspectRatio: 4 / 3, backgroundColor: colors.surface, borderRadius: radius.md,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mediaTabs: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  mediaTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, height: 32, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  mediaTabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  mediaTabText: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft },
  mediaTabTextOn: { color: colors.white },
  spinChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 10 },
  spinChip: {
    paddingHorizontal: 11, height: 30, borderRadius: radius.pill, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  spinChipOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  spinChipText: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  spinChipTextOn: { color: colors.primary },
  thumbs: { gap: 8, paddingVertical: 10 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbActive: { borderWidth: 2, borderColor: colors.primary },
  title: { ...type.h3, fontSize: 18, marginTop: 12, lineHeight: 24 },
  priceBox: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginTop: 12, gap: 2,
  },
  priceLabel: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, letterSpacing: 0.4 },
  price: { fontSize: 30, fontWeight: '800', color: colors.primary, letterSpacing: -0.6 },
  priceMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  reserveOk: { color: colors.primary, fontWeight: '700' },
  reserveWarn: { color: colors.accentDeep, fontWeight: '700' },
  clock: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginTop: 8 },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  leadText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  myMax: { ...type.tiny, marginTop: 4 },
  block: { marginTop: 22 },
  blockTitle: { ...type.h3, fontSize: 15, marginBottom: 8 },
  desc: { ...type.body, lineHeight: 21 },
  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  histWho: { flex: 1, fontSize: 12.5, color: colors.inkSoft },
  histMe: { color: colors.primary, fontWeight: '800' },
  histAmount: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  // A hardcoded 'right' inside a row that mirrors puts this column at the
  // physical left with its text jammed against the far edge of its box.
  histWhen: { ...type.tiny, width: 70, textAlign: 'right' },
  histWhenRTL: { textAlign: 'left' },
  feesNote: { ...type.tiny, marginTop: 20, lineHeight: 16 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(20,20,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 30,
  },
  sheetBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetLede: { ...type.soft, lineHeight: 19, marginBottom: 16 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    height: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 14, fontSize: 22, fontWeight: '800', color: colors.ink,
  },
  hint: { ...type.tiny, marginTop: 6 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  quick: {
    flex: 1, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  quickText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
  binding: { ...type.tiny, marginTop: 10, textAlign: 'center', lineHeight: 16 },
  empty: { alignItems: 'center', paddingTop: 40 },
  retry: {
    marginTop: 14, paddingHorizontal: 18, height: 40, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  retryText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
