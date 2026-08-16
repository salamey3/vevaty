import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

type AdminProfile = {
  id: string;
  fullName: string;
  district: string | null;
  points: number;
  tier: string;
  createdAt: string;
  isSuspended: boolean;
  suspendedReason: string | null;
};

type UserListing = { id: string; titleEn: string; status: string; price: number };

export default function AdminUsersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [rows, setRows] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listingsByUser, setListingsByUser] = useState<Record<string, UserListing[] | 'loading'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id,full_name,district,points,tier,created_at,is_suspended,suspended_reason')
        .order('created_at', { ascending: false });
      if (err) throw err;
      setRows(
        (data || []).map((row: any) => ({
          id: row.id,
          fullName: row.full_name || 'Vevaty user',
          district: row.district,
          points: row.points ?? 0,
          tier: row.tier || 'bronze',
          createdAt: row.created_at,
          isSuspended: !!row.is_suspended,
          suspendedReason: row.suspended_reason,
        }))
      );
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.fullName.toLowerCase().includes(q) || (r.district || '').toLowerCase().includes(q));
  }, [rows, query]);

  const toggleExpand = async (row: AdminProfile) => {
    const next = expandedId === row.id ? null : row.id;
    setExpandedId(next);
    setSuspendingId(null);
    if (next && !listingsByUser[row.id]) {
      setListingsByUser((prev) => ({ ...prev, [row.id]: 'loading' }));
      const { data } = await supabase
        .from('listings')
        .select('id,title_en,status,price')
        .eq('seller_id', row.id)
        .order('created_at', { ascending: false });
      setListingsByUser((prev) => ({
        ...prev,
        [row.id]: (data || []).map((l: any) => ({ id: l.id, titleEn: l.title_en || '(untitled)', status: l.status, price: Number(l.price) || 0 })),
      }));
    }
  };

  const unsuspend = async (row: AdminProfile) => {
    setBusyId(row.id);
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ is_suspended: false, suspended_reason: null, suspended_at: null })
        .eq('id', row.id);
      if (err) throw err;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isSuspended: false, suspendedReason: null } : r)));
    } catch (e: any) {
      Alert.alert('Could not update user', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const confirmSuspend = async (row: AdminProfile) => {
    setBusyId(row.id);
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({ is_suspended: true, suspended_reason: suspendReason.trim() || null, suspended_at: new Date().toISOString() })
        .eq('id', row.id);
      if (err) throw err;
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, isSuspended: true, suspendedReason: suspendReason.trim() || null } : r))
      );
      setSuspendingId(null);
      setSuspendReason('');
    } catch (e: any) {
      Alert.alert('Could not update user', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Users</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={15} color={colors.inkSoft} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name or district" style={styles.searchInput} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.hint}>New listings are posted instantly (no pre-approval) -- suspending a user only stops them from posting new ones; their existing listings stay as-is unless removed from Moderation.</Text>
          {filtered.length === 0 && <Text style={styles.emptyText}>No users match this search.</Text>}
          {filtered.map((row) => {
            const expanded = expandedId === row.id;
            const listings = listingsByUser[row.id];
            return (
              <View key={row.id} style={styles.card}>
                <Pressy onPress={() => toggleExpand(row)} style={styles.row}>
                  <View style={styles.avatar}>
                    <Icon name="user" size={18} color={colors.inkSoft} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{row.fullName}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {row.district || 'No district'} · {row.tier} · {row.points} pts
                    </Text>
                  </View>
                  {row.isSuspended && (
                    <View style={styles.suspendedBadge}>
                      <Text style={styles.suspendedBadgeText}>Suspended</Text>
                    </View>
                  )}
                </Pressy>

                {expanded && (
                  <View style={styles.expandBody}>
                    {row.isSuspended && row.suspendedReason && (
                      <Text style={styles.reasonText}>Reason: {row.suspendedReason}</Text>
                    )}

                    <Text style={styles.sectionLabel}>Listings</Text>
                    {listings === 'loading' || !listings ? (
                      <ActivityIndicator color={colors.ink} style={{ marginVertical: 10 }} />
                    ) : listings.length === 0 ? (
                      <Text style={styles.rowSub}>No listings.</Text>
                    ) : (
                      listings.map((l) => (
                        <Pressy
                          key={l.id}
                          onPress={() => navigation.navigate('ListingDetail', { listingId: l.id })}
                          style={styles.listingRow}
                        >
                          <Text style={styles.listingTitle} numberOfLines={1}>{l.titleEn}</Text>
                          <Text style={styles.listingMeta}>${l.price.toLocaleString()} · {l.status}</Text>
                        </Pressy>
                      ))
                    )}

                    <View style={styles.actionsRow}>
                      {row.isSuspended ? (
                        <Button label="Unsuspend" variant="secondary" onPress={() => unsuspend(row)} loading={busyId === row.id} style={{ flex: 1 }} />
                      ) : suspendingId === row.id ? (
                        <View style={{ flex: 1 }}>
                          <TextInput
                            value={suspendReason}
                            onChangeText={setSuspendReason}
                            placeholder="Reason (optional)"
                            style={styles.reasonInput}
                          />
                          <View style={styles.actionsRow}>
                            <Pressy onPress={() => { setSuspendingId(null); setSuspendReason(''); }} style={styles.cancelBtn}>
                              <Text style={styles.cancelBtnText}>Cancel</Text>
                            </Pressy>
                            <Button label="Confirm suspend" onPress={() => confirmSuspend(row)} loading={busyId === row.id} style={{ flex: 1 }} />
                          </View>
                        </View>
                      ) : (
                        <Pressy onPress={() => setSuspendingId(row.id)} style={styles.dangerBtn}>
                          <Icon name="close" size={13} color={colors.danger} />
                          <Text style={styles.dangerBtnText}>Suspend</Text>
                        </Pressy>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, height: '100%' },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 60 },
  hint: { ...type.tiny, textTransform: 'none', letterSpacing: 0, lineHeight: 16, marginBottom: 14 },
  emptyText: { ...type.soft, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 10, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  suspendedBadge: { paddingHorizontal: 8, height: 20, borderRadius: radius.pill, backgroundColor: '#f5e4e2', alignItems: 'center', justifyContent: 'center' },
  suspendedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.danger, textTransform: 'uppercase' },
  expandBody: { padding: 12, paddingTop: 0 },
  reasonText: { ...type.soft, marginBottom: 10 },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  listingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  listingTitle: { fontSize: 13, color: colors.ink, flex: 1, marginRight: 8 },
  listingMeta: { ...type.tiny },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'center' },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, paddingHorizontal: 16, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, flex: 1,
  },
  dangerBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.danger },
  reasonInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40, fontSize: 13.5, color: colors.ink, marginBottom: 8,
  },
  cancelBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft },
});
