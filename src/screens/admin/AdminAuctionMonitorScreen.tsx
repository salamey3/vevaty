import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { AuctionMonitor, fetchAuctionMonitor, formatBidAmount, formatMoney } from '../../lib/auctions';
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
//
// It is the sale's books as well as its scoreboard, and it does not wait
// for the close to start being one. A lot that WOULD sell if the clock
// stopped -- live, with a leader, reserve met -- shows the same six
// figures as a projection, recomputed on every refetch, so the numbers
// move with each outbid. A lot still short of its reserve is heading for
// unsold and shows nothing: projecting it would invent revenue from a
// sale that is not going to happen.
//
// The running total sits ABOVE the lots, because "what is this sale worth
// to us right now" is the question being asked every few seconds, and
// putting it under fifteen lot cards means scrolling to it every time.
//
// None of the arithmetic happens here -- it comes from
// myazar.lot_settlement() and myazar.sum_settlements() so that the
// invoices settlement eventually generates cannot disagree with what the
// admin read off this screen.
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
              {' · default terms '}{data.sellerCommissionPct}/{data.buyerPremiumPct}
            </Text>
            <Text style={styles.updated}>
              updated {lastUpdated ? clockTime(new Date(lastUpdated).toISOString()) : '—'}
            </Text>
          </View>

          {/* ---- what the sale is worth, right now ---- */}
          {/* Shown whenever there is anything to say -- including a sale
              where every bid-on lot is under its reserve, which is
              precisely when "why is the take zero" needs answering, and a
              finished sale where nothing sold. */}
          {(data.combined.lots > 0
            || data.settlement.lotsUnderReserve > 0
            || data.settlement.lotsUnsold > 0) && (
            <View style={styles.take}>
              <Text style={styles.takeLabel}>Vevaty — this sale</Text>
              <Text style={styles.takeValue}>{formatMoney(data.combined.vevatyTake)}</Text>
              <Text style={styles.takeSub}>
                on {formatMoney(data.combined.hammer)} hammer across {data.combined.lots}
                {data.combined.lots === 1 ? ' lot' : ' lots'} of {data.settlement.lotsTotal}
              </Text>

              {/* Banked and provisional kept apart. They are not the same
                  kind of number and a single total that silently mixes
                  them is how a forecast gets mistaken for a receipt. */}
              <View style={styles.takeSplit}>
                <View style={styles.takeCol}>
                  <Text style={styles.takeColLabel}>Settled</Text>
                  <Text style={styles.takeColValue}>{formatMoney(data.settlement.vevatyTake)}</Text>
                  <Text style={styles.takeColSub}>
                    {data.settlement.lotsWon} won
                    {data.settlement.lotsUnsold > 0 ? ` · ${data.settlement.lotsUnsold} unsold` : ''}
                  </Text>
                </View>
                <View style={styles.takeDivider} />
                <View style={styles.takeCol}>
                  <Text style={styles.takeColLabel}>Projected</Text>
                  <Text style={[styles.takeColValue, styles.projectedInk]}>
                    {formatMoney(data.projection.vevatyTake)}
                  </Text>
                  {/* "would sell", not "still running": the books below
                      use "still running" for every open lot, and a column
                      that counted only the ones over reserve while naming
                      more beside it contradicted itself. */}
                  <Text style={styles.takeColSub}>
                    {data.projection.lots} would sell
                    {data.settlement.lotsUnderReserve > 0
                      ? ` · ${data.settlement.lotsUnderReserve} under reserve`
                      : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.takeFeet}>
                <Text style={styles.takeFoot}>
                  Sellers collect <Text style={styles.takeFootNum}>{formatMoney(data.combined.sellerPayout)}</Text>
                </Text>
                <Text style={styles.takeFoot}>
                  Buyers pay <Text style={styles.takeFootNum}>{formatMoney(data.combined.buyerTotal)}</Text>
                </Text>
              </View>
            </View>
          )}

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
                  {l.ratesCustom && (
                    <View style={styles.termsPill}>
                      <Text style={styles.termsPillText}>
                        {l.sellerPct}/{l.buyerPct}
                      </Text>
                    </View>
                  )}
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

                {/* The money, once there is any. Two sides, side by side,
                    because they are two different invoices to two
                    different people -- not one number split up. */}
                {l.settlement && (
                  <View style={[styles.moneyWrap, l.settlementBasis === 'projected' && styles.moneyWrapProjected]}>
                  {l.settlementBasis === 'projected' && (
                    <Text style={styles.projectedTag}>if it closed now</Text>
                  )}
                  <View style={styles.money}>
                    <View style={styles.moneySide}>
                      <Text style={styles.moneyWho} numberOfLines={1}>
                        {l.seller} collects
                      </Text>
                      <Text style={styles.moneyBig}>{formatMoney(l.settlement.sellerPayout)}</Text>
                      <Text style={styles.moneyWorking}>
                        {formatMoney(l.settlement.hammer)} hammer − {formatMoney(l.settlement.sellerCommission)}
                        {' '}commission ({l.sellerPct}%)
                      </Text>
                    </View>
                    <View style={styles.moneyDivider} />
                    <View style={styles.moneySide}>
                      <Text style={styles.moneyWho} numberOfLines={1}>
                        {l.winner || l.leader || 'Buyer'} pays
                      </Text>
                      <Text style={styles.moneyBig}>{formatMoney(l.settlement.buyerTotal)}</Text>
                      <Text style={styles.moneyWorking}>
                        {formatMoney(l.settlement.hammer)} hammer + {formatMoney(l.settlement.buyerPremium)}
                        {' '}premium ({l.buyerPct}%)
                      </Text>
                    </View>
                  </View>
                  </View>
                )}
                {l.settlement && (
                  <Text style={[styles.moneyTake, l.settlementBasis === 'projected' && styles.projectedInk]}>
                    Vevaty {formatMoney(l.settlement.vevatyTake)}
                  </Text>
                )}
                {/* Bid on, but not going to sell as it stands. Said out
                    loud, because an empty space where every other lot has
                    money reads as a bug rather than as a fact. */}
                {!l.settlement && l.status === 'live' && l.leaderId && !l.reserveMet && (
                  <Text style={styles.noMoneyYet}>
                    {/* Past its close but not yet swept: advance_auctions
                        runs on a one-minute tick, so for up to a minute a
                        finished lot is still 'live' and telling the reader
                        the bidding could still clear the reserve would be
                        a lie by then. */}
                    {l.closesAt && new Date(l.closesAt).getTime() <= Date.now()
                      ? 'Under reserve at the close — heading for unsold, nothing owed'
                      : `Under reserve — nothing owed unless the bidding clears ${formatBidAmount(l.reservePrice ?? 0)}`}
                  </Text>
                )}
              </View>
            );
          })}

          {/* ---- the auction's books ---- */}
          {data.settlement.lotsWon > 0 && (
            <>
              <Text style={styles.sectionTitle}>The books — settled lots only</Text>
              <View style={styles.books}>
                <Text style={styles.booksLead}>
                  {data.settlement.lotsWon} of {data.settlement.lotsTotal} lots sold
                  {data.settlement.lotsUnsold > 0 ? ` · ${data.settlement.lotsUnsold} unsold` : ''}
                  {data.settlement.lotsOpen > 0 ? ` · ${data.settlement.lotsOpen} still running` : ''}
                </Text>
                <BooksRow label="Total hammer" value={data.settlement.hammer} />
                <BooksRow label="Seller commission" value={data.settlement.sellerCommission} />
                <BooksRow label="Payable to sellers" value={data.settlement.sellerPayout} strong />
                <BooksRow label="Buyer's premium" value={data.settlement.buyerPremium} />
                <BooksRow label="Collectable from buyers" value={data.settlement.buyerTotal} strong />
                <BooksRow label="Vevaty's take" value={data.settlement.vevatyTake} accent />
              </View>
            </>
          )}

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
            {'\n\n'}
            Money appears on a lot only once it is won — an unsold lot charges nobody. The seller's
            commission comes off the hammer; the buyer's premium goes on top of it, so the two sides
            are two separate invoices. Each lot settles at its own agreed rates — a lot showing a
            pill like "6/15" was negotiated, the rest run on the sale's default terms — which is why
            the totals are the sum of the lot lines and not a percentage of the total hammer. Rates
            freeze the moment a lot is won, so a settled account cannot be restated.
            {'\n\n'}
            A lot that would sell if the clock stopped shows its money as a projection, marked
            "if it closed now", and it moves with every bid. A lot still under its reserve shows
            none — it is heading for unsold, and counting it would be inventing revenue. The
            panel at the top keeps settled and projected apart for the same reason.
          </Text>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

// One line of the auction's books. Its own component only because the
// label/value/emphasis triple is repeated six times and a stray style on
// one of them is the kind of thing nobody notices on a money screen.
function BooksRow({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: number;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <View style={styles.booksRow}>
      <Text style={[styles.booksLabel, (strong || accent) && styles.booksLabelStrong]}>{label}</Text>
      <Text
        style={[
          styles.booksValue,
          strong && styles.booksValueStrong,
          accent && styles.booksAccent,
        ]}
      >
        {formatMoney(value)}
      </Text>
    </View>
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

  take: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.md, padding: 15, marginTop: 12,
  },
  takeLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.inkSoft },
  takeValue: {
    fontSize: 30, lineHeight: 36, fontWeight: '800', color: colors.ink,
    fontVariant: ['tabular-nums'], marginTop: 2,
  },
  takeSub: { ...type.tiny, color: colors.inkSoft, marginTop: 1 },
  takeSplit: {
    flexDirection: 'row', gap: 14, marginTop: 13, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  takeCol: { flex: 1, gap: 1 },
  takeDivider: { width: 1, backgroundColor: colors.line },
  takeColLabel: { ...type.tiny, color: colors.inkSoft },
  takeColValue: { fontSize: 17, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  takeColSub: { fontSize: 10.5, lineHeight: 14, color: colors.inkSoft },
  takeFeet: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line,
  },
  takeFoot: { ...type.tiny, color: colors.inkSoft },
  takeFootNum: { color: colors.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },

  // Projected money is the brand gold, settled money is ink. One glance
  // has to say which is a receipt and which is a forecast.
  projectedInk: { color: colors.accentDeep },
  projectedTag: {
    fontSize: 9.5, fontWeight: '800', color: colors.accentDeep,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
  },
  noMoneyYet: { ...type.tiny, color: colors.inkSoft, fontStyle: 'italic' },

  lotCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, marginBottom: 8, gap: 10,
  },
  lotCardLive: { borderColor: colors.primary },
  lotTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lotNum: { ...type.tiny, fontWeight: '800', color: colors.inkSoft },
  lotTitle: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink },
  lotClock: { ...type.tiny, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
  termsPill: {
    paddingHorizontal: 6, height: 17, borderRadius: radius.pill,
    backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center',
  },
  termsPillText: {
    fontSize: 9.5, fontWeight: '800', color: colors.primary, fontVariant: ['tabular-nums'],
  },
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

  // The wrapper carries the tint and the tag; the row inside it stays a
  // row. Putting the tag inside `money` and flipping it to a column
  // stacked the seller and buyer sides on top of each other, which is the
  // one thing the side-by-side layout exists to avoid.
  moneyWrap: { backgroundColor: colors.surface, borderRadius: radius.sm, padding: 11 },
  moneyWrapProjected: { backgroundColor: colors.accentTint },
  money: { flexDirection: 'row', gap: 12 },
  moneySide: { flex: 1, gap: 2 },
  moneyDivider: { width: 1, backgroundColor: colors.line },
  moneyWho: { ...type.tiny, color: colors.inkSoft },
  moneyBig: { fontSize: 16, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  moneyWorking: { fontSize: 10.5, lineHeight: 14, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
  // Ink by default so that projectedInk below actually changes something:
  // both were accentDeep, which made the conditional a no-op and left
  // settled and projected takes pixel-identical on this line.
  moneyTake: { ...type.tiny, color: colors.ink, fontWeight: '700', textAlign: 'right' },

  books: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 4,
  },
  booksLead: { ...type.tiny, color: colors.inkSoft, paddingTop: 9, paddingBottom: 3 },
  booksRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line,
  },
  booksLabel: { flex: 1, fontSize: 13, color: colors.inkSoft },
  booksLabelStrong: { color: colors.ink, fontWeight: '700' },
  booksValue: { fontSize: 13.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  booksValueStrong: { fontSize: 15, fontWeight: '800' },
  booksAccent: { color: colors.accentDeep, fontWeight: '800', fontSize: 15 },

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
