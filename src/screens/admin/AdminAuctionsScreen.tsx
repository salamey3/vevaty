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
import { Auction, AuctionStatus } from '../../types';
import {
  AuctionError, createAuction, deleteAuction, publishAuction, updateAuction,
} from '../../lib/auctions';
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
  // Not simply "no lots": publish_auction counts only lots that are not
  // withdrawn, so this fires on an auction showing three rows.
  no_lots: 'This auction has no lots that are not withdrawn — add one, or bring a withdrawn lot back from the lots screen.',
  schedule_incomplete: 'Set both the opening time and the first lot close.',
  closes_before_opens: 'The first lot cannot close before the auction opens.',
  already_published: 'This auction is already published.',
  title_required: 'Enter both titles.',
  category_required: 'Pick a category.',
  invalid_status: 'That is not an auction status.',
  listing_not_found: 'That listing no longer exists.',
  already_a_lot: 'That listing is already a lot in an auction — including a withdrawn one. Remove that lot first.',
  start_price_invalid: 'Enter a start price above zero.',
  reserve_below_start: 'A reserve cannot be below the start price.',
  auction_not_found: 'That auction no longer exists.',
  lot_not_found: 'That lot no longer exists.',
  not_admin: 'Admin only.',
};

export function adminMessage(e: any): string {
  // `e.message` is NOT a fallback: AuctionError's constructor passes the
  // code to super(), so an unmapped error has message === 'unknown' and
  // this used to render a dialog whose entire body was that word. The raw
  // text the database or the transport actually returned is on `.raw`.
  if (e instanceof AuctionError) {
    return ADMIN_MESSAGES[e.code] || e.raw || 'Something went wrong.';
  }
  return e?.message || 'Something went wrong.';
}

// Every status the auction table allows, offered as a plain row of pills.
//
// Deliberately not a workflow. publish_auction is the guarded path -- it
// checks the schedule, refuses an auction with no lots, stamps every lot's
// clock -- and it stays the normal way to open a sale. This row is the
// override beside it: an auction under test has to be draggable to `live`
// and back without waiting for Friday, and closing one has to be possible
// without waiting for the minute job to notice.
//
// update_auction carries the lots along for every one of these, which it
// did not at first: advance_auctions closes any lot that is 'live' with a
// passed closes_at and never reads the auction above it, so an auction
// forced to `cancelled` went on stamping winners a minute later, and one
// forced back to `draft` did it invisibly.
const STATUSES: AuctionStatus[] = ['draft', 'scheduled', 'live', 'closed', 'settled', 'cancelled'];

type FormState = {
  titleEn: string; titleAr: string; opensAt: string; closesAt: string;
  stagger: string; antiSnipe: string; sellerPct: string; buyerPct: string;
  status: AuctionStatus;
  // Whether the status pill was actually TAPPED. Without it, Save writes
  // back whatever status the row had when the screen last loaded -- and
  // advance_auctions moves auctions on its own every sixty seconds, so
  // fixing a typo two minutes after opening the screen would silently
  // shove a live auction back to `scheduled` and unbid every lot.
  statusTouched: boolean;
};

const EMPTY_FORM: FormState = {
  titleEn: '', titleAr: '', opensAt: '', closesAt: '',
  stagger: '', antiSnipe: '', sellerPct: '', buyerPct: '',
  status: 'draft', statusTouched: false,
};

// A number field that was left blank means "leave it alone", and a field
// with rubbish in it is a mistake worth stopping for -- undefined and
// invalid must not collapse into the same thing.
function optionalNumber(text: string): number | null | undefined {
  if (!text.trim()) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function AdminAuctionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { language } = useLanguage();
  const { siteSettings, updateSiteSettings } = useSettings();
  const [rows, setRows] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // null = the form is closed. 'new' = creating. An id = editing that one.
  // One piece of state rather than two booleans, because "creating AND
  // editing" is not a state this screen can be in and a pair of flags
  // would let it be.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

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

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };

  const openEdit = (a: Auction) => {
    setForm({
      titleEn: a.titleEn, titleAr: a.titleAr,
      opensAt: fromIso(a.opensAt), closesAt: fromIso(a.firstLotClosesAt),
      stagger: String(a.lotCloseStaggerSeconds ?? ''),
      antiSnipe: String(a.antiSnipeSeconds ?? ''),
      sellerPct: String(a.sellerCommissionPct ?? ''),
      buyerPct: String(a.buyerPremiumPct ?? ''),
      status: a.status, statusTouched: false,
    });
    setEditing(a.id);
  };

  const closeForm = () => { setEditing(null); setForm(EMPTY_FORM); };

  const submit = async () => {
    if (!form.titleEn.trim() || !form.titleAr.trim()) {
      Alert.alert('Missing title', 'Enter both titles.');
      return;
    }
    // A blank time is allowed on an EDIT and means "leave it alone" --
    // update_auction coalesces a null. A malformed one is not: silently
    // ignoring "2026-9-5 8pm" would look exactly like a successful save.
    const opens = form.opensAt.trim() ? toIso(form.opensAt) : null;
    const closes = form.closesAt.trim() ? toIso(form.closesAt) : null;
    if ((form.opensAt.trim() && !opens) || (form.closesAt.trim() && !closes)) {
      Alert.alert('Bad date', 'Use YYYY-MM-DD HH:MM, e.g. 2026-09-05 20:00');
      return;
    }
    if (editing === 'new' && (!opens || !closes)) {
      Alert.alert('Missing schedule', 'A new auction needs both times.');
      return;
    }

    const stagger = optionalNumber(form.stagger);
    const antiSnipe = optionalNumber(form.antiSnipe);
    const sellerPct = optionalNumber(form.sellerPct);
    const buyerPct = optionalNumber(form.buyerPct);
    if (stagger === null || antiSnipe === null) {
      Alert.alert('Bad number', 'Stagger and anti-snipe are whole seconds, zero or more.');
      return;
    }
    if (sellerPct === null || buyerPct === null ||
        (sellerPct !== undefined && sellerPct > 100) || (buyerPct !== undefined && buyerPct > 100)) {
      Alert.alert('Bad percentage', 'Commission and premium are percentages between 0 and 100.');
      return;
    }

    setBusy(true);
    try {
      if (editing === 'new') {
        // create_auction, not an insert: `authenticated` has no INSERT on
        // this table and an RLS policy cannot give one back.
        await createAuction({
          titleEn: form.titleEn.trim(), titleAr: form.titleAr.trim(),
          opensAt: opens!, firstLotClosesAt: closes!,
        });
      } else if (editing) {
        // Only what the form actually holds. `undefined` for a blank field
        // rather than null, so the wrapper sends null and the function
        // coalesces -- "leave it", not "clear it". Status goes only if the
        // pill was tapped, for the staleness reason on FormState.
        await updateAuction(editing, {
          titleEn: form.titleEn.trim(),
          titleAr: form.titleAr.trim(),
          opensAt: opens || undefined,
          firstLotClosesAt: closes || undefined,
          staggerSeconds: stagger,
          antiSnipeSeconds: antiSnipe,
          sellerCommissionPct: sellerPct,
          buyerPremiumPct: buyerPct,
          status: form.statusTouched ? form.status : undefined,
        });
      }
    } catch (e: any) {
      setBusy(false);
      Alert.alert(editing === 'new' ? 'Could not create' : 'Could not save', adminMessage(e));
      return;
    }
    setBusy(false);
    closeForm();
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

  // Naming what goes, rather than asking "are you sure?". The consequence
  // differs by what is in the auction and the admin cannot see it from
  // this row, so the dialog says it: consigned listings come back, items
  // created for the sale are removed, bids are gone.
  const confirmDelete = (a: Auction) => {
    Alert.alert(
      'Delete this auction?',
      `"${pickText(a.titleEn, a.titleAr, language)}" and every bid placed in it are deleted. ` +
        'Lots consigned from an existing listing go back to the status they had before ' +
        'the auction. Items created for this auction are hidden from the site but kept ' +
        'in the database indefinitely — the daily purge skips them — so they can be ' +
        'brought back by hand. The auction and its bids cannot.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAuction(a.id);
            } catch (e: any) {
              Alert.alert('Could not delete', adminMessage(e));
            } finally {
              setBusy(false);
              if (editing === a.id) closeForm();
              load();
            }
          },
        },
      ]
    );
  };

  const renderForm = () => (
    <View style={styles.form}>
      <Text style={styles.formTitle}>{editing === 'new' ? 'New auction' : 'Edit auction'}</Text>
      <Text style={styles.fieldLabel}>Title (English)</Text>
      <TextInput value={form.titleEn} onChangeText={(v) => setForm((f) => ({ ...f, titleEn: v }))} style={styles.input} placeholder="September Sale No. 1" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Title (Arabic)</Text>
      <TextInput value={form.titleAr} onChangeText={(v) => setForm((f) => ({ ...f, titleAr: v }))} style={styles.input} placeholder="مزاد أيلول ١" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Opens (YYYY-MM-DD HH:MM, your local time)</Text>
      <TextInput value={form.opensAt} onChangeText={(v) => setForm((f) => ({ ...f, opensAt: v }))} style={styles.input} placeholder="2026-09-05 20:00" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Lot 1 closes</Text>
      <TextInput value={form.closesAt} onChangeText={(v) => setForm((f) => ({ ...f, closesAt: v }))} style={styles.input} placeholder="2026-09-07 20:00" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.hint}>
        {editing === 'new'
          ? 'Each later lot closes 2 minutes after the one before it; change that below once it exists.'
          : 'Changing these moves every lot that has not finished — including backwards, which closes them at the next minute tick.'}
      </Text>

      {editing !== 'new' && (
        <>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.pillRow}>
            {STATUSES.map((s) => (
              <Pressy
                key={s}
                onPress={() => setForm((f) => ({ ...f, status: s, statusTouched: true }))}
                style={[styles.pill, form.status === s && styles.pillOn]}
              >
                <Text style={[styles.pillText, form.status === s && styles.pillTextOn]}>{s}</Text>
              </Pressy>
            ))}
          </View>
          <Text style={styles.hint}>
            The lots follow: live promotes them and gives each a close time, scheduled
            makes them unbiddable, draft also stops their clocks, cancelled cancels the ones
            still running and hands their consigned items back (finished lots keep their
            results), closed and settled bring each unfinished lot to its close so it
            resolves to won or unsold on the bids it has.
            {!form.statusTouched && ' Untouched, so this save leaves the status alone.'}
          </Text>
          {/* The one status that does not stick on its own. The minute job
              reopens any `scheduled` auction whose opening time has passed,
              so a running sale demoted to scheduled is live again inside a
              minute unless Opens moves with it. */}
          <Text style={styles.hint}>
            Scheduled only holds while Opens is still in the future — the minute job reopens
            a scheduled auction the moment its opening time passes. To pause a running sale,
            move Opens forward in this same save, or use draft.
          </Text>

          <Text style={styles.fieldLabel}>Lot close stagger (seconds)</Text>
          <TextInput value={form.stagger} onChangeText={(v) => setForm((f) => ({ ...f, stagger: v }))} keyboardType="numeric" style={styles.input} placeholder="120" placeholderTextColor={colors.inkSoft} />
          <Text style={styles.hint}>
            Changing the stagger recomputes every unfinished lot's close from the first one —
            the same as changing the times above. Two things ride in that column and are
            overwritten: anti-snipe extensions already granted, and the five-minute floor a
            late-added lot was given. A recomputed time that lands in the past closes that lot
            at the next minute tick.
          </Text>
          <Text style={styles.fieldLabel}>Anti-snipe extension (seconds)</Text>
          <TextInput value={form.antiSnipe} onChangeText={(v) => setForm((f) => ({ ...f, antiSnipe: v }))} keyboardType="numeric" style={styles.input} placeholder="120" placeholderTextColor={colors.inkSoft} />
          <Text style={styles.fieldLabel}>Seller commission (%)</Text>
          <TextInput value={form.sellerPct} onChangeText={(v) => setForm((f) => ({ ...f, sellerPct: v }))} keyboardType="numeric" style={styles.input} placeholder="15" placeholderTextColor={colors.inkSoft} />
          <Text style={styles.fieldLabel}>Buyer premium (%)</Text>
          <TextInput value={form.buyerPct} onChangeText={(v) => setForm((f) => ({ ...f, buyerPct: v }))} keyboardType="numeric" style={styles.input} placeholder="10" placeholderTextColor={colors.inkSoft} />
        </>
      )}

      <View style={styles.formActions}>
        <Pressy onPress={closeForm} style={styles.cancelBtn} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></Pressy>
        <Pressy onPress={submit} style={styles.saveBtn} disabled={busy}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : editing === 'new' ? 'Create' : 'Save'}</Text>
        </Pressy>
      </View>
    </View>
  );

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

        {editing === 'new' ? renderForm() : (
          <Pressy onPress={openNew} style={styles.newBtn}>
            <Icon name="plus" size={16} color={colors.white} />
            <Text style={styles.newText}>New auction</Text>
          </Pressy>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
        ) : (
          rows.map((a) => (
            <View key={a.id}>
              <View style={styles.row}>
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
                <Pressy onPress={() => (editing === a.id ? closeForm() : openEdit(a))} style={styles.iconAction} disabled={busy}>
                  <Icon name="edit" size={15} color={colors.inkSoft} />
                </Pressy>
                <Pressy onPress={() => confirmDelete(a)} style={styles.iconAction} disabled={busy}>
                  <Icon name="trash" size={15} color={colors.danger} />
                </Pressy>
                <Icon name="chevronRight" size={16} color={colors.inkSoft} />
              </View>
              {editing === a.id && renderForm()}
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
  formTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, marginTop: 10 },
  input: {
    height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 14.5, color: colors.ink,
  },
  hint: { ...type.tiny, marginTop: 8, lineHeight: 16 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 12, height: 32, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pillText: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft },
  pillTextOn: { color: colors.primary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  saveBtn: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13.5, fontWeight: '800', color: colors.white },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowSub: { ...type.tiny },
  publishBtn: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  publishText: { fontSize: 12, fontWeight: '800', color: colors.white },
  iconAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
