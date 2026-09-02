import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { Listing } from '../../types';
import { listingTitle } from '../../lib/listingText';
import {
  AdminLotRow, addAuctionLot, cancelAuctionLot, fetchAdminAuctionLots, fetchLotListings,
  formatBidAmount, removeAuctionLot,
} from '../../lib/auctions';
import { adminMessage } from './AdminAuctionsScreen';
import { useAppStore } from '../../store/AppStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { DESKTOP_CONTENT_MAX_WIDTH } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';

// Adding lots to an auction.
//
// A lot is built from an EXISTING listing rather than from a new form, and
// that is the whole point of a lot being a listing: the photos, the 360
// spin and the video come from the app's own posting flow, which is
// already the best tooling here for producing them. Adding a lot flips
// that listing's status to 'auction', which takes it out of the
// marketplace and puts it in the sale.
export default function AdminAuctionLotsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { auctionId } = useRoute<RouteProp<RootStackParamList, 'AdminAuctionLots'>>().params;
  const { language } = useLanguage();
  const { listings, profile } = useAppStore();

  const [lots, setLots] = useState<AdminLotRow[]>([]);
  const [lotListings, setLotListings] = useState<Record<string, Listing>>({});
  // 'unknown', not 'draft': a failed read must not leave the screen
  // offering Add and Remove on a published auction, where every action
  // then fails with already_published.
  const [status, setStatus] = useState<string>('unknown');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Listing | null>(null);
  const [startPrice, setStartPrice] = useState('');
  const [reserve, setReserve] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: auctionRow, error: auctionErr }, mapped] = await Promise.all([
        supabase.from('auctions').select('status').eq('id', auctionId).maybeSingle(),
        // An RPC, not a select. reserve_price is granted to service_role
        // ONLY, and naming an ungranted column fails the whole statement
        // (@AGENTS.md) -- the first version of this screen selected it and
        // came back empty for every admin, permanently.
        fetchAdminAuctionLots(auctionId),
      ]);
      // NOT `|| 'draft'`: defaulting a failed read to draft shows Add and
      // Remove on a published auction, and every one of those actions then
      // fails with already_published. Unknown is treated as not-draft.
      if (auctionErr) throw auctionErr;
      setStatus(auctionRow?.status || 'unknown');
      setLots(mapped);
      if (mapped.length) {
        const rows = await fetchLotListings(mapped.map((l) => l.listingId));
        setLotListings(Object.fromEntries(rows.map((r) => [r.id, r])));
      }
    } catch (e: any) {
      setStatus('unknown');
      Alert.alert('Could not load lots', adminMessage(e));
    } finally {
      setLoading(false);
    }
  }, [auctionId]);

  useEffect(() => { load(); }, [load]);

  // The admin's OWN active listings. The filter is the point, not the
  // comment: adding a lot flips the row out of the marketplace, and doing
  // that to somebody else's listing from a picker is not something this
  // flow should make easy. A consigned item is posted by the Vevaty
  // account anyway -- that is what custody means.
  const candidates = listings.filter((l) => l.status === 'active' && l.sellerId === profile.id);

  const addLot = async () => {
    if (!chosen) return;
    const start = Number(startPrice);
    const res = reserve.trim() ? Number(reserve) : null;
    if (!Number.isFinite(start) || start <= 0) { Alert.alert('Start price', 'Enter a start price above zero.'); return; }
    if (res !== null && (!Number.isFinite(res) || res < start)) {
      Alert.alert('Reserve', 'A reserve cannot be below the start price.');
      return;
    }
    setBusy(true);
    // ONE call. This used to be two writes from here -- insert the lot,
    // then flip the listing -- and either half could land alone. A lot with
    // its listing still active puts an auction item into the browse grid;
    // a flipped listing with no lot is invisible to both the marketplace
    // and the auction, and no screen in the app points at it. Both halves
    // are one transaction inside add_auction_lot now.
    try {
      await addAuctionLot({
        auctionId, listingId: chosen.id, startPrice: start, reservePrice: res,
      });
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not add lot', adminMessage(e));
      return;
    }
    setBusy(false);
    setChosen(null);
    setStartPrice('');
    setReserve('');
    setPicking(false);
    load();
  };

  const removeLot = async (lot: AdminLotRow) => {
    setBusy(true);
    // Also one call, and this pair was the dangerous one: the delete could
    // succeed, the restore fail unread, and the listing strand at status
    // 'auction' with nothing pointing at it. remove_auction_lot puts it
    // back, restamps its expiry and closes the lot-number gap, atomically.
    try {
      await removeAuctionLot(lot.id);
    } catch (e: any) {
      Alert.alert('Could not remove', adminMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  };

  const withdrawLot = async (lot: AdminLotRow) => {
    setBusy(true);
    try {
      await cancelAuctionLot(lot.id);
    } catch (e: any) {
      Alert.alert('Could not withdraw', adminMessage(e));
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Lots</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.note}>
          {status === 'draft'
            ? 'Draft — add lots, then publish from the auctions list.'
            : `Published (${status}). Lots can only be added or removed while the auction is a draft; withdraw one instead.`}
        </Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
        ) : (
          <>
            {lots.map((lot) => (
              <View key={lot.id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    Lot {lot.lotNumber} · {lotListings[lot.listingId] ? listingTitle(lotListings[lot.listingId], language) : '—'}
                  </Text>
                  <Text style={styles.rowSub}>
                    Start {formatBidAmount(lot.startPrice)}
                    {lot.reservePrice !== null ? ` · Reserve ${formatBidAmount(lot.reservePrice)}` : ' · No reserve'}
                    {' · '}{lot.status}
                  </Text>
                  <Text style={styles.rowSub}>
                    {lot.currentPrice === null ? 'No bids' : `${formatBidAmount(lot.currentPrice)} · ${lot.bidCount} bids`}
                  </Text>
                </View>
                {status === 'draft' ? (
                  <Pressy onPress={() => removeLot(lot)} style={styles.removeBtn} disabled={busy}>
                    <Icon name="trash" size={15} color={colors.danger} />
                  </Pressy>
                ) : lot.status === 'pending' || lot.status === 'live' ? (
                  // Withdrawing, not deleting: bids may have been placed,
                  // and the lot has to stay readable to the people who
                  // placed them.
                  <Pressy onPress={() => withdrawLot(lot)} style={styles.removeBtn} disabled={busy}>
                    <Icon name="close" size={15} color={colors.danger} />
                  </Pressy>
                ) : null}
              </View>
            ))}

            {picking ? (
              <View style={styles.form}>
                <Text style={styles.fieldLabel}>Pick a listing</Text>
                <ScrollView style={styles.pickList} nestedScrollEnabled>
                  {candidates.map((l) => (
                    <Pressy
                      key={l.id}
                      onPress={() => setChosen(l)}
                      style={[styles.pickRow, chosen?.id === l.id && styles.pickRowOn]}
                    >
                      <Text style={styles.pickText} numberOfLines={1}>{listingTitle(l, language)}</Text>
                      {chosen?.id === l.id && <Icon name="checkCircle" size={15} color={colors.primary} />}
                    </Pressy>
                  ))}
                  {candidates.length === 0 && (
                    <Text style={styles.rowSub}>No active listings. Post the item first — that is where its photos and 360 spin come from.</Text>
                  )}
                </ScrollView>

                <Text style={styles.fieldLabel}>Start price (USD)</Text>
                <TextInput value={startPrice} onChangeText={setStartPrice} keyboardType="numeric" style={styles.input} placeholder="500" placeholderTextColor={colors.inkSoft} />
                <Text style={styles.fieldLabel}>Reserve (optional, never shown to bidders)</Text>
                <TextInput value={reserve} onChangeText={setReserve} keyboardType="numeric" style={styles.input} placeholder="1200" placeholderTextColor={colors.inkSoft} />

                <View style={styles.formActions}>
                  <Pressy onPress={() => { setPicking(false); setChosen(null); }} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressy>
                  <Pressy onPress={addLot} style={styles.saveBtn} disabled={busy || !chosen}>
                    <Text style={styles.saveText}>Add lot</Text>
                  </Pressy>
                </View>
              </View>
            ) : (
              status === 'draft' && (
                <Pressy onPress={() => setPicking(true)} style={styles.newBtn}>
                  <Icon name="plus" size={16} color={colors.white} />
                  <Text style={styles.newText}>Add a lot</Text>
                </Pressy>
              )
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 80 },
  note: { ...type.tiny, marginBottom: 14, lineHeight: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowSub: { ...type.tiny },
  removeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.pill, height: 46, marginTop: 10,
  },
  newText: { fontSize: 14, fontWeight: '800', color: colors.white },
  form: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginTop: 10,
  },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, marginTop: 10 },
  pickList: { maxHeight: 200 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 11, height: 42, marginBottom: 6, backgroundColor: colors.bg,
  },
  pickRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pickText: { flex: 1, fontSize: 13, color: colors.ink },
  input: {
    height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 14.5, color: colors.ink,
  },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  saveBtn: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13.5, fontWeight: '800', color: colors.white },
});
