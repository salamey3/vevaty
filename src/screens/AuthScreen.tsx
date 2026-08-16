import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import { supabase, sendPhoneOtp, verifyPhoneOtp } from '../lib/supabase';
import { useSettings } from '../store/SettingsStore';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

type Step = 'phone' | 'otp' | 'name' | 'adminMfaEnroll' | 'adminMfaChallenge';

// Loose E.164-ish check -- a leading "+" and 8-15 digits after it. Good
// enough to catch obviously-broken input before spending an OTP send;
// Twilio/Supabase are the real validators.
function normalizePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s-]/g, '');
  return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
}

export default function AuthScreen({ navigation, route }: Props) {
  const { t } = useLanguage();
  const { adminSignIn, adminEnrollMfaStart, adminMfaVerify } = useSettings();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+961');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentPhone, setSentPhone] = useState('');
  // Admin TOTP enroll/challenge step state -- see adminLogin()/submitAdminMfa() below.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // This screen is the ONLY sign-in surface in the whole app -- regular
  // buyers/sellers never see a discoverable "admin" affordance anywhere.
  // An explicit "Sign in as admin instead" link switches this same field
  // into admin email+password sign-in. (Previously this was auto-detected
  // by sniffing for "@" typed into the phone field -- but the phone field
  // defaults to a numeric phone-pad keyboard, which has no letter keys on
  // mobile, so an admin could never actually type an email address into it
  // to trigger the switch. Explicit mode state, with its own text field and
  // keyboard type, fixes that regardless of platform.)
  const [isEmailInput, setIsEmailInput] = useState(false);

  const finishAndLeave = () => {
    const { returnTo, returnToParams } = route.params || {};
    if (returnTo) navigation.replace(returnTo as any, returnToParams);
    else navigation.goBack();
  };

  const adminLogin = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    const result = await adminSignIn(email.trim(), password);
    if (result.error) {
      setLoading(false);
      setError(result.error);
      return;
    }
    if (result.status === 'needsEnroll') {
      const enroll = await adminEnrollMfaStart();
      setLoading(false);
      if (enroll.error || !enroll.factorId) {
        setError(enroll.error || t('auth.mfaEnrollFailed'));
        return;
      }
      setMfaFactorId(enroll.factorId);
      setMfaQrCode(enroll.qrCode || null);
      setMfaSecret(enroll.secret || null);
      setStep('adminMfaEnroll');
    } else if (result.status === 'needsChallenge' && result.factorId) {
      setLoading(false);
      setMfaFactorId(result.factorId);
      setStep('adminMfaChallenge');
    } else {
      setLoading(false);
    }
  };

  const submitAdminMfa = async () => {
    if (!mfaFactorId || mfaCode.trim().length < 6) return;
    setLoading(true);
    setError(null);
    const result = await adminMfaVerify(mfaFactorId, mfaCode.trim());
    setLoading(false);
    if (result.error) setError(result.error);
    else finishAndLeave();
  };

  const sendCode = async (channel: 'sms' | 'whatsapp') => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError(t('auth.invalidPhone'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendPhoneOtp(normalized, channel);
      setSentPhone(normalized);
      setStep('otp');
    } catch (e: any) {
      const msg: string = e?.message || '';
      // Supabase returns a distinct "provider not enabled"-style message
      // when phone auth hasn't been configured in the dashboard yet --
      // surface that as "not available yet" rather than a generic error,
      // since it's an expected state until Twilio is set up.
      setError(/not enabled|provider|unsupported/i.test(msg) ? t('auth.notConfiguredYet') : t('auth.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (otp.trim().length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const session = await verifyPhoneOtp(sentPhone, otp.trim());
      const uid = session?.user?.id;
      if (!uid) throw new Error('No session after verification');
      // Persist the verified phone immediately, regardless of whether this
      // user goes on to complete the 'name' step below. Previously this
      // write only happened for returning users (the branch below with an
      // existing full_name) -- a brand-new user who verified their phone
      // but then closed the tab/navigated away before typing a name (e.g.
      // via the browser's own back button, which this screen can't
      // intercept) was left with is_phone_verified: false and phone: null
      // forever, with no way to ever be re-prompted. Found live 2026-08-14
      // testing the new Supabase Test OTP numbers: a real verified
      // auth.users.phone with a completely untouched profiles row.
      await supabase
        .from('profiles')
        .upsert({ id: uid, phone: sentPhone, is_phone_verified: true }, { onConflict: 'id' });
      const { data: existing } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      if (existing?.full_name) {
        finishAndLeave();
      } else {
        setStep('name');
      }
    } catch (e: any) {
      setError(t('auth.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  const finishSignup = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) throw new Error('No session');
      // upsert, not insert -- AppStore's own syncFromSupabase may have
      // already inserted a bare profile row for this uid the moment the
      // auth-state-change fired, racing this write. upsert makes either
      // order land on the same final row instead of a unique-violation.
      await supabase
        .from('profiles')
        .upsert({ id: uid, full_name: name.trim(), phone: sentPhone, is_phone_verified: true }, { onConflict: 'id' });
      finishAndLeave();
    } catch (e: any) {
      setError(t('auth.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressy
            onPress={() => {
              if (step === 'phone') {
                if (isEmailInput) { setIsEmailInput(false); setPassword(''); setError(null); }
                else navigation.goBack();
              }
              else if (step === 'name') setStep('otp');
              else if (step === 'adminMfaEnroll' || step === 'adminMfaChallenge') { setStep('phone'); setMfaCode(''); }
              else setStep('phone');
            }}
            style={styles.iconBtn}
          >
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('auth.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <View style={styles.body}>
          {step === 'phone' && !isEmailInput && (
            <>
              <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.phoneLabel')}</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder={t('auth.phonePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button label={t('auth.sendWhatsapp')} onPress={() => sendCode('whatsapp')} loading={loading} style={{ marginTop: 18 }} />
              <Button
                label={t('auth.sendSms')}
                onPress={() => sendCode('sms')}
                loading={loading}
                variant="secondary"
                style={{ marginTop: 10 }}
              />
              <Pressy onPress={() => { setIsEmailInput(true); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.adminSignInLink')}</Text>
              </Pressy>
            </>
          )}

          {step === 'phone' && isEmailInput && (
            <>
              <Text style={styles.subtitle}>{t('auth.adminSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.emailLabel')}</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t('auth.passwordLabel')}</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.signIn')}
                onPress={adminLogin}
                loading={loading}
                disabled={!password || !email.trim()}
                style={{ marginTop: 18 }}
              />
              <Pressy onPress={() => { setIsEmailInput(false); setPassword(''); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.backToPhoneLink')}</Text>
              </Pressy>
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={styles.subtitle}>{t('auth.otpSubtitle', { phone: sentPhone })}</Text>
              <Text style={styles.fieldLabel}>{t('auth.otpTitle')}</Text>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder={t('auth.otpPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button label={t('auth.verify')} onPress={verifyCode} loading={loading} style={{ marginTop: 18 }} />
              <Pressy onPress={() => setStep('phone')} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.changeNumber')}</Text>
              </Pressy>
            </>
          )}

          {step === 'name' && (
            <>
              <Text style={styles.subtitle}>{t('auth.nameTitle')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('auth.namePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button label={t('auth.finish')} onPress={finishSignup} loading={loading} style={{ marginTop: 18 }} />
            </>
          )}

          {(step === 'adminMfaEnroll' || step === 'adminMfaChallenge') && (
            <>
              <Text style={styles.subtitle}>
                {step === 'adminMfaEnroll' ? t('auth.mfaEnrollNote') : t('auth.mfaChallengeNote')}
              </Text>

              {step === 'adminMfaEnroll' && !!mfaQrCode && (
                <View style={styles.qrWrap}>
                  <Image
                    source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(mfaQrCode)}` }}
                    style={styles.qrImage}
                  />
                  {!!mfaSecret && <Text style={styles.mfaSecret}>{mfaSecret}</Text>}
                </View>
              )}

              <Text style={styles.fieldLabel}>{t('auth.mfaCodeLabel')}</Text>
              <TextInput
                value={mfaCode}
                onChangeText={setMfaCode}
                placeholder="123456"
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={step === 'adminMfaEnroll' ? t('auth.mfaEnrollCta') : t('auth.verify')}
                onPress={submitAdminMfa}
                loading={loading}
                disabled={mfaCode.trim().length < 6}
                style={{ marginTop: 18 }}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  subtitle: { ...type.soft, marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
  linkBtn: { alignSelf: 'center', marginTop: 16, padding: 8 },
  linkText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  qrWrap: { alignItems: 'center', marginBottom: 16 },
  qrImage: { width: 200, height: 200 },
  mfaSecret: {
    marginTop: 10, fontSize: 12.5, color: colors.inkSoft, letterSpacing: 1,
    textAlign: 'center',
  },
});
