import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import VideoPlayer from '../../components/VideoPlayer';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../store/SettingsStore';
import { LISTING_STATUSES, ListingStatus } from '../../types';
import { parseResolutions } from '../../lib/bunnyVideo';
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

// 'auction' is deliberately absent from the FILTER pills below even though
// it is a real listing status: an auction lot is curated by hand into a
// sale that has already been agreed, it never passes through moderation,
// and the fetch excludes it (see the query). Offering a Remove button for
// one would set its listing to 'removed', which instantly fails the
// auction-lot RLS policy and makes a live lot vanish for every bidder
// mid-auction while auction_lots still points at it.
type Status = Exclude<ListingStatus, 'auction'>;
const STATUSES: Status[] = LISTING_STATUSES.filter((s): s is Status => s !== 'auction');
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
  // Full gallery + video, not just the thumbnail -- so a removed listing
  // can actually be retrieved whole for a dispute or a mistaken-delete
  // recovery, not just identified by its cover photo. See the expanded
  // row's mediaSection.
  photos: string[];
  galleryPhotoCount: number;
  video: { guid: string; resolutions: number[] | null } | null;
  openReportCount: number;
  // Only ever set once status is 'removed' -- see the migration comment
  // on myazar.listings.removed_reason for what each value means.
  removedReason: 'seller_deleted' | 'admin_moderated' | 'report_resolved' | null;
  removedAt: string | null;
};

const REMOVED_REASON_LABELS: Record<string, string> = {
  seller_deleted: 'Seller deleted it themselves',
  admin_moderated: 'Removed by an admin',
  report_resolved: 'Removed while resolving a report',
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
  const [filter, setFilter] = useState<'all' | 'reported' | 'flagged' | 'nophotos' | Status>('all');
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
            'id,title_en,price,status,moderation_status,moderation_reason,district,created_at,seller_id,category_id,' +
              'removed_reason,removed_at,' +
              'seller:profiles(full_name),photos:listing_photos(url,kind),video:listing_videos(bunny_guid,resolutions)'
          )
          .neq('status', 'auction')
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
        // The full gallery (every kind, not just the thumbnail pick above)
        // -- this is what makes a removed listing actually retrievable for
        // a dispute, not just identifiable by one cover photo.
        photos: Array.isArray(row.photos) ? row.photos.map((p: any) => p.url).filter(Boolean) : [],
        // Gallery only, kept apart from `photos` above. The "no photos"
        // filter and badge are about what a buyer sees on the listing
        // page, and a listing whose only rows are 360 spin frames looks
        // exactly as empty to them -- but counted against every kind it
        // read as having pictures and never showed up.
        galleryPhotoCount: Array.isArray(row.photos)
          ? row.photos.filter((p: any) => (p.kind || 'gallery') === 'gallery').length
          : 0,
        video: (() => {
          const v = Array.isArray(row.video) ? row.video[0] : row.video;
          return v?.bunny_guid ? { guid: v.bunny_guid, resolutions: parseResolutions(v.resolutions) } : null;
        })(),
        openReportCount: reportCounts.get(row.id) || 0,
        removedReason: row.removed_reason ?? null,
        removedAt: row.removed_at ?? null,
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
    else if (filter === 'nophotos') list = list.filter((r) => r.status === 'active' && r.galleryPhotoCount === 0);
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
      // Reads the row BACK rather than trusting the absence of an error.
      // Two documented ways this write can do nothing and still look fine
      // (@AGENTS.md): RLS filtering the row out, and
      // enforce_listing_moderation_gate, a BEFORE UPDATE trigger that
      // rewrites new.status back to old.status without raising. Setting a
      // flagged listing active goes straight through both. The moderator
      // saw the row flip to Active and drop out of the Flagged filter,
      // while the listing stayed pending_review and invisible to buyers
      // with nobody left watching it.
      const { data: updated, error: updErr } = await supabase
        .from('listings').update(patch).eq('id', row.id).select('id,status,moderation_status');
      if (updErr) throw updErr;
      if (!updated || updated.length === 0) throw new Error('That listing did not change — you may not have permission.');
      const saved = updated[0] as { status?: string; moderation_status?: string };
      // Local state is brought level with the database BEFORE anything
      // throws. These patches send several columns in one statement, and
      // a trigger can let some through and revert others -- so raising
      // first left the grid showing the old row while the database held
      // the new one, and the moderator had no way to tell which was true.
      // Whatever the row actually says now, not what we asked for.
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, ...localPatch, status: (saved.status as any) ?? r.status, moderationStatus: (saved.moderation_status as any) ?? r.moderationStatus }
            : r
        )
      );
      // Now say what did not go through. A trigger can revert one column
      // while letting the rest land -- enforce_listing_moderation_gate
      // rewrites new.status back to old.status without raising -- and
      // both of these used to pass unremarked because the row we patch
      // from is the database's own and therefore always looks
      // self-consistent.
      if (patch.status !== undefined && saved.status !== patch.status) {
        throw new Error(`The database kept this listing at "${saved.status}". A trigger refused the change.`);
      }
      if (patch.moderation_status !== undefined && saved.moderation_status !== patch.moderation_status) {
        throw new Error(
          `The database kept this listing's review state at "${saved.moderation_status}". A trigger refused the change.`
        );
      }
    } catch (e: any) {
      Alert.alert('Could not update listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  // Also used to restore a removed listing (e.g. "Set active"/"Set draft"
  // from a removed row's action list) -- clearing the removed_* bookkeeping
  // whenever the target isn't 'removed' so a later look at this listing
  // doesn't show a stale removal reason for something that's live again.
  const setStatus = (row: ModListing, next: Status) =>
    patchListing(
      row,
      next === 'removed'
        ? { status: next }
        : { status: next, removed_at: null, removed_reason: null, removed_by: null },
      next === 'removed' ? { status: next } : { status: next, removedReason: null, removedAt: null }
    );

  // Approving a flagged listing clears the moderation flag too, not just
  // status -- otherwise it'd keep showing up under the "Flagged" filter
  // even after going live.
  const approveModeration = (row: ModListing) => {
    const approve = () =>
      patchListing(
        row,
        { status: 'active', moderation_status: 'human_approved', moderation_reason: null },
        { status: 'active', moderationStatus: 'human_approved', moderationReason: null }
      );
    // A listing whose photos failed to upload now PARKS at pending_review
    // instead of going live empty -- which is the point of the change,
    // but it lands the listing in this queue, where Approve is one tap
    // and the row shows a category icon rather than a missing thumbnail.
    // Approving it here reproduces the original incident by the one route
    // the fix created, and admins are privileged in
    // enforce_listing_moderation_gate so nothing stops it server-side.
    if (row.galleryPhotoCount === 0) {
      Alert.alert(
        'This listing has no photos',
        'It will go on the site with nothing for a buyer to look at. This is usually a listing whose upload failed — rejecting it asks the seller to add them.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Publish anyway', style: 'destructive', onPress: approve },
        ]
      );
      return;
    }
    approve();
  };

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
      'This unpublishes the listing immediately and takes it off the seller\'s own listings too. It stays fully retrievable here (photos and video included) under the Removed filter for 15 days before it\'s purged for good.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { data: userData } = await supabase.auth.getUser();
            patchListing(
              row,
              {
                status: 'removed',
                removed_at: new Date().toISOString(),
                removed_reason: 'admin_moderated',
                removed_by: userData.user?.id ?? null,
              },
              { status: 'removed', removedReason: 'admin_moderated', removedAt: new Date().toISOString() }
            );
          },
        },
      ]
    );
  };

  // A listing anyone can open that has no picture in it.
  //
  // This is the shape of a specific incident: photos upload after the
  // listing row is created, moderation publishes the listing four seconds
  // later, and if the upload never finished the listing went live with
  // nothing to look at -- silently, and only discovered because the seller
  // happened to look at their own listing. Posting now waits for the
  // photos (@AGENTS.md), so this should stay empty; it is here to notice
  // if it ever does not, rather than waiting for the next bug report.
  const noPhotoRows = rows.filter((r) => r.status === 'active' && r.galleryPhotoCount === 0);

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `All (${rows.length})` },
    { key: 'flagged', label: `Flagged (${flaggedCount})` },
    { key: 'reported', label: `Reported (${reportedCount})` },
    { key: 'nophotos', label: `No photos (${noPhotoRows.length})` },
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
                    {row.galleryPhotoCount === 0 && row.status !== 'draft' && (
                      <View style={styles.reportBadge}>
                        <Icon name="image" size={11} color={colors.danger} />
                        <Text style={styles.reportBadgeText}>NO PHOTOS</Text>
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
                    {row.status === 'removed' ? (
                      // A removed listing was pulled out of AppStore's shared
                      // `listings` (the same fetch every screen -- including
                      // ListingDetailScreen -- reads from now excludes
                      // status='removed', so this row wouldn't resolve
                      // there). The gallery/video below is the retrieval
                      // path for a removed listing instead.
                      <View style={styles.removedInfoBox}>
                        <Text style={styles.moderationReasonText}>
                          {REMOVED_REASON_LABELS[row.removedReason || ''] || 'Removed'}
                          {row.removedAt ? ` · ${new Date(row.removedAt).toLocaleString()}` : ''}
                        </Text>
                        <Text style={styles.removedInfoSub}>
                          Purges automatically 15 days after removal unless restored before then.
                        </Text>
                      </View>
                    ) : (
                      <Pressy onPress={() => navigation.navigate('ListingDetail', { listingId: row.id })} style={styles.actionBtn}>
                        <Text style={styles.actionBtnText}>View listing</Text>
                      </Pressy>
                    )}

                    {row.galleryPhotoCount === 0 && row.status !== 'draft' && (
                      <View style={styles.mediaSection}>
                        <Text style={styles.noMediaNote}>
                          This listing has no gallery photos. A media write failed when it was posted
                          (see AppStore's addListing). Approving it puts it on the site with nothing to
                          look at — reject it, or ask the seller to re-upload first.
                        </Text>
                      </View>
                    )}

                    {(row.photos.length > 0 || row.video) && (
                      <View style={styles.mediaSection}>
                        {row.photos.length > 0 && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaPhotoRow}>
                            {row.photos.map((url, i) => (
                              <Image key={`${url}-${i}`} source={{ uri: url }} style={styles.mediaPhoto} />
                            ))}
                          </ScrollView>
                        )}
                        {row.video && (
                          <View style={styles.mediaVideoWrap}>
                            <VideoPlayer guid={row.video.guid} resolutions={row.video.resolutions} />
                          </View>
                        )}
                      </View>
                    )}

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
  removedInfoBox: {
    width: '100%', gap: 4, padding: 10, borderRadius: radius.sm,
    backgroundColor: '#f5e4e2', borderWidth: 1, borderColor: colors.line,
  },
  removedInfoSub: { fontSize: 11.5, color: colors.inkSoft },
  mediaSection: { width: '100%', gap: 10 },
  noMediaNote: { fontSize: 12, lineHeight: 17, color: colors.danger },
  mediaPhotoRow: { gap: 8 },
  mediaPhoto: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.surface },
  mediaVideoWrap: { width: '100%', height: 220, borderRadius: radius.sm, overflow: 'hidden' },
});
