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
// non-dismissible full-screen gate over an admin session the server says is
// locked (SettingsStore's sessionLocked, from admin_session_status). Unlike
// ConfirmDialog/AlertHost this never lets a backdrop tap close it.
//
// It is not the lock, only its face. Until 11 Sep 2026 it was both: a flag
// in the app's memory that a reload forgot, over a session that stayed fully
// code-verified. Now the database refuses a locked session every admin
// power, and a reload asks the server and gets this screen straight back.
// Only a fresh authenticator code reopens the session -- the fingerprint
// shortcut that was here went with the old design, because the server
// cannot check a fingerprint (see ACCOUNTS.md).
export default function AdminLockScreen() {
  const { t } = useLanguage();
  const { isAdmin, sessionLocked, adminLockReason, getVerifiedTotpFactorId, adminMfaVerify, adminSignOut } = useSettings();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = isAdmin && sessionLocked;

  useEffect(() => {
    if (!visible) {
      setCode('');
      setError(null);
      return;
    }
    // A failed lookup is retried on Verify (below); nothing to say yet.
    getVerifiedTotpFactorId().then(setFactorId, () => {});
  }, [visible, getVerifiedTotpFactorId]);

  if (!visible) return null;

  const submitCode = async () => {
    if (code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    // The code is now the only way back in, so a factor lookup that failed
    // when the screen opened (a dropped connection) is retried here rather
    // than leaving Verify silently doing nothing -- and "no authenticator"
    // is told apart from "no connection".
    let id = factorId;
    if (!id) {
      try {
        id = await getVerifiedTotpFactorId();
      } catch (e) {
        setBusy(false);
        setError(t('admin.lock.tryAgain'));
        return;
      }
    }
    if (!id) {
      setBusy(false);
      setError(t('admin.lock.noFactor'));
      return;
    }
    setFactorId(id);
    const result = await adminMfaVerify(id, code.trim());
    setBusy(false);
    if (result.code === 'unpinned') setError(t('admin.lock.unpinnedCode'));
    else if (result.code === 'session_ended') setError(t('admin.lock.sessionEnded'));
    else if (result.error) setError(result.error);
  };

  return (
    <Modal transparent visible animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Icon name="lock" size={22} color={colors.white} />
          </View>
          <Text style={styles.title}>{t('admin.lock.title')}</Text>
          <Text style={styles.note}>
            {adminLockReason === 'unpinned' ? t('admin.lock.unpinnedNote') : t('admin.lock.note')}
          </Text>

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
