import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCallback as useCb } from 'react';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import AuctionCountdown from '../components/AuctionCountdown';
import { colors, radius, type } from '../theme/theme';
import { Auction } from '../types';
import { fetchAuctions } from '../lib/auctions';
import { mirrorRow } from '../lib/mirrorRow';
import { pickText } from '../lib/listingText';
import { useLanguage } from '../i18n/LanguageContext';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';

// The auction section's front door, reached from the fourth tile on the
// browse gate.
//
// Three groups, in this order, and the order is the point: what is
// happening now, what is coming, what happened. A fortnightly event is
// dead for twelve days out of fourteen, so a section that showed only the
// live auction would be an empty room most of the time -- past results are
// what make it worth opening on a Tuesday, and they are also the only
// evidence a new bidder has that this is real.
export default function AuctionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t, language, isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setAuctions(await fetchAuctions());
      setFailed(false);
    } catch {
      // An empty list and a failed fetch look identical on screen and are
      // not the same thing -- "no auctions yet" is a true statement about
      // the marketplace, and showing it when the network simply failed is
      // a lie the user cannot tell from the truth.
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on focus and tick slowly, or a scheduled auction whose opening
  // time passes while this list is on screen sits under "Opening soon"
  // reading "Ended" forever. advance_auctions flips it within a minute.
  useFocusEffect(
    useCb(() => {
      load();
      const id = setInterval(load, 30000);
      return () => clearInterval(id);
    }, [load])
  );

  const live = auctions.filter((a) => a.status === 'live');
  const upcoming = auctions.filter((a) => a.status === 'scheduled');
  const past = auctions.filter((a) => a.status === 'closed' || a.status === 'settled');

  const card = (a: Auction) => {
    const isLive = a.status === 'live';
    return (
      <Pressy
        key={a.id}
        onPress={() => navigation.navigate('Auction', { auctionId: a.id })}
        style={styles.card}
      >
        <View style={[styles.cardTop, mirrorRow(isRTL)]}>
          <View style={styles.cardIcon}>
            <Icon name="gavel" size={18} color={colors.primary} />
          </View>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, isRTL && styles.rtl]} numberOfLines={2}>
              {pickText(a.titleEn, a.titleAr, language)}
            </Text>
            {isLive ? (
              <AuctionCountdown
                closesAt={a.firstLotClosesAt}
                prefix={t('auctions.firstLotClosesIn')}
                style={[styles.cardMeta, styles.cardMetaLive, isRTL && styles.rtl] as any}
              />
            ) : a.status === 'scheduled' ? (
              <AuctionCountdown
                closesAt={a.opensAt}
                prefix={t('auctions.opensIn')}
                style={[styles.cardMeta, isRTL && styles.rtl] as any}
              />
            ) : (
              <Text style={[styles.cardMeta, isRTL && styles.rtl]}>{t('auctions.finished')}</Text>
            )}
          </View>
          <Icon name="chevronRight" size={16} color={colors.inkSoft} />
        </View>
        {isLive && <View style={styles.liveStrip}><Text style={styles.liveStripText}>{t('auctions.biddingOpen')}</Text></View>}
      </Pressy>
    );
  };

  const section = (title: string, items: Auction[]) =>
    items.length > 0 && (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.rtl]}>{title}</Text>
        {items.map(card)}
      </View>
    );

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={[styles.topBar, mirrorRow(isRTL)]}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('auctions.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <Text style={[styles.lede, isRTL && styles.rtl]}>{t('auctions.lede')}</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : failed ? (
          <View style={styles.empty}>
            <Text style={type.body}>{t('auctions.loadFailed')}</Text>
            <Pressy onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          </View>
        ) : auctions.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="gavel" size={30} color={colors.inkSoft} />
            <Text style={[type.body, { marginTop: 10 }]}>{t('auctions.emptyTitle')}</Text>
            <Text style={type.soft}>{t('auctions.emptySub')}</Text>
          </View>
        ) : (
          <>
            {section(t('auctions.biddingNow'), live)}
            {section(t('auctions.openingSoon'), upcoming)}
            {section(t('auctions.pastResults'), past)}
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
  lede: { ...type.soft, marginTop: 4, marginBottom: 18, lineHeight: 20 },
  section: { marginBottom: 22 },
  sectionTitle: { ...type.h3, fontSize: 16, marginBottom: 10 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderTopLeftRadius: radius.md, borderBottomRightRadius: radius.md,
    overflow: 'hidden', marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  cardIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  cardMeta: { ...type.tiny },
  cardMetaLive: { color: colors.primary, fontWeight: '700' },
  liveStrip: { backgroundColor: colors.primary, paddingVertical: 5, alignItems: 'center' },
  liveStripText: { fontSize: 11, fontWeight: '800', color: colors.white, letterSpacing: 0.6 },
  empty: { alignItems: 'center', paddingTop: 50, gap: 4 },
  retry: {
    marginTop: 14, paddingHorizontal: 18, height: 40, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  retryText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
