import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Button from './Button';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useSettings } from '../store/SettingsStore';
import { useLanguage } from '../i18n/LanguageContext';

// Renders at the app root (see App.tsx), alongside AlertHost -- a
// non-dismissible full-screen gate that appears whenever the admin's
// auto-lock idle timer fires (see SettingsStore's sessionLocked/
// lockDurationMinutes). Unlike ConfirmDialog/AlertHost this never lets a
// backdrop tap close it: the whole point is that the underlying app stays
// hidden until the person in front of the screen re-proves they're the
// admin.
//
// The underlying Supabase session is never touched by locking -- it's
// still fully aal2-verified the whole time (see SettingsStore's comment on
// why locking never calls signOut). So unlocking only needs a fresh TOTP
// code, not the account password again; a registered platform biometric
// credential can substitute for typing that code (see
// tryBiometricUnlock's local-only-gate comment in SettingsStore).
export default function AdminLockScreen() {
  const { t } = useLanguage();
  const {
    isAdmin, sessionLocked, biometricSupported, hasBiometricCredential,
    tryBiometricUnlock, getVerifiedTotpFactorId, adminMfaVerify, adminSignOut,
  } = useSettings();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  const visible = isAdmin && sessionLocked;

  useEffect(() => {
    if (!visible) {
      setCode('');
      setError(null);
      return;
    }
    getVerifiedTotpFactorId().then(setFactorId);
  }, [visible, getVerifiedTotpFactorId]);

  if (!visible) return null;

  const submitCode = async () => {
    if (!factorId || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    const result = await adminMfaVerify(factorId, code.trim());
    setBusy(false);
    if (result.error) setError(result.error);
  };

  const useFingerprint = async () => {
    setBioBusy(true);
    setError(null);
    const result = await tryBiometricUnlock();
    setBioBusy(false);
    if (result.error) setError(result.error);
  };

  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="lock" size={22} color={colors.white} />
          </View>
          <Text style={styles.title}>{t('admin.lock.title')}</Text>
          <Text style={styles.note}>{t('admin.lock.note')}</Text>

          {biometricSupported && hasBiometricCredential && (
            <Button
              label={t('admin.lock.useFingerprint')}
              onPress={useFingerprint}
              loading={bioBusy}
              style={{ marginTop: 10, marginBottom: 6 }}
            />
          )}

          <Text style={styles.fieldLabel}>{t('admin.mfaCodeLabel')}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Button
            label={t('admin.verify')}
            onPress={submitCode}
            loading={busy}
            disabled={code.trim().length < 6}
            variant={biometricSupported && hasBiometricCredential ? 'secondary' : 'primary'}
            style={{ marginTop: 14 }}
          />

          <Pressy onPress={() => adminSignOut()} style={styles.signOutLink}>
            <Text style={styles.signOutLinkText}>{t('admin.lock.notYouSignOut')}</Text>
          </Pressy>
        </View>
        <SystemBottomStrip />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 360 },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16,
  },
  title: { ...type.h3, textAlign: 'center' },
  note: { ...type.soft, textAlign: 'center', lineHeight: 18, marginTop: 6, marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 14, fontSize: 16, color: colors.ink, textAlign: 'center',
  },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10, textAlign: 'center' },
  signOutLink: { alignSelf: 'center', marginTop: 20, padding: 8 },
  signOutLinkText: { color: colors.inkSoft, fontSize: 12.5, fontWeight: '600' },
});
