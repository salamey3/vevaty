import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import AuctionCountdown from './AuctionCountdown';
import { colors, radius, type } from '../theme/theme';
import { AuctionLot, Listing } from '../types';
import { listingTitle } from '../lib/listingText';
import { sizedPhotoUrl } from '../lib/photoSize';
import { formatBidAmount } from '../lib/auctions';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';

// One lot in an auction's grid.
//
// NOT ListingCard. They look alike on purpose but they answer different
// questions: a listing card says what a thing is and what it costs, and a
// lot card says what it is, what it has REACHED, and how long is left. A
// price with no clock beside it is the one thing a lot card must never
// look like, because that is what tells a buyer they can think about it.
export default function AuctionLotCard({
  lot,
  listing,
  width,
  onPress,
}: {
  lot: AuctionLot;
  listing: Listing | undefined;
  width: number;
  onPress: () => void;
}) {
  const { t, language, isRTL } = useLanguage();
  const photo = listing?.coverThumbnailUrl ?? listing?.photos?.[0] ?? null;
  const closed = lot.status !== 'live' && lot.status !== 'pending';
  const price = lot.currentPrice ?? lot.startPrice;

  return (
    <Pressy onPress={onPress} style={[styles.card, { width }]}>
      <View style={styles.thumb}>
        {photo ? (
          <Image source={{ uri: sizedPhotoUrl(photo, 400)! }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          <Icon name="gavel" size={28} color={colors.inkSoft} />
        )}
        <View style={styles.lotBadge}>
          <Text style={styles.lotBadgeText}>{t('auctions.lotN', { n: lot.lotNumber })}</Text>
        </View>
        {/* The viewer's own standing is the one piece of state worth
            putting on the photo: someone scanning fifteen lots is looking
            for the ones they are losing. */}
        {lot.viewerIsLeading && lot.status === 'live' && (
          <View style={[styles.leadBadge, mirrorRow(isRTL)]}>
            <Icon name="check" size={10} color={colors.white} strokeWidth={2.6} />
            <Text style={styles.leadBadgeText}>{t('auctions.youLead')}</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={[styles.title, isRTL && styles.rtl]} numberOfLines={2}>
          {listing ? listingTitle(listing, language) : t('auctions.lotN', { n: lot.lotNumber })}
        </Text>

        <Text style={[styles.priceLabel, isRTL && styles.rtl]}>
          {lot.currentPrice === null ? t('auctions.startsAt') : t('auctions.currentBid')}
        </Text>
        <Text style={[styles.price, isRTL && styles.rtl]} numberOfLines={1}>
          {formatBidAmount(price)}
        </Text>

        <View style={[styles.metaRow, mirrorRow(isRTL)]}>
          {/* Bid count and reserve state sit together because they answer
              the same question -- is this contested, and is it going to
              sell. A lot with bids that has not met its reserve is the
              case a bidder most needs to be told about. */}
          <Text style={styles.meta} numberOfLines={1}>
            {lot.bidCount === 0 ? t('auctions.bidCountNone')
              : lot.bidCount === 1 ? t('auctions.bidCountOne')
              : t('auctions.bidCount', { n: lot.bidCount })}
          </Text>
          {lot.hasReserve && !lot.reserveMet && (
            <Text style={[styles.meta, styles.reserveWarn]} numberOfLines={1}>
              {t('auctions.reserveNotMet')}
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        {closed ? (
          <Text style={[styles.closedLine, isRTL && styles.rtl]} numberOfLines={1}>
            {lot.status === 'won' || lot.status === 'settled'
              ? t('auctions.soldFor', { amount: formatBidAmount(lot.winningAmount ?? price) })
              : lot.status === 'cancelled'
              ? t('auctions.withdrawn')
              : t('auctions.unsold')}
          </Text>
        ) : (
          <AuctionCountdown closesAt={lot.closesAt} style={[styles.clock, isRTL && styles.rtl] as any} />
        )}
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    marginBottom: 8,
  },
  // 4:3, matching the browse card exactly -- a lot is the same object
  // photographed the same way, and a second aspect ratio in the same app
  // reads as a different product.
  thumb: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  lotBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(20,20,22,0.72)',
    borderRadius: radius.pill, paddingHorizontal: 8, height: 20, justifyContent: 'center',
  },
  lotBadgeText: { fontSize: 10.5, fontWeight: '800', color: colors.white },
  leadBadge: {
    position: 'absolute', bottom: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill, paddingHorizontal: 8, height: 20,
  },
  leadBadgeText: { fontSize: 10.5, fontWeight: '800', color: colors.white },
  info: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 10, gap: 3 },
  title: { fontSize: 13.5, fontWeight: '700', color: colors.ink, lineHeight: 18.5, minHeight: 37 },
  priceLabel: { fontSize: 11, fontWeight: '600', color: colors.inkSoft, marginTop: 3 },
  price: { fontSize: 17, fontWeight: '800', color: colors.primary, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  meta: { ...type.tiny },
  reserveWarn: { color: colors.accentDeep, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.line, marginHorizontal: 2, marginTop: 8, marginBottom: 6 },
  clock: { fontSize: 12, fontWeight: '700', color: colors.ink },
  closedLine: { fontSize: 12, fontWeight: '700', color: colors.inkSoft },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
