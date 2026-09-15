import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { Alert } from '../lib/alertShim';
import { normalizePhone } from '../lib/supabase';
import {
  MAX_STAFF, StaffMember, fetchStaff, inviteStaff, isWaiting, removeStaff,
  staffErrorKey, staffLabel,
} from '../lib/shopStaff';

// Who else works here.
//
// The owner's side of stage 4: a list, a number to add, and a way to take
// somebody off. Everything about it hangs on the PHONE, which is why the
// box asks for a number and not a name -- the number is the account, and
// an invite written against one waits for whoever proves it with the text
// message at sign-up. So the owner can add the person standing next to
// them before that person has ever heard of Vevaty.
//
// Deliberately not a roles screen. There is one role and it is the whole
// counter: stock, and answering the buyer in the chat. What it does NOT
// carry is anything that changes what the shop SELLS -- the storefront,
// the listings, the size-and-colour table. Those stay with the owner, and
// the database enforces it rather than this screen.

const DIAL_PREFIX = '+961';

export default function StaffScreen() {
  const { t, isRTL } = useLanguage();
  const [rows, setRows] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    fetchStaff()
      .then(setRows)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (busy) return;
    // Only ever ONE country code on the front. Concatenating the prefix
    // onto whatever was typed meant that writing a number out in full --
    // 96170123456, or 0096170123456, which is how a Lebanese number is
    // normally written down -- produced +96196170123456: fourteen digits,
    // so every validator accepted it, the owner was told "Added", a slot
    // was spent, and the person standing next to them never saw anything.
    // Anything already carrying a country code is taken as typed.
    const typed = phone.trim().replace(/[\s-]/g, '');
    const local = typed.replace(/^\+/, '').replace(/^00/, '');
    const digits = local.replace(/^961/, '').replace(/^0+/, '');
    const full = normalizePhone(DIAL_PREFIX + digits);
    if (!full || !digits) { Alert.alert(t('staff.errBadPhone')); return; }
    setBusy(true);
    try {
      const { hasAccount } = await inviteStaff(full);
      setPhone('');
      Alert.alert(
        t('staff.invitedTitle'),
        t(hasAccount ? 'staff.invitedBody' : 'staff.invitedBodyNoAccount', { phone: full })
      );
      load();
    } catch (e: any) {
      Alert.alert(t('staff.failedTitle'), t(staffErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    const person = removing;
    if (!person) return;
    setRemoving(null);
    try {
      await removeStaff(person.id);
      load();
    } catch (e: any) {
      Alert.alert(t('staff.failedTitle'), t(staffErrorKey(e)));
    }
  };

  const full = rows.length >= MAX_STAFF;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={type.title}>{t('staff.title')}</Text>
        <Text style={type.soft}>{t('staff.intro')}</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.ink} />
        ) : failed ? (
          <View style={styles.empty}>
            <Text style={type.soft}>{t('staff.loadFailed')}</Text>
            <Pressy onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressy>
          </View>
        ) : (
          <>
            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Icon name="user" size={26} color={colors.inkSoft} />
                <Text style={type.soft}>{t('staff.nobodyYet')}</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {rows.map((m) => (
                  <View key={m.id} style={[styles.card, styles.row, mirrorRow(isRTL)]}>
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>{staffLabel(m)}</Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {isWaiting(m) ? t('staff.waitingToAccept') : m.phone}
                      </Text>
                    </View>
                    <Pressy
                      onPress={() => setRemoving(m)}
                      accessibilityRole="button"
                      accessibilityLabel={t('staff.removeOne', { who: staffLabel(m) })}
                      style={styles.remove}
                    >
                      <Icon name="close" size={15} color={colors.danger} />
                    </Pressy>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.addLabel}>{t('staff.addLabel')}</Text>
            <View style={[styles.addRow, mirrorRow(isRTL)]}>
              {/* Not part of the text field: a prefix inside the input is a
                  thing people delete by accident, and a wrong country code
                  invites a different person entirely. */}
              <Text style={styles.prefix}>{DIAL_PREFIX}</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder={t('staff.phonePlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="phone-pad"
                editable={!full}
                style={styles.input}
                accessibilityLabel={t('staff.addLabel')}
              />
            </View>
            <Pressy
              onPress={add}
              disabled={busy || full || !phone.trim()}
              style={[styles.addBtn, (busy || full || !phone.trim()) && styles.addBtnOff]}
            >
              <Text style={styles.addBtnText}>
                {busy ? t('common.loading') : t('staff.addBtn')}
              </Text>
            </Pressy>
            <Text style={styles.foot}>
              {full ? t('staff.fullUp', { max: MAX_STAFF }) : t('staff.whatTheyCanDo')}
            </Text>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!removing}
        title={t('staff.removeTitle')}
        message={t('staff.removeBody', { who: removing ? staffLabel(removing) : '' })}
        confirmLabel={t('staff.removeConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48 },
  list: { marginTop: 16, gap: 12 },
  card: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    backgroundColor: colors.card, overflow: 'hidden',
  },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sub: { ...type.tiny, marginTop: 2 },
  remove: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
  },

  addLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 28, marginBottom: 8 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    backgroundColor: colors.card, paddingHorizontal: 14, height: 48,
  },
  prefix: { fontSize: 14.5, fontWeight: '700', color: colors.inkSoft },
  input: { flex: 1, minWidth: 0, fontSize: 14.5, color: colors.ink },
  addBtn: {
    marginTop: 12, height: 50, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnOff: { opacity: 0.45 },
  addBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  foot: { ...type.tiny, marginTop: 12 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 36 },
  retry: {
    paddingHorizontal: 18, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.primary, justifyContent: 'center',
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.white },
});
