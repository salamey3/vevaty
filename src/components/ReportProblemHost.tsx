import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import Button from './Button';
import SystemBottomStrip from './SystemBottomStrip';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useLanguage } from '../i18n/LanguageContext';
import { captureProblemContext, ProblemContext } from '../lib/problemContext';
import { PROBLEM_SEVERITIES, ProblemSeverity, submitProblemReport } from '../lib/testers';
import { uploadPhoto } from '../lib/photoUpload';
import { mirrorRow } from '../lib/mirrorRow';

// The tester round's "Report a problem" button: a slim tab on the edge of
// every screen, shown only to tagged testers and to admin accounts. Mounted
// once in App.tsx beside AlertHost rather than on any screen, because the
// whole point is that it is reachable from exactly where something broke --
// and it records that place itself (see captureProblemContext) so a tester
// never has to describe which screen they were on.
//
// Everything the sheet has to say is said INSIDE the sheet. A Modal is its
// own native window, and AlertHost's alert is another one; an Alert fired
// from in here can open underneath the sheet and never be seen.
//
// Known gap, accepted for the first round: on iOS a screen presented as a
// native modal (presentation: 'modal') is drawn above this whole layer, so
// the tab is hidden on those screens there. Android and the website are
// unaffected, and the first round has no iPhone testers.

const SEVERITY_LABELS: Record<ProblemSeverity, string> = {
  blocked: 'report.severityBlocked',
  annoyed: 'report.severityAnnoyed',
  idea: 'report.severityIdea',
};

type Phase = 'editing' | 'sending' | 'sent';

export default function ReportProblemHost() {
  const { isVerified, testerStatus, refreshTesterStatus, profile } = useAppStore();
  const { isAdmin } = useSettings();
  const { t, language, isRTL } = useLanguage();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ProblemContext | null>(null);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<ProblemSeverity | null>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('editing');
  const [error, setError] = useState<string | null>(null);
  const [shotLost, setShotLost] = useState(false);
  // The server said this account is no longer a tester. The tab goes once
  // the sheet is closed, not while its explanation is on screen.
  const [untaggedOnClose, setUntaggedOnClose] = useState(false);
  // The screenshot already on the CDN, so a Send retried after a failed
  // report reuses it instead of uploading a second public copy every time.
  const [uploadedShot, setUploadedShot] = useState<{ uri: string; url: string } | null>(null);

  // A different account on the same phone -- and phones get handed around a
  // shop -- starts from an empty sheet: a draft belongs to whoever wrote it.
  useEffect(() => {
    setOpen(false);
    setContext(null);
    setMessage('');
    setSeverity(null);
    setScreenshotUri(null);
    setPhase('editing');
    setError(null);
    setShotLost(false);
    setUntaggedOnClose(false);
    setUploadedShot(null);
  }, [profile.id]);

  // A real account that is tagged, or an admin account. Never an anonymous
  // visitor: the server refuses them anyway, and a tab that does nothing is
  // worse than no tab.
  const eligible = isVerified && (testerStatus.roles.length > 0 || testerStatus.isAdmin || isAdmin);
  // An OPEN sheet stays until it is closed, even if the tag goes meanwhile
  // (a foreground re-read after picking a screenshot, say): vanishing
  // mid-report loses the explanation, and a sheet left "open" behind a
  // hidden tab would slide back up by itself the day the tag returned.
  if (!eligible && !open) return null;

  const openSheet = () => {
    // Captured on the tap, before the sheet exists -- so the screen recorded
    // is the one the tester was looking at, not this sheet. Only for a NEW
    // report, though: one that was half written, closed to look at the
    // screen again and reopened somewhere else is still about the screen it
    // was started on.
    const draftEmpty = !message.trim() && !severity && !screenshotUri;
    if (!context || draftEmpty) setContext(captureProblemContext());
    setPhase('editing');
    setError(null);
    setShotLost(false);
    setOpen(true);
  };

  // Closing keeps a half-written report: a tester who shuts the sheet to
  // look at the screen again should find their words still there. Only a
  // sent report clears it.
  const close = () => {
    if (phase === 'sending') return;
    if (phase === 'sent') {
      setMessage('');
      setSeverity(null);
      setScreenshotUri(null);
      setUploadedShot(null);
      setPhase('editing');
    }
    setOpen(false);
    if (untaggedOnClose) {
      setUntaggedOnClose(false);
      void refreshTesterStatus();
    }
  };

  const pickScreenshot = async () => {
    setError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError(t('report.photoPerm'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]?.uri) setScreenshotUri(result.assets[0].uri);
    } catch {
      setError(t('report.photoPerm'));
    }
  };

  const send = async () => {
    if (!message.trim()) {
      setError(t('report.needMessage'));
      return;
    }
    if (!severity) {
      setError(t('report.needSeverity'));
      return;
    }
    const ctx = context ?? captureProblemContext();
    setPhase('sending');
    setError(null);

    // The screenshot is the extra, the words are the report. One that will
    // not upload is dropped rather than allowed to cost the whole report --
    // and the tester is told, since they chose to attach it.
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
          console.warn('[ReportProblem] screenshot did not upload:', e?.message || e);
          lost = true;
        }
      }
    }

    try {
      await submitProblemReport({
        message: message.trim(),
        severity,
        screen: ctx.screen,
        listingId: ctx.listingId,
        platform: ctx.platform,
        osVersion: ctx.osVersion,
        device: ctx.device,
        appLanguage: language,
        runtimeVersion: ctx.runtimeVersion,
        updateId: ctx.updateId,
        updateCreatedAt: ctx.updateCreatedAt,
        screenshotUrl,
      });
      setShotLost(lost);
      setPhase('sent');
    } catch (e: any) {
      // Kept in the sheet, words and all.
      console.warn('[ReportProblem] report not sent:', e?.message || e);
      const reason: string = e?.message || '';
      if (reason.includes('not_a_tester')) {
        // Untagged in the Tester centre since this launch. Saying "check your
        // connection" here would send them round in circles.
        setError(t('report.notTester'));
        setUntaggedOnClose(true);
      } else {
        setError(reason.includes('too_many_reports') ? t('report.tooMany') : t('report.failed'));
      }
      setPhase('editing');
    }
  };

  const edge = isRTL ? styles.tabOnLeft : styles.tabOnRight;
  // Reading-side text and the start of a row, for Arabic. Web gets both from
  // the document's own direction; native has none, so it is spelled out
  // (see mirrorRow).
  const rowDir = mirrorRow(isRTL);
  const textDir = isRTL ? styles.rtl : null;
  const startSelf: ViewStyle = { alignSelf: rowDir ? 'flex-end' : 'flex-start' };

  return (
    <>
      {!open && (
        <Pressy
          onPress={openSheet}
          style={[styles.tab, edge, { top: Math.round(height * 0.58) }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('report.tabLabel')}
        >
          <Icon name="flag" size={14} color={colors.white} />
        </Pressy>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
          {/* A plain Pressable: Pressy's press-shrink on a full-screen
              backdrop is motion nobody asked for. */}
          <Pressable style={styles.backdropTap} onPress={close} accessibilityLabel={t('common.cancel')} />
          {/* The bottom inset is the Android navigation bar / iOS home
              indicator: under edge-to-edge the sheet is drawn behind it, and
              the Send button would sit where the system swallows taps. */}
          <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]}>
            <View style={[styles.header, rowDir]}>
              <Text style={[type.h2, textDir]}>{t('report.title')}</Text>
              <Pressy onPress={close} style={styles.closeBtn} accessibilityLabel={t('common.cancel')}>
                <Icon name="close" size={18} />
              </Pressy>
            </View>

            {phase === 'sent' ? (
              <View style={styles.sentBox}>
                <View style={styles.sentIcon}>
                  <Icon name="check" size={22} color={colors.white} />
                </View>
                <Text style={[type.h3, styles.centerText]}>{t('report.sentTitle')}</Text>
                <Text style={[type.soft, styles.centerText]}>
                  {shotLost ? t('report.sentNoShot') : t('report.sentBody')}
                </Text>
                <Button label={t('report.done')} onPress={close} style={{ marginTop: 18, alignSelf: 'stretch' }} />
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
                <Text style={[type.soft, textDir]}>{t('report.prompt')}</Text>
                <TextInput
                  value={message}
                  onChangeText={(v) => {
                    setMessage(v);
                    if (error) setError(null);
                  }}
                  placeholder={t('report.placeholder')}
                  placeholderTextColor={colors.inkSoft}
                  multiline
                  maxLength={4000}
                  editable={phase !== 'sending'}
                  style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
                />

                <Text style={[styles.label, textDir]}>{t('report.severityLabel')}</Text>
                {/* keyboardShouldPersistTaps is per-ScrollView and not
                    inherited (@AGENTS.md) -- this row is a plain View so the
                    first tap lands even with the keyboard up. */}
                <View style={[styles.chips, rowDir]}>
                  {PROBLEM_SEVERITIES.map((s) => (
                    <Pressy
                      key={s}
                      onPress={() => {
                        setSeverity(s);
                        if (error) setError(null);
                      }}
                      style={[styles.chip, severity === s && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, severity === s && styles.chipTextOn]}>{t(SEVERITY_LABELS[s])}</Text>
                    </Pressy>
                  ))}
                </View>

                {screenshotUri ? (
                  <View style={[styles.shotRow, rowDir]}>
                    <Image source={{ uri: screenshotUri }} style={styles.shot} />
                    <Pressy onPress={() => setScreenshotUri(null)} style={styles.linkBtn} disabled={phase === 'sending'}>
                      <Text style={styles.linkText}>{t('report.removeScreenshot')}</Text>
                    </Pressy>
                  </View>
                ) : (
                  <Pressy onPress={pickScreenshot} style={[styles.addShot, rowDir, startSelf]} disabled={phase === 'sending'}>
                    <Icon name="image" size={16} color={colors.inkSoft} />
                    <Text style={type.soft}>{t('report.addScreenshot')}</Text>
                  </Pressy>
                )}

                <Text style={[styles.note, textDir]}>{t('report.attachedNote')}</Text>
                {!!error && <Text style={[styles.error, textDir]}>{error}</Text>}

                {phase === 'sending' ? (
                  <ActivityIndicator style={{ marginTop: 18 }} color={colors.primary} />
                ) : (
                  <Button label={t('report.send')} onPress={send} style={{ marginTop: 16 }} />
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
        {/* A Modal is its own window, which the app root's strip cannot reach. */}
        <SystemBottomStrip />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Slim, dark and half-tucked against the edge: present on every screen,
  // so it has to be ignorable on all of them. Placed a little below the
  // middle -- clear of top bars, card hearts and the full-width Continue and
  // Post buttons along the bottom.
  tab: {
    position: 'absolute',
    width: 26,
    height: 50,
    backgroundColor: 'rgba(28,36,32,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOnRight: { right: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
  tabOnLeft: { left: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,20,22,0.35)' },
  backdropTap: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '88%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 8 },
  input: {
    ...type.body,
    minHeight: 120,
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    textAlignVertical: 'top',
  },
  label: { ...type.h3, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  chipTextOn: { color: colors.white },
  // alignSelf comes from startSelf, which knows which side a row starts on.
  addShot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 8,
  },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  shot: { width: 64, height: 110, borderRadius: 8, backgroundColor: colors.surface },
  linkBtn: { paddingVertical: 6 },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  note: { ...type.tiny, marginTop: 14 },
  error: { fontSize: 13, color: colors.danger, marginTop: 10 },
  sentBox: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 18, gap: 8 },
  sentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  centerText: { textAlign: 'center' },
  rtl: { textAlign: 'right' },
});
