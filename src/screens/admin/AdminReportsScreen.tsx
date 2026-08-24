import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';
const STATUSES: ReportStatus[] = ['open', 'reviewing', 'resolved', 'dismissed'];

type ReportRow = {
  id: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  reporterName: string;
  reportedUserId: string | null;
  reportedUserName: string | null;
  listingId: string | null;
  listingTitle: string | null;
  listingStatus: string | null;
};

const STATUS_COLORS: Record<ReportStatus, { bg: string; fg: string }> = {
  open: { bg: '#f5e4e2', fg: colors.danger },
  reviewing: { bg: colors.warnBg, fg: colors.ink },
  resolved: { bg: '#e3efe8', fg: colors.success },
  dismissed: { bg: colors.surface, fg: colors.inkSoft },
};

export default function AdminReportsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ReportStatus>('open');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('reports')
        .select(
          'id,reason,status,created_at,' +
            'reporter:profiles!reports_reporter_id_fkey(full_name),' +
            'reported_user:profiles!reports_reported_user_id_fkey(id,full_name),' +
            'listing:listings!reports_reported_listing_id_fkey(id,title_en,status)'
        )
        .order('created_at', { ascending: false });
      if (err) throw err;
      setRows(
        (data || []).map((row: any) => ({
          id: row.id,
          reason: row.reason,
          status: row.status,
          createdAt: row.created_at,
          reporterName: row.reporter?.full_name || 'Vevaty user',
          reportedUserId: row.reported_user?.id ?? null,
          reportedUserName: row.reported_user?.full_name ?? null,
          listingId: row.listing?.id ?? null,
          listingTitle: row.listing?.title_en ?? null,
          listingStatus: row.listing?.status ?? null,
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
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    STATUSES.forEach((s) => (c[s] = rows.filter((r) => r.status === s).length));
    return c;
  }, [rows]);

  const setReportStatus = async (row: ReportRow, next: ReportStatus) => {
    setBusyId(row.id);
    try {
      const { error: err } = await supabase.from('reports').update({ status: next }).eq('id', row.id);
      if (err) throw err;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    } catch (e: any) {
      Alert.alert('Could not update report', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const removeListing = (row: ReportRow) => {
    if (!row.listingId) return;
    Alert.alert('Remove this listing?', 'Unpublishes the listing and marks this report resolved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove & resolve',
        style: 'destructive',
        onPress: async () => {
          setBusyId(row.id);
          try {
            const { data: userData } = await supabase.auth.getUser();
            const { error: listErr } = await supabase
              .from('listings')
              .update({
                status: 'removed',
                removed_at: new Date().toISOString(),
                removed_reason: 'report_resolved',
                removed_by: userData.user?.id ?? null,
              })
              .eq('id', row.listingId as string);
            if (listErr) throw listErr;
            const { error: repErr } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', row.id);
            if (repErr) throw repErr;
            setRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, status: 'resolved', listingStatus: 'removed' } : r))
            );
          } catch (e: any) {
            Alert.alert('Could not remove listing', e?.message || String(e));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'open', label: `Open (${counts.open})` },
    { key: 'reviewing', label: `Reviewing (${counts.reviewing})` },
    { key: 'resolved', label: `Resolved (${counts.resolved})` },
    { key: 'dismissed', label: `Dismissed (${counts.dismissed})` },
  ];

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Reports</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
        {FILTERS.map((f) => (
          <Pressy key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressy>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {filtered.length === 0 && <Text style={styles.emptyText}>No reports here.</Text>}
          {filtered.map((row) => {
            const sc = STATUS_COLORS[row.status];
            const expanded = expandedId === row.id;
            const target = row.listingTitle ? `Listing: ${row.listingTitle}` : row.reportedUserName ? `User: ${row.reportedUserName}` : 'Unknown target';
            return (
              <View key={row.id} style={styles.card}>
                <Pressy onPress={() => setExpandedId(expanded ? null : row.id)} style={styles.row}>
                  <View style={styles.flagIcon}>
                    <Icon name="flag" size={16} color={colors.inkSoft} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{row.reason}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{target} · reported by {row.reporterName}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{row.status}</Text>
                  </View>
                </Pressy>

                {expanded && (
                  <View style={styles.actions}>
                    {row.listingId && (
                      <Pressy onPress={() => navigation.navigate('ListingDetail', { listingId: row.listingId as string })} style={styles.actionBtn}>
                        <Text style={styles.actionBtnText}>View listing</Text>
                      </Pressy>
                    )}
                    {STATUSES.filter((s) => s !== row.status).map((s) => (
                      <Pressy key={s} disabled={busyId === row.id} onPress={() => setReportStatus(row, s)} style={styles.actionBtn}>
                        <Text style={styles.actionBtnText}>Mark {s}</Text>
                      </Pressy>
                    ))}
                    {row.listingId && row.listingStatus !== 'removed' && (
                      <Pressy disabled={busyId === row.id} onPress={() => removeListing(row)} style={styles.dangerBtn}>
                        <Icon name="trash" size={13} color={colors.danger} />
                        <Text style={styles.dangerBtnText}>Remove listing</Text>
                      </Pressy>
                    )}
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
  chipRow: { marginTop: 8, flexGrow: 0 },
  chipRowContent: { paddingHorizontal: 18, gap: 8 },
  chip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  chipTextActive: { color: colors.white },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 60 },
  emptyText: { ...type.soft, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 10, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  flagIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, height: 20, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  statusBadgeText: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, paddingTop: 0 },
  actionBtn: {
    height: 34, paddingHorizontal: 12, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 34, paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line,
  },
  dangerBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.danger },
});
