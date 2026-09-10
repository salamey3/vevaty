import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TextInput, KeyboardAvoidingView, ScrollView } from 'react-native';
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
  ensureSession,
} from '../lib/supabase';
import { emailFieldOk, normalizeEmail } from '../lib/contactDetails';
import { mirrorRow } from '../lib/mirrorRow';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { openLegalPage } from '../lib/legalLinks';
import {
  checkTesterInvite,
  fetchRegistrationOpen,
  formatInviteCode,
  joinSignupWaitlist,
  normalizeInviteCode,
  redeemTesterInvite,
  testerErrorWord,
} from '../lib/testers';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth'>;

// 'phone': collect a number and find out whether it's registered (no OTP
// sent yet -- see checkPhone()). 'signup': not registered -- create a
// password, then send the OTP. 'signin': registered -- enter the password,
// or fall through to 'forgotPassword' from the link on that same step.
// 'otp' is shared by both the signup and forgot-password sends (see
// otpPurpose); 'setNewPassword' follows a forgot-password OTP (and is also
// where a pre-password account sets one for the very first time -- see
// setAccountPassword's own comment in lib/supabase.ts).
// 'invite': the number is not registered and sign-up is invite-only right
// now (the tester round, see TESTERS.md) -- enter a code, or leave the number
// on the waitlist. Sits between 'phone' and 'signup'; nothing is sent from it.
type Step = 'phone' | 'invite' | 'signup' | 'signin' | 'otp' | 'setNewPassword' | 'name';

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
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(DEFAULT_DIAL_PREFIX);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
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
  // Members only. The admin sign-in used to live here too, behind a "Sign
  // in as admin instead" link every visitor could see; it is the admin
  // panel's own page now (AdminGateScreen, vevaty.com/control-room), and in
  // the app an admin account reaches it from Profile -- see ACCOUNTS.md.

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

  // ---- The tester round's invite step (TESTERS.md) ----
  const { refreshTesterStatus } = useAppStore();
  // The code a website invite link carried in (/login?invite=CODE), or one
  // typed on the invite step or the repair step. Kept across a change of
  // number: it belongs to the person, not to the number they typed first.
  const [inviteCode, setInviteCode] = useState(() => normalizeInviteCode(route.params?.invite ?? ''));
  // The code the invite step confirmed, normalised. Set only by checkInvite,
  // cleared the moment the box is edited again.
  const [inviteChecked, setInviteChecked] = useState('');
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  // The server refused to make this verified account a member for want of
  // an invite (VV002): sign-up was shut between the phone step and the text
  // message, or the code was cancelled in that gap. The repair step then
  // asks for a code, instead of failing the same way every time Finish is
  // pressed. A ref as well as state for the same reason as
  // profileWritePendingRef: afterAuthenticated reads it in the same tick.
  const [inviteRequired, setInviteRequired] = useState(false);
  const inviteRequiredRef = useRef(false);
  // While sign-up is OPEN the invite step never appears, so the form carries
  // an optional code box of its own -- otherwise a tester who types their
  // code in the app (links only reach the website) would have nowhere to
  // put it, and would sign up as an ordinary member with no tester tag.
  const [showInviteField, setShowInviteField] = useState(false);
  // The code in that box was checked and refused.
  const [inviteFieldBad, setInviteFieldBad] = useState(false);
  // Bumped whenever the person walks away from a step -- back, close, or
  // the screen unmounting (Android's hardware back pops it without going
  // through either). A check still in flight compares its own copy before
  // it acts, so leaving mid-check neither spends a text message on a
  // number being abandoned nor yanks the person onto a step they left.
  const navEpochRef = useRef(0);
  useEffect(() => () => { navEpochRef.current += 1; }, []);

  // The invite this sign-up holds: the one the invite step confirmed, else
  // whatever a link or the repair step put in the box.
  const heldInvite = () => inviteChecked || normalizeInviteCode(inviteCode);

  // Claims it for the session that has just been authenticated. On a
  // sign-up this has to happen BEFORE the profile write, which is where the
  // server checks for a claimed invite while sign-up is invite-only; it is
  // also how someone who already has an account, and opens an invite link
  // and signs in, gets tagged. Never thrown: the profile write that follows
  // is what knows whether a failed claim mattered.
  //
  // Tried twice: a dropped connection at this exact moment would otherwise
  // cost a tester their tag, or -- while sign-up is shut -- leave the
  // profile write below to be refused for want of an invite.
  const claimHeldInvite = async (): Promise<'none' | 'claimed' | 'refused' | 'failed'> => {
    const code = heldInvite();
    if (!code) return 'none';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const roles = await redeemTesterInvite(code);
        if (roles) return 'claimed';
        // null is the server's "no": the code was used by somebody else or
        // cancelled after it was checked on this screen.
        console.warn('[Auth] invite not claimed: the code was refused');
        return 'refused';
      } catch (e: any) {
        console.warn('[Auth] invite claim failed:', e?.message || e);
      }
    }
    return 'failed';
  };

  // Opened straight from an invite link, this screen can be the only one on
  // the stack, where goBack() does nothing at all -- a brand-new tester would
  // finish signing up and stay parked on this screen. Home instead.
  const leaveScreen = () => {
    navEpochRef.current += 1;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  const finishAndLeave = () => {
    const { returnTo, returnToParams } = route.params || {};
    if (returnTo) navigation.replace(returnTo as any, returnToParams);
    else leaveScreen();
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
    // A sign-up has already claimed its code before the profile write; this
    // is for an existing member who came in through an invite link. Then
    // the tester status is re-read, because the one read at launch was for
    // the anonymous session this sign-in has just replaced.
    const claim = await claimHeldInvite();
    // An account that already existed but never became a member (its
    // sign-up was refused for want of an invite) is let in by the claim
    // just made -- and nothing else would ask for that until the next
    // launch: AppStore's repair runs as this session starts, which can be
    // before the claim lands. Harmless for a member, whom the server never
    // re-examines. The phone comes from the session, never from state.
    if (claim === 'claimed') {
      const authPhone = data.session?.user?.phone;
      try {
        await upsertOwnProfile({
          isPhoneVerified: true,
          ...(authPhone ? { phone: '+' + authPhone.replace(/^\+/, '') } : {}),
        });
        // A sign-up refused for want of an invite has one now. The repair
        // step below may still be needed for the rest of the details, but
        // not to say "this account has no invite".
        inviteRequiredRef.current = false;
      } catch (e: any) {
        console.warn('[Auth] membership after claim refused:', e?.code || '', e?.message || e);
      }
    }
    void refreshTesterStatus();
    // Checked before the read, not after it -- see profileWritePendingRef.
    // Every route that ends up here after a failed profile write lands on
    // the repair step, including the one that got there via a failed
    // password attach, which used to slip past this entirely.
    if (profileWritePendingRef.current) {
      if (inviteRequiredRef.current) {
        setInviteRequired(true);
        setError(t('auth.inviteNeededAfterVerify'));
      } else {
        setError(t('auth.detailsSaveFailed'));
      }
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
    const epoch = navEpochRef.current;
    try {
      // Whether sign-up is open is read fresh here, with the registration
      // check, rather than trusted from launch: getting it wrong in the
      // "open" direction sends a paid text message for an account the server
      // will then refuse to make a member (see fetchRegistrationOpen).
      //
      // A code confirmed earlier on this screen, or carried in by a link, is
      // checked again with them: it may have been used or cancelled since,
      // and a form shown on the strength of a dead code ends in a paid text
      // message the server then refuses. An answer we could not get (null)
      // changes nothing.
      const held = heldInvite();
      const [registered, open, heldValid] = await Promise.all([
        isPhoneRegistered(normalized),
        fetchRegistrationOpen(),
        held ? checkTesterInvite(held).catch(() => null) : Promise.resolve(null),
      ]);
      if (navEpochRef.current !== epoch) return;
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
      setWaitlistJoined(false);
      setInviteRequired(false);
      inviteRequiredRef.current = false;
      // An invite already confirmed on this screen still counts after a
      // change of number -- it is the person's, not the number's. A link's
      // code that checks out counts as confirmed, so a link tester goes
      // straight to the form instead of pressing Continue on a box already
      // filled in for them.
      const invite = heldValid === true ? held : heldValid === false ? '' : inviteChecked;
      setInviteChecked(invite);
      setInviteFieldBad(heldValid === false);
      // A dead code is shown where it can be fixed: in the box on the invite
      // step while sign-up is shut, in the form's own box while it is open.
      if (heldValid === false && !registered && !open) setError(t('auth.inviteInvalid'));
      setStep(registered ? 'signin' : open || invite ? 'signup' : 'invite');
    } catch (e: any) {
      if (navEpochRef.current === epoch) setError(t('auth.phoneCheckFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 'invite' step's Continue. Nothing is sent to the phone from here: the
  // code is checked first, so an invalid one costs nothing.
  const checkInvite = async () => {
    const code = normalizeInviteCode(inviteCode);
    if (code.length < 4) {
      setError(t('auth.inviteInvalid'));
      return;
    }
    setLoading(true);
    setError(null);
    const epoch = navEpochRef.current;
    try {
      const valid = await checkTesterInvite(code);
      if (navEpochRef.current !== epoch) return;
      if (!valid) {
        setError(t('auth.inviteInvalid'));
        return;
      }
      setInviteChecked(code);
      setStep('signup');
    } catch {
      if (navEpochRef.current === epoch) setError(t('auth.inviteCheckFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 'invite' step's "Tell me when it opens". Every answer gets its own
  // outcome; none of them is a silent "done".
  const joinWaitlist = async () => {
    setLoading(true);
    setError(null);
    const epoch = navEpochRef.current;
    try {
      let outcome = await joinSignupWaitlist(checkedPhone, language);
      // No session at all: the anonymous sign-in at launch never happened,
      // usually because the app opened offline. Nothing else on this screen
      // would ever make one, so retrying as-is could never work.
      if (outcome === 'no_session') {
        await ensureSession();
        outcome = await joinSignupWaitlist(checkedPhone, language);
      }
      if (navEpochRef.current !== epoch) return;
      if (outcome === 'ok') setWaitlistJoined(true);
      // Sign-up opened while they were reading this screen: nothing to wait for.
      else if (outcome === 'open') setStep('signup');
      // Registered moments ago, on another device or tab.
      else if (outcome === 'already_member') setStep('signin');
      else if (outcome === 'too_many') setError(t('auth.waitlistTooMany'));
      // Still no session after trying to make one: a connection problem,
      // not a bad number.
      else if (outcome === 'no_session') setError(t('auth.waitlistFailed'));
      else setError(t('auth.invalidPhone'));
    } catch {
      if (navEpochRef.current === epoch) setError(t('auth.waitlistFailed'));
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
    const epoch = navEpochRef.current;
    try {
      // Asked once more, right before the text message -- the step that
      // costs money. Sign-up can have been shut, or the code used or
      // cancelled, while this form was being filled in, and the server
      // would then verify the number and refuse to make it a member.
      const held = heldInvite();
      let open: boolean;
      let heldValid: boolean | null;
      try {
        [open, heldValid] = await Promise.all([
          fetchRegistrationOpen(),
          held ? checkTesterInvite(held) : Promise.resolve(null),
        ]);
      } catch {
        if (navEpochRef.current === epoch) setError(t('auth.sendFailed'));
        return;
      }
      // Walked away while that was being asked: send nothing.
      if (navEpochRef.current !== epoch) return;
      if (heldValid === false) {
        setInviteChecked('');
        setError(t('auth.inviteInvalid'));
        if (open) {
          // Open: the code only decides whether this is a tester account, so
          // it is theirs to fix or clear, in the box on this form.
          setInviteFieldBad(true);
          setShowInviteField(true);
        } else {
          setStep('invite');
        }
        return;
      }
      if (!open && heldValid !== true) {
        setError(t('auth.inviteClosedMeanwhile'));
        setStep('invite');
        return;
      }
      if (heldValid === true) setInviteChecked(held);
      await sendPhoneOtp(checkedPhone, channel);
      // Sent, but they have since left this step -- the text is on its way
      // and cannot be recalled, and pulling them back onto the code screen
      // for a number they walked away from would be worse.
      if (navEpochRef.current !== epoch) return;
      setSentPhone(checkedPhone);
      setOtpPurpose('signup');
      setOtp('');
      setStep('otp');
    } catch (e: any) {
      if (navEpochRef.current !== epoch) return;
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
      // Before the profile write below, which is where the server checks for
      // a claimed invite while sign-up is invite-only.
      await claimHeldInvite();
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
        inviteRequiredRef.current = false;
      } catch (e) {
        profileWritePendingRef.current = true;
        inviteRequiredRef.current = testerErrorWord(e) === 'invite_required';
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
      // The repair step can be where an invite is entered (see
      // inviteRequired), so the claim comes first here too -- and when that
      // is why they are here, a refused code is said out loud rather than
      // left to the profile write, which would only repeat "this account
      // has no invite" with their code sitting in the box.
      const claim = await claimHeldInvite();
      if (inviteRequired && claim === 'refused') {
        setError(t('auth.inviteInvalid'));
        return;
      }
      await upsertOwnProfile({
        phone: sentPhone || undefined,
        fullName: name.trim(),
        isPhoneVerified: true,
        email: normalizeEmail(signupEmail),
        ...(effectiveWhatsapp ? { whatsapp: effectiveWhatsapp, whatsappOptIn } : {}),
      });
      profileWritePendingRef.current = false;
      inviteRequiredRef.current = false;
      setInviteRequired(false);
      void refreshTesterStatus();
      finishAndLeave();
    } catch (e: any) {
      if (testerErrorWord(e) === 'invite_required') {
        inviteRequiredRef.current = true;
        setInviteRequired(true);
        setError(t('auth.inviteNeededAfterVerify'));
      } else {
        // Not "that code didn't work": nothing here checks a text-message
        // code, and on this screen it reads as the invite code being wrong.
        setError(t('auth.finishFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const lockoutSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0;

  const goBack = () => {
    navEpochRef.current += 1;
    if (step === 'phone') {
      leaveScreen();
    } else if (step === 'invite' || step === 'signup' || step === 'signin') {
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
          <Pressy onPress={leaveScreen} style={styles.iconBtn}>
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
          {step === 'phone' && (
            <>
              {/* Arrived through a tester's invite link: say so before anything
                  else, so the phone field reads as the way in rather than a wall. */}
              {!!route.params?.invite && (
                <Text style={[styles.inviteBanner, isRTL && styles.rtl]}>{t('auth.invitedBanner')}</Text>
              )}
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
            </>
          )}

          {step === 'invite' && (
            <>
              <Text style={[styles.inviteTitle, isRTL && styles.rtl]}>{t('auth.inviteTitle')}</Text>
              <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('auth.inviteSubtitle')}</Text>
              <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auth.inviteCodeLabel')}</Text>
              <TextInput
                value={inviteCode}
                onChangeText={(v) => {
                  setInviteCode(v);
                  setInviteChecked('');
                  setError(null);
                }}
                placeholder="ABC 123"
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                style={[styles.input, styles.codeInput]}
              />
              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}
              <Button
                label={t('common.continue')}
                onPress={checkInvite}
                loading={loading}
                disabled={!normalizeInviteCode(inviteCode)}
                style={{ marginTop: 18 }}
              />

              {/* No invite: the waitlist. Their number is already in hand from
                  the phone step, so joining is one tap and nothing is typed
                  twice. Nothing is sent to it now -- see join_signup_waitlist. */}
              <View style={styles.inviteDivider} />
              <Text style={[styles.noInviteTitle, isRTL && styles.rtl]}>{t('auth.noInviteTitle')}</Text>
              {waitlistJoined ? (
                <Text style={[styles.waitlistDone, isRTL && styles.rtl]}>
                  {t('auth.waitlistJoined', { phone: checkedPhone })}
                </Text>
              ) : (
                <>
                  <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('auth.noInviteBody', { phone: checkedPhone })}</Text>
                  <Button label={t('auth.waitlistCta')} variant="secondary" onPress={joinWaitlist} loading={loading} />
                </>
              )}
            </>
          )}

          {step === 'signup' && (
            <>
              <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('auth.signupSubtitle')}</Text>
              {!!inviteChecked && (
                <Text style={[styles.inviteOk, isRTL && styles.rtl]}>
                  {t('auth.inviteAccepted', { code: formatInviteCode(inviteChecked) })}
                </Text>
              )}
              {/* Only reachable while sign-up is open (a shut sign-up comes
                  here with a confirmed code), so it is optional and folded
                  away -- see showInviteField. Opened by itself when a link
                  or an earlier step left a code in it. */}
              {!inviteChecked && (showInviteField || !!inviteCode ? (
                <>
                  <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auth.inviteOptionalLabel')}</Text>
                  <TextInput
                    value={inviteCode}
                    onChangeText={(v) => {
                      setInviteCode(v);
                      // Opened by a code already in it, it would otherwise
                      // fold away -- keyboard and all -- the moment the last
                      // character is deleted to type a new one.
                      setShowInviteField(true);
                      setInviteFieldBad(false);
                      setError(null);
                    }}
                    placeholder="ABC 123"
                    placeholderTextColor={colors.inkSoft}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!loading}
                    style={[styles.input, styles.codeInput, inviteFieldBad && styles.inputInvalid]}
                  />
                  {inviteFieldBad && <Text style={[styles.error, isRTL && styles.rtl]}>{t('auth.inviteInvalid')}</Text>}
                  <View style={styles.fieldLabelSpaced} />
                </>
              ) : (
                <Pressy onPress={() => setShowInviteField(true)} disabled={loading} style={styles.inviteLinkBtn}>
                  <Text style={[styles.linkText, isRTL && styles.rtl]}>{t('auth.haveInviteLink')}</Text>
                </Pressy>
              ))}

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
              {inviteRequired && (
                <>
                  <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>{t('auth.inviteCodeLabel')}</Text>
                  <TextInput
                    value={inviteCode}
                    onChangeText={(v) => {
                      setInviteCode(v);
                      setInviteChecked('');
                      setError(null);
                    }}
                    placeholder="ABC 123"
                    placeholderTextColor={colors.inkSoft}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={[styles.input, styles.codeInput]}
                  />
                </>
              )}
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
  // The tester round's invite step (see Step's 'invite').
  inviteTitle: { ...type.h2, marginBottom: 8 },
  inviteBanner: { fontSize: 14, fontWeight: '600', color: colors.success, marginBottom: 10 },
  inviteOk: { fontSize: 13, fontWeight: '600', color: colors.success, marginTop: -8, marginBottom: 14 },
  // Full width rather than a pill, so the text can take the reading side in
  // Arabic through textAlign -- native has no ambient direction to do it.
  inviteLinkBtn: { paddingVertical: 6, marginTop: -8, marginBottom: 10 },
  // Six characters read off a message and typed by hand: large, spaced
  // and centred, so a transposed pair is visible before Continue.
  codeInput: { fontSize: 20, letterSpacing: 3, textAlign: 'center', fontWeight: '600' },
  inviteDivider: { height: 1, backgroundColor: colors.line, marginTop: 28, marginBottom: 22 },
  noInviteTitle: { ...type.h3, marginBottom: 6 },
  waitlistDone: { ...type.body, color: colors.success },
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
});
