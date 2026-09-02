import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { Auction } from '../../types';
import { AuctionError, createAuction, publishAuction } from '../../lib/auctions';
import { pickText } from '../../lib/listingText';
import { useLanguage } from '../../i18n/LanguageContext';
import { useSettings } from '../../store/SettingsStore';
import { DESKTOP_CONTENT_MAX_WIDTH } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';

// Building an auction. Admin-only, English-only chrome like every other
// admin screen -- the people using it are the two of us, and a bilingual
// admin is work spent on an audience of two.
//
// Times are entered as plain local datetime strings rather than through a
// picker: an auction is scheduled once a fortnight by somebody who knows
// exactly when Friday night is, and a date picker that behaves differently
// on three platforms is a worse trade than a text field with a format hint.
function toIso(local: string): string | null {
  // Accepts "2026-09-05 20:00". Parsed as LOCAL time, which is what the
  // person typing it means -- appending 'Z' here would silently shift a
  // Beirut evening auction by three hours.
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fromIso(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// The engine raises codes; this is the admin's half of turning them into
// sentences. English only, like the rest of the admin.
const ADMIN_MESSAGES: Record<string, string> = {
  no_lots: 'Add at least one lot first.',
  schedule_incomplete: 'Set both the opening time and the first lot close.',
  closes_before_opens: 'The first lot cannot close before the auction opens.',
  already_published: 'This auction is already published.',
  title_required: 'Enter both titles.',
  listing_not_found: 'That listing no longer exists.',
  already_a_lot: 'That listing is already a lot in an auction.',
  start_price_invalid: 'Enter a start price above zero.',
  reserve_below_start: 'A reserve cannot be below the start price.',
  listing_not_active: 'Only a live listing can be consigned. Publish it first.',
  auction_not_found: 'That auction no longer exists.',
  lot_not_found: 'That lot no longer exists.',
  lot_already_sold: 'That lot has already sold — it cannot be withdrawn.',
  auction_still_draft: 'Remove the lot instead — this auction is not published yet.',
  not_admin: 'Admin only.',
};

export function adminMessage(e: any): string {
  const code = e instanceof AuctionError ? e.code : 'unknown';
  return ADMIN_MESSAGES[code] || e?.message || 'Something went wrong.';
}

export default function AdminAuctionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { language } = useLanguage();
  const { siteSettings, updateSiteSettings } = useSettings();
  const [rows, setRows] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ titleEn: '', titleAr: '', opensAt: '', closesAt: '' });

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('auctions')
      .select('id, title_en, title_ar, status, opens_at, first_lot_closes_at, lot_close_stagger_seconds, anti_snipe_seconds, seller_commission_pct, buyer_premium_pct')
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load auctions', error.message);
    setRows((data || []).map((r: any) => ({
      id: r.id, titleEn: r.title_en, titleAr: r.title_ar, status: r.status,
      opensAt: r.opens_at, firstLotClosesAt: r.first_lot_closes_at,
      lotCloseStaggerSeconds: r.lot_close_stagger_seconds,
      antiSnipeSeconds: r.anti_snipe_seconds,
      sellerCommissionPct: Number(r.seller_commission_pct),
      buyerPremiumPct: Number(r.buyer_premium_pct),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const opens = toIso(form.opensAt);
    const closes = toIso(form.closesAt);
    if (!form.titleEn.trim() || !form.titleAr.trim()) { Alert.alert('Missing title', 'Enter both titles.'); return; }
    if (!opens || !closes) { Alert.alert('Bad date', 'Use YYYY-MM-DD HH:MM, e.g. 2026-09-05 20:00'); return; }
    setBusy(true);
    // create_auction, not an insert: `authenticated` has no INSERT on this
    // table and an RLS policy cannot give one back.
    try {
      await createAuction({
        titleEn: form.titleEn.trim(), titleAr: form.titleAr.trim(),
        opensAt: opens, firstLotClosesAt: closes,
      });
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not create', adminMessage(e));
      return;
    }
    setBusy(false);
    setForm({ titleEn: '', titleAr: '', opensAt: '', closesAt: '' });
    setCreating(false);
    load();
  };

  // publish_auction is a SECURITY DEFINER function, not an UPDATE: it
  // validates the schedule, refuses an auction with no lots, and stamps
  // every lot's own staggered close in the same statement. Doing that from
  // here would be four writes that can half-succeed.
  const publish = async (a: Auction) => {
    setBusy(true);
    try {
      await publishAuction(a.id);
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not publish', adminMessage(e));
      return;
    }
    setBusy(false);
    load();
  };

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Auctions</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* The switch that makes the whole section visible to buyers. It
            lives here rather than in Branding because it is the one
            control that decides whether an auction exists as far as the
            app is concerned, and it belongs beside the auctions. */}
        <Pressy
          onPress={async () => {
            // await + catch, because updateSiteSettings applies the change
            // to local state BEFORE the write and throws if the write is
            // refused -- so an unhandled call leaves this device reading
            // "visible to buyers" while the database says otherwise, on
            // the one switch that decides whether the feature exists.
            try {
              await updateSiteSettings({ auctionsEnabled: !siteSettings.auctionsEnabled });
            } catch (e: any) {
              Alert.alert('Could not save', e?.message || String(e));
            }
          }}
          style={[styles.flagRow, siteSettings.auctionsEnabled && styles.flagRowOn]}
        >
          <Icon
            name={siteSettings.auctionsEnabled ? 'eye' : 'eyeOff'}
            size={18}
            color={siteSettings.auctionsEnabled ? colors.primary : colors.inkSoft}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.flagTitle}>
              {siteSettings.auctionsEnabled ? 'Auctions are visible to buyers' : 'Auctions are hidden'}
            </Text>
            <Text style={styles.flagSub}>
              {siteSettings.auctionsEnabled
                ? 'The Auctions tile shows on the browse gate. Tap to hide it again.'
                : 'Nobody sees the tile or can reach the section. Tap to switch it on.'}
            </Text>
          </View>
        </Pressy>

        {creating ? (
          <View style={styles.form}>
            <Text style={styles.fieldLabel}>Title (English)</Text>
            <TextInput value={form.titleEn} onChangeText={(v) => setForm((f) => ({ ...f, titleEn: v }))} style={styles.input} placeholder="September Sale No. 1" placeholderTextColor={colors.inkSoft} />
            <Text style={styles.fieldLabel}>Title (Arabic)</Text>
            <TextInput value={form.titleAr} onChangeText={(v) => setForm((f) => ({ ...f, titleAr: v }))} style={styles.input} placeholder="مزاد أيلول ١" placeholderTextColor={colors.inkSoft} />
            <Text style={styles.fieldLabel}>Opens (YYYY-MM-DD HH:MM, your local time)</Text>
            <TextInput value={form.opensAt} onChangeText={(v) => setForm((f) => ({ ...f, opensAt: v }))} style={styles.input} placeholder="2026-09-05 20:00" placeholderTextColor={colors.inkSoft} />
            <Text style={styles.fieldLabel}>Lot 1 closes</Text>
            <TextInput value={form.closesAt} onChangeText={(v) => setForm((f) => ({ ...f, closesAt: v }))} style={styles.input} placeholder="2026-09-07 20:00" placeholderTextColor={colors.inkSoft} />
            <Text style={styles.hint}>Each later lot closes 2 minutes after the one before it.</Text>
            <View style={styles.formActions}>
              <Pressy onPress={() => setCreating(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>Cancel</Text></Pressy>
              <Pressy onPress={create} style={styles.saveBtn} disabled={busy}><Text style={styles.saveText}>Create</Text></Pressy>
            </View>
          </View>
        ) : (
          <Pressy onPress={() => setCreating(true)} style={styles.newBtn}>
            <Icon name="plus" size={16} color={colors.white} />
            <Text style={styles.newText}>New auction</Text>
          </Pressy>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
        ) : (
          rows.map((a) => (
            <View key={a.id} style={styles.row}>
              <Pressy onPress={() => navigation.navigate('AdminAuctionLots', { auctionId: a.id })} style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>{pickText(a.titleEn, a.titleAr, language)}</Text>
                <Text style={styles.rowSub}>
                  {a.status} · opens {fromIso(a.opensAt) || '—'} · lot 1 closes {fromIso(a.firstLotClosesAt) || '—'}
                </Text>
                <Text style={styles.rowSub}>
                  Seller {a.sellerCommissionPct}% · Buyer {a.buyerPremiumPct}%
                </Text>
              </Pressy>
              {a.status === 'draft' && (
                <Pressy onPress={() => publish(a)} style={styles.publishBtn} disabled={busy}>
                  <Text style={styles.publishText}>Publish</Text>
                </Pressy>
              )}
              <Icon name="chevronRight" size={16} color={colors.inkSoft} />
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 80 },
  flagRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 13, marginBottom: 16,
  },
  flagRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  flagTitle: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  flagSub: { ...type.tiny, marginTop: 2, lineHeight: 16 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.pill, height: 46, marginBottom: 18,
  },
  newText: { fontSize: 14, fontWeight: '800', color: colors.white },
  form: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginBottom: 18,
  },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, marginTop: 10 },
  input: {
    height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 14.5, color: colors.ink,
  },
  hint: { ...type.tiny, marginTop: 8 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  saveBtn: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13.5, fontWeight: '800', color: colors.white },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowSub: { ...type.tiny },
  publishBtn: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  publishText: { fontSize: 12, fontWeight: '800', color: colors.white },
});
