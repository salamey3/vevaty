import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, Image, KeyboardAvoidingView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import {
  supabase,
  sendPhoneOtp,
  verifyPhoneOtp,
  normalizePhone,
  isPhoneRegistered,
  signInWithPhonePassword,
  setAccountPassword,
} from '../lib/supabase';
import { useSettings } from '../store/SettingsStore';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { openLegalPage } from '../lib/legalLinks';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

// 'phone': collect a number and find out whether it's registered (no OTP
// sent yet -- see checkPhone()). 'signup': not registered -- create a
// password, then send the OTP. 'signin': registered -- enter the password,
// or fall through to 'forgotPassword' from the link on that same step.
// 'otp' is shared by both the signup and forgot-password sends (see
// otpPurpose); 'setNewPassword' follows a forgot-password OTP (and is also
// where a pre-password account sets one for the very first time -- see
// setAccountPassword's own comment in lib/supabase.ts).
type Step = 'phone' | 'signup' | 'signin' | 'otp' | 'setNewPassword' | 'name' | 'adminMfaEnroll' | 'adminMfaChallenge';

// A few failed password attempts pause further tries for a short cooldown
// -- a plain client-side speed bump, not a real brute-force defense (that
// needs Supabase's own CAPTCHA integration, which isn't wired up here).
// Good enough to stop someone mashing the button by hand; a scripted
// attacker hitting Supabase's API directly would skip this entirely.
const MAX_PASSWORD_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export default function AuthScreen({ navigation, route }: Props) {
  const { t, language } = useLanguage();
  const { adminSignIn, adminEnrollMfaStart, adminMfaVerify } = useSettings();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+961');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The phone number the 'signup'/'signin'/'setNewPassword' steps act on --
  // set once, right after checkPhone() resolves which branch to take.
  // Kept separate from `sentPhone` below, which specifically tracks
  // whichever number an OTP was actually sent to (the 'otp' step's own
  // subtitle reads off that one, matching its pre-existing meaning).
  const [checkedPhone, setCheckedPhone] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  // Which flow the 'otp' step is currently completing -- a brand-new
  // signup (apply the password captured on 'signup', then go to 'name')
  // or a forgot-password recovery (go to 'setNewPassword' instead, since
  // no password was captured up front for that one).
  const [otpPurpose, setOtpPurpose] = useState<'signup' | 'recovery' | null>(null);
  // 'signup' step's password fields.
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState('');
  // 'signin' step's password field, and whether it's showing the password
  // field or the forgot-password channel choice in its place.
  const [signinPassword, setSigninPassword] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  // 'setNewPassword' step's fields (forgot-password recovery, or a
  // long-time member's very first password).
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  // Simple attempt-cooldown for 'signin' -- see MAX_PASSWORD_ATTEMPTS.
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  // Only used to force a re-render once a second while locked out, so the
  // countdown in the error message and the button's re-enabling actually
  // update on their own instead of being frozen at whatever they read on
  // the render that set lockedUntil.
  const [, setLockoutTick] = useState(0);
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      if (Date.now() >= lockedUntil) {
        setLockedUntil(null);
        setFailedAttempts(0);
      } else {
        setLockoutTick((n) => n + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);
  // Hard gate on the 'name' step (the last step of NEW-user signup only --
  // a returning user skips straight to afterAuthenticated()'s
  // finishAndLeave() branch below and never sees this). Required before
  // finishSignup() is allowed to run; see legalLinks.ts for why these are
  // absolute-URL static pages rather than in-app screens.
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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

  // Shared "what's next" decision after ANY of the three ways this screen
  // can produce a freshly-authenticated session (signup OTP verified +
  // password attached, password sign-in, or a recovered/first-time
  // password just set): a genuinely new account has no full_name yet, so
  // it goes to the 'name' step; anyone who already completed that once
  // before is done. Re-checks the database rather than trusting local
  // state, so a signup that got interrupted after verifying but before
  // finishing 'name' (closed the tab, lost connection) correctly lands
  // back on 'name' again next time instead of a silent skip.
  const afterAuthenticated = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) throw new Error('No session');
    const { data: existing } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    if (existing?.full_name) finishAndLeave();
    else setStep('name');
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

  // 'phone' step's Continue -- looks up whether this number already has an
  // account (see isPhoneRegistered's own comment for why that's a narrow
  // database function rather than a plain table read) and branches to
  // 'signup' or 'signin'. No OTP is sent from this step any more -- that
  // now only happens once we know which branch we're in.
  const checkPhone = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError(t('auth.invalidPhone'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const registered = await isPhoneRegistered(normalized);
      setCheckedPhone(normalized);
      setSigninPassword('');
      setSignupPassword('');
      setSignupPasswordConfirm('');
      setFailedAttempts(0);
      setLockedUntil(null);
      setForgotMode(false);
      setStep(registered ? 'signin' : 'signup');
    } catch (e: any) {
      setError(t('auth.phoneCheckFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 'signup' step -- validates the new password, then sends the OTP via
  // whichever channel was tapped. Same sendPhoneOtp/verifyPhoneOtp pair
  // the app has always used for phone verification (proven live already,
  // WhatsApp channel included) -- the password itself is only attached
  // once that OTP verifies (see verifyCode's 'signup' branch), rather than
  // risking an unproven signUp()-with-password-and-channel combination.
  const sendSignupOtp = async (channel: 'sms' | 'whatsapp') => {
    if (signupPassword.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (signupPassword !== signupPasswordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendPhoneOtp(checkedPhone, channel);
      setSentPhone(checkedPhone);
      setOtpPurpose('signup');
      setOtp('');
      setStep('otp');
    } catch (e: any) {
      const msg: string = e?.message || '';
      setError(/not enabled|provider|unsupported/i.test(msg) ? t('auth.notConfiguredYet') : t('auth.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 'signin' step -- direct password sign-in for an already-registered
  // number. No OTP involved at all on this path, which is the entire
  // point: a returning user isn't spending a fresh text message just to
  // get back in.
  const signIn = async () => {
    if (lockedUntil && Date.now() < lockedUntil) return;
    if (!signinPassword) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithPhonePassword(checkedPhone, signinPassword);
      setFailedAttempts(0);
      await afterAuthenticated();
    } catch (e: any) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      if (next >= MAX_PASSWORD_ATTEMPTS) setLockedUntil(Date.now() + LOCKOUT_MS);
      setError(t('auth.wrongPassword'));
    } finally {
      setLoading(false);
    }
  };

  // Forgot-password branch of 'signin' -- same OTP send as signup, just a
  // different purpose so verifyCode() below knows to route to
  // 'setNewPassword' instead of attaching a password that was never
  // collected up front.
  const sendRecoveryOtp = async (channel: 'sms' | 'whatsapp') => {
    setLoading(true);
    setError(null);
    try {
      await sendPhoneOtp(checkedPhone, channel);
      setSentPhone(checkedPhone);
      setOtpPurpose('recovery');
      setOtp('');
      setStep('otp');
    } catch (e: any) {
      const msg: string = e?.message || '';
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
      // Persist the verified phone immediately, regardless of what happens
      // next -- see this same upsert's original comment history: a user
      // who verifies but never reaches the end of whichever step follows
      // (closes the tab, loses connection) should never be left with
      // is_phone_verified: false and no way to be re-prompted.
      await supabase
        .from('profiles')
        .upsert({ id: uid, phone: sentPhone, is_phone_verified: true }, { onConflict: 'id' });
      if (otpPurpose === 'signup') {
        // The password was already collected on 'signup', before this OTP
        // was even sent -- attach it now that the session is real.
        await setAccountPassword(signupPassword);
        setSignupPassword('');
        setSignupPasswordConfirm('');
        await afterAuthenticated();
      } else {
        // Recovery: no password was collected yet -- that's what
        // 'setNewPassword' is for.
        setStep('setNewPassword');
      }
    } catch (e: any) {
      setError(t('auth.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 'setNewPassword' -- reached after a forgot-password OTP verifies, or
  // (functionally identical, see setAccountPassword's own comment) the
  // first time a pre-password long-time member ever sets one at all.
  const submitNewPassword = async () => {
    if (newPassword.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await setAccountPassword(newPassword);
      setNewPassword('');
      setNewPasswordConfirm('');
      await afterAuthenticated();
    } catch (e: any) {
      setError(t('auth.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  const finishSignup = async () => {
    if (!name.trim() || !agreedToTerms) return;
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

  const lockoutSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  const goBack = () => {
    if (step === 'phone') {
      if (isEmailInput) { setIsEmailInput(false); setPassword(''); setError(null); }
      else navigation.goBack();
    } else if (step === 'signup' || step === 'signin') {
      setStep('phone');
      setError(null);
    } else if (step === 'otp') {
      setStep(otpPurpose === 'signup' ? 'signup' : 'signin');
      setError(null);
    } else if (step === 'setNewPassword') {
      setStep('phone');
      setError(null);
    } else if (step === 'name') {
      setStep('otp');
    } else if (step === 'adminMfaEnroll' || step === 'adminMfaChallenge') {
      setStep('phone');
      setMfaCode('');
    } else {
      setStep('phone');
    }
  };

  return (
    <Screen maxWidth={480}>
      {/* behavior='padding' on both platforms -- see the long note in
          ChatThreadScreen: under Expo's edge-to-edge default the Android
          window no longer resizes for the keyboard, so leaving Android
          undefined makes KeyboardAvoidingView a no-op. */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressy onPress={goBack} style={styles.iconBtn}>
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
              <Button label={t('common.continue')} onPress={checkPhone} loading={loading} style={{ marginTop: 18 }} />
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

          {step === 'signup' && (
            <>
              <Text style={styles.subtitle}>{t('auth.createPasswordSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.newPasswordLabel')}</Text>
              <TextInput
                value={signupPassword}
                onChangeText={setSignupPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t('auth.confirmPasswordLabel')}</Text>
              <TextInput
                value={signupPasswordConfirm}
                onChangeText={setSignupPasswordConfirm}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.sendWhatsapp')}
                onPress={() => sendSignupOtp('whatsapp')}
                loading={loading}
                disabled={!signupPassword || !signupPasswordConfirm}
                style={{ marginTop: 18 }}
              />
              <Button
                label={t('auth.sendSms')}
                onPress={() => sendSignupOtp('sms')}
                loading={loading}
                variant="secondary"
                disabled={!signupPassword || !signupPasswordConfirm}
                style={{ marginTop: 10 }}
              />
            </>
          )}

          {step === 'signin' && !forgotMode && (
            <>
              <Text style={styles.subtitle}>{t('auth.signinSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.passwordLabel')}</Text>
              <TextInput
                value={signinPassword}
                onChangeText={setSigninPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              {!!lockedUntil && lockoutSecondsLeft > 0 && (
                <Text style={styles.error}>{t('auth.tooManyAttempts', { n: lockoutSecondsLeft })}</Text>
              )}
              <Button
                label={t('auth.signIn')}
                onPress={signIn}
                loading={loading}
                disabled={!signinPassword || (!!lockedUntil && lockoutSecondsLeft > 0)}
                style={{ marginTop: 18 }}
              />
              <Pressy onPress={() => { setForgotMode(true); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.forgotPassword')}</Text>
              </Pressy>
            </>
          )}

          {step === 'signin' && forgotMode && (
            <>
              <Text style={styles.subtitle}>{t('auth.forgotPasswordSubtitle')}</Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button label={t('auth.sendWhatsapp')} onPress={() => sendRecoveryOtp('whatsapp')} loading={loading} style={{ marginTop: 18 }} />
              <Button
                label={t('auth.sendSms')}
                onPress={() => sendRecoveryOtp('sms')}
                loading={loading}
                variant="secondary"
                style={{ marginTop: 10 }}
              />
              <Pressy onPress={() => { setForgotMode(false); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('common.back')}</Text>
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
              <Pressy onPress={() => { setStep('phone'); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.changeNumber')}</Text>
              </Pressy>
            </>
          )}

          {step === 'setNewPassword' && (
            <>
              <Text style={styles.subtitle}>{t('auth.setNewPasswordSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.newPasswordLabel')}</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t('auth.confirmPasswordLabel')}</Text>
              <TextInput
                value={newPasswordConfirm}
                onChangeText={setNewPasswordConfirm}
                placeholder="••••••••"
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.setPasswordCta')}
                onPress={submitNewPassword}
                loading={loading}
                disabled={!newPassword || !newPasswordConfirm}
                style={{ marginTop: 18 }}
              />
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
              <View style={styles.termsRow}>
                <Pressy onPress={() => setAgreedToTerms((v) => !v)} style={styles.checkboxHit}>
                  <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                    {agreedToTerms && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                  </View>
                </Pressy>
                {/* The Terms/Privacy substrings are their own nested <Text onPress>
                    so tapping a link opens that page without also toggling the
                    checkbox -- this outer Text carries no onPress of its own,
                    so there's no handler for a link tap to conflict with. */}
                <Text style={styles.termsText}>
                  {t('auth.agreeToPrefix')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('terms', language)}>{t('nav.termsOfUse')}</Text>
                  {' '}{t('auth.agreeToAnd')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('privacy', language)}>{t('nav.privacyPolicy')}</Text>
                </Text>
              </View>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.finish')}
                onPress={finishSignup}
                loading={loading}
                disabled={!name.trim() || !agreedToTerms}
                style={{ marginTop: 18 }}
              />
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
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 14 },
  checkboxHit: { padding: 2 },
  checkbox: {
    width: 17, height: 17, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.ink },
  termsText: { flex: 1, fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  termsLink: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  linkBtn: { alignSelf: 'center', marginTop: 16, padding: 8 },
  linkText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  qrWrap: { alignItems: 'center', marginBottom: 16 },
  qrImage: { width: 200, height: 200 },
  mfaSecret: {
    marginTop: 10, fontSize: 12.5, color: colors.inkSoft, letterSpacing: 1,
    textAlign: 'center',
  },
});
