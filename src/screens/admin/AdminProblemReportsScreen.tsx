import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

// What testers sent from the Report a problem tab, newest first. Each report
// carries the facts the app recorded when the tab was tapped -- screen,
// listing, phone, OS and exact build -- which is what makes "it didn't work"
// findable. Triage is status only: the report itself is the tester's words
// and the app's record, and the column grants keep both read-only here.

type Status = 'new' | 'seen' | 'fixed' | 'wontfix';
type Severity = 'blocked' | 'annoyed' | 'idea';

type Row = {
  id: string;
  createdAt: string;
  message: string;
  severity: Severity | string;
  status: Status | string;
  screen: string | null;
  listingId: string | null;
  listingTitle: string | null;
  platform: string | null;
  osVersion: string | null;
  device: string | null;
  appLanguage: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  updateCreatedAt: string | null;
  screenshotUrl: string | null;
  reporterName: string | null;
};

// Unknown values stay visible as themselves rather than being read as one of
// these -- a status or severity added later must not masquerade as 'new'.
const SEVERITY: Record<string, { label: string; bg: string; fg: string }> = {
  blocked: { label: 'Stopped them', bg: '#f5e4e2', fg: colors.danger },
  annoyed: { label: 'Annoyed them', bg: colors.warnBg, fg: colors.ink },
  idea: { label: 'Idea', bg: colors.primaryTint, fg: colors.primary },
};

type Filter = Status | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'seen', label: 'Seen' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'wontfix', label: 'Won’t fix' },
  { key: 'all', label: 'All' },
];

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  seen: 'Seen',
  fixed: 'Fixed',
  wontfix: 'Won’t fix',
};

function stamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminProblemReportsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('new');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('problem_reports')
        .select(
          'id,created_at,message,severity,status,screen,listing_id,platform,os_version,device,app_language,' +
            'runtime_version,update_id,update_created_at,screenshot_url,' +
            'reporter:profiles!problem_reports_reporter_id_fkey(full_name),' +
            'listing:listings!problem_reports_listing_id_fkey(title_en)'
        )
        .order('created_at', { ascending: false })
        .limit(300);
      if (err) throw err;
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          createdAt: r.created_at,
          message: r.message,
          severity: r.severity,
          status: r.status,
          screen: r.screen,
          listingId: r.listing_id,
          listingTitle: r.listing?.title_en ?? null,
          platform: r.platform,
          osVersion: r.os_version,
          device: r.device,
          appLanguage: r.app_language,
          runtimeVersion: r.runtime_version,
          updateId: r.update_id,
          updateCreatedAt: r.update_created_at,
          screenshotUrl: r.screenshot_url,
          reporterName: r.reporter?.full_name ?? null,
        }))
      );
    } catch (e: any) {
      setError('Could not load the reports. Check you are signed in to the admin panel, then refresh.');
      console.warn('[AdminProblemReports] load failed:', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)), [rows, filter]);
  const newCount = rows.filter((r) => r.status === 'new').length;

  // `.select('id')` and the length check: an update that matches no row is
  // not an error (@AGENTS.md), and an inbox that says "fixed" over a report
  // it never touched is worse than one that says nothing.
  const setStatus = async (id: string, status: Status) => {
    setBusyId(id);
    try {
      const { data, error: err } = await supabase
        .from('problem_reports')
        .update({ status, handled_at: status === 'new' ? null : new Date().toISOString() })
        .eq('id', id)
        .select('id');
      if (err) throw err;
      if (!data || data.length === 0) throw new Error('no row updated');
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: any) {
      Alert.alert('Not changed', 'The report was not updated. Refresh and try again.');
      console.warn('[AdminProblemReports] status not saved:', e?.message || e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen maxWidth={760}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Problem reports{newCount > 0 ? ` (${newCount} new)` : ''}</Text>
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
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!error && shown.length === 0 && <Text style={styles.empty}>Nothing here.</Text>}
          {shown.map((r) => {
            const sev = SEVERITY[r.severity] ?? { label: String(r.severity), bg: colors.surface, fg: colors.inkSoft };
            const build = [
              r.updateId === 'built-in' ? 'built-in bundle' : r.updateId ? `update ${r.updateId.slice(0, 8)}` : null,
              r.updateCreatedAt ? stamp(r.updateCreatedAt) : null,
              r.runtimeVersion === 'web' ? 'website' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={r.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={[styles.badge, { backgroundColor: sev.bg }]}>
                    <Text style={[styles.badgeText, { color: sev.fg }]}>{sev.label}</Text>
                  </View>
                  <Text style={styles.meta}>{stamp(r.createdAt)}</Text>
                  <Text style={[styles.meta, styles.status]}>{STATUS_LABEL[r.status] ?? String(r.status)}</Text>
                </View>

                <Text style={styles.message} selectable>
                  {r.message}
                </Text>

                <Text style={styles.meta}>
                  {r.reporterName || 'Unknown tester'}
                  {r.appLanguage ? ` · app in ${r.appLanguage === 'ar' ? 'Arabic' : r.appLanguage === 'en' ? 'English' : r.appLanguage}` : ''}
                </Text>
                <Text style={styles.meta}>
                  {[r.screen ? `on ${r.screen}` : 'screen unknown', r.platform, r.device, r.osVersion].filter(Boolean).join(' · ')}
                </Text>
                {!!build && <Text style={styles.meta}>{build}</Text>}

                {!!r.listingId && (
                  <Pressy onPress={() => navigation.navigate('ListingDetail', { listingId: r.listingId! })} style={styles.linkRow}>
                    <Icon name="tag" size={13} color={colors.primary} />
                    <Text style={styles.linkText} numberOfLines={1}>
                      {r.listingTitle || 'Open the listing'}
                    </Text>
                  </Pressy>
                )}

                {!!r.screenshotUrl && (
                  <Pressy onPress={() => Linking.openURL(r.screenshotUrl!)} style={styles.shotWrap}>
                    <Image source={{ uri: r.screenshotUrl }} style={styles.shot} resizeMode="cover" />
                  </Pressy>
                )}

                <View style={styles.actions}>
                  {r.status === 'new' && (
                    <Pressy onPress={() => setStatus(r.id, 'seen')} style={styles.actionBtn} disabled={busyId === r.id}>
                      <Text style={styles.actionText}>Mark seen</Text>
                    </Pressy>
                  )}
                  {r.status !== 'fixed' && (
                    <Pressy onPress={() => setStatus(r.id, 'fixed')} style={styles.actionBtn} disabled={busyId === r.id}>
                      <Text style={styles.actionText}>Fixed</Text>
                    </Pressy>
                  )}
                  {r.status !== 'wontfix' && (
                    <Pressy onPress={() => setStatus(r.id, 'wontfix')} style={styles.actionBtn} disabled={busyId === r.id}>
                      <Text style={styles.actionText}>Won’t fix</Text>
                    </Pressy>
                  )}
                  {r.status !== 'new' && (
                    <Pressy onPress={() => setStatus(r.id, 'new')} style={styles.actionBtn} disabled={busyId === r.id}>
                      <Text style={styles.actionText}>Back to new</Text>
                    </Pressy>
                  )}
                </View>
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
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  chipTextActive: { color: colors.white },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 60 },
  error: { fontSize: 13, color: colors.danger, marginBottom: 10 },
  empty: { ...type.soft, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  badge: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  status: { marginLeft: 'auto', textTransform: 'uppercase', fontWeight: '700' },
  message: { ...type.body, marginBottom: 8 },
  meta: { ...type.tiny, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.primary, flexShrink: 1 },
  shotWrap: { marginTop: 10, alignSelf: 'flex-start' },
  shot: { width: 110, height: 190, borderRadius: 8, backgroundColor: colors.surface },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
});
