import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, KeyboardAvoidingView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { isAuthWeakPasswordError } from '@supabase/supabase-js';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import {
  supabase,
  getOwnAuthIdentity,
  sendPhoneOtp,
  verifyPhoneOtp,
  setAccountPassword,
  verifyTotpStepUp,
} from '../lib/supabase';
import { mirrorRow } from '../lib/mirrorRow';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { useSettings } from '../store/SettingsStore';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;

type Step = 'choose' | 'otp' | 'mfa' | 'newPassword';
type Channel = 'sms' | 'whatsapp';

// Two whole minutes, not the thirty seconds a resend button usually gets.
// Every press of one of these buttons is a real message with a real price
// on it, and the only thing a second one does that the first didn't is
// cost that again -- Twilio's own code is already on its way.
const RESEND_COOLDOWN_MS = 120_000;

// Module scope, deliberately, and not component state. This screen is a
// stack modal: closing it unmounts, and a cost guard that forgets itself
// every time the sheet is dismissed is not a guard at all -- close,
// reopen, send again, twice the money, three seconds apart. Living out
// here it survives the remount and only resets on a cold start, where
// Supabase's own per-number OTP limit takes over.
let lastOtpSentAt = 0;
let lastOtpChannel: Channel = 'whatsapp';

// "Change your password" from ProfileScreen's Edit-your-profile menu --
// the logged-in half of the pair whose logged-out half is AuthScreen's
// forgot-password path. Both end in the same place (setAccountPassword)
// and both insist on a fresh OTP first; the difference is only where the
// number comes from, which on this screen is the session itself rather
// than something typed.
//
// Why an OTP at all, when the person is demonstrably already signed in:
// a session on this device is evidence about the DEVICE, and it can be
// months old. The code proves the phone is in the hand of whoever is
// about to change the credential, right now. It is deliberately NOT
// paired with a "current password" field -- anyone who has this screen
// open can reach the same account through sign-out plus forgot-password,
// which sends to the very same number, so asking for the old password
// would add a step that stops nobody and locks out the one person with a
// legitimate reason to be here: someone who has forgotten it.
export default function ChangePasswordScreen({ navigation }: Props) {
  const { t, isRTL } = useLanguage();
  // The repo's ONE rule for picking which authenticator to challenge --
  // pinned factor first, because "the first verified one" could be an
  // intruder's. Borrowed rather than re-derived: a second copy of that
  // choice is exactly the kind of drift this codebase has paid for before.
  const { getVerifiedTotpFactorId } = useSettings();
  const [step, setStep] = useState<Step>('choose');
  // Read once on mount, from auth.users and never from profiles -- see
  // getOwnAuthIdentity's comment for why that distinction is the whole
  // safety of this screen. Held for the length of the flow so the uid can
  // be compared against the one verification comes back with.
  const [identity, setIdentity] = useState<{ uid: string; phone: string } | null>(null);
  // Three states, not two. `null` means "still looking"; an identity means
  // ready; and `identityFailed` distinguishes "this account genuinely has
  // no phone" (a dead end worth explaining) from "the /user call did not
  // come back" (a bad minute on a Lebanese mobile link, worth a retry
  // button). Collapsing those two told sellers their own number did not
  // exist.
  const [identityFailed, setIdentityFailed] = useState<'noPhone' | 'lookup' | null>(null);
  const [otp, setOtp] = useState('');
  // Set only when the account has a verified authenticator and the session
  // the OTP just minted is therefore too weak to change a password with.
  const [totpFactorId, setTotpFactorId] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  // The server's own sentence, kept beside the translated one whenever
  // nothing above matched it. Three password attempts were spent against a
  // bare "Could not save the new password" that named neither the rule that
  // refused them nor the fact that the refusal was a 401 about two-factor
  // and had nothing to do with the password at all. A handler that cannot
  // classify an error must not also hide it.
  const [serverDetail, setServerDetail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(lastOtpSentAt);
  const [channel, setChannel] = useState<Channel>(lastOtpChannel);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(false);

  const loadIdentity = useCallback(() => {
    setIdentity(null);
    setIdentityFailed(null);
    getOwnAuthIdentity()
      .then((id) => {
        if (id) setIdentity(id);
        else setIdentityFailed('noPhone');
      })
      .catch(() => setIdentityFailed('lookup'));
  }, []);

  useEffect(loadIdentity, [loadIdentity]);

  const cooldownLeft = Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - now) / 1000));
  // Deps are [sentAt] and deliberately NOT [sentAt, now]: `now` changes on
  // every tick, so including it would tear this effect down and rebuild it
  // once a second -- and the rebuild would happen immediately after the
  // clearInterval below, handing back a fresh interval that ticks forever.
  // The self-stop only works if the effect is created once per send.
  useEffect(() => {
    if (!sentAt) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      // Stops itself at the end of the cooldown rather than re-rendering
      // this screen once a second for as long as it stays open.
      if (n >= sentAt + RESEND_COOLDOWN_MS) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const sendCode = async (which: Channel) => {
    if (!identity || cooldownLeft > 0) return;
    setLoading(true);
    setError(null);
    try {
      await sendPhoneOtp(identity.phone, which);
      const at = Date.now();
      lastOtpSentAt = at;
      lastOtpChannel = which;
      setSentAt(at);
      setNow(at);
      setChannel(which);
      setOtp('');
      setStep('otp');
    } catch (e: any) {
      const msg: string = e?.message || '';
      // The cooldown above is this app's own, and deliberately stricter
      // than Supabase's. If the project's OTP rate limit is ever set
      // LONGER than RESEND_COOLDOWN_MS, the button re-enables while the
      // server is still refusing -- and "could not send the code, please
      // try again" would have someone tapping it in a loop. Say what is
      // actually happening.
      if (/rate|limit|too many|only request|after \d+ seconds/i.test(msg)) setError(t('changePassword.tooSoon'));
      else if (/not enabled|provider|unsupported/i.test(msg)) setError(t('auth.notConfiguredYet'));
      else setError(t('auth.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!identity || otp.trim().length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const session = await verifyPhoneOtp(identity.phone, otp.trim());
      const uid = session?.user?.id;
      if (!uid) throw new Error('No session after verification');
      // The assertion getOwnAuthIdentity exists to make possible. A code
      // sent to this account's own number can only ever verify back into
      // this account, so a mismatch here means a premise broke -- and the
      // very next thing this screen would otherwise do is write a password
      // onto whatever account the session now holds.
      //
      // Stopping is not enough on its own. verifyOtp has ALREADY saved the
      // stranger's session and fired SIGNED_IN, so AppStore has resynced
      // the whole app onto their profile, listings and shop, and that
      // session would survive a restart. Telling someone "nothing was
      // changed" over an app that is now logged in as somebody else is a
      // true sentence about a false screen. Sign out, then say it.
      if (uid !== identity.uid) {
        await supabase.auth.signOut().catch(() => {});
        setError(t('changePassword.accountMismatch'));
        return;
      }
      // Straight to the password fields for everyone with no second
      // factor, which is every ordinary member -- nothing in this app
      // enrols one outside the admin panel. Gated on a verified factor
      // EXISTING rather than on the session's cached nextLevel, which is
      // read from the stored JWT and would silently answer "no step-up
      // needed" for any session that arrived without its factor list.
      const factorId = await getVerifiedTotpFactorId().catch(() => null);
      if (factorId) {
        setTotpFactorId(factorId);
        setTotpCode('');
        setStep('mfa');
      } else {
        setStep('newPassword');
      }
    } catch (e: any) {
      setError(t('auth.verifyFailed'));
    } finally {
      setLoading(false);
    }
  };

  const submitTotp = async () => {
    if (!totpFactorId || totpCode.trim().length < 6) return;
    setLoading(true);
    setError(null);
    try {
      await verifyTotpStepUp(totpFactorId, totpCode.trim());
      setStep('newPassword');
    } catch (e: any) {
      // Cleared, not left sitting in the field. The input is maxLength 6
      // and already holds six digits, so every further keystroke is
      // ignored -- the message says "check the current one and try again"
      // over a box that refuses to be typed into, and the enabled Verify
      // button resubmits the same expired code forever.
      setTotpCode('');
      setError(t('changePassword.totpFailed'));
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    // Cleared here, ahead of the two client-side returns below. Left until
    // after them, a server sentence from the PREVIOUS attempt stayed on
    // screen underneath "Password must be at least 6 characters" -- an
    // unrelated refusal presented as the detail of a length check.
    setServerDetail(null);
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
      // Cleared before the success screen renders rather than left in
      // state behind it -- this screen stays mounted until the stack pops.
      setNewPassword('');
      setNewPasswordConfirm('');
      setOtp('');
      setDone(true);
    } catch (e: any) {
      const msg: string = e?.message || '';
      const code: string = e?.code || '';
      // The server's own sentence, kept alongside whatever this handler
      // decides to say. Set on EVERY branch that guesses from message
      // text, and withheld only where the error was typed and therefore
      // actually known -- a regex that matches the wrong rule would
      // otherwise produce a confident, wrong instruction with the one
      // accurate sentence thrown away, which is the exact failure this
      // whole block exists to stop. Capped because auth-js falls back to
      // JSON.stringify for an unexpected body shape.
      const detail = msg ? msg.slice(0, 300) : null;

      // The 401 that has nothing to do with the password. Reachable even
      // with the mfa step in place: the factor lookup after the OTP is
      // allowed to fail soft, and a step-up can expire. Routed BACK to the
      // step that fixes it rather than told to start over -- starting over
      // means closing a modal whose send buttons are inside a two-minute
      // cooldown, holding an OTP that has already been spent.
      if (code === 'insufficient_aal' || /aal2|assurance level/i.test(msg)) {
        const factorId = totpFactorId ?? (await getVerifiedTotpFactorId().catch(() => null));
        if (factorId) {
          setTotpFactorId(factorId);
          setTotpCode('');
          setError(null);
          setStep('mfa');
        } else {
          setError(t('changePassword.needsMfa'));
          setServerDetail(detail);
        }
        return;
      }
      // The typed error FIRST. GoTrue returns the same code
      // (`weak_password`) whether the password was too short, missing a
      // character class, or found in HaveIBeenPwned -- the only thing that
      // separates them is the `reasons` array, and the word "pwned"
      // appears there and nowhere in the human-readable text.
      if (isAuthWeakPasswordError(e)) {
        if (e.reasons?.includes('pwned')) setError(t('changePassword.leakedPassword'));
        else if (e.reasons?.includes('characters')) setError(t('changePassword.needsCharacters'));
        else setError(t('changePassword.weakPassword'));
        return;
      }
      // ...and the message SECOND, because the typed error is not
      // guaranteed. The required-characters refusal observed in this
      // project's own auth log came back as a bare 422 carrying only a
      // sentence, with no code for the client to key off, so
      // isAuthWeakPasswordError was false and it fell through everything.
      // Every branch below is a guess, so every branch below keeps the
      // sentence it guessed from.
      setServerDetail(detail);
      if (/pwned|leaked|breach|known to be weak/i.test(msg)) setError(t('changePassword.leakedPassword'));
      else if (/at least one character|character of each/i.test(msg)) setError(t('changePassword.needsCharacters'));
      else if (/at least \d+ characters|too short/i.test(msg)) setError(t('changePassword.weakPassword'));
      else if (/different from the old|should be different/i.test(msg)) setError(t('changePassword.samePassword'));
      else setError(t('changePassword.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const topBar = (leading: React.ReactNode) => (
    <View style={styles.topBar}>
      {leading}
      <Text style={type.h3}>{t('changePassword.title')}</Text>
      <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
        <Icon name="close" size={18} />
      </Pressy>
    </View>
  );

  if (done) {
    return (
      <Screen maxWidth={480}>
        {topBar(<View style={styles.iconBtn} />)}
        <View style={styles.body}>
          <View style={styles.successIcon}>
            <Icon name="checkCircle" size={28} color={colors.success} />
          </View>
          <Text style={[type.h3, { textAlign: 'center', marginTop: 14 }]}>{t('changePassword.successTitle')}</Text>
          <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 6 }]}>
            {t('changePassword.successBody')}
          </Text>
          <Button label={t('common.done')} onPress={() => navigation.goBack()} style={{ marginTop: 22 }} />
        </View>
      </Screen>
    );
  }

  if (identityFailed) {
    return (
      <Screen maxWidth={480}>
        {topBar(<View style={styles.iconBtn} />)}
        <View style={styles.body}>
          <Text style={styles.subtitle}>
            {t(identityFailed === 'noPhone' ? 'changePassword.noPhone' : 'changePassword.lookupFailed')}
          </Text>
          {identityFailed === 'lookup' ? (
            <Button label={t('common.retry')} onPress={loadIdentity} style={{ marginTop: 18 }} />
          ) : (
            <Button label={t('common.done')} onPress={() => navigation.goBack()} style={{ marginTop: 18 }} />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {/* No way back from 'mfa' or 'newPassword'. The code that got here
            has already been spent, so a back arrow would land on an OTP
            field that can only ever reject what is typed into it -- a dead
            end dressed up as a step. From there the only honest exits are
            forward and Close. */}
        {topBar(
          step === 'newPassword' || step === 'mfa' ? (
            <View style={styles.iconBtn} />
          ) : (
            <Pressy
              onPress={() => {
                setError(null);
                if (step === 'choose') navigation.goBack();
                else setStep('choose');
              }}
              style={styles.iconBtn}
            >
              <Icon name={step === 'choose' ? 'close' : 'back'} size={18} />
            </Pressy>
          )
        )}

        <View style={styles.body}>
          {step === 'choose' && (
            <>
              <Text style={styles.subtitle}>
                {identity ? t('changePassword.subtitle', { phone: identity.phone }) : t('common.loading')}
              </Text>
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.sendWhatsapp')}
                onPress={() => sendCode('whatsapp')}
                loading={loading}
                disabled={!identity || cooldownLeft > 0}
                style={{ marginTop: 18 }}
              />
              <Button
                label={t('auth.sendSms')}
                onPress={() => sendCode('sms')}
                loading={loading}
                disabled={!identity || cooldownLeft > 0}
                variant="secondary"
                style={{ marginTop: 10 }}
              />
              {cooldownLeft > 0 && (
                <Text style={styles.cooldown}>{t('changePassword.cooldown', { n: cooldownLeft })}</Text>
              )}
              {/* The way out of what would otherwise be a two-minute trap:
                  a code has been sent, both send buttons are correctly
                  disabled to stop it being paid for twice, and without
                  this there is no route back to the field it gets typed
                  into. */}
              {sentAt > 0 && (
                <Pressy onPress={() => { setStep('otp'); setError(null); }} style={styles.linkBtn}>
                  <Text style={styles.linkText}>{t('changePassword.haveCode')}</Text>
                </Pressy>
              )}
            </>
          )}

          {step === 'otp' && (
            <>
              <Text style={styles.subtitle}>{t('auth.otpSubtitle', { phone: identity?.phone ?? '' })}</Text>
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
              {/* A resend that actually resends, on the channel the first
                  one went out on. While the cooldown runs it says so
                  instead of pretending to be tappable. */}
              {cooldownLeft > 0 ? (
                <Text style={styles.cooldown}>{t('changePassword.cooldown', { n: cooldownLeft })}</Text>
              ) : (
                <Pressy onPress={() => sendCode(channel)} style={styles.linkBtn}>
                  <Text style={styles.linkText}>{t('changePassword.resend')}</Text>
                </Pressy>
              )}
              <Pressy onPress={() => { setStep('choose'); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('changePassword.otherChannel')}</Text>
              </Pressy>
            </>
          )}

          {/* Only ever seen by an account with an authenticator enrolled,
              which today means the admin. It is not an extra hoop invented
              here: without it Supabase refuses the password change outright
              with a 401 that names two-factor and says nothing about the
              password. */}
          {step === 'mfa' && (
            <>
              <Text style={styles.subtitle}>{t('changePassword.mfaSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('changePassword.mfaLabel')}</Text>
              <TextInput
                value={totpCode}
                onChangeText={setTotpCode}
                editable={!loading}
                placeholder={t('auth.otpPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.input}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={t('auth.verify')}
                onPress={submitTotp}
                loading={loading}
                disabled={totpCode.trim().length < 6}
                style={{ marginTop: 18 }}
              />
            </>
          )}

          {step === 'newPassword' && (
            <>
              <Text style={styles.subtitle}>{t('changePassword.newPasswordSubtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('auth.newPasswordLabel')}</Text>
              <View style={[styles.inputRow, mirrorRow(isRTL)]}>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  editable={!loading}
                  placeholder="••••••••"
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry={!revealPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.inputInRow}
                />
                <Pressy onPress={() => setRevealPassword((v) => !v)} style={styles.revealBtn}>
                  <Icon name={revealPassword ? 'eyeOff' : 'eye'} size={17} color={colors.inkSoft} />
                </Pressy>
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t('auth.confirmPasswordLabel')}</Text>
              <View style={[styles.inputRow, mirrorRow(isRTL)]}>
                <TextInput
                  value={newPasswordConfirm}
                  onChangeText={setNewPasswordConfirm}
                  editable={!loading}
                  placeholder="••••••••"
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry={!revealConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.inputInRow}
                />
                <Pressy onPress={() => setRevealConfirm((v) => !v)} style={styles.revealBtn}>
                  <Icon name={revealConfirm ? 'eyeOff' : 'eye'} size={17} color={colors.inkSoft} />
                </Pressy>
              </View>

              {!!error && <Text style={styles.error}>{error}</Text>}
              {!!serverDetail && <Text style={styles.serverDetail}>{serverDetail}</Text>}
              <Button
                label={t('changePassword.saveCta')}
                onPress={submit}
                loading={loading}
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
  inputInRow: { flex: 1, fontSize: 16, color: colors.ink, height: '100%' },
  // Symmetric padding, not paddingLeft: the row above flips to
  // row-reverse in Arabic, and a physical-left pad would put the gap on
  // the outside of the icon and none between it and the text.
  revealBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
  // Untranslated on purpose: it is the server's own sentence, and
  // paraphrasing it is exactly what hid the real refusal for three tries.
  serverDetail: { color: colors.inkSoft, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
  cooldown: { ...type.tiny, color: colors.inkSoft, textAlign: 'center', marginTop: 14 },
  linkBtn: { alignSelf: 'center', marginTop: 12, padding: 8 },
  linkText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  successIcon: {
    alignSelf: 'center', width: 56, height: 56, borderRadius: 28, marginTop: 24,
    backgroundColor: '#e3efe8', alignItems: 'center', justifyContent: 'center',
  },
});
