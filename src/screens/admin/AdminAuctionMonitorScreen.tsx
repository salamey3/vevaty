import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { AuctionMonitor, fetchAuctionMonitor, formatBidAmount } from '../../lib/auctions';
import { RootStackParamList } from '../../navigation/types';

// Watching a sale happen: every lot on one screen with who is leading it
// and what they just paid, plus one feed of bids across the whole auction.
// Read-only on purpose -- the place to CHANGE a lot is AdminAuctionLots.
//
// Live by two mechanisms, deliberately both:
//
//   - A realtime subscription on myazar.auction_bids, so a bid appears
//     within a moment of being placed. It is used as a NUDGE, not as the
//     data: the payload carries a bidder_id, not a name, and none of the
//     derived state (who now leads, whether the reserve is met, whether
//     anti-snipe moved the clock) is in the row. So an event just triggers
//     the same refetch the poll uses, and the screen never has to
//     reimplement the bidding engine to stay correct.
//   - A ten-second poll underneath it. A dropped socket, a throttled
//     background tab, or a table missing from the realtime publication
//     would otherwise leave this frozen while looking live, which is worse
//     than plainly being ten seconds behind.
//
// The countdown ticks locally off each lot's closes_at rather than asking
// the server every second.
export default function AdminAuctionMonitorScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AdminAuctionMonitor'>>();
  const auctionId = route.params.auctionId;

  const [data, setData] = useState<AuctionMonitor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  // Re-rendered once a second purely to move the countdowns.
  const [, setTick] = useState(0);

  // Guards against a slow request landing on top of a newer one and
  // painting an older picture of a sale that is actively moving.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const next = await fetchAuctionMonitor(auctionId);
      if (seq !== seqRef.current) return;
      setData(next);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      setError(e?.message === 'not_admin' ? 'This account is not an admin.' : e?.message || String(e));
    }
  }, [auctionId]);

  useEffect(() => { load(); }, [load]);

  // The poll, and the one-second clock for the countdowns.
  useEffect(() => {
    const poll = setInterval(load, 10000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  // The nudge.
  useEffect(() => {
    const channel = supabase
      .channel(`auction_monitor:${auctionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'myazar', table: 'auction_bids' }, () => {
        // Not filtered to this auction: the filter would have to be on
        // lot_id, which this screen would have to enumerate and keep in
        // step as lots are added. A refetch is cheap and always right.
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [auctionId, load]);

  const countdown = (closesAt: string | null) => {
    if (!closesAt) return '—';
    const ms = new Date(closesAt).getTime() - Date.now();
    if (ms <= 0) return 'closed';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
    return `${sec}s`;
  };

  const clockTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <Screen maxWidth={980}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3} numberOfLines={1}>{data?.title || 'Live monitor'}</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      {!data && !error ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      ) : data ? (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.headerRow}>
            <View style={[styles.statusPill, data.status === 'live' && styles.statusPillLive]}>
              {data.status === 'live' && <View style={styles.livePip} />}
              <Text style={[styles.statusPillText, data.status === 'live' && styles.statusPillTextLive]}>
                {data.status}
              </Text>
            </View>
            <Text style={styles.headerMeta}>
              {data.registeredBidders} registered {data.registeredBidders === 1 ? 'bidder' : 'bidders'}
              {data.antiSnipeSeconds > 0 ? ` · anti-snipe ${data.antiSnipeSeconds}s` : ''}
            </Text>
            <Text style={styles.updated}>
              updated {lastUpdated ? clockTime(new Date(lastUpdated).toISOString()) : '—'}
            </Text>
          </View>

          {/* ---- the lots ---- */}
          <Text style={styles.sectionTitle}>Lots</Text>
          {data.lots.length === 0 && <Text style={type.soft}>No lots in this auction yet.</Text>}
          {data.lots.map((l) => {
            const live = l.status === 'live';
            return (
              <View key={l.lotId} style={[styles.lotCard, live && styles.lotCardLive]}>
                <View style={styles.lotTop}>
                  <Text style={styles.lotNum}>LOT {l.lotNumber}</Text>
                  <Text style={styles.lotTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={[styles.lotClock, live && styles.lotClockLive]}>
                    {live ? countdown(l.closesAt) : l.status}
                  </Text>
                </View>

                <View style={styles.lotFigures}>
                  <View style={styles.figure}>
                    <Text style={styles.figureLabel}>Current</Text>
                    <Text style={styles.figureValue}>
                      {l.currentPrice == null ? '—' : formatBidAmount(l.currentPrice)}
                    </Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={styles.figureLabel}>Reserve</Text>
                    <Text style={[styles.figureValue, styles.figureSmall, l.reserveMet && styles.metText]}>
                      {l.reservePrice == null ? 'none' : `${formatBidAmount(l.reservePrice)}${l.reserveMet ? ' ✓' : ''}`}
                    </Text>
                  </View>
                  <View style={styles.figure}>
                    <Text style={styles.figureLabel}>Bids</Text>
                    <Text style={[styles.figureValue, styles.figureSmall]}>{l.bidCount}</Text>
                  </View>
                </View>

                <View style={styles.leaderRow}>
                  <Icon name="user" size={13} color={colors.inkSoft} />
                  <Text style={styles.leaderText} numberOfLines={1}>
                    {l.winner
                      ? `Won by ${l.winner}`
                      : l.leader
                      ? l.leader
                      : 'No bids yet'}
                  </Text>
                  {/* The ceiling is the whole point of watching a proxy
                      auction: it says how much room the leader still has. */}
                  {l.leaderMax != null && !l.winner && (
                    <Text style={styles.leaderMax}>max {formatBidAmount(l.leaderMax)}</Text>
                  )}
                </View>
              </View>
            );
          })}

          {/* ---- the feed ---- */}
          <Text style={styles.sectionTitle}>Bids as they land</Text>
          {data.feed.length === 0 ? (
            <Text style={type.soft}>Nothing bid yet.</Text>
          ) : (
            <View style={styles.feed}>
              {data.feed.map((b) => (
                <View key={b.id} style={styles.feedRow}>
                  <Text style={styles.feedTime}>{clockTime(b.createdAt)}</Text>
                  <Text style={styles.feedLot}>L{b.lotNumber}</Text>
                  <Text style={styles.feedWho} numberOfLines={1}>{b.bidder}</Text>
                  {b.isAuto && (
                    <View style={styles.autoPill}>
                      <Text style={styles.autoPillText}>auto</Text>
                    </View>
                  )}
                  <Text style={styles.feedAmount}>{formatBidAmount(b.amount)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.footnote}>
            Updates the moment a bid lands, and refreshes every ten seconds regardless — so a dropped
            connection shows as stale rather than as quiet. "max" is the most that bidder has authorised;
            an "auto" row is the system bidding on their behalf to hold the lead.
          </Text>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48, gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  body: { paddingHorizontal: 18, paddingBottom: 80 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, height: 24, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  statusPillLive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  livePip: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  statusPillText: { fontSize: 11, fontWeight: '700', color: colors.inkSoft, textTransform: 'uppercase' },
  statusPillTextLive: { color: colors.primary },
  headerMeta: { ...type.tiny, color: colors.inkSoft },
  updated: { ...type.tiny, color: colors.inkSoft, marginLeft: 'auto' },

  sectionTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },

  lotCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, marginBottom: 8, gap: 10,
  },
  lotCardLive: { borderColor: colors.primary },
  lotTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lotNum: { ...type.tiny, fontWeight: '800', color: colors.inkSoft },
  lotTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink },
  lotClock: { ...type.tiny, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
  lotClockLive: { color: colors.primary, fontWeight: '700' },

  lotFigures: { flexDirection: 'row', gap: 22 },
  figure: { gap: 2 },
  figureLabel: { ...type.tiny, color: colors.inkSoft },
  figureValue: { fontSize: 17, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  figureSmall: { fontSize: 13.5, fontWeight: '600' },
  metText: { color: colors.primary },

  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9,
  },
  leaderText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  leaderMax: { ...type.tiny, color: colors.inkSoft, fontVariant: ['tabular-nums'] },

  feed: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, paddingHorizontal: 12,
  },
  feedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  feedTime: { ...type.tiny, color: colors.inkSoft, fontVariant: ['tabular-nums'], width: 60 },
  feedLot: { ...type.tiny, fontWeight: '800', color: colors.inkSoft, width: 26 },
  feedWho: { flex: 1, fontSize: 13, color: colors.ink },
  autoPill: {
    paddingHorizontal: 6, height: 17, borderRadius: radius.pill,
    backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center',
  },
  autoPillText: { fontSize: 9.5, fontWeight: '800', color: colors.accentDeep, textTransform: 'uppercase' },
  feedAmount: { fontSize: 13.5, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },

  footnote: { ...type.tiny, textTransform: 'none', letterSpacing: 0, lineHeight: 16, marginTop: 18, color: colors.inkSoft },
});
