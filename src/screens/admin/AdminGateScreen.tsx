import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

const LOCK_DURATION_OPTIONS = [10, 20, 30, 60, 120, 180];

export default function AdminGateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useLanguage();
  const {
    isAdmin, adminChecked, adminSignIn, adminBootstrapSignUp, adminSignOut,
    adminEnrollMfaStart, adminMfaVerify,
    lockDurationMinutes, setLockDuration, biometricSupported, hasBiometricCredential, registerBiometricCredential,
  } = useSettings();

  const [mode, setMode] = useState<'signIn' | 'setup' | 'mfaEnroll' | 'mfaChallenge'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openReportCount, setOpenReportCount] = useState<number | null>(null);
  // MFA enroll/challenge step state -- see submit()/submitMfa() below.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);

  // Defined up here (rather than below, next to the sign-in JSX that uses
  // them) so they're already available if the isAdmin branch below ever
  // needs them too -- keeps this component's control flow simple to
  // reason about regardless of which branch renders.
  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const result =
      mode === 'signIn' ? await adminSignIn(email.trim(), password) : await adminBootstrapSignUp(email.trim(), password);
    if (result.error) {
      setBusy(false);
      setError(result.error);
      return;
    }
    if (result.status === 'needsEnroll') {
      const enroll = await adminEnrollMfaStart();
      setBusy(false);
      if (enroll.error || !enroll.factorId) {
        setError(enroll.error || t('admin.mfaEnrollFailed'));
        return;
      }
      setMfaFactorId(enroll.factorId);
      setMfaQrCode(enroll.qrCode || null);
      setMfaSecret(enroll.secret || null);
      setMode('mfaEnroll');
    } else if (result.status === 'needsChallenge' && 'factorId' in result && result.factorId) {
      setBusy(false);
      setMfaFactorId(result.factorId);
      setMode('mfaChallenge');
    } else {
      setBusy(false);
    }
  };

  const submitMfa = async () => {
    if (!mfaFactorId || mfaCode.trim().length < 6) return;
    setBusy(true);
    setError(null);
    const result = await adminMfaVerify(mfaFactorId, mfaCode.trim());
    setBusy(false);
    // On success isAdmin flips true in SettingsStore and this component
    // re-renders straight into the dashboard branch below -- no extra
    // navigation needed here.
    if (result.error) setError(result.error);
  };

  const enableFingerprint = async () => {
    setBioBusy(true);
    setBioError(null);
    const result = await registerBiometricCredential();
    setBioBusy(false);
    if (result.error) setBioError(result.error);
    else setBioEnabled(true);
  };

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .then(({ count }) => setOpenReportCount(count ?? 0));
  }, [isAdmin]);

  const topBar = (
    <View style={styles.topBar}>
      <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={type.h3}>{t('admin.title')}</Text>
      <View style={styles.iconBtn} />
    </View>
  );

  if (!adminChecked) {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </Screen>
    );
  }

  if (isAdmin) {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.dashboardTitle}>{t('admin.dashboardTitle')}</Text>

          <Pressy onPress={() => navigation.navigate('AdminCategories')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageCategories')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageCategoriesSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminCollections')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageCollections')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageCollectionsSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminBanners')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageBanners')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageBannersSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminBranding')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageBranding')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageBrandingSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminModeration')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageModeration')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageModerationSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminShops')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageStorefronts')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageStorefrontsSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminUsers')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageUsers')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageUsersSub')}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Pressy onPress={() => navigation.navigate('AdminReports')} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('admin.manageReports')}</Text>
              <Text style={styles.rowSub}>{t('admin.manageReportsSub')}</Text>
            </View>
            {!!openReportCount && (
              <View style={styles.reportCountBadge}>
                <Text style={styles.reportCountBadgeText}>{openReportCount}</Text>
              </View>
            )}
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>

          <Text style={styles.sectionLabel}>{t('admin.security.title')}</Text>

          <Text style={styles.fieldLabel}>{t('admin.security.autoLock')}</Text>
          <View style={styles.durationRow}>
            {LOCK_DURATION_OPTIONS.map((mins) => (
              <Pressy
                key={mins}
                onPress={() => setLockDuration(mins)}
                style={[styles.durationChip, lockDurationMinutes === mins && styles.durationChipActive]}
              >
                <Text style={[styles.durationChipText, lockDurationMinutes === mins && styles.durationChipTextActive]}>
                  {mins < 60 ? t('admin.security.minutes', { n: mins }) : t('admin.security.hours', { n: mins / 60 })}
                </Text>
              </Pressy>
            ))}
          </View>
          <Text style={styles.note}>{t('admin.security.autoLockNote')}</Text>

          {biometricSupported && !hasBiometricCredential && !bioEnabled && (
            <>
              <Pressy onPress={enableFingerprint} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{t('admin.security.enableFingerprint')}</Text>
                  <Text style={styles.rowSub}>{t('admin.security.enableFingerprintSub')}</Text>
                </View>
                {bioBusy ? <ActivityIndicator color={colors.ink} /> : <Icon name="fingerprint" size={18} color={colors.inkSoft} />}
              </Pressy>
              {!!bioError && <Text style={styles.error}>{bioError}</Text>}
            </>
          )}
          {(hasBiometricCredential || bioEnabled) && (
            <Text style={styles.note}>{t('admin.security.fingerprintEnabled')}</Text>
          )}

          <Pressy onPress={() => adminSignOut()} style={styles.signOutBtn}>
            <Icon name="close" size={15} color={colors.danger} />
            <Text style={styles.signOutText}>{t('admin.signOut')}</Text>
          </Pressy>
        </ScrollView>
      </Screen>
    );
  }

  if (mode === 'mfaEnroll' || mode === 'mfaChallenge') {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.dashboardTitle}>
            {mode === 'mfaEnroll' ? t('admin.mfaEnrollTitle') : t('admin.mfaChallengeTitle')}
          </Text>
          <Text style={styles.note}>
            {mode === 'mfaEnroll' ? t('admin.mfaEnrollNote') : t('admin.mfaChallengeNote')}
          </Text>

          {mode === 'mfaEnroll' && !!mfaQrCode && (
            <View style={styles.qrWrap}>
              <Image
                source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(mfaQrCode)}` }}
                style={styles.qrImage}
              />
              {!!mfaSecret && <Text style={styles.mfaSecret}>{mfaSecret}</Text>}
            </View>
          )}

          <Text style={styles.fieldLabel}>{t('admin.mfaCodeLabel')}</Text>
          <TextInput
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="123456"
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Button
            label={mode === 'mfaEnroll' ? t('admin.mfaEnrollCta') : t('admin.verify')}
            onPress={submitMfa}
            loading={busy}
            disabled={mfaCode.trim().length < 6}
            style={{ marginTop: 18 }}
          />

          <Pressy onPress={() => { setMode('signIn'); setError(null); setMfaCode(''); }} style={styles.switchLink}>
            <Text style={styles.switchLinkText}>{t('admin.backToSignIn')}</Text>
          </Pressy>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={480}>
      {topBar}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.dashboardTitle}>{mode === 'signIn' ? t('admin.signInTitle') : t('admin.setupTitle')}</Text>
        {mode === 'signIn' ? (
          <Text style={styles.note}>{t('admin.signInNote')}</Text>
        ) : (
          <Text style={styles.note}>{t('admin.setupNote')}</Text>
        )}

        <Text style={styles.fieldLabel}>{t('admin.emailLabel')}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>{t('admin.passwordLabel')}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          label={mode === 'signIn' ? t('admin.signIn') : t('admin.setupCta')}
          onPress={submit}
          loading={busy}
          disabled={!email.trim() || !password}
          style={{ marginTop: 18 }}
        />

        {mode === 'signIn' ? (
          <Pressy onPress={() => { setMode('setup'); setError(null); }} style={styles.switchLink}>
            <Text style={styles.switchLinkText}>{t('admin.needSetup')} {t('admin.setupLink')}</Text>
          </Pressy>
        ) : (
          <Pressy onPress={() => { setMode('signIn'); setError(null); }} style={styles.switchLink}>
            <Text style={styles.switchLinkText}>{t('admin.backToSignIn')}</Text>
          </Pressy>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Content padding for the ScrollViews below (renamed from a plain View
  // this used to be -- see the render sites). Screen.tsx never scrolls on
  // its own (every wrapper in that chain is just flex:1), so a dashboard
  // this long -- 8 section rows plus the whole Security block -- had no
  // way to reach anything past roughly the Users row on a phone-height
  // viewport or in the native app, where there's no page-level scroll to
  // fall back on the way a wide desktop browser window has. Every other
  // admin screen (AdminBrandingScreen, AdminCollectionsScreen, ...)
  // already wraps its content in a ScrollView; this one just hadn't been
  // updated to match as rows were added to it over time.
  scroll: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40 },
  dashboardTitle: { ...type.title, fontSize: 21, marginBottom: 16 },
  note: { ...type.soft, lineHeight: 18, marginBottom: 20 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
  switchLink: { marginTop: 16, alignItems: 'center' },
  switchLinkText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 16, marginBottom: 12,
  },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  reportCountBadge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', marginRight: 4,
  },
  reportCountBadgeText: { fontSize: 11.5, fontWeight: '700', color: colors.white },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginTop: 24,
  },
  signOutText: { fontSize: 14.5, fontWeight: '600', color: colors.danger },
  sectionLabel: {
    ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 28, marginBottom: 6,
  },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  durationChip: {
    height: 34, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  durationChipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  durationChipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  durationChipTextActive: { color: colors.white },
  qrWrap: { alignItems: 'center', marginTop: 16, marginBottom: 4 },
  qrImage: { width: 200, height: 200 },
  mfaSecret: {
    marginTop: 10, fontSize: 12.5, color: colors.inkSoft, letterSpacing: 1,
    textAlign: 'center',
  },
});
