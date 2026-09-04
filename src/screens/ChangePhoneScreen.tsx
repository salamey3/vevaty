import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, KeyboardAvoidingView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import { supabase, normalizePhone, sendPhoneChangeOtp, verifyPhoneChangeOtp, upsertOwnProfile } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePhone'>;

type Step = 'newPhone' | 'otp';

// Reached from ProfileScreen (only shown to verified users -- there's no
// "change number" concept for an anonymous session). Swaps the CURRENT
// account's phone number via Supabase's phone_change OTP flow (see
// sendPhoneChangeOtp/verifyPhoneChangeOtp's own comments for why that's a
// different primitive from AuthScreen's sign-in one) -- same uid, same
// listings/favorites/chat history throughout, just a new verified number.
export default function ChangePhoneScreen({ navigation }: Props) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('newPhone');
  const [phone, setPhone] = useState('+961');
  const [sentPhone, setSentPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Not an error -- the number change itself succeeded. This is the one
  // half that didn't stick, shown on the success screen so the seller can
  // act on it instead of leaving with a public contact number that is no
  // longer theirs.
  const [profileWarning, setProfileWarning] = useState<string | null>(null);

  const sendCode = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError(t('auth.invalidPhone'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendPhoneChangeOtp(normalized);
      setSentPhone(normalized);
      setStep('otp');
    } catch (e: any) {
      const msg: string = e?.message || '';
      // Supabase's phone-uniqueness error text varies by version ("phone
      // number already exists"/"already registered"/etc.) -- pattern-match
      // rather than a single exact string, same spirit as AuthScreen's
      // "not enabled" detection right below it.
      if (/already|exists|registered|taken/i.test(msg)) {
        setError(t('changePhone.numberTaken'));
      } else if (/not enabled|provider|unsupported/i.test(msg)) {
        setError(t('auth.notConfiguredYet'));
      } else {
        setError(t('auth.sendFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (otp.trim().length < 4) return;
    setLoading(true);
    setError(null);
    let uid: string | null = null;
    try {
      const session = await verifyPhoneChangeOtp(sentPhone, otp.trim());
      uid = session?.user?.id ?? null;
      if (!uid) throw new Error('No session after verification');
    } catch (e: any) {
      const msg: string = e?.message || '';
      if (/already|exists|registered|taken/i.test(msg)) {
        setError(t('changePhone.numberTaken'));
      } else {
        setError(t('auth.verifyFailed'));
      }
      setLoading(false);
      return;
    }

    // PAST THE POINT OF NO RETURN. The OTP is spent, auth.users.phone has
    // moved, and the seller's sign-in number IS the new one -- so this
    // screen says "done" from here on whatever else happens. That is the
    // entire reason for the second try block rather than one big one:
    // anything thrown below used to land in the verify catch and put
    // "verification failed" on screen for a change that had definitely
    // succeeded, sending the seller back to request another code for a
    // number they are already on. It was not enough to move the
    // `setDone(true)` -- the throw has to be caught somewhere that cannot
    // reach the verification message at all.
    setDone(true);
    setLoading(false);

    // Keeps the denormalized profiles.phone copy in sync with
    // auth.users.phone. If this copy does not move, the seller reads
    // "Phone changed" while every buyer who taps Show number still gets
    // the old one, because get_seller_contact reads this column and not
    // auth.users.
    //
    // Checked with `.select()`, not fired blind: an `.update().eq()` that
    // matches no row returns error: null (@AGENTS.md), so the error check
    // alone would not have caught it.
    //
    // On failure it goes through upsert_own_profile before giving up --
    // the SECURITY DEFINER RPC AuthScreen's verifyCode uses, which exists
    // precisely because a client-side write to profiles is the one that
    // silently never persisted (see its comment in lib/supabase.ts). That
    // is worth a second attempt here because no screen in this app writes
    // profiles.phone: if both fail there is nothing the seller can do
    // about it themselves, which is why the message they get says to
    // start the change again rather than sending them to a Save button
    // that does not touch this column.
    let phoneSaved = false;
    try {
      const { data: phoneRows, error: phoneError } = await supabase
        .from('profiles').update({ phone: sentPhone }).eq('id', uid).select('id');
      if (phoneError || !phoneRows || phoneRows.length === 0) {
        console.warn('[ChangePhone] profiles.phone not updated:', phoneError?.message || 'no row matched');
      } else {
        phoneSaved = true;
      }
    } catch (e: any) {
      console.warn('[ChangePhone] profiles.phone update threw:', e?.message || e);
    }
    if (!phoneSaved) {
      try {
        await upsertOwnProfile({ phone: sentPhone, isPhoneVerified: true });
        phoneSaved = true;
      } catch (e: any) {
        console.warn('[ChangePhone] upsert_own_profile also failed:', e?.message || e);
      }
    }
    if (!phoneSaved) setProfileWarning(t('changePhone.profileNotUpdated'));
  };

  if (done) {
    return (
      <Screen maxWidth={480}>
        <View style={styles.topBar}>
          <View style={styles.iconBtn} />
          <Text style={type.h3}>{t('changePhone.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>
        <View style={styles.body}>
          <View style={styles.successIcon}>
            <Icon name="checkCircle" size={28} color={colors.success} />
          </View>
          <Text style={[type.h3, { textAlign: 'center', marginTop: 14 }]}>{t('changePhone.successTitle')}</Text>
          <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 6 }]}>
            {t('changePhone.successBody', { phone: sentPhone })}
          </Text>
          {!!profileWarning && (
            <Text style={[styles.error, { textAlign: 'center', marginTop: 10 }]}>{profileWarning}</Text>
          )}
          <Button label={t('common.done')} onPress={() => navigation.goBack()} style={{ marginTop: 22 }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressy
            onPress={() => (step === 'otp' ? setStep('newPhone') : navigation.goBack())}
            style={styles.iconBtn}
          >
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('changePhone.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <View style={styles.body}>
          {step === 'newPhone' && (
            <>
              <Text style={styles.subtitle}>{t('changePhone.subtitle')}</Text>
              <Text style={styles.fieldLabel}>{t('changePhone.newNumberLabel')}</Text>
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
              <Button label={t('changePhone.sendCode')} onPress={sendCode} loading={loading} style={{ marginTop: 18 }} />
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
              <Pressy onPress={() => { setStep('newPhone'); setError(null); }} style={styles.linkBtn}>
                <Text style={styles.linkText}>{t('auth.changeNumber')}</Text>
              </Pressy>
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
  successIcon: {
    alignSelf: 'center', width: 56, height: 56, borderRadius: 28, marginTop: 24,
    backgroundColor: '#e3efe8', alignItems: 'center', justifyContent: 'center',
  },
});
