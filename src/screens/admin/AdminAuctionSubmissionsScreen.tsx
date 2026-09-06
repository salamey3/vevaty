import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../store/SettingsStore';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';
import {
  AdminSubmission, DraftCondition, SUBMISSION_CONDITIONS, SubmissionDecision,
  SubmissionError, SubmissionStatus,
  convertSubmission, decideSubmission, fetchSubmissionQueue, saveSubmissionNote,
} from '../../lib/auctionSubmissions';

// The consignment queue: what people have offered us, and what became of
// it.
//
// Two distinct acts live on this screen and they are deliberately not one
// button. ACCEPTING says "we want this object" -- it creates nothing, and
// it is the answer to a photograph and a description. CONVERTING says
// "these are the terms and this is the sale it goes in" -- it creates a
// listing owned by the consignor and a lot, and it is the answer to
// having the object on the desk. Between them sits the inspection, and a
// screen that collapsed them would mean quoting a start price off a phone
// photograph.
//
// English only, like every other admin screen: this is read by the people
// running the sale, not by the market.

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ADMIN_MESSAGES: Record<string, string> = {
  not_admin: 'Admin only.',
  not_found: 'That submission no longer exists.',
  not_accepted: 'Accept it first — converting straight from the queue skips the screening.',
  already_converted: 'This one is already a lot.',
  not_decidable: 'The consignor withdrew this one. It is not ours to decide.',
  note_required: 'Say what is missing — a question with no question in it leaves them nothing to do.',
  invalid_decision: 'That is not a decision.',
  text_too_long: 'That note is too long.',
  auction_not_found: 'That auction no longer exists.',
  category_required: 'Pick a category.',
  condition_invalid: 'That is not a condition this category accepts.',
  title_required: 'Enter both titles.',
  start_price_invalid: 'Enter a start price above zero.',
  reserve_below_start: 'A reserve cannot be below the start price.',
  rate_out_of_range: 'A commission or premium has to be between 0 and 100 percent.',
  invalid_commission_basis: 'That is not a commission basis.',
  surplus_needs_reserve:
    'Charging the seller only on the amount above reserve needs a reserve on the lot — set one, ' +
    'or charge on the full sale price.',
  amount_invalid: 'One of those numbers is not a number.',
};

function say(e: unknown): string {
  const code = (e as SubmissionError)?.code;
  if (code && ADMIN_MESSAGES[code]) return ADMIN_MESSAGES[code];
  return (e as Error)?.message || 'Something went wrong.';
}

type AuctionOption = { id: string; title: string; status: string };

const FILTERS: { key: string; label: string; statuses: SubmissionStatus[] | null }[] = [
  { key: 'open', label: 'Waiting', statuses: ['pending', 'needs_info'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'converted', label: 'In a sale', statuses: ['converted'] },
  { key: 'closed', label: 'Closed', statuses: ['declined', 'withdrawn'] },
  { key: 'all', label: 'Everything', statuses: null },
];

type ConvertForm = {
  auctionId: string; categoryId: string;
  titleEn: string; titleAr: string;
  descriptionEn: string; descriptionAr: string;
  district: string; condition: DraftCondition;
  startPrice: string; reservePrice: string;
  sellerCommissionPct: string; buyerPremiumPct: string;
  sellerCommissionBasis: 'hammer' | 'surplus' | '';
};

function money(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// The submission's amounts are STRINGS -- they came off text inputs and ''
// means "did not say", which Number('') would quietly turn into a $0 the
// consignor never typed.
function amount(raw: string | null | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  return Number.isFinite(n) ? money(n) : '—';
}

export default function AdminAuctionSubmissionsScreen() {
  const navigation = useNavigation<Nav>();
  const isDesktop = useIsDesktop();
  const { allCategories, categoryById } = useSettings();

  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState<AdminSubmission[]>([]);
  const [counts, setCounts] = useState<Partial<Record<SubmissionStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // A failed load used to leave the PREVIOUS filter's rows on screen under
  // the newly highlighted pill, every Accept/Decline button live -- an
  // admin deciding a pending row while believing it was already converted.
  // It also rendered "Nothing here" on a first-load failure, which is an
  // assertion about the queue this screen cannot make.
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Per-row note drafts, keyed by submission id. Kept out of the row
  // component so typing a decline reason does not vanish when the list
  // refreshes underneath it.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [privateNotes, setPrivateNotes] = useState<Record<string, string>>({});

  const [converting, setConverting] = useState<AdminSubmission | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertForm | null>(null);
  const [auctions, setAuctions] = useState<AuctionOption[]>([]);
  const [catQuery, setCatQuery] = useState('');

  // Bumped on every load. A response whose ticket is no longer the current
  // one is dropped: tapping through the filters quickly could otherwise
  // land an older reply last and leave rows from a filter nobody is on.
  const ticket = React.useRef(0);

  // `quiet` is for the refresh that follows an action the user already got
  // an answer to. Its failure alert used to stack on top of the "Lot
  // created / Open the lots" dialog and could bury the navigate option --
  // and the row itself has already been updated locally, so a failed
  // background refresh is not news.
  const load = useCallback(async (quiet = false) => {
    const mine = ++ticket.current;
    try {
      const f = FILTERS.find((x) => x.key === filter);
      const q = await fetchSubmissionQueue(f?.statuses ?? null, 150);
      if (mine !== ticket.current) return;
      setRows(q.rows);
      setCounts(q.counts);
      setFailed(false);
    } catch (e) {
      if (mine !== ticket.current) return;
      // Cleared, not kept. Stale rows under the wrong pill are worse than
      // none, because nothing on screen says they are stale.
      setRows([]);
      // The counts go too. "Waiting (7)" on the pill above "could not read
      // the queue" is a number asserted from a read that failed.
      setCounts({});
      setFailed(true);
      if (!quiet) Alert.alert('Could not load the queue', say(e));
    } finally {
      if (mine === ticket.current) { setLoading(false); setRefreshing(false); }
    }
  }, [filter]);

  useEffect(() => { setLoading(true); setFailed(false); load(); }, [load]);

  // Drafts included: an accepted item usually goes into the next sale,
  // which has not been published yet. Read straight from the table the way
  // the auctions admin screen does — RLS lets an admin see drafts.
  // Its error used to be destructured away, so a failed read became an
  // empty list -- and the convert sheet then stated as fact that there was
  // no sale to put the lot in, which is a claim about the database rather
  // than a report of a failure.
  // Four states, not three. While the FIRST read is in flight the list is
  // empty and nothing has failed -- and the sheet used to fill that gap
  // with "no auction to put it in", which is the same claim-about-the-
  // database this flag was added to stop it making about a failed read.
  const [auctionsPhase, setAuctionsPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const auctionTicket = React.useRef(0);
  const loadAuctions = useCallback(async () => {
    const mine = ++auctionTicket.current;
    setAuctionsPhase('loading');
    try {
      const { data, error } = await supabase
        .from('auctions')
        .select('id, title_en, status')
        .in('status', ['draft', 'scheduled', 'live'])
        .order('created_at', { ascending: false });
      if (mine !== auctionTicket.current) return;
      if (error) { setAuctionsPhase('failed'); return; }
      setAuctions((data || []).map((a: any) => ({ id: a.id, title: a.title_en, status: a.status })));
      setAuctionsPhase('ready');
    } catch {
      // Without this a thrown (rather than returned) error is an unhandled
      // rejection and the sheet sits on 'loading' for good.
      if (mine === auctionTicket.current) setAuctionsPhase('failed');
    }
  }, []);
  useEffect(() => { loadAuctions(); }, [loadAuctions]);

  const leafCategories = useMemo(() => {
    const parents = new Set(allCategories.map((c) => c.parentId).filter(Boolean) as string[]);
    return allCategories
      .filter((c) => c.active && !parents.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [allCategories]);

  const visibleCategories = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    const chosen = convertForm?.categoryId;
    if (!q) return leafCategories.slice(0, 40);
    return leafCategories
      .filter((c) => c.id === chosen || c.nameEn.toLowerCase().includes(q) || c.id.includes(q))
      .slice(0, 40);
  }, [leafCategories, catQuery, convertForm?.categoryId]);

  const decide = async (s: AdminSubmission, decision: SubmissionDecision) => {
    setBusy(true);
    try {
      const note = notes[s.id] ?? '';
      // undefined leaves the stored private note alone; the string
      // replaces it. Only sent when this admin actually typed one, so
      // opening a row and deciding does not wipe somebody else's note.
      const updated = await decideSubmission(s.id, decision, note, privateNotes[s.id]);
      setRows((r) => r.map((x) => (x.id === s.id ? updated : x)));
      setNotes((n) => ({ ...n, [s.id]: '' }));
      // The decision carried the private note with it, so the local copy
      // is now the stored one -- dropped, or its Save button stays live
      // over a value that is already saved.
      setPrivateNotes((n) => { const { [s.id]: _drop, ...rest } = n; return rest; });
      // The filter it was in may no longer hold it.
      load(true);
    } catch (e) {
      Alert.alert('Could not save that', say(e));
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (s: AdminSubmission) => {
    const note = privateNotes[s.id];
    if (note === undefined) return;
    setBusy(true);
    try {
      const updated = await saveSubmissionNote(s.id, note);
      setRows((r) => r.map((x) => (x.id === s.id ? updated : x)));
      // Dropped from the local map so the field falls back to what is now
      // stored -- otherwise the button stays live over a saved value and
      // "unsaved" and "saved" look identical.
      setPrivateNotes((n) => { const { [s.id]: _drop, ...rest } = n; return rest; });
    } catch (e) {
      Alert.alert('Could not save the note', say(e));
    } finally {
      setBusy(false);
    }
  };

  const openConvert = (s: AdminSubmission) => {
    setConverting(s);
    setCatQuery('');
    setConvertForm({
      // Nothing preselected. Every other field here that is a commitment
      // -- the start price, the rates, the basis -- is left blank on
      // purpose, and which sale it goes into is the biggest of them: the
      // most recently created auction can be one already running.
      auctionId: '',
      categoryId: s.suggested.categoryId ?? '',
      titleEn: s.suggested.titleEn,
      titleAr: s.suggested.titleAr,
      descriptionEn: s.suggested.descriptionEn,
      descriptionAr: s.suggested.descriptionAr,
      district: s.suggested.district ?? '',
      // The four grades map straight onto listings.condition, so what they
      // told us carries over rather than being re-guessed.
      condition: s.suggested.condition,
      startPrice: '',
      // Their expectation, not a commitment — it is the obvious opening
      // number for the conversation and it is editable right here.
      reservePrice: s.suggested.reservePrice == null ? '' : String(s.suggested.reservePrice),
      sellerCommissionPct: '',
      buyerPremiumPct: '',
      sellerCommissionBasis: '',
    });
  };

  const doConvert = async () => {
    if (!converting || !convertForm) return;
    if (!convertForm.auctionId) { Alert.alert('Pick a sale', 'Choose which auction this lot goes into.'); return; }
    if (!convertForm.condition) { Alert.alert('Pick a condition', 'Confirm what state the object is in.'); return; }
    setBusy(true);
    try {
      const updated = await convertSubmission(converting.id, convertForm);
      setConverting(null);
      setConvertForm(null);
      setRows((r) => r.map((x) => (x.id === updated.id ? updated : x)));
      load(true);
      Alert.alert(
        'Lot created',
        'The listing belongs to the consignor and the lot is in the sale. Set anything else from the lots screen.',
        [
          { text: 'Stay here' },
          {
            text: 'Open the lots',
            onPress: () => navigation.navigate('AdminAuctionLots', { auctionId: convertForm.auctionId }),
          },
        ]
      );
    } catch (e) {
      Alert.alert('Could not create the lot', say(e));
    } finally {
      setBusy(false);
    }
  };

  const setCF = <K extends keyof ConvertForm>(k: K, v: ConvertForm[K]) =>
    setConvertForm((f) => (f ? { ...f, [k]: v } : f));

  // ---- The convert sheet ------------------------------------------
  if (converting && convertForm) {
    const cat = convertForm.categoryId ? categoryById(convertForm.categoryId) : null;
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        <View style={styles.topBar}>
          <Pressy onPress={() => { setConverting(null); setConvertForm(null); }} style={styles.iconBtn} disabled={busy}>
            <Icon name="close" size={18} />
          </Pressy>
          <Text style={type.h3}>Make it a lot</Text>
          <View style={styles.iconBtn} />
        </View>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.lede}>
              {converting.title} — {converting.seller.name}
            </Text>
            <Text style={styles.hint}>
              The listing this creates belongs to {converting.seller.name}, not to the house: they are the
              one who gets paid. Their {converting.photos.length} photograph
              {converting.photos.length === 1 ? '' : 's'} come across with it.
            </Text>

            <Text style={styles.section}>Which sale</Text>
            {auctionsPhase === 'loading' ? (
              <ActivityIndicator style={{ marginTop: 6, alignSelf: 'flex-start' }} color={colors.primary} />
            ) : auctionsPhase === 'failed' ? (
              <View>
                <Text style={styles.hint}>
                  Could not read the sales. That is not the same as there being none — try again.
                </Text>
                <Pressy onPress={() => { loadAuctions(); }} style={styles.plainBtn}>
                  <Text style={styles.plainBtnText}>Try again</Text>
                </Pressy>
              </View>
            ) : auctions.length === 0 ? (
              <Text style={styles.hint}>
                No draft, scheduled or live auction to put it in. Create one on the auctions screen first.
              </Text>
            ) : (
              <View style={styles.pills}>
                {auctions.map((a) => (
                  <Pressy
                    key={a.id}
                    onPress={() => setCF('auctionId', a.id)}
                    style={[styles.pill, convertForm.auctionId === a.id && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, convertForm.auctionId === a.id && styles.pillTextOn]}>
                      {a.title} · {a.status}
                    </Text>
                  </Pressy>
                ))}
              </View>
            )}

            <Text style={styles.section}>Category</Text>
            {cat ? <Text style={styles.hint}>Now: {cat.nameEn}</Text> : (
              <Text style={styles.hint}>
                Nothing suggested — this came in under “Something else”, so pick where it belongs.
              </Text>
            )}
            <TextInput
              value={catQuery}
              onChangeText={setCatQuery}
              placeholder="Search categories"
              placeholderTextColor={colors.inkSoft}
              style={styles.input}
            />
            <View style={styles.pills}>
              {visibleCategories.map((c) => (
                <Pressy
                  key={c.id}
                  onPress={() => setCF('categoryId', c.id)}
                  style={[styles.pill, convertForm.categoryId === c.id && styles.pillOn]}
                >
                  <Text style={[styles.pillText, convertForm.categoryId === c.id && styles.pillTextOn]}>
                    {c.nameEn}
                  </Text>
                </Pressy>
              ))}
            </View>

            <Text style={styles.section}>Titles and description</Text>
            <Text style={styles.hint}>
              Both languages, prefilled with what the consignor wrote. The Arabic side is their own words
              until somebody rewrites it — worth doing before the sale opens.
            </Text>
            {[
              ['titleEn', 'Title (English)'], ['titleAr', 'Title (Arabic)'],
            ].map(([k, l]) => (
              <View key={k} style={styles.field}>
                <Text style={styles.label}>{l}</Text>
                <TextInput
                  value={(convertForm as any)[k]}
                  onChangeText={(v) => setCF(k as keyof ConvertForm, v as any)}
                  style={styles.input}
                />
              </View>
            ))}
            {[
              ['descriptionEn', 'Description (English)'], ['descriptionAr', 'Description (Arabic)'],
            ].map(([k, l]) => (
              <View key={k} style={styles.field}>
                <Text style={styles.label}>{l}</Text>
                <TextInput
                  value={(convertForm as any)[k]}
                  onChangeText={(v) => setCF(k as keyof ConvertForm, v as any)}
                  multiline
                  style={[styles.input, styles.inputTall]}
                />
              </View>
            ))}

            <Text style={styles.section}>Condition</Text>
            <Text style={styles.hint}>
              What they said, until you have had the object in your hands. The grade goes onto the
              listing and it is part of what the lot is priced on, so it is worth confirming rather
              than inheriting — the consignor graded it from memory.
            </Text>
            <View style={styles.pills}>
              {SUBMISSION_CONDITIONS.map((c) => (
                <Pressy
                  key={c}
                  onPress={() => setCF('condition', c)}
                  style={[styles.pill, convertForm.condition === c && styles.pillOn]}
                >
                  <Text style={[styles.pillText, convertForm.condition === c && styles.pillTextOn]}>
                    {c.replace('_', ' ')}
                  </Text>
                </Pressy>
              ))}
            </View>

            <Text style={styles.section}>The money</Text>
            <Text style={styles.hint}>
              They said they think it is worth {amount(converting.estimateLow)}–{amount(converting.estimateHigh)}
              {converting.reserveExpectation ? `, and would not take less than ${amount(converting.reserveExpectation)}` : ''}.
              That is their view, not a term.
            </Text>
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>Start price</Text>
                <TextInput
                  value={convertForm.startPrice}
                  onChangeText={(v) => setCF('startPrice', v)}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Reserve</Text>
                <TextInput
                  value={convertForm.reservePrice}
                  onChangeText={(v) => setCF('reservePrice', v)}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.hint}>
              Never open at the reserve. A start price well under it is what makes the early bidding happen,
              and it keeps the seller's floor private.
            </Text>

            <Text style={styles.section}>Terms for this lot</Text>
            <Text style={styles.hint}>
              Blank inherits the sale's rates. Fill these in when the deal struck with this consignor
              differs from the house terms.
            </Text>
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>Seller commission %</Text>
                <TextInput
                  value={convertForm.sellerCommissionPct}
                  onChangeText={(v) => setCF('sellerCommissionPct', v)}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Buyer premium %</Text>
                <TextInput
                  value={convertForm.buyerPremiumPct}
                  onChangeText={(v) => setCF('buyerPremiumPct', v)}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>
            <View style={styles.pills}>
              {([
                ['', 'Inherit the sale'],
                ['hammer', 'Commission on the full sale'],
                ['surplus', 'Commission on the amount above reserve'],
              ] as const).map(([v, l]) => (
                <Pressy
                  key={v || 'inherit'}
                  onPress={() => setCF('sellerCommissionBasis', v)}
                  style={[styles.pill, convertForm.sellerCommissionBasis === v && styles.pillOn]}
                >
                  <Text style={[styles.pillText, convertForm.sellerCommissionBasis === v && styles.pillTextOn]}>
                    {l}
                  </Text>
                </Pressy>
              ))}
            </View>

            {/* Dimmed, not inert: with no sale to pick, tapping it named
                an action the screen was not offering. */}
            <Pressy
              onPress={doConvert}
              disabled={busy || auctionsPhase !== 'ready' || auctions.length === 0}
              style={[styles.primaryBtn,
                      (busy || auctionsPhase !== 'ready' || auctions.length === 0) && styles.dim]}
            >
              {busy ? <ActivityIndicator size="small" color={colors.white} />
                    : <Text style={styles.primaryBtnText}>Create the lot</Text>}
            </Pressy>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ---- The queue ---------------------------------------------------
  const row = (s: AdminSubmission) => {
    const expanded = open === s.id;
    const decidable = s.status !== 'converted' && s.status !== 'withdrawn';
    return (
      <View key={s.id} style={styles.card}>
        <Pressy onPress={() => setOpen(expanded ? null : s.id)} style={styles.cardHead}>
          {s.photos[0] ? (
            <Image source={{ uri: s.photos[0].thumbnailUrl || s.photos[0].url }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverEmpty]}>
              <Icon name="image" size={16} color={colors.inkSoft} />
            </View>
          )}
          <View style={styles.cardText}>
            <Text style={styles.cardTitle} numberOfLines={2}>{s.title}</Text>
            <Text style={styles.cardMeta}>
              {s.kindLabelEn}{s.brand ? ` · ${s.brand}` : ''} · {amount(s.estimateLow)}–{amount(s.estimateHigh)}
            </Text>
            <Text style={styles.cardMeta}>
              {s.seller.name}
              {s.seller.phone ? ` · ${s.seller.phone}` : ''}
              {s.sellerHistory.total > 0
                ? ` · ${s.sellerHistory.total} before (${s.sellerHistory.converted} sold, ${s.sellerHistory.declined} declined)`
                : ' · first submission'}
            </Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>{s.status.replace('_', ' ')}</Text>
          </View>
        </Pressy>

        {expanded ? (
          <View style={styles.detail}>
            {s.photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
                {s.photos.map((p) => (
                  <Image key={p.url} source={{ uri: p.thumbnailUrl || p.url }} style={styles.stripShot} />
                ))}
              </ScrollView>
            ) : null}

            <Text style={styles.detailBody}>{s.description}</Text>

            {[
              ['Reference / model', s.modelRef],
              ['Year or period', s.yearMade],
              ['Size', s.sizeNotes],
              // 'not stated' rather than nothing: an absent grade used to
              // drop the whole row, so a submission with no condition read
              // as one nobody had asked about.
              ['Condition', `${s.condition ? s.condition.replace('_', ' ') : 'not stated'}${s.conditionNotes ? ` — ${s.conditionNotes}` : ''}`],
              ['Comes with', [
                s.hasBox ? 'box' : null,
                s.hasPapers ? 'papers' : null,
                s.hasAuthentication ? 'a certificate' : null,
              ].filter(Boolean).join(', ') || 'nothing stated'],
              ['Owns it outright', s.ownsOutright ? 'yes, they say so' : 'NOT CONFIRMED'],
              ['Provenance', s.provenance],
              ['Their reserve', s.reserveExpectation ? amount(s.reserveExpectation) : null],
              ['Where it is', [s.governorate, s.district].filter(Boolean).join(', ')],
              ['Getting it here', s.logisticsNotes],
            ].map(([label, value]) =>
              value ? (
                <View key={label as string} style={styles.kv}>
                  <Text style={styles.kvKey}>{label}</Text>
                  <Text style={styles.kvVal}>{value}</Text>
                </View>
              ) : null
            )}

            {s.adminNote ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>THEY CAN SEE THIS</Text>
                <Text style={styles.noteText}>{s.adminNote}</Text>
              </View>
            ) : null}

            {decidable ? (
              <>
                <Text style={styles.label}>Note to the consignor — they read this</Text>
                <TextInput
                  value={notes[s.id] ?? ''}
                  onChangeText={(v) => setNotes((n) => ({ ...n, [s.id]: v.slice(0, 1000) }))}
                  placeholder="Required when asking for more; the reason on a decline."
                  placeholderTextColor={colors.inkSoft}
                  multiline
                  style={[styles.input, styles.inputTall]}
                />
                <Text style={styles.label}>Private note — never shown to them</Text>
                <TextInput
                  value={privateNotes[s.id] ?? s.adminPrivateNote ?? ''}
                  onChangeText={(v) => setPrivateNotes((n) => ({ ...n, [s.id]: v.slice(0, 2000) }))}
                  multiline
                  style={[styles.input, styles.inputTall]}
                />
                {/* Its own button. This note used to be written only as a
                    side effect of a decision, which is the one place it
                    must not live -- it exists to survive the days between
                    screening an object and deciding on it, and a note only
                    saved by the decision is lost over exactly that gap. */}
                <Pressy
                  onPress={() => saveNote(s)}
                  disabled={busy || privateNotes[s.id] === undefined}
                  style={[styles.plainBtn, styles.noteSave,
                          privateNotes[s.id] === undefined && styles.dim]}
                >
                  <Text style={styles.plainBtnText}>Save the private note</Text>
                </Pressy>

                <View style={styles.btnRow}>
                  {s.status !== 'accepted' ? (
                    <Pressy onPress={() => decide(s, 'accept')} disabled={busy} style={styles.okBtn}>
                      <Text style={styles.okBtnText}>Accept</Text>
                    </Pressy>
                  ) : null}
                  <Pressy onPress={() => decide(s, 'needs_info')} disabled={busy} style={styles.plainBtn}>
                    <Text style={styles.plainBtnText}>Ask for more</Text>
                  </Pressy>
                  <Pressy onPress={() => decide(s, 'decline')} disabled={busy} style={styles.plainBtn}>
                    <Text style={[styles.plainBtnText, { color: colors.danger }]}>Decline</Text>
                  </Pressy>
                  {s.status === 'declined' || s.status === 'accepted' ? (
                    <Pressy onPress={() => decide(s, 'reopen')} disabled={busy} style={styles.plainBtn}>
                      <Text style={styles.plainBtnText}>Back to the queue</Text>
                    </Pressy>
                  ) : null}
                </View>

                {s.status === 'accepted' ? (
                  <Pressy onPress={() => openConvert(s)} disabled={busy} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>Make it a lot</Text>
                  </Pressy>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  {s.status === 'converted'
                    ? 'This is a lot now. Its terms, photos and video live on the lots screen.'
                    : 'The consignor withdrew this. Nothing to decide.'}
                </Text>
                {/* Closed to DECISIONS, not to notes. What we thought of a
                    consignor is worth keeping after their item sold, and
                    this was the only screen that could show it. */}
                <Text style={styles.label}>Private note — never shown to them</Text>
                <TextInput
                  value={privateNotes[s.id] ?? s.adminPrivateNote ?? ''}
                  onChangeText={(v) => setPrivateNotes((n) => ({ ...n, [s.id]: v.slice(0, 2000) }))}
                  multiline
                  style={[styles.input, styles.inputTall]}
                />
                <Pressy
                  onPress={() => saveNote(s)}
                  disabled={busy || privateNotes[s.id] === undefined}
                  style={[styles.plainBtn, styles.noteSave,
                          privateNotes[s.id] === undefined && styles.dim]}
                >
                  <Text style={styles.plainBtnText}>Save the private note</Text>
                </Pressy>
              </>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const waiting = (counts.pending ?? 0) + (counts.needs_info ?? 0);

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Consignments</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressy
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.pill, filter === f.key && styles.pillOn]}
          >
            <Text style={[styles.pillText, filter === f.key && styles.pillTextOn]}>
              {f.label}
              {f.key === 'open' && waiting > 0 ? ` (${waiting})` : ''}
            </Text>
          </Pressy>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        ) : failed ? (
          <View style={styles.empty}>
            <Icon name="rotate" size={26} color={colors.inkSoft} />
            <Text style={[type.body, { marginTop: 10 }]}>Could not read the queue.</Text>
            <Text style={type.soft}>This is not the same as it being empty.</Text>
            <Pressy onPress={() => { setLoading(true); load(); }} style={styles.plainBtn}>
              <Text style={styles.plainBtnText}>Try again</Text>
            </Pressy>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="gavel" size={26} color={colors.inkSoft} />
            <Text style={[type.body, { marginTop: 10 }]}>Nothing here.</Text>
            <Text style={type.soft}>
              {filter === 'open'
                ? 'No consignment is waiting on us.'
                : 'Nothing in this state yet.'}
            </Text>
          </View>
        ) : (
          rows.map(row)
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 18, paddingBottom: 10 },
  body: { paddingHorizontal: 18, paddingBottom: 120 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  lede: { ...type.h3, fontSize: 15, marginBottom: 6 },
  section: {
    ...type.h3, fontSize: 14, marginTop: 20, marginBottom: 6,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line,
  },
  hint: { ...type.tiny, lineHeight: 16, marginBottom: 8 },
  field: { marginBottom: 10 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.ink, marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 9, color: colors.ink,
    backgroundColor: colors.card, fontSize: 14,
  },
  inputTall: { minHeight: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 },
  pill: {
    paddingHorizontal: 11, height: 32, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  pillOn: { borderColor: colors.accentRing, backgroundColor: colors.accentTint },
  pillText: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft },
  pillTextOn: { color: colors.ink },

  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, marginBottom: 10, overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 12 },
  cover: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surface },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, lineHeight: 18 },
  cardMeta: { ...type.tiny, lineHeight: 15 },
  statusPill: {
    paddingHorizontal: 8, height: 20, justifyContent: 'center',
    borderRadius: radius.pill, backgroundColor: colors.surface,
  },
  statusPillText: { fontSize: 10, fontWeight: '800', color: colors.inkSoft },

  detail: { paddingHorizontal: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  strip: { marginBottom: 10 },
  stripShot: { width: 88, height: 88, borderRadius: radius.sm, marginRight: 8, backgroundColor: colors.surface },
  detailBody: { fontSize: 13.5, color: colors.ink, lineHeight: 19, marginBottom: 10 },
  kv: { flexDirection: 'row', gap: 10, paddingVertical: 3 },
  kvKey: { width: 128, ...type.tiny, fontWeight: '700' },
  kvVal: { flex: 1, fontSize: 13, color: colors.ink, lineHeight: 18 },

  noteBox: { marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.warnBg, gap: 3 },
  noteLabel: { fontSize: 10, fontWeight: '800', color: colors.accentDeep, letterSpacing: 0.4 },
  noteText: { fontSize: 13, color: colors.ink, lineHeight: 18 },

  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  okBtn: {
    height: 38, paddingHorizontal: 16, justifyContent: 'center',
    borderRadius: radius.pill, backgroundColor: colors.primary,
  },
  okBtnText: { fontSize: 13, fontWeight: '800', color: colors.white },
  plainBtn: {
    height: 38, paddingHorizontal: 14, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
  },
  plainBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  primaryBtn: {
    marginTop: 14, height: 46, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 14.5, fontWeight: '800', color: colors.white },
  noteSave: { alignSelf: 'flex-start', marginTop: 8 },
  dim: { opacity: 0.5 },

  empty: { alignItems: 'center', paddingTop: 50, gap: 3 },
});
