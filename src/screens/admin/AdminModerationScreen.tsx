import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../store/SettingsStore';
import { RootStackParamList } from '../../navigation/types';

// This screen is both the admin's after-the-fact browse-everything tool
// (unpublish/relist/mark-sold anything, regardless of status/owner -- RLS's
// normal "active or mine" rule doesn't apply here, "admins can view all
// listings" covers this screen specifically) AND, since the AI-first-pass
// content moderation feature, the actual human-escalation queue: any
// listing the AI declined to auto-publish (moderation_status: 'flagged')
// lands in the "Flagged" filter here for a human decision. A listing still
// sitting in 'pending_review' with moderation_status 'pending' also shows
// up there -- normally that resolves itself within a couple seconds of
// posting, but if the AI check never got a chance to run (e.g. a network
// blip on the seller's device right after posting), this is the only place
// it's still visible.

type Status = 'draft' | 'active' | 'sold' | 'expired' | 'removed' | 'pending_review' | 'rejected';
const STATUSES: Status[] = ['draft', 'active', 'sold', 'expired', 'removed', 'pending_review', 'rejected'];
type ModStatus = 'pending' | 'ai_approved' | 'flagged' | 'human_approved' | 'rejected';

type ModListing = {
  id: string;
  titleEn: string;
  price: number;
  status: Status;
  moderationStatus: ModStatus;
  moderationReason: string | null;
  district: string;
  createdAt: string;
  sellerId: string;
  sellerName: string;
  categoryId: string;
  photoUrl: string | null;
  openReportCount: number;
};

const STATUS_COLORS: Record<Status, { bg: string; fg: string }> = {
  draft: { bg: colors.surface, fg: colors.inkSoft },
  active: { bg: '#e3efe8', fg: colors.success },
  sold: { bg: colors.surface, fg: colors.ink },
  expired: { bg: colors.warnBg, fg: colors.ink },
  removed: { bg: '#f5e4e2', fg: colors.danger },
  pending_review: { bg: colors.warnBg, fg: colors.ink },
  rejected: { bg: '#f5e4e2', fg: colors.danger },
};

export default function AdminModerationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { categoryById } = useSettings();

  const [rows, setRows] = useState<ModListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'reported' | 'flagged' | Status>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectDraft, setRejectDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: listingRows, error: listErr }, { data: openReports, error: repErr }] = await Promise.all([
        supabase
          .from('listings')
          .select(
            'id,title_en,price,status,moderation_status,moderation_reason,district,created_at,seller_id,category_id,seller:profiles(full_name),photos:listing_photos(url,kind)'
          )
          .order('created_at', { ascending: false }),
        supabase.from('reports').select('reported_listing_id').eq('status', 'open'),
      ]);
      if (listErr) throw listErr;
      if (repErr) throw repErr;
      const reportCounts = new Map<string, number>();
      (openReports || []).forEach((r: any) => {
        if (!r.reported_listing_id) return;
        reportCounts.set(r.reported_listing_id, (reportCounts.get(r.reported_listing_id) || 0) + 1);
      });
      const mapped: ModListing[] = (listingRows || []).map((row: any) => ({
        id: row.id,
        titleEn: row.title_en || '(untitled)',
        price: Number(row.price) || 0,
        status: row.status,
        moderationStatus: row.moderation_status || 'ai_approved',
        moderationReason: row.moderation_reason ?? null,
        district: row.district || '',
        createdAt: row.created_at,
        sellerId: row.seller_id,
        sellerName: row.seller?.full_name || 'Vevaty user',
        categoryId: row.category_id,
        // Prefer a gallery photo over a spin frame for the thumbnail — the
        // join can return both kinds interleaved once a listing has a 360°
        // spin set (Phase 3 item 7).
        photoUrl: Array.isArray(row.photos)
          ? (row.photos.find((p: any) => (p.kind || 'gallery') === 'gallery') ?? row.photos[0])?.url ?? null
          : null,
        openReportCount: reportCounts.get(row.id) || 0,
      }));
      setRows(mapped);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The actual human-moderation queue: anything the AI declined to
  // auto-publish, plus anything still waiting on the AI check that hasn't
  // resolved (see the top-of-file comment) -- both need a human's eyes.
  const isFlagged = (r: ModListing) => r.moderationStatus === 'flagged' || r.status === 'pending_review';

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === 'reported') list = list.filter((r) => r.openReportCount > 0);
    else if (filter === 'flagged') list = list.filter(isFlagged);
    else if (filter !== 'all') list = list.filter((r) => r.status === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.titleEn.toLowerCase().includes(q) || r.sellerName.toLowerCase().includes(q));
    return list;
  }, [rows, filter, query]);

  const reportedCount = useMemo(() => rows.filter((r) => r.openReportCount > 0).length, [rows]);
  const flaggedCount = useMemo(() => rows.filter(isFlagged).length, [rows]);

  const patchListing = async (row: ModListing, patch: Record<string, unknown>, localPatch: Partial<ModListing>) => {
    setBusyId(row.id);
    try {
      const { error: updErr } = await supabase.from('listings').update(patch).eq('id', row.id);
      if (updErr) throw updErr;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...localPatch } : r)));
    } catch (e: any) {
      Alert.alert('Could not update listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = (row: ModListing, next: Status) => patchListing(row, { status: next }, { status: next });

  // Approving a flagged listing clears the moderation flag too, not just
  // status -- otherwise it'd keep showing up under the "Flagged" filter
  // even after going live.
  const approveModeration = (row: ModListing) =>
    patchListing(
      row,
      { status: 'active', moderation_status: 'human_approved', moderation_reason: null },
      { status: 'active', moderationStatus: 'human_approved', moderationReason: null }
    );

  const rejectModeration = (row: ModListing) => {
    const reason = (rejectDraft[row.id] || '').trim();
    if (!reason) {
      Alert.alert('Reason required', 'Give the seller a short reason so they know what to fix before resubmitting.');
      return;
    }
    patchListing(
      row,
      { status: 'rejected', moderation_status: 'rejected', moderation_reason: reason },
      { status: 'rejected', moderationStatus: 'rejected', moderationReason: reason }
    );
    setRejectDraft((prev) => ({ ...prev, [row.id]: '' }));
  };

  const confirmRemove = (row: ModListing) => {
    Alert.alert(
      `Remove "${row.titleEn}"?`,
      'This unpublishes the listing immediately. The seller can still see it as removed, but buyers will no longer find it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setStatus(row, 'removed') },
      ]
    );
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `All (${rows.length})` },
    { key: 'flagged', label: `Flagged (${flaggedCount})` },
    { key: 'reported', label: `Reported (${reportedCount})` },
    { key: 'active', label: 'Active' },
    { key: 'draft', label: 'Draft' },
    { key: 'sold', label: 'Sold' },
    { key: 'expired', label: 'Expired' },
    { key: 'removed', label: 'Removed' },
  ];

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Moderation</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={15} color={colors.inkSoft} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by title or seller"
          style={styles.searchInput}
        />
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
          {filtered.length === 0 && <Text style={styles.emptyText}>No listings match this filter.</Text>}
          {filtered.map((row) => {
            const cat = categoryById(row.categoryId);
            const sc = STATUS_COLORS[row.status];
            const expanded = expandedId === row.id;
            return (
              <View key={row.id} style={styles.card}>
                <Pressy onPress={() => setExpandedId(expanded ? null : row.id)} style={styles.row}>
                  <View style={styles.thumb}>
                    {row.photoUrl ? (
                      <Image source={{ uri: row.photoUrl }} style={styles.thumbImg} />
                    ) : (
                      <Icon name={(cat?.icon as any) || 'bag'} size={20} color={colors.inkSoft} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{row.titleEn}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      ${row.price.toLocaleString()} · {row.sellerName} · {row.district || cat?.nameEn || ''}
                    </Text>
                  </View>
                  <View style={styles.badges}>
                    {row.openReportCount > 0 && (
                      <View style={styles.reportBadge}>
                        <Icon name="flag" size={11} color={colors.danger} />
                        <Text style={styles.reportBadgeText}>{row.openReportCount}</Text>
                      </View>
                    )}
                    {isFlagged(row) && (
                      <View style={styles.reportBadge}>
                        <Icon name="rotate" size={11} color={colors.danger} />
                        <Text style={styles.reportBadgeText}>
                          {row.moderationStatus === 'flagged' ? 'AI FLAGGED' : 'AWAITING AI'}
                        </Text>
                      </View>
                    )}
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{row.status}</Text>
                    </View>
                  </View>
                </Pressy>

                {expanded && (
                  <View style={styles.actions}>
                    <Pressy onPress={() => navigation.navigate('ListingDetail', { listingId: row.id })} style={styles.actionBtn}>
                      <Text style={styles.actionBtnText}>View listing</Text>
                    </Pressy>

                    {isFlagged(row) && (
                      <View style={styles.moderationBox}>
                        {row.moderationReason ? (
                          <Text style={styles.moderationReasonText}>AI's reason: {row.moderationReason}</Text>
                        ) : row.moderationStatus === 'pending' ? (
                          <Text style={styles.moderationReasonText}>Still waiting on the AI check -- you can decide manually.</Text>
                        ) : null}
                        <Pressy disabled={busyId === row.id} onPress={() => approveModeration(row)} style={styles.actionBtn}>
                          <Text style={styles.actionBtnText}>Approve & publish</Text>
                        </Pressy>
                        <TextInput
                          value={rejectDraft[row.id] || ''}
                          onChangeText={(text) => setRejectDraft((prev) => ({ ...prev, [row.id]: text }))}
                          placeholder="Reason for the seller (required to reject)"
                          style={styles.rejectInput}
                          multiline
                        />
                        <Pressy disabled={busyId === row.id} onPress={() => rejectModeration(row)} style={styles.dangerBtn}>
                          <Icon name="flag" size={13} color={colors.danger} />
                          <Text style={styles.dangerBtnText}>Reject with reason</Text>
                        </Pressy>
                      </View>
                    )}

                    {STATUSES.filter((s) => s !== row.status && s !== 'removed' && s !== 'pending_review' && s !== 'rejected').map((s) => (
                      <Pressy
                        key={s}
                        disabled={busyId === row.id}
                        onPress={() => setStatus(row, s)}
                        style={styles.actionBtn}
                      >
                        <Text style={styles.actionBtnText}>Set {s}</Text>
                      </Pressy>
                    ))}
                    {row.status !== 'removed' && (
                      <Pressy disabled={busyId === row.id} onPress={() => confirmRemove(row)} style={styles.dangerBtn}>
                        <Icon name="trash" size={13} color={colors.danger} />
                        <Text style={styles.dangerBtnText}>Remove</Text>
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
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, height: '100%' },
  chipRow: { marginTop: 12, flexGrow: 0 },
  chipRowContent: { paddingHorizontal: 18, gap: 8 },
  chip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  chipTextActive: { color: colors.white },
  scroll: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 60 },
  emptyText: { ...type.soft, textAlign: 'center', marginTop: 30 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 10, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  thumb: {
    width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  badges: { alignItems: 'flex-end', gap: 6 },
  reportBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, height: 20, borderRadius: radius.pill, backgroundColor: '#f5e4e2',
  },
  reportBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.danger },
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
  moderationBox: {
    width: '100%', gap: 8, padding: 10, borderRadius: radius.sm,
    backgroundColor: colors.warnBg, borderWidth: 1, borderColor: colors.line,
  },
  moderationReasonText: { ...type.soft, fontSize: 12.5 },
  rejectInput: {
    minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: colors.ink,
  },
});
