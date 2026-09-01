import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TextInput, Image, KeyboardAvoidingView, ScrollView } from 'react-native';
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
  upsertOwnProfile,
} from '../lib/supabase';
import { emailFieldOk, normalizeEmail } from '../lib/contactDetails';
import { mirrorRow } from '../lib/mirrorRow';
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
// The country code both phone fields start from. Seeded rather than left to
// the placeholder because normalizePhone requires a leading '+' and a country
// code, and a seller typing "70 123 456" into a field that then rejects it
// mostly just gives up and leaves it blank -- which routes buyers straight
// back to the account phone, i.e. the exact bug the WhatsApp field exists to
// fix. A field holding nothing but this counts as empty everywhere below.
const DEFAULT_DIAL_PREFIX = '+961';

const MAX_PASSWORD_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export default function AuthScreen({ navigation, route }: Props) {
  const { t, language, isRTL } = useLanguage();
  const { adminSignIn, adminEnrollMfaStart, adminMfaVerify } = useSettings();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(DEFAULT_DIAL_PREFIX);
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
  // 'signup' step's fields. This step is the whole registration form now --
  // name, the two optional contact fields, and the password -- rather than
  // just a password, so a new account is complete the moment its OTP
  // verifies. See the 'name' step further down for what still catches a
  // signup that dies between those two moments.
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPasswordConfirm, setSignupPasswordConfirm] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupWhatsapp, setSignupWhatsapp] = useState('');
  // "Same as my mobile number". While on, the WhatsApp field mirrors the
  // number this signup is for and stops being editable, rather than the two
  // silently drifting apart.
  const [whatsappSameAsMobile, setWhatsappSameAsMobile] = useState(false);
  // Consent for Vevaty's OWN messages to that number (listing-expiry
  // reminders). Nothing to do with buyers reaching the seller, which is what
  // the number is shown for regardless -- see the column comment in the
  // migration. Collected now so there is no second consent round on the day
  // Meta finally permits template creation on the WABA.
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  // Required-field borders stay quiet until the first submit attempt --
  // painting a form red before anyone has typed in it is just hostile.
  const [showSignupErrors, setShowSignupErrors] = useState(false);
  const [revealSignupPassword, setRevealSignupPassword] = useState(false);
  const [revealSignupPasswordConfirm, setRevealSignupPasswordConfirm] = useState(false);
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

  // Set when the one profile write in verifyCode() fails. A ref, not state:
  // afterAuthenticated() is called in the same tick that sets it, and a
  // useState value read there would still be the old one.
  //
  // It exists because "did the profile land?" cannot be answered by reading
  // full_name back. AppStore inserts a bare profile row from its own CACHED
  // name the moment the session fires (see syncFromSupabase), so that read
  // can find a name this signup never typed and wave a half-written account
  // straight into the app. We know whether the write failed; we do not need
  // to ask.
  const profileWritePendingRef = useRef(false);

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
    // Checked before the read, not after it -- see profileWritePendingRef.
    // Every route that ends up here after a failed profile write lands on
    // the repair step, including the one that got there via a failed
    // password attach, which used to slip past this entirely.
    if (profileWritePendingRef.current) {
      setError(t('auth.detailsSaveFailed'));
      setStep('name');
      return;
    }
    const { data: existing, error } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', uid)
      .maybeSingle();
    // A read that FAILED is not the same as a read that found no name. On a
    // dropped connection this used to answer "no name" and park a member of
    // three months on the "what's your name?" screen. When we cannot tell,
    // let them through -- AppStore syncs the real profile moments later.
    if (error) finishAndLeave();
    else if (existing?.full_name) finishAndLeave();
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
      setSignupEmail('');
      setSignupWhatsapp('');
      setWhatsappSameAsMobile(false);
      setWhatsappOptIn(false);
      setShowSignupErrors(false);
      setRevealSignupPassword(false);
      setRevealSignupPasswordConfirm(false);
      // These three are NOT optional to reset, and leaving them out was a
      // real defect. `name` and `agreedToTerms` are shared with the 'name'
      // step, so without this a user who filled the form for one number,
      // tapped Change, and entered another arrived at a fresh form carrying
      // the previous person's name and a terms box already ticked -- an
      // agreement nobody gave for this account, on a phone that gets handed
      // around a shop. `sentPhone` is worse: finishSignup used to write it,
      // so a stale value could stamp one account's number onto another's
      // profile, which is exactly the column buyers are shown.
      setName('');
      setAgreedToTerms(false);
      setSentPhone('');
      setOtpPurpose(null);
      // Same reason as the rest of this block, and easy to miss because it is
      // a ref rather than state: left set, a failed write on one number would
      // follow the user to the next one, park a perfectly intact account on
      // the repair step, and let finishSignup write this session's name over
      // an established full_name.
      profileWritePendingRef.current = false;
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
  // The WhatsApp number this signup will actually save: the mobile itself
  // when "same as my mobile" is on, otherwise whatever was typed -- null if
  // that is empty (the field is optional) or unparseable (caught below before
  // anything is sent). Derived rather than stored so the checkbox and the
  // field can never disagree about which one won.
  // A field holding nothing but the seeded country code is empty, not a bad
  // number -- otherwise merely tapping into the field and tapping out again
  // would fail validation on an optional field.
  const whatsappTyped = signupWhatsapp.trim() === DEFAULT_DIAL_PREFIX ? '' : signupWhatsapp.trim();
  const typedWhatsapp = normalizePhone(whatsappTyped);
  const effectiveWhatsapp = whatsappSameAsMobile ? checkedPhone : typedWhatsapp;
  const whatsappFieldBad = !whatsappSameAsMobile && !!whatsappTyped && !typedWhatsapp;

  const sendSignupOtp = async (channel: 'sms' | 'whatsapp') => {
    // Everything is checked here, before the OTP goes out, because an OTP
    // costs real money -- $0.36 a message to Lebanon -- and a form that sends
    // one and only then complains about the email has spent it for nothing.
    setShowSignupErrors(true);
    if (!name.trim()) {
      setError(t('auth.nameRequired'));
      return;
    }
    if (!emailFieldOk(signupEmail)) {
      setError(t('auth.invalidEmail'));
      return;
    }
    if (whatsappFieldBad) {
      setError(t('auth.invalidWhatsapp'));
      return;
    }
    if (signupPassword.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (signupPassword !== signupPasswordConfirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    if (!agreedToTerms) {
      setError(t('auth.mustAgreeToTerms'));
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
      // next -- see this same call's original comment history: a user
      // who verifies but never reaches the end of whichever step follows
      // (closes the tab, loses connection) should never be left with
      // is_phone_verified: false and no way to be re-prompted. Goes through
      // upsertOwnProfile, not a plain client-side upsert -- see that
      // function's own comment for why a plain upsert here silently never
      // actually wrote anything.
      // Everything the form collected, in ONE write. Not two: a second
      // follow-up upsert can fail on its own and leave a half-written
      // account, and this is a single SQL statement, so it either lands
      // whole or not at all. For the recovery path the extra fields are
      // simply absent, which the RPC reads as "leave those columns alone".
      const signingUp = otpPurpose === 'signup';
      try {
        await upsertOwnProfile({
          phone: sentPhone,
          isPhoneVerified: true,
          ...(signingUp
            ? {
                fullName: name.trim(),
                email: normalizeEmail(signupEmail),
                // The number and its consent flag travel together or not at
                // all. Sending `whatsappOptIn: false` when there is no number
                // is NOT the same as omitting it: the RPC coalesces a null
                // argument to "leave the column alone" but takes a literal
                // false at face value, so an unconditional false here would
                // revoke a consent this form never asked about.
                ...(effectiveWhatsapp ? { whatsapp: effectiveWhatsapp, whatsappOptIn } : {}),
              }
            : {}),
        });
        profileWritePendingRef.current = false;
      } catch {
        profileWritePendingRef.current = true;
      }

      if (signingUp) {
        // Past this line the OTP is spent and the session is real, so NOTHING
        // below may report "verification failed" -- that message over a number
        // that verified perfectly well would send the user to buy a second
        // code for a problem that has nothing to do with the code.
        //
        // The password is the one thing that genuinely must land: without it
        // there is no way back into the account except a forgot-password OTP,
        // at $0.36 a message. So a failure here routes to 'setNewPassword',
        // which attaches a password to THIS live session -- no second code
        // needed -- rather than throwing.
        try {
          await setAccountPassword(signupPassword);
        } catch {
          setSignupPassword('');
          setSignupPasswordConfirm('');
          setError(t('auth.passwordNotAttached'));
          setStep('setNewPassword');
          return;
        }
        setSignupPassword('');
        setSignupPasswordConfirm('');
        // No separate check for the failed write here: afterAuthenticated()
        // reads the same ref and routes to the repair step, so the password
        // branch above gets the identical treatment on its way back through
        // submitNewPassword() rather than escaping it.
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
      // upsertOwnProfile, not insert -- AppStore's own syncFromSupabase may
      // have already inserted a bare profile row for this uid the moment
      // the auth-state-change fired, racing this write. The upsert (done
      // server-side inside upsertOwnProfile's RPC -- see its comment)
      // makes either order land on the same final row instead of a
      // unique-violation.
      // `sentPhone || undefined`, not a bare `sentPhone`, and not nothing.
      //
      // This step is reached two ways. An interrupted signup gets here
      // BECAUSE the write that would have stored the phone failed, so it is
      // the only chance to store it -- drop it and the account keeps a null
      // phone forever, every buyer who taps "Contact seller" is told the
      // number could not be loaded, and the only repair is a paid OTP
      // through Change phone number that nobody knows to go looking for.
      // A long-standing account signing in, on the other hand, has had a
      // number for months and must not have it overwritten by a stale one.
      // checkPhone() clears sentPhone, so on that path this is '' -> undefined
      // -> null, which the RPC reads as "leave the column alone".
      //
      // The contact fields ride along for the same reason: this is the
      // repair screen for a details write that failed, they are still in
      // state, and losing them silently is what made that failure invisible.
      // The number and its consent flag travel together or not at all -- see
      // verifyCode's note on why a literal false is not the same as omitting
      // it, and would quietly revoke a consent set months ago from the
      // profile screen.
      await upsertOwnProfile({
        phone: sentPhone || undefined,
        fullName: name.trim(),
        isPhoneVerified: true,
        email: normalizeEmail(signupEmail),
        ...(effectiveWhatsapp ? { whatsapp: effectiveWhatsapp, whatsappOptIn } : {}),
      });
      profileWritePendingRef.current = false;
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
      setShowSignupErrors(false);
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

        {/* A ScrollView, not a View, since the signup step became a full
            registration form -- eight fields and three checkboxes do not fit
            a phone screen with the keyboard up, and without this the
            password fields and the submit buttons are simply unreachable.
            keyboardShouldPersistTaps so the first tap on a button lands
            instead of being eaten dismissing the keyboard. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
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
              <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('auth.signupSubtitle')}</Text>

              <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auth.fullNameLabel')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                editable={!loading}
                placeholder={t('auth.namePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="words"
                style={[styles.input, isRTL && styles.rtl, showSignupErrors && !name.trim() && styles.inputInvalid]}
              />

              {/* Optional, and labelled as optional rather than starred --
                  see contactDetails.ts: phone is still the only thing anyone
                  signs in with, and nothing here is ever verified. */}
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.emailOptionalLabel')}
              </Text>
              <TextInput
                value={signupEmail}
                onChangeText={setSignupEmail}
                editable={!loading}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  isRTL && styles.rtl,
                  showSignupErrors && !emailFieldOk(signupEmail) && styles.inputInvalid,
                ]}
              />
              <Text style={[styles.hint, isRTL && styles.rtl]}>{t('auth.emailWhy')}</Text>

              {/* Read-only on purpose. The number was entered and checked on
                  the previous step, and that check is what decided this is a
                  signup at all -- letting it be edited here would mean the
                  form could be submitted for a number nobody ever looked up. */}
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.mobileLabel')}
              </Text>
              <View style={[styles.readonlyRow, mirrorRow(isRTL)]}>
                <Text style={styles.readonlyValue}>{checkedPhone}</Text>
                {/* disabled while sending: without it, tapping this during
                    an in-flight OTP send lands on the phone step and is then
                    yanked onto the OTP screen by the send's own success
                    handler, for a number being changed. */}
                <Pressy
                  onPress={() => { setStep('phone'); setError(null); }}
                  disabled={loading}
                  style={styles.inlineLinkBtn}
                >
                  <Text style={styles.inlineLinkText}>{t('common.change')}</Text>
                </Pressy>
              </View>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.whatsappOptionalLabel')}
              </Text>
              <TextInput
                value={whatsappSameAsMobile ? checkedPhone : signupWhatsapp}
                onChangeText={(v) => {
                  setSignupWhatsapp(v);
                  // Consent belongs to a NUMBER, not to a checkbox. Editing
                  // the number withdraws it, so a box ticked for one number
                  // can never carry over to a different one -- which is
                  // otherwise easy to do without noticing, because the
                  // consent row unmounts while the field is empty and comes
                  // back still ticked.
                  setWhatsappOptIn(false);
                }}
                onFocus={() => {
                  if (!signupWhatsapp) setSignupWhatsapp(DEFAULT_DIAL_PREFIX);
                }}
                editable={!whatsappSameAsMobile && !loading}
                placeholder={t('auth.phonePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={[
                  styles.input,
                  isRTL && styles.rtl,
                  whatsappSameAsMobile && styles.inputDisabled,
                  showSignupErrors && whatsappFieldBad && styles.inputInvalid,
                ]}
              />
              <View style={[styles.checkRow, mirrorRow(isRTL)]}>
                <Pressy
                  onPress={() => {
                    // The typed number is deliberately left alone: the value
                    // expression above already shows the mobile while this is
                    // on, so unticking simply hands back what they typed
                    // rather than an empty field they have to redo.
                    setWhatsappSameAsMobile((v) => !v);
                    setWhatsappOptIn(false);
                  }}
                  disabled={loading}
                  style={styles.checkboxHit}
                >
                  <View style={[styles.checkbox, whatsappSameAsMobile && styles.checkboxChecked]}>
                    {whatsappSameAsMobile && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                  </View>
                </Pressy>
                <Text style={[styles.checkText, isRTL && styles.rtl]}>{t('auth.whatsappSameAsMobile')}</Text>
              </View>

              {/* Only offered once there is a number for it to be about. A
                  consent checkbox floating above an empty field is a promise
                  about nothing. */}
              {!!effectiveWhatsapp && (
                <View style={[styles.checkRow, mirrorRow(isRTL)]}>
                  <Pressy onPress={() => setWhatsappOptIn((v) => !v)} disabled={loading} style={styles.checkboxHit}>
                    <View style={[styles.checkbox, whatsappOptIn && styles.checkboxChecked]}>
                      {whatsappOptIn && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                    </View>
                  </Pressy>
                  <Text style={[styles.checkText, isRTL && styles.rtl]}>{t('auth.whatsappOptIn')}</Text>
                </View>
              )}

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.newPasswordLabel')}
              </Text>
              <View
                style={[
                  styles.inputRow,
                  mirrorRow(isRTL),
                  showSignupErrors && signupPassword.length < 6 && styles.inputInvalid,
                ]}
              >
                <TextInput
                  value={signupPassword}
                  onChangeText={setSignupPassword}
                  editable={!loading}
                  placeholder="••••••••"
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry={!revealSignupPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.inputInRow, isRTL && styles.rtl]}
                />
                <Pressy onPress={() => setRevealSignupPassword((v) => !v)} style={styles.revealBtn}>
                  <Icon name={revealSignupPassword ? 'eyeOff' : 'eye'} size={17} color={colors.inkSoft} />
                </Pressy>
              </View>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.confirmPasswordLabel')}
              </Text>
              <View
                style={[
                  styles.inputRow,
                  mirrorRow(isRTL),
                  showSignupErrors && signupPassword !== signupPasswordConfirm && styles.inputInvalid,
                ]}
              >
                <TextInput
                  value={signupPasswordConfirm}
                  onChangeText={setSignupPasswordConfirm}
                  editable={!loading}
                  placeholder="••••••••"
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry={!revealSignupPasswordConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.inputInRow, isRTL && styles.rtl]}
                />
                <Pressy onPress={() => setRevealSignupPasswordConfirm((v) => !v)} style={styles.revealBtn}>
                  <Icon name={revealSignupPasswordConfirm ? 'eyeOff' : 'eye'} size={17} color={colors.inkSoft} />
                </Pressy>
              </View>

              {/* Moved here from the old post-verification 'name' step, which
                  is where it used to live -- agreeing to the terms belongs on
                  the form that creates the account, not on a screen after the
                  account already exists. That step keeps its own copy for the
                  cases it still catches; both drive this same flag. */}
              <View style={[styles.termsRow, mirrorRow(isRTL)]}>
                <Pressy onPress={() => setAgreedToTerms((v) => !v)} disabled={loading} style={styles.checkboxHit}>
                  <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                    {agreedToTerms && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                  </View>
                </Pressy>
                <Text style={[styles.termsText, isRTL && styles.rtl]}>
                  {t('auth.agreeToPrefix')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('terms', language)}>{t('nav.termsOfUse')}</Text>
                  {' '}{t('auth.agreeToAnd')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('privacy', language)}>{t('nav.privacyPolicy')}</Text>
                </Text>
              </View>

              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}
              <Text style={[styles.hint, isRTL && styles.rtl]}>{t('auth.signupVerifyNote')}</Text>
              {/* Neither button is disabled on an incomplete form any more.
                  A dead button tells you nothing about WHICH field it is
                  waiting on; sendSignupOtp validates and names the problem. */}
              <Button
                label={t('auth.sendWhatsapp')}
                onPress={() => sendSignupOtp('whatsapp')}
                loading={loading}
                style={{ marginTop: 14 }}
              />
              <Button
                label={t('auth.sendSms')}
                onPress={() => sendSignupOtp('sms')}
                loading={loading}
                variant="secondary"
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
              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}
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
              <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('auth.nameTitle')}</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t('auth.namePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="words"
                style={[styles.input, isRTL && styles.rtl]}
              />
              <View style={[styles.termsRow, mirrorRow(isRTL)]}>
                <Pressy onPress={() => setAgreedToTerms((v) => !v)} style={styles.checkboxHit}>
                  <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                    {agreedToTerms && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                  </View>
                </Pressy>
                {/* The Terms/Privacy substrings are their own nested <Text onPress>
                    so tapping a link opens that page without also toggling the
                    checkbox -- this outer Text carries no onPress of its own,
                    so there's no handler for a link tap to conflict with. */}
                <Text style={[styles.termsText, isRTL && styles.rtl]}>
                  {t('auth.agreeToPrefix')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('terms', language)}>{t('nav.termsOfUse')}</Text>
                  {' '}{t('auth.agreeToAnd')}{' '}
                  <Text style={styles.termsLink} onPress={() => openLegalPage('privacy', language)}>{t('nav.privacyPolicy')}</Text>
                </Text>
              </View>
              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 40 },
  subtitle: { ...type.soft, marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  fieldLabelSpaced: { marginTop: 14 },
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
  // The red border the required fields take on after a failed submit.
  inputInvalid: { borderColor: colors.danger },
  inputDisabled: { backgroundColor: colors.surface, color: colors.inkSoft },
  // A bordered box holding a text field plus its show/hide eye. The border
  // lives on this row rather than on the TextInput inside it, so the toggle
  // sits inside the same outline instead of beside it.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  inputInRow: { flex: 1, height: '100%', fontSize: 16, color: colors.ink },
  // No directional margin anywhere in these rows: mirrorRow flips the row on
  // native for Arabic, but marginStart/End still resolve against
  // I18nManager.isRTL, which this app never flips -- so a directional outdent
  // points the wrong way in exactly the layout it was added for.
  revealBtn: { padding: 6 },
  readonlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  // writingDirection 'ltr' because this is the one place in the flow where
  // the user is asked to CHECK their number, and a bare E.164 string in an
  // RTL paragraph renders its neutral leading '+' at the wrong end --
  // "+96170123456" reads back as "96170123456+".
  readonlyValue: { fontSize: 16, color: colors.ink, writingDirection: 'ltr' },
  inlineLinkBtn: { padding: 4 },
  inlineLinkText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  hint: { ...type.tiny, marginTop: 6, lineHeight: 16 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  checkText: { flex: 1, fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  rtl: { textAlign: 'right' },
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
