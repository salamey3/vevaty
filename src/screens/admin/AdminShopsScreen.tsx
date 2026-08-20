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

// The other half of the merchant-facing "create my storefront" flow
// (MyStorefrontScreen): a shop a seller creates there is instantly theirs
// to edit, but stays invisible to everyone else (shops_select RLS) until
// an admin verifies it here. Deliberately mirrors AdminModerationScreen's
// shape (list -> expand -> approve/reject-with-reason) since it's the same
// underlying pattern -- a queue of user-submitted things waiting on a
// human decision -- just for shops instead of listings.

type AdminShop = {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  taglineEn: string | null;
  logoUrl: string | null;
  governorate: string | null;
  caza: string | null;
  primaryCategoryId: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  createdAt: string;
  ownerName: string;
  ownerId: string;
};

export default function AdminShopsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { categoryById } = useSettings();

  const [rows, setRows] = useState<AdminShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'verified'>('pending');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineDraft, setDeclineDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('shops')
        .select(
          'id,slug,name_en,name_ar,tagline_en,logo_url,governorate,caza,primary_category_id,verified_at,verification_note,created_at,owner_id,owner:profiles(full_name)'
        )
        .order('created_at', { ascending: false });
      if (err) throw err;
      setRows(
        (data || []).map((row: any) => ({
          id: row.id,
          slug: row.slug,
          nameEn: row.name_en || '(untitled)',
          nameAr: row.name_ar,
          taglineEn: row.tagline_en,
          logoUrl: row.logo_url,
          governorate: row.governorate,
          caza: row.caza,
          primaryCategoryId: row.primary_category_id,
          verifiedAt: row.verified_at,
          verificationNote: row.verification_note,
          createdAt: row.created_at,
          ownerId: row.owner_id,
          ownerName: row.owner?.full_name || 'Vevaty user',
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
    let list = rows;
    if (filter === 'pending') list = list.filter((r) => !r.verifiedAt);
    else if (filter === 'verified') list = list.filter((r) => !!r.verifiedAt);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.nameEn.toLowerCase().includes(q) || r.ownerName.toLowerCase().includes(q));
    return list;
  }, [rows, filter, query]);

  const pendingCount = useMemo(() => rows.filter((r) => !r.verifiedAt).length, [rows]);

  const patchShop = async (row: AdminShop, patch: Record<string, unknown>, localPatch: Partial<AdminShop>) => {
    setBusyId(row.id);
    try {
      const { error: updErr } = await supabase.from('shops').update(patch).eq('id', row.id);
      if (updErr) throw updErr;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...localPatch } : r)));
    } catch (e: any) {
      Alert.alert('Could not update storefront', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const approveShop = async (row: AdminShop) => {
    setBusyId(row.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const adminId = userData?.user?.id;
      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabase
        .from('shops')
        .update({ verified_at: nowIso, verified_by: adminId, verification_note: null })
        .eq('id', row.id);
      if (updErr) throw updErr;
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, verifiedAt: nowIso, verificationNote: null } : r)));
    } catch (e: any) {
      Alert.alert('Could not verify storefront', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const declineShop = (row: AdminShop) => {
    const reason = (declineDraft[row.id] || '').trim();
    if (!reason) {
      Alert.alert('Reason required', 'Give the merchant a short reason so they know what to fix before resubmitting.');
      return;
    }
    patchShop(row, { verification_note: reason }, { verificationNote: reason });
    setDeclineDraft((prev) => ({ ...prev, [row.id]: '' }));
  };

  const unverifyShop = (row: AdminShop) => {
    Alert.alert(
      `Unverify "${row.nameEn}"?`,
      'This immediately hides the storefront from buyers again until it is re-verified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unverify',
          style: 'destructive',
          onPress: () => patchShop(row, { verified_at: null, verified_by: null }, { verifiedAt: null }),
        },
      ]
    );
  };

  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'pending', label: `Pending (${pendingCount})` },
    { key: 'verified', label: 'Verified' },
    { key: 'all', label: `All (${rows.length})` },
  ];

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Storefronts</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={15} color={colors.inkSoft} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name or owner" style={styles.searchInput} />
      </View>

      <View style={styles.chipRowContent}>
        {FILTERS.map((f) => (
          <Pressy key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </Pressy>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {filtered.length === 0 && <Text style={styles.emptyText}>No storefronts match this filter.</Text>}
          {filtered.map((row) => {
            const cat = row.primaryCategoryId ? categoryById(row.primaryCategoryId) : undefined;
            const expanded = expandedId === row.id;
            const verified = !!row.verifiedAt;
            return (
              <View key={row.id} style={styles.card}>
                <Pressy onPress={() => setExpandedId(expanded ? null : row.id)} style={styles.row}>
                  <View style={styles.thumb}>
                    {row.logoUrl ? (
                      <Image source={{ uri: row.logoUrl }} style={styles.thumbImg} />
                    ) : (
                      <Icon name="building" size={20} color={colors.inkSoft} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{row.nameEn}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {row.ownerName} · {[row.caza, row.governorate].filter(Boolean).join(', ') || 'No location'} · {cat?.nameEn || 'No category'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: verified ? '#e3efe8' : colors.warnBg }]}>
                    <Text style={[styles.statusBadgeText, { color: verified ? colors.success : colors.ink }]}>
                      {verified ? 'verified' : row.verificationNote ? 'declined' : 'pending'}
                    </Text>
                  </View>
                </Pressy>

                {expanded && (
                  <View style={styles.actions}>
                    <Pressy onPress={() => navigation.navigate('Storefront', { shopSlug: row.slug })} style={styles.actionBtn}>
                      <Text style={styles.actionBtnText}>View public page</Text>
                    </Pressy>

                    {!verified ? (
                      <View style={styles.reviewBox}>
                        {!!row.verificationNote && (
                          <Text style={styles.reviewNoteText}>Last decline reason shown to merchant: {row.verificationNote}</Text>
                        )}
                        <Pressy disabled={busyId === row.id} onPress={() => approveShop(row)} style={styles.actionBtn}>
                          <Text style={styles.actionBtnText}>Approve & publish</Text>
                        </Pressy>
                        <TextInput
                          value={declineDraft[row.id] || ''}
                          onChangeText={(text) => setDeclineDraft((prev) => ({ ...prev, [row.id]: text }))}
                          placeholder="Reason for the merchant (required to decline)"
                          style={styles.declineInput}
                          multiline
                        />
                        <Pressy disabled={busyId === row.id} onPress={() => declineShop(row)} style={styles.dangerBtn}>
                          <Icon name="flag" size={13} color={colors.danger} />
                          <Text style={styles.dangerBtnText}>Decline with reason</Text>
                        </Pressy>
                      </View>
                    ) : (
                      <Pressy disabled={busyId === row.id} onPress={() => unverifyShop(row)} style={styles.dangerBtn}>
                        <Icon name="close" size={13} color={colors.danger} />
                        <Text style={styles.dangerBtnText}>Unverify</Text>
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
  chipRowContent: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 18, gap: 8, marginTop: 12 },
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
  reviewBox: {
    width: '100%', gap: 8, padding: 10, borderRadius: radius.sm,
    backgroundColor: colors.warnBg, borderWidth: 1, borderColor: colors.line,
  },
  reviewNoteText: { ...type.soft, fontSize: 12.5 },
  declineInput: {
    minHeight: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12.5, color: colors.ink,
  },
});
