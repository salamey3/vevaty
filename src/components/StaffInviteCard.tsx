import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { Alert } from '../lib/alertShim';
import { acceptInvite, declineInvite, shopName, staffErrorKey } from '../lib/shopStaff';

// "Someone wants you to help run their shop."
//
// This card IS the invite. There is no push, no email, and Meta blocks the
// WhatsApp channel, so nothing can reach a Vevaty user who is not looking
// at the app -- the same wall the waiting list ran into. The one thing
// that always works is something on the screen they open, and the two
// people involved are usually standing in the same shop anyway.
//
// Renders nothing at all when there is nothing waiting, which is almost
// always, and for almost everybody.

export default function StaffInviteCard() {
  const { t, language, isRTL } = useLanguage();
  const { staffInvites, refreshWork } = useAppStore();
  const [busy, setBusy] = useState<string | null>(null);

  const invite = staffInvites[0];
  if (!invite) return null;

  const act = async (yes: boolean) => {
    if (busy) return;
    setBusy(invite.id);
    try {
      if (yes) await acceptInvite(invite.id); else await declineInvite(invite.id);
      await refreshWork();
      if (yes) Alert.alert(t('staff.joinedTitle'), t('staff.joinedBody'));
    } catch (e: any) {
      Alert.alert(t('staff.failedTitle'), t(staffErrorKey(e)));
      // Whatever went wrong, the truth about where this person works now
      // lives on the server -- re-read it rather than leaving a card that
      // may already have been answered somewhere else.
      await refreshWork();
    } finally {
      setBusy(null);
    }
  };

  const name = shopName(invite, language);

  return (
    <View style={styles.card}>
      <View style={[styles.head, mirrorRow(isRTL)]}>
        <View style={styles.mark}>
          <Icon name="briefcase" size={15} color={colors.accentInk} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{t('staff.inviteTitle', { shop: name })}</Text>
          <Text style={styles.body}>
            {invite.invitedBy
              ? t('staff.inviteFrom', { who: invite.invitedBy })
              : t('staff.inviteWhat')}
          </Text>
        </View>
      </View>
      <Text style={styles.what}>{t('staff.inviteWhat')}</Text>
      <View style={[styles.actions, mirrorRow(isRTL)]}>
        <Pressy
          onPress={() => act(false)}
          disabled={!!busy}
          style={[styles.btn, styles.no, !!busy && styles.off]}
        >
          <Text style={styles.noText}>{t('staff.inviteNo')}</Text>
        </Pressy>
        <Pressy
          onPress={() => act(true)}
          disabled={!!busy}
          style={[styles.btn, styles.yes, !!busy && styles.off]}
        >
          <Text style={styles.yesText}>{busy ? t('common.loading') : t('staff.inviteYes')}</Text>
        </Pressy>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1, borderColor: colors.accentRing, borderRadius: radius.md,
    backgroundColor: colors.accentTint, padding: 14, gap: 10,
  },
  // mirrorRow only supplies row-reverse on native RTL, so every row keeps
  // its own flexDirection or it stacks vertically on the web.
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  body: { ...type.tiny, color: colors.accentDeep, marginTop: 2 },
  what: { ...type.tiny },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minWidth: 0, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.5 },
  no: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  noText: { fontSize: 14.5, fontWeight: '700', color: colors.inkSoft },
  yes: { backgroundColor: colors.primary },
  yesText: { fontSize: 14.5, fontWeight: '700', color: colors.white },
});
