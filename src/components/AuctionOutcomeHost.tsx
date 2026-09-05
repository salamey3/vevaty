import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Button from './Button';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { formatBidAmount } from '../lib/auctions';

// Tells a bidder how a lot ended, the first time they open the app after it
// closed. Mounted once beside AlertHost (see App.tsx) rather than on a
// screen, because a lot closes on its own clock and the bidder could be
// anywhere in the app -- or not in it at all -- when it happens.
//
// One at a time, oldest first. A bidder who slept through a fifteen-lot
// auction has fifteen of these waiting, and stacking them would bury the
// one that says they won something. Each is dismissed, marked seen, and the
// next appears behind it.
export default function AuctionOutcomeHost() {
  const { auctionAnnouncements, markAnnouncementSeen } = useAppStore();
  const { t, language, isRTL } = useLanguage();

  const current = auctionAnnouncements[0];
  if (!current) return null;

  const won = current.outcome === 'won';
  const unsold = current.outcome === 'unsold';
  const title = (language === 'ar' ? current.titleAr : current.titleEn)
    || current.titleEn || current.titleAr || '';

  const heading = won
    ? t('auctionOutcome.wonTitle')
    : unsold
    ? t('auctionOutcome.unsoldTitle')
    : t('auctionOutcome.lostTitle');

  const body = won
    ? t('auctionOutcome.wonBody', { amount: formatBidAmount(current.amount ?? 0) })
    : unsold
    ? t('auctionOutcome.unsoldBody')
    : t('auctionOutcome.lostBody');

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => markAnnouncementSeen(current.id)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.crest, won && styles.crestWon]}>
            <Icon
              name={won ? 'trophy' : 'gavel'}
              size={26}
              color={won ? colors.accentDeep : colors.inkSoft}
            />
          </View>

          {current.lotNumber !== null && (
            <Text style={[styles.lotLine, isRTL && styles.rtl]}>
              {t('auctionOutcome.lotLine', { number: String(current.lotNumber) })}
            </Text>
          )}

          <Text style={[styles.heading, isRTL && styles.rtl]}>{heading}</Text>

          {!!title && (
            <Text style={[styles.item, isRTL && styles.rtl]} numberOfLines={2}>{title}</Text>
          )}

          <Text style={[styles.body, isRTL && styles.rtl]}>{body}</Text>

          <Button
            label={t('auctionOutcome.dismiss')}
            onPress={() => markAnnouncementSeen(current.id)}
            style={styles.cta}
          />

          {/* Deliberately no "view the lot" link. A closed lot is not a page
              worth sending somebody to -- there is nothing left to do on it,
              and for a winner the next step is the chat message Vevaty has
              already posted, which is where the handover gets arranged. */}
          {auctionAnnouncements.length > 1 && (
            <Text style={styles.more}>
              {t('auctionOutcome.more', { count: String(auctionAnnouncements.length - 1) })}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  crest: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  crestWon: { backgroundColor: colors.accentTint },
  lotLine: {
    ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, color: colors.inkSoft,
  },
  heading: { ...type.h2, textAlign: 'center' },
  item: {
    fontSize: 13.5, fontWeight: '600', color: colors.inkSoft,
    textAlign: 'center', marginTop: 2,
  },
  body: {
    fontSize: 14, color: colors.ink, textAlign: 'center',
    lineHeight: 20, marginTop: 8,
  },
  cta: { alignSelf: 'stretch', marginTop: 18 },
  more: { ...type.tiny, color: colors.inkSoft, marginTop: 10 },
  rtl: { writingDirection: 'rtl' },
});
