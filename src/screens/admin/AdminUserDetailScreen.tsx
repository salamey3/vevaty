import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

// One user, everything about them, editable. Reached from AdminUsersScreen,
// which is now a search box over myazar.admin_search_users rather than a
// list that also tried to be an editor.
//
// Every read and write on this screen goes through a SECURITY DEFINER
// function, and not because RLS is missing: `authenticated` has NO column
// grant on profiles.phone / email / whatsapp, deliberately, because that
// table's SELECT policy is `true` -- a grant there would hand every signed-in
// user every user's phone number. So an admin screen genuinely cannot read
// those columns directly, however many policies say "admins can". Same
// lesson the auctions admin half was rebuilt on: RLS filters rows, it never
// confers a privilege.

type AdminUser = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  whatsappOptIn: boolean;
  district: string | null;
  points: number;
  tier: string;
  tierOverride: string | null;
  isPhoneVerified: boolean;
  isIdVerified: boolean;
  isSuspended: boolean;
  suspendedReason: string | null;
  createdAt: string;
};

type UserListing = { id: string; titleEn: string; status: string; price: number };
type AdminAction = { id: string; action: string; details: any; createdAt: string };

const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as const;
const TIER_LABEL: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  diamond: 'Diamond',
};
// Mirrors myazar.tier_for_points -- shown as a hint so the admin can see
// what the points alone would earn, next to what the override is doing.
const TIER_MINIMUM: Record<string, number> = { bronze: 0, silver: 300, gold: 900, diamond: 2500 };

function tierForPoints(points: number): string {
  if (points >= 2500) return 'diamond';
  if (points >= 900) return 'gold';
  if (points >= 300) return 'silver';
  return 'bronze';
}

function rowToUser(row: any): AdminUser {
  return {
    id: row.id,
    fullName: row.full_name || '',
    phone: row.phone,
    email: row.email,
    whatsapp: row.whatsapp,
    whatsappOptIn: !!row.whatsapp_opt_in,
    district: row.district,
    points: row.points ?? 0,
    tier: row.tier || 'bronze',
    tierOverride: row.tier_override,
    isPhoneVerified: !!row.is_phone_verified,
    isIdVerified: !!row.is_id_verified,
    isSuspended: !!row.is_suspended,
    suspendedReason: row.suspended_reason,
    createdAt: row.created_at,
  };
}

export default function AdminUserDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AdminUserDetail'>>();
  const userId = route.params.userId;

  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The edit form. Seeded from the loaded row and compared back against it
  // to decide what to send -- only changed fields go to the server, which
  // is what keeps the audit entry meaningful rather than a rewrite of every
  // column every time Save is pressed.
  const [fullName, setFullName] = useState('');
  const [district, setDistrict] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [isIdVerified, setIsIdVerified] = useState(false);
  const [tierOverride, setTierOverride] = useState<string | null>(null);

  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);

  const [listings, setListings] = useState<UserListing[] | null>(null);
  const [history, setHistory] = useState<AdminAction[]>([]);
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [busy, setBusy] = useState(false);

  const seedForm = useCallback((u: AdminUser) => {
    setFullName(u.fullName);
    setDistrict(u.district || '');
    setEmail(u.email || '');
    setWhatsapp(u.whatsapp || '');
    setWhatsappOptIn(u.whatsappOptIn);
    setIsIdVerified(u.isIdVerified);
    setTierOverride(u.tierOverride);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_get_user', { p_user_id: userId });
      if (err) throw err;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('This user no longer exists.');
      const u = rowToUser(row);
      setUser(u);
      seedForm(u);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [userId, seedForm]);

  const loadExtras = useCallback(async () => {
    const [{ data: ls }, { data: acts }] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title_en,status,price')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('admin_actions')
        .select('id,action,details,created_at')
        .eq('target_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    setListings(
      (ls || []).map((l: any) => ({
        id: l.id,
        titleEn: l.title_en || '(untitled)',
        status: l.status,
        price: Number(l.price) || 0,
      }))
    );
    setHistory(
      (acts || []).map((a: any) => ({ id: a.id, action: a.action, details: a.details, createdAt: a.created_at }))
    );
  }, [userId]);

  useEffect(() => {
    load();
    loadExtras();
  }, [load, loadExtras]);

  // What actually changed. An empty string means "cleared" for the optional
  // text fields, which the server reads as JSON null -- present-key-means-write
  // is the whole reason admin_update_profile takes a jsonb object rather than
  // one argument per column (a null argument cannot say whether it means
  // "leave alone" or "make it empty", and guessing wrong is what silently
  // revoked a user's WhatsApp consent once already).
  const changes = useMemo(() => {
    if (!user) return {};
    const out: Record<string, any> = {};
    const norm = (s: string) => (s.trim() === '' ? null : s.trim());
    if (norm(fullName) !== (user.fullName || null)) out.full_name = norm(fullName);
    if (norm(district) !== user.district) out.district = norm(district);
    if (norm(email) !== user.email) out.email = norm(email);
    if (norm(whatsapp) !== user.whatsapp) out.whatsapp = norm(whatsapp);
    if (whatsappOptIn !== user.whatsappOptIn) out.whatsapp_opt_in = whatsappOptIn;
    if (isIdVerified !== user.isIdVerified) out.is_id_verified = isIdVerified;
    if (tierOverride !== user.tierOverride) out.tier_override = tierOverride;
    return out;
  }, [user, fullName, district, email, whatsapp, whatsappOptIn, isIdVerified, tierOverride]);

  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.rpc('admin_update_profile', {
        p_user_id: userId,
        p_changes: changes,
      });
      if (err) throw err;
      await load();
      await loadExtras();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const grant = async () => {
    const amount = parseInt(grantAmount.trim(), 10);
    if (!Number.isFinite(amount) || amount === 0) {
      Alert.alert('Enter an amount', 'A number of points to add, or a negative number to take some back.');
      return;
    }
    setGranting(true);
    try {
      const { error: err } = await supabase.rpc('admin_grant_points', {
        p_user_id: userId,
        p_points: amount,
        p_reason: grantReason.trim() || null,
      });
      if (err) throw err;
      setGrantAmount('');
      setGrantReason('');
      await load();
      await loadExtras();
    } catch (e: any) {
      Alert.alert('Could not change the balance', e?.message || String(e));
    } finally {
      setGranting(false);
    }
  };

  // Suspension goes through the same RPC as every other edit rather than a
  // direct table update -- it is the most consequential thing on this screen
  // and belongs in the same audit trail as changing someone's district. The
  // function sets suspended_at itself and clears the reason on release.
  const setSuspended = async (next: boolean) => {
    setBusy(true);
    try {
      const { error: err } = await supabase.rpc('admin_update_profile', {
        p_user_id: userId,
        p_changes: next
          ? { is_suspended: true, suspended_reason: suspendReason.trim() || null }
          : { is_suspended: false },
      });
      if (err) throw err;
      setSuspending(false);
      setSuspendReason('');
      await load();
      await loadExtras();
    } catch (e: any) {
      Alert.alert('Could not update user', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen maxWidth={720}>
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      </Screen>
    );
  }

  if (error || !user) {
    return (
      <Screen maxWidth={720}>
        <View style={styles.topBar}>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>User</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      </Screen>
    );
  }

  const earnedTier = tierForPoints(user.points);
  const nextTier = TIERS.find((t) => TIER_MINIMUM[t] > user.points);

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3} numberOfLines={1}>{user.fullName || 'Vevaty user'}</Text>
        <Pressy onPress={() => { load(); loadExtras(); }} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {user.isSuspended && (
          <View style={styles.suspendedBanner}>
            <Text style={styles.suspendedBannerText}>
              Suspended{user.suspendedReason ? ` — ${user.suspendedReason}` : ''}. They cannot post new listings.
            </Text>
          </View>
        )}

        {/* ---- Identity ---- */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.readRow}>
            <Text style={styles.readLabel}>Phone</Text>
            <Text style={styles.readValue}>{user.phone || 'Not set'}</Text>
          </View>
          <Text style={styles.fieldHint}>
            This is the number they sign in with, so it is not editable here — changing it has to be done by the
            user themselves under Edit profile → Change phone, which sends a fresh code to the new number. Editing
            it here would leave them signing in with the old one.
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, user.isPhoneVerified && styles.badgeOn]}>
              <Text style={[styles.badgeText, user.isPhoneVerified && styles.badgeTextOn]}>
                {user.isPhoneVerified ? 'Phone verified' : 'Phone not verified'}
              </Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Joined {new Date(user.createdAt).toLocaleDateString()}</Text>
            </View>
          </View>
        </View>

        {/* ---- Editable profile ---- */}
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Full name</Text>
          <TextInput value={fullName} onChangeText={setFullName} style={styles.input} placeholder="Not set" />

          <Text style={styles.fieldLabel}>District</Text>
          <TextInput value={district} onChangeText={setDistrict} style={styles.input} placeholder="Not set" />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="Not set"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.fieldLabel}>WhatsApp number</Text>
          <TextInput
            value={whatsapp}
            onChangeText={setWhatsapp}
            style={styles.input}
            placeholder="Falls back to their phone number"
            keyboardType="phone-pad"
          />
          <Text style={styles.fieldHint}>
            The number the WhatsApp button on their listings opens. Left empty, buyers are sent to their account phone.
          </Text>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Agreed to messages from Vevaty</Text>
              <Text style={styles.fieldHint}>
                Their own consent to be messaged about their listings expiring. Turning this on for someone who did
                not tick it themselves is best avoided.
              </Text>
            </View>
            <Switch value={whatsappOptIn} onValueChange={setWhatsappOptIn} />
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>ID verified</Text>
              <Text style={styles.fieldHint}>Marks the account as identity-checked.</Text>
            </View>
            <Switch value={isIdVerified} onValueChange={setIsIdVerified} />
          </View>
        </View>

        {/* ---- Tier ---- */}
        <Text style={styles.sectionTitle}>Tier</Text>
        <View style={styles.card}>
          <View style={styles.readRow}>
            <Text style={styles.readLabel}>Now</Text>
            <Text style={styles.readValue}>
              {TIER_LABEL[user.tier] || user.tier}
              {user.tierOverride ? ' (set by admin)' : ''}
            </Text>
          </View>
          <Text style={styles.fieldHint}>
            {user.tierOverride
              ? `Their ${user.points} points would otherwise put them at ${TIER_LABEL[earnedTier]}.`
              : `Earned from their ${user.points} points.${nextTier ? ` ${TIER_MINIMUM[nextTier] - user.points} more for ${TIER_LABEL[nextTier]}.` : ''}`}
          </Text>

          <View style={styles.chipRow}>
            <Pressy onPress={() => setTierOverride(null)} style={[styles.chip, tierOverride === null && styles.chipActive]}>
              <Text style={[styles.chipText, tierOverride === null && styles.chipTextActive]}>Follow points</Text>
            </Pressy>
            {TIERS.map((t) => (
              <Pressy key={t} onPress={() => setTierOverride(t)} style={[styles.chip, tierOverride === t && styles.chipActive]}>
                <Text style={[styles.chipText, tierOverride === t && styles.chipTextActive]}>{TIER_LABEL[t]}</Text>
              </Pressy>
            ))}
          </View>
          <Text style={styles.fieldHint}>
            Naming a tier pins them there whatever their points do. "Follow points" hands them back to the tier their
            balance earns, which is how every account starts.
          </Text>
        </View>

        <View style={styles.saveRow}>
          <Button
            label={dirty ? 'Save changes' : 'Saved'}
            onPress={save}
            loading={saving}
            disabled={!dirty || saving}
            style={{ flex: 1 }}
          />
        </View>

        {/* ---- Points ---- */}
        <Text style={styles.sectionTitle}>Points</Text>
        <View style={styles.card}>
          <View style={styles.readRow}>
            <Text style={styles.readLabel}>Balance</Text>
            <Text style={styles.readValue}>{user.points} pts</Text>
          </View>

          <Text style={styles.fieldLabel}>Add points</Text>
          <TextInput
            value={grantAmount}
            onChangeText={setGrantAmount}
            style={styles.input}
            placeholder="e.g. 500, or -50 to take some back"
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.fieldLabel}>Reason</Text>
          <TextInput
            value={grantReason}
            onChangeText={setGrantReason}
            style={styles.input}
            placeholder="Added by Vevaty"
          />
          <Text style={styles.fieldHint}>
            The user reads this on their own points activity screen, so write it as a sentence they should see. This
            does not count against their 300-a-month earning cap.
          </Text>
          <View style={styles.saveRow}>
            <Button label="Apply" onPress={grant} loading={granting} disabled={granting} style={{ flex: 1 }} />
          </View>
        </View>

        {/* ---- Listings ---- */}
        <Text style={styles.sectionTitle}>Listings</Text>
        <View style={styles.card}>
          {listings === null ? (
            <ActivityIndicator color={colors.ink} style={{ marginVertical: 10 }} />
          ) : listings.length === 0 ? (
            <Text style={type.soft}>No listings.</Text>
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
        </View>

        {/* ---- Suspension ---- */}
        <Text style={styles.sectionTitle}>Access</Text>
        <View style={styles.card}>
          <Text style={styles.fieldHint}>
            Suspending stops them posting new listings. Existing listings stay up unless they are removed from
            Moderation.
          </Text>
          {user.isSuspended ? (
            <Button label="Unsuspend" variant="secondary" onPress={() => setSuspended(false)} loading={busy} />
          ) : suspending ? (
            <View>
              <TextInput
                value={suspendReason}
                onChangeText={setSuspendReason}
                placeholder="Reason (optional)"
                style={styles.input}
              />
              <View style={styles.actionsRow}>
                <Pressy onPress={() => { setSuspending(false); setSuspendReason(''); }} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressy>
                <Button label="Confirm suspend" onPress={() => setSuspended(true)} loading={busy} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Pressy onPress={() => setSuspending(true)} style={styles.dangerBtn}>
              <Icon name="close" size={13} color={colors.danger} />
              <Text style={styles.dangerBtnText}>Suspend</Text>
            </Pressy>
          )}
        </View>

        {/* ---- Audit ---- */}
        {history.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Admin history</Text>
            <View style={styles.card}>
              {history.map((h) => (
                <View key={h.id} style={styles.historyRow}>
                  <Text style={styles.historyText}>{describeAction(h)}</Text>
                  <Text style={styles.historyDate}>{new Date(h.createdAt).toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// The log stores the raw change object, which is the right thing to KEEP
// (it stays true whatever the UI does later) and the wrong thing to SHOW.
function describeAction(h: AdminAction): string {
  if (h.action === 'grant_points') {
    const pts = h.details?.points ?? 0;
    const verb = pts >= 0 ? 'Added' : 'Removed';
    return `${verb} ${Math.abs(pts)} points — "${h.details?.reason || ''}"`;
  }
  if (h.action === 'suspend') {
    const why = h.details?.changes?.suspended_reason;
    return `Suspended${why ? ` — "${why}"` : ''}`;
  }
  if (h.action === 'unsuspend') return 'Unsuspended';
  if (h.action === 'update_profile') {
    const changed = Object.keys(h.details?.changes || {});
    if (changed.length === 0) return 'Edited profile';
    const pretty: Record<string, string> = {
      full_name: 'name',
      district: 'district',
      email: 'email',
      whatsapp: 'WhatsApp number',
      whatsapp_opt_in: 'message consent',
      is_id_verified: 'ID verified',
      tier_override: 'tier',
    };
    return `Edited ${changed.map((c) => pretty[c] || c).join(', ')}`;
  }
  return h.action;
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48, gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 80 },
  suspendedBanner: {
    backgroundColor: '#f5e4e2', borderRadius: radius.sm, padding: 12, marginBottom: 14,
  },
  suspendedBannerText: { fontSize: 12.5, color: colors.danger, fontWeight: '600', lineHeight: 17 },
  sectionTitle: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14,
  },
  readRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  readLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5 },
  readValue: { fontSize: 14.5, fontWeight: '700', color: colors.ink, flexShrink: 1, textAlign: 'right' },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  fieldHint: { ...type.tiny, textTransform: 'none', letterSpacing: 0, color: colors.inkSoft, lineHeight: 16, marginTop: 6 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 44, fontSize: 14, color: colors.ink,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  badge: {
    paddingHorizontal: 10, height: 24, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.primaryTint, borderColor: colors.primaryTint },
  badgeText: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  badgeTextOn: { color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    height: 34, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.white },
  saveRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'center' },
  listingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  listingTitle: { fontSize: 13, color: colors.ink, flex: 1, marginRight: 8 },
  listingMeta: { ...type.tiny },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, paddingHorizontal: 16, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, marginTop: 12,
  },
  dangerBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.danger },
  cancelBtn: { height: 44, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  historyText: { fontSize: 13, color: colors.ink },
  historyDate: { ...type.tiny, marginTop: 2 },
});
