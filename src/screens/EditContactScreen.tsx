import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TextInput, KeyboardAvoidingView, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import { getOwnContactDetails, saveOwnContactDetails, normalizePhone } from '../lib/supabase';
import { emailFieldOk, normalizeEmail } from '../lib/contactDetails';
import { mirrorRow } from '../lib/mirrorRow';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'EditContact'>;

// Reached from ProfileScreen's "Edit your profile" menu, next to change name
// / phone / location. It exists because registration collects two fields that
// nothing else in the app could ever change again: an email and a WhatsApp
// number typed once, at signup, by someone who may well have fat-fingered
// either. A field a user can enter but never correct is a defect, not a
// feature.
//
// Unlike its siblings this screen does NOT read from AppStore. Neither value
// is in the store, and deliberately so: both columns are unreadable to the
// client (see getOwnContactDetails' comment for why a SELECT grant on this
// table would publish them to every signed-in user), so they arrive from
// their own RPC and go back out with their own write. Nothing else on screen
// displays them, so there is no store state to keep in sync either.
export default function EditContactScreen({ navigation }: Props) {
  const { t, isRTL } = useLanguage();
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getOwnContactDetails();
        if (cancelled) return;
        // getOwnContactDetails resolves to all-nulls for BOTH "you have no
        // contact details" and "there is no profile row / no session at all".
        // Those are not the same thing, and rendering the second as an empty,
        // editable form tells the user their account holds nothing when we
        // simply failed to look.
        if (!current.loaded) {
          setLoadFailed(true);
          return;
        }
        setEmail(current.email || '');
        setWhatsapp(current.whatsapp || '');
        setOptIn(current.whatsappOptIn);
      } catch {
        // Saving over values that never loaded would silently wipe whatever
        // is really on the account, so the form stays locked instead.
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!emailFieldOk(email)) {
      setError(t('editContact.invalidEmail'));
      return;
    }
    const trimmedWhatsapp = whatsapp.trim();
    const normalizedWhatsapp = trimmedWhatsapp ? normalizePhone(trimmedWhatsapp) : null;
    if (trimmedWhatsapp && !normalizedWhatsapp) {
      setError(t('editContact.invalidWhatsapp'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveOwnContactDetails({
        email: normalizeEmail(email),
        whatsapp: normalizedWhatsapp,
        // Clearing the number clears the consent with it -- leaving a true
        // behind would be consent attached to nothing, ready to attach itself
        // to whatever number gets typed in next.
        whatsappOptIn: !!normalizedWhatsapp && optIn,
      });
      navigation.goBack();
    } catch {
      setError(t('editContact.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('editContact.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.subtitle, isRTL && styles.rtl]}>{t('editContact.subtitle')}</Text>

          {loadFailed ? (
            <Text style={[styles.error, isRTL && styles.rtl]}>{t('editContact.loadFailed')}</Text>
          ) : (
            <>
              <Text style={[styles.fieldLabel, isRTL && styles.rtl]}>{t('auth.emailOptionalLabel')}</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, isRTL && styles.rtl, loading && styles.inputDisabled]}
              />
              <Text style={[styles.hint, isRTL && styles.rtl]}>{t('auth.emailWhy')}</Text>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, isRTL && styles.rtl]}>
                {t('auth.whatsappOptionalLabel')}
              </Text>
              <TextInput
                value={whatsapp}
                onChangeText={(v) => {
                  setWhatsapp(v);
                  // Consent belongs to a number, not to a checkbox -- see the
                  // same guard on the signup form. Changing the number here
                  // withdraws it rather than silently carrying an old
                  // agreement onto a new number.
                  setOptIn(false);
                }}
                editable={!loading}
                placeholder={t('auth.phonePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="phone-pad"
                autoCapitalize="none"
                style={[styles.input, isRTL && styles.rtl, loading && styles.inputDisabled]}
              />
              <Text style={[styles.hint, isRTL && styles.rtl]}>{t('editContact.whatsappWhy')}</Text>

              {/* A VALID number, not merely a non-empty field, matching the
                  signup form exactly -- offering consent for something save()
                  is about to reject reads as though it had been accepted. */}
              {!!normalizePhone(whatsapp.trim()) && (
                <View style={[styles.checkRow, mirrorRow(isRTL)]}>
                  <Pressy onPress={() => setOptIn((v) => !v)} style={styles.checkboxHit}>
                    <View style={[styles.checkbox, optIn && styles.checkboxChecked]}>
                      {optIn && <Icon name="check" size={11} color={colors.white} strokeWidth={2.4} />}
                    </View>
                  </Pressy>
                  <Text style={[styles.checkText, isRTL && styles.rtl]}>{t('auth.whatsappOptIn')}</Text>
                </View>
              )}

              {!!error && <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text>}
              <Button
                label={t('common.save')}
                onPress={save}
                loading={saving}
                disabled={loading}
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
  inputDisabled: { backgroundColor: colors.surface, color: colors.inkSoft },
  hint: { ...type.tiny, marginTop: 6, lineHeight: 16 },
  // No directional margin: mirrorRow flips the row on native, but
  // marginStart still resolves against I18nManager.isRTL, which this app
  // never flips. See mirrorRow's own comment.
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkboxHit: { padding: 2 },
  checkbox: {
    width: 17, height: 17, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.ink },
  checkText: { flex: 1, fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
  rtl: { textAlign: 'right' },
});
