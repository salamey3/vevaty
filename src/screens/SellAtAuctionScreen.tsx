import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { Alert } from '../lib/alertShim';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { RootStackParamList } from '../navigation/types';
import {
  Submission, SubmissionError, SubmissionStatus,
  fetchMySubmissions, withdrawAuctionSubmission,
} from '../lib/auctionSubmissions';

// "Sell at auction" -- the consignor's side of the sale.
//
// One screen holding two things: the pitch, for the large majority of
// people arriving here who have never sent us anything, and the state of
// whatever they have sent, for the few who have. They are on the same
// screen rather than behind a tab because the second list is empty for
// almost everyone and an empty tab is a dead end.
//
// The status of a submission is the whole product here. A consignor who
// has handed over a $20,000 watch and heard nothing will assume the worst,
// so every row says exactly where it stands in a sentence, and a row we
// have asked a question about says the question.

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_TONE: Record<SubmissionStatus, 'wait' | 'good' | 'bad' | 'done'> = {
  pending: 'wait',
  needs_info: 'wait',
  accepted: 'good',
  converted: 'done',
  declined: 'bad',
  withdrawn: 'bad',
};

export default function SellAtAuctionScreen() {
  const navigation = useNavigation<Nav>();
  const { t, isRTL } = useLanguage();
  const { isVerified, authChecked } = useAppStore();
  const isDesktop = useIsDesktop();

  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Distinct from an empty list on purpose -- "you have not sent us
  // anything" and "we could not ask" look identical on screen and are not
  // the same statement.
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isVerified) { setLoading(false); setRefreshing(false); return; }
    try {
      const mine = await fetchMySubmissions();
      if (mine === null) setFailed(true);
      else { setRows(mine); setFailed(false); }
    } catch {
      // fetchMySubmissions handles a RETURNED error, but a thrown one --
      // a row whose shape the mapper does not expect -- used to strand
      // both `loading` and `refreshing` true, leaving the pull-to-refresh
      // spinner turning over a screen that would never finish.
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isVerified]);

  // On focus rather than on mount: the form pushes back here after a save,
  // and a list that only loaded once would not show what was just sent.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const withdraw = (s: Submission) => {
    Alert.alert(
      t('consign.withdrawTitle'),
      t('consign.withdrawBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('consign.withdrawConfirm'),
          style: 'destructive',
          onPress: async () => {
            setBusy(s.id);
            try {
              const updated = await withdrawAuctionSubmission(s.id);
              setRows((r) => r.map((x) => (x.id === s.id ? updated : x)));
            } catch (e) {
              const code = (e as SubmissionError)?.code;
              Alert.alert(
                t('consign.withdrawFailed'),
                code === 'already_converted' ? t('consign.errAlreadyLot') : t('consign.errGeneric')
              );
              load();
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const rtlText = isRTL ? styles.rtl : null;

  const row = (s: Submission) => {
    const tone = STATUS_TONE[s.status];
    return (
      <View key={s.id} style={styles.card}>
        <View style={[styles.cardHead, mirrorRow(isRTL)]}>
          <Text style={[styles.cardTitle, rtlText]} numberOfLines={2}>{s.title}</Text>
          <View style={[styles.chip, styles[`chip_${tone}` as const]]}>
            <Text style={[styles.chipText, styles[`chipText_${tone}` as const]]}>
              {t(`consign.status.${s.status}`)}
            </Text>
          </View>
        </View>

        <Text style={[styles.cardMeta, rtlText]}>
          {isRTL ? s.kindLabelAr : s.kindLabelEn}
          {s.brand ? ` · ${s.brand}` : ''}
        </Text>

        {/* What this status actually means for them, in a sentence. A
            coloured chip on its own tells a consignor nothing about what
            happens next or whether it is their turn to act. */}
        <Text style={[styles.cardSays, rtlText]}>{t(`consign.says.${s.status}`)}</Text>

        {s.adminNote ? (
          <View style={styles.note}>
            <Text style={[styles.noteLabel, rtlText]}>{t('consign.fromVevaty')}</Text>
            <Text style={[styles.noteText, rtlText]}>{s.adminNote}</Text>
          </View>
        ) : null}

        {s.editable ? (
          <View style={[styles.actions, mirrorRow(isRTL)]}>
            <Pressy
              onPress={() => navigation.navigate('AuctionSubmissionForm', { submissionId: s.id })}
              disabled={busy === s.id}
              style={styles.actionBtn}
            >
              <Icon name="edit" size={14} color={colors.ink} />
              <Text style={styles.actionText}>
                {s.status === 'needs_info' ? t('consign.answer') : t('consign.edit')}
              </Text>
            </Pressy>
            <Pressy
              onPress={() => withdraw(s)}
              disabled={busy === s.id}
              style={styles.actionBtn}
            >
              {busy === s.id ? (
                <ActivityIndicator size="small" color={colors.inkSoft} />
              ) : (
                <>
                  <Icon name="trash" size={14} color={colors.danger} />
                  <Text style={[styles.actionText, { color: colors.danger }]}>
                    {t('consign.withdraw')}
                  </Text>
                </>
              )}
            </Pressy>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={[styles.topBar, mirrorRow(isRTL)]}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('consign.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <View style={styles.hero}>
          <Icon name="gavel" size={26} color={colors.primary} />
          <Text style={[styles.heroTitle, rtlText]}>{t('consign.heroTitle')}</Text>
          <Text style={[styles.heroBody, rtlText]}>{t('consign.heroBody')}</Text>
        </View>

        <View style={styles.steps}>
          {['1', '2', '3'].map((n) => (
            <View key={n} style={[styles.step, mirrorRow(isRTL)]}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
              <Text style={[styles.stepText, rtlText]}>{t(`consign.step${n}`)}</Text>
            </View>
          ))}
        </View>

        <Pressy
          onPress={() => navigation.navigate('AuctionSubmissionForm', {})}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>{t('consign.offerAnItem')}</Text>
        </Pressy>

        {!authChecked ? null : !isVerified ? (
          <Text style={[styles.gateLine, rtlText]}>{t('consign.signInFirst')}</Text>
        ) : loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
        ) : failed ? (
          <View style={styles.empty}>
            <Text style={type.body}>{t('consign.loadFailed')}</Text>
            {/* setLoading first: without it a second, equally fast
                failure repaints the same screen and the button looks
                completely inert. */}
            <Pressy onPress={() => { setLoading(true); load(); }} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          </View>
        ) : rows.length > 0 ? (
          <View style={styles.list}>
            <Text style={[styles.listTitle, rtlText]}>{t('consign.yourItems')}</Text>
            {rows.map(row)}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 120 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },

  hero: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderTopLeftRadius: radius.md, borderBottomRightRadius: radius.md,
    padding: 18, gap: 8, marginTop: 4,
  },
  heroTitle: { ...type.h3, fontSize: 17 },
  heroBody: { ...type.soft, lineHeight: 20 },

  steps: { marginTop: 16, gap: 12 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  stepText: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 19 },

  cta: {
    marginTop: 20, height: 50, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.white },
  gateLine: { ...type.tiny, marginTop: 12, lineHeight: 17 },

  list: { marginTop: 28 },
  listTitle: { ...type.h3, fontSize: 15, marginBottom: 10 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, padding: 14, marginBottom: 10, gap: 5,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink, lineHeight: 19 },
  cardMeta: { ...type.tiny },
  cardSays: { fontSize: 13, color: colors.inkSoft, lineHeight: 18, marginTop: 3 },

  chip: { paddingHorizontal: 9, height: 22, justifyContent: 'center', borderRadius: radius.pill },
  chip_wait: { backgroundColor: colors.warnBg },
  chip_good: { backgroundColor: colors.primaryTint },
  chip_done: { backgroundColor: colors.primary },
  chip_bad: { backgroundColor: colors.surface },
  chipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  chipText_wait: { color: colors.accentDeep },
  chipText_good: { color: colors.primary },
  chipText_done: { color: colors.white },
  chipText_bad: { color: colors.inkSoft },

  note: {
    marginTop: 8, padding: 10, borderRadius: radius.sm,
    backgroundColor: colors.surface, gap: 3,
  },
  noteLabel: { fontSize: 10.5, fontWeight: '800', color: colors.inkSoft, letterSpacing: 0.3 },
  noteText: { fontSize: 13, color: colors.ink, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 36,
    paddingHorizontal: 12, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
  },
  actionText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },

  empty: { alignItems: 'center', paddingTop: 30, gap: 4 },
  retry: {
    marginTop: 12, paddingHorizontal: 18, height: 40, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  retryText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
