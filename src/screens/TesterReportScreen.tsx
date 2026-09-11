import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Button from '../components/Button';
import Pressy from '../components/Pressy';
import BrandMark from '../components/BrandMark';
import LanguageSwitch from '../components/LanguageSwitch';
import Icon from '../icons/Icon';
import { ChoiceGroupLabel, ChoiceList, FormInput, QuestionCard } from '../components/FormParts';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { mirrorRow } from '../lib/mirrorRow';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { uploadPhoto } from '../lib/photoUpload';
import { captureProblemContext } from '../lib/problemContext';
import {
  Finished,
  MISSION_ROLES,
  Mission,
  MissionAccess,
  Severity,
  Surface,
  fetchMyMissions,
  guessDeviceType,
  missionLabel,
  severityAsked,
  stuckRequired,
  submitTesterReport,
} from '../lib/testerForms';

// Form 2 of the tester round: Testers Reports (@TESTERS.md, "The two
// forms"). One report per mission, straight after the tester tries it --
// the considered half of the feedback, where the Report a problem tab is
// the thing that just broke. Members only: a visitor who is not signed in
// to a member account is asked to sign in, and the server refuses anyone
// else whatever this screen shows.
//
// The mission list is the tester's own role sheet (the missions live in the
// database and are edited in the Tester centre), with "something else" at
// the end. Like the flag tab, the report records by itself which phone or
// browser it came from and which build was running.

type Props = NativeStackScreenProps<RootStackParamList, 'TesterReport'>;

type Field = 'name' | 'mission' | 'finished' | 'stuck' | 'severity' | 'surface' | 'device';
const FIELD_ORDER: Field[] = ['name', 'mission', 'finished', 'stuck', 'severity', 'surface', 'device'];

const OTHER = 'other';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; access: MissionAccess };

const ROLE_KEYS: Record<string, string> = {
  seller: 'testerReport.roleSeller',
  storefront: 'testerReport.roleStorefront',
  buyer: 'testerReport.roleBuyer',
  consignor: 'testerReport.roleConsignor',
  everyone: 'testerReport.roleEveryone',
};

// The tester's own role sheet, and the missions meant for everyone. With no
// role -- an admin, a member outside the round -- or a role with no
// missions written yet, every mission is offered.
function missionsFor(access: MissionAccess): Mission[] {
  const mine = access.missions.filter((m) => access.roles.includes(m.role));
  if (mine.length === 0) return access.missions;
  return access.missions.filter((m) => access.roles.includes(m.role) || m.role === 'everyone');
}

export default function TesterReportScreen({ navigation }: Props) {
  const { t, language, isRTL } = useLanguage();
  const { authChecked, isVerified, profile } = useAppStore();

  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [name, setName] = useState('');
  const nameTouched = useRef(false);
  const [missionChoice, setMissionChoice] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [stuck, setStuck] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [surface, setSurface] = useState<Surface | null>(null);
  const [deviceType, setDeviceType] = useState(() => guessDeviceType());
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  // The screenshot already on the CDN, so a Send retried after a failure
  // reuses it instead of uploading a second public copy.
  const [uploadedShot, setUploadedShot] = useState<{ uri: string; url: string } | null>(null);

  const [tried, setTried] = useState(false);
  const [phase, setPhase] = useState<'editing' | 'sending' | 'sent'>('editing');
  const [formError, setFormError] = useState<string | null>(null);
  const [shotLost, setShotLost] = useState(false);
  // The keyboard: on Android nothing scrolls a focused field above it by
  // itself (see useKeyboardAwareScroll), and a form this long has fields
  // near the bottom.
  const { scrollRef, onScroll, onInputFocus, keyboardHeight } = useKeyboardAwareScroll();
  const scrollY = useRef(0);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    onScroll(e);
  };
  // Send scrolls to the first question that needs an answer. Measured at
  // that moment, against the frame the list scrolls in: questions appear
  // and disappear with the answers above them, so any position remembered
  // from earlier can be stale.
  const frameRef = useRef<View>(null);
  const cards = useRef<Partial<Record<Field, View | null>>>({});
  const refFor = (f: Field) => (v: View | null) => {
    cards.current[f] = v;
  };
  const scrollToField = (f: Field) => {
    const card = cards.current[f];
    const frame = frameRef.current;
    if (!card || !frame) return;
    frame.measureInWindow((_fx, frameY) => {
      card.measureInWindow((_cx, cardY) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + cardY - frameY - 12), animated: true });
      });
    });
  };

  // Asked again whenever the account changes; an answer about an account
  // that is no longer the one signed in is dropped.
  const loadSeq = useRef(0);
  const loadMissions = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoad({ state: 'loading' });
    try {
      const access = await fetchMyMissions();
      if (seq !== loadSeq.current) return;
      setLoad({ state: 'ready', access });
      if (!nameTouched.current && access.fullName) setName(access.fullName);
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      console.warn('[TesterReport] missions not loaded:', e?.message || e);
      setLoad({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    if (!authChecked || !isVerified) return;
    void loadMissions();
  }, [authChecked, isVerified, profile.id, loadMissions]);

  // A report belongs to whoever wrote it: another account on the same
  // phone starts from an empty form.
  useEffect(() => {
    nameTouched.current = false;
    setName('');
    setMissionChoice(null);
    setFinished(null);
    setStuck('');
    setSeverity(null);
    setSurface(null);
    setScreenshotUri(null);
    setUploadedShot(null);
    setTried(false);
    setPhase('editing');
    setFormError(null);
  }, [profile.id]);

  const askSeverity = severityAsked(finished, stuck);

  const validate = () => {
    const errors: Partial<Record<Field, string>> = {};
    if (!name.trim()) errors.name = t('testerReport.errName');
    if (!missionChoice) errors.mission = t('testerReport.errMission');
    if (!finished) errors.finished = t('testerReport.errChoose');
    if (stuckRequired(finished) && !stuck.trim()) errors.stuck = t('testerReport.errStuck');
    if (askSeverity && !severity) errors.severity = t('testerReport.errChoose');
    if (!surface) errors.surface = t('testerReport.errChoose');
    if (!deviceType.trim()) errors.device = t('testerReport.errDevice');
    return errors;
  };
  const errors = tried ? validate() : {};

  const pickScreenshot = async () => {
    setFormError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setFormError(t('testerReport.photoPerm'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) setScreenshotUri(result.assets[0].uri);
    } catch {
      setFormError(t('testerReport.photoPerm'));
    }
  };

  const send = async () => {
    if (phase === 'sending') return;
    setTried(true);
    setFormError(null);
    const now = validate();
    const first = FIELD_ORDER.find((f) => now[f]);
    if (first || !finished || !surface) {
      setFormError(t('testerReport.errSummary'));
      if (first) scrollToField(first);
      return;
    }
    setPhase('sending');
    const ctx = captureProblemContext();

    // The screenshot is the extra, the words are the report: one that will
    // not upload is dropped rather than allowed to cost the report, and the
    // tester is told.
    let screenshotUrl: string | null = null;
    let lost = false;
    if (screenshotUri) {
      if (uploadedShot?.uri === screenshotUri) {
        screenshotUrl = uploadedShot.url;
      } else {
        try {
          screenshotUrl = await uploadPhoto(screenshotUri);
          setUploadedShot({ uri: screenshotUri, url: screenshotUrl });
        } catch (e: any) {
          console.warn('[TesterReport] screenshot did not upload:', e?.message || e);
          lost = true;
        }
      }
    }

    try {
      await submitTesterReport({
        name: name.trim(),
        missionId: missionChoice === OTHER ? null : missionChoice,
        finished,
        stuck: stuck.trim(),
        severity: askSeverity ? severity : null,
        surface,
        deviceType: deviceType.trim(),
        screenshotUrl,
        platform: ctx.platform,
        osVersion: ctx.osVersion,
        device: ctx.device,
        appLanguage: language,
        runtimeVersion: ctx.runtimeVersion,
        updateId: ctx.updateId,
        updateCreatedAt: ctx.updateCreatedAt,
      });
      setShotLost(lost);
      setPhase('sent');
      return;
    } catch (e: any) {
      console.warn('[TesterReport] not sent:', e?.message || e);
      const reason: string = e?.message || '';
      if (reason.includes('not_a_member') || reason.includes('not_signed_in')) {
        setLoad({ state: 'ready', access: { member: false, roles: [], fullName: null, missions: [] } });
      } else if (reason.includes('unknown_mission')) {
        setMissionChoice(null);
        setFormError(t('testerReport.missionGone'));
        void loadMissions();
      } else if (reason.includes('too_many_reports')) {
        setFormError(t('testerReport.tooMany'));
      } else if (reason.includes('stuck_required')) {
        setFormError(t('testerReport.errStuck'));
      } else if (reason.includes('severity_required') || reason.includes('bad_answer')) {
        setFormError(t('testerReport.errSummary'));
      } else if (reason.includes('device_required')) {
        setFormError(t('testerReport.errDevice'));
      } else if (reason.includes('name_required')) {
        setFormError(t('testerReport.errName'));
      } else {
        setFormError(t('testerReport.failed'));
      }
    }
    setPhase('editing');
  };

  // The next mission's report: who is writing, and on what, stay; the rest
  // starts again.
  const another = () => {
    setMissionChoice(null);
    setFinished(null);
    setStuck('');
    setSeverity(null);
    setScreenshotUri(null);
    setUploadedShot(null);
    setShotLost(false);
    setTried(false);
    setFormError(null);
    setPhase('editing');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  const rowDir = mirrorRow(isRTL);
  const textDir = isRTL ? styles.rtl : null;
  const busy = phase === 'sending';

  const membersOnly = (
    <View style={styles.center}>
      <View style={[styles.badge, { backgroundColor: colors.surface }]}>
        <Icon name="lock" size={20} color={colors.inkSoft} />
      </View>
      <Text style={[type.h2, styles.centerText]}>{t('testerReport.membersOnly')}</Text>
      <Text style={[type.soft, styles.centerText]}>{t('testerReport.membersOnlyBody')}</Text>
      <Button label={t('testerReport.signIn')} onPress={() => navigation.navigate('Auth')} style={styles.centerButton} />
    </View>
  );

  let body: React.ReactNode;
  if (!authChecked || (isVerified && load.state === 'loading')) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (!isVerified) {
    body = membersOnly;
  } else if (load.state === 'error') {
    body = (
      <View style={styles.center}>
        <Text style={[type.body, styles.centerText]}>{t('testerReport.loadFailed')}</Text>
        <Button label={t('testerReport.retry')} variant="secondary" onPress={loadMissions} style={styles.centerButton} />
      </View>
    );
  } else if (load.state === 'ready' && !load.access.member) {
    body = membersOnly;
  } else if (phase === 'sent') {
    body = (
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: colors.success }]}>
          <Icon name="check" size={22} color={colors.white} />
        </View>
        <Text style={[type.h2, styles.centerText]}>{t('testerReport.sentTitle')}</Text>
        <Text style={[type.soft, styles.centerText]}>
          {shotLost ? t('testerReport.sentNoShot') : t('testerReport.sentBody')}
        </Text>
        <Button label={t('testerReport.another')} onPress={another} style={styles.centerButton} />
        <Button label={t('testerReport.done')} variant="secondary" onPress={leave} style={styles.centerButtonTight} />
      </View>
    );
  } else if (load.state === 'ready') {
    const shown = missionsFor(load.access);
    const groups = MISSION_ROLES.map((role) => ({ role, missions: shown.filter((m) => m.role === role) })).filter(
      (g) => g.missions.length > 0
    );
    body = (
      <View ref={frameRef} style={styles.fill}>
        <ScrollView
          ref={scrollRef}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: 48 + keyboardHeight }]}
        >
          <View style={styles.header}>
            <Text style={[type.title, textDir]}>{t('testerReport.title')}</Text>
            <Text style={[type.body, styles.intro, textDir]}>{t('testerReport.intro')}</Text>
          </View>

          <QuestionCard title={t('testerReport.name')} required error={errors.name} cardRef={refFor('name')}>
            <FormInput
              onFocus={onInputFocus}
              value={name}
              onChangeText={(v) => {
                nameTouched.current = true;
                setName(v);
              }}
              placeholder={t('testerReport.namePh')}
              autoCapitalize="words"
              maxLength={120}
              editable={!busy}
              invalid={!!errors.name}
            />
          </QuestionCard>

          <QuestionCard
            title={t('testerReport.mission')}
            required
            help={t('testerReport.missionHelp')}
            error={errors.mission}
            cardRef={refFor('mission')}
          >
            {groups.map((g) => (
              <View key={g.role} style={styles.group}>
                <ChoiceGroupLabel label={t(ROLE_KEYS[g.role] ?? g.role)} />
                <ChoiceList
                  options={g.missions.map((m) => ({ value: m.id, label: missionLabel(m, language) }))}
                  selected={missionChoice}
                  onPick={setMissionChoice}
                  disabled={busy}
                />
              </View>
            ))}
            <View style={groups.length > 0 ? styles.group : null}>
              <ChoiceList
                options={[{ value: OTHER, label: t('testerReport.missionOther') }]}
                selected={missionChoice}
                onPick={setMissionChoice}
                disabled={busy}
              />
            </View>
          </QuestionCard>

          <QuestionCard title={t('testerReport.finished')} required error={errors.finished} cardRef={refFor('finished')}>
            <ChoiceList
              options={[
                { value: 'yes' as const, label: t('testerReport.finishedYes') },
                { value: 'hard' as const, label: t('testerReport.finishedHard') },
                { value: 'gave_up' as const, label: t('testerReport.finishedNo') },
              ]}
              selected={finished}
              onPick={setFinished}
              disabled={busy}
            />
          </QuestionCard>

          <QuestionCard
            title={finished === 'yes' ? t('testerReport.stuckOptional') : t('testerReport.stuck')}
            required={finished !== 'yes'}
            help={t('testerReport.stuckHelp')}
            error={errors.stuck}
            cardRef={refFor('stuck')}
          >
            <FormInput
              onFocus={onInputFocus}
              value={stuck}
              onChangeText={setStuck}
              placeholder={t('testerReport.stuckPh')}
              multiline
              maxLength={4000}
              editable={!busy}
              invalid={!!errors.stuck}
            />
          </QuestionCard>

          {askSeverity && (
            <QuestionCard title={t('testerReport.severity')} required error={errors.severity} cardRef={refFor('severity')}>
              <ChoiceList
                options={[
                  { value: 'blocked' as const, label: t('testerReport.sevBlocked') },
                  { value: 'annoyed' as const, label: t('testerReport.sevAnnoyed') },
                  { value: 'idea' as const, label: t('testerReport.sevIdea') },
                ]}
                selected={severity}
                onPick={setSeverity}
                disabled={busy}
              />
            </QuestionCard>
          )}

          <QuestionCard title={t('testerReport.surface')} required error={errors.surface} cardRef={refFor('surface')}>
            <ChoiceList
              options={[
                { value: 'app' as const, label: t('testerReport.surfaceApp') },
                { value: 'website' as const, label: t('testerReport.surfaceWebsite') },
                { value: 'both' as const, label: t('testerReport.surfaceBoth') },
              ]}
              selected={surface}
              onPick={setSurface}
              disabled={busy}
            />
          </QuestionCard>

          <QuestionCard title={t('testerReport.device')} required error={errors.device} cardRef={refFor('device')}>
            <FormInput
              onFocus={onInputFocus}
              value={deviceType}
              onChangeText={setDeviceType}
              placeholder={t('testerReport.devicePh')}
              maxLength={80}
              editable={!busy}
              invalid={!!errors.device}
            />
          </QuestionCard>

          <QuestionCard title={t('testerReport.screenshot')} help={t('testerReport.screenshotHelp')}>
            {screenshotUri ? (
              <View style={[styles.shotRow, rowDir]}>
                <Image source={{ uri: screenshotUri }} style={styles.shot} />
                <Pressy onPress={() => setScreenshotUri(null)} style={styles.linkBtn} disabled={busy}>
                  <Text style={styles.linkDanger}>{t('testerReport.removeScreenshot')}</Text>
                </Pressy>
              </View>
            ) : (
              <Pressy onPress={pickScreenshot} style={[styles.addShot, rowDir]} disabled={busy}>
                <Icon name="image" size={16} color={colors.inkSoft} />
                <Text style={type.body}>{t('testerReport.addScreenshot')}</Text>
              </Pressy>
            )}
          </QuestionCard>

          <Text style={[type.tiny, styles.note, textDir]}>{t('testerReport.attachedNote')}</Text>
          {!!formError && <Text style={[styles.formError, textDir]}>{formError}</Text>}
          <Button label={t('testerReport.send')} onPress={send} loading={busy} style={styles.send} />
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen maxWidth={640}>
      <View style={[styles.topBar, rowDir]}>
        {navigation.canGoBack() ? (
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn} accessibilityLabel={t('common.back')}>
            <Icon name="back" size={18} />
          </Pressy>
        ) : (
          <BrandMark variant="sidebar" />
        )}
        <LanguageSwitch compact />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    height: 56,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48 },
  header: { marginBottom: 14, paddingHorizontal: 2, gap: 8 },
  intro: { color: colors.inkSoft, lineHeight: 21 },
  rtl: { textAlign: 'right' },
  group: { marginBottom: 10 },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shot: { width: 72, height: 124, borderRadius: 8, backgroundColor: colors.surface },
  linkBtn: { paddingVertical: 8 },
  linkDanger: { fontSize: 13.5, fontWeight: '600', color: colors.danger },
  addShot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  note: { marginTop: 4, marginBottom: 10, paddingHorizontal: 2, lineHeight: 17 },
  formError: { fontSize: 13.5, color: colors.danger, fontWeight: '600', marginBottom: 10, paddingHorizontal: 2 },
  send: { marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 60, gap: 10 },
  centerText: { textAlign: 'center' },
  centerButton: { marginTop: 10, alignSelf: 'stretch', maxWidth: 360, width: '100%' },
  centerButtonTight: { alignSelf: 'stretch', maxWidth: 360, width: '100%' },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
});
