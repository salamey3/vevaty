import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { RootStackParamList } from '../../navigation/types';
import { shareMessage } from '../../lib/share';
import {
  TESTER_ROLES,
  TesterCentre,
  TesterInvite,
  createTesterInvite,
  fetchTesterCentre,
  formatInviteCode,
  inviteLink,
  inviteMessage,
  removeWaitlistEntry,
  revokeTesterInvite,
  setRegistrationOpen,
  setTesterRoles,
  tagMemberByPhone,
  adminPhoneDigits,
  fetchWaitlistExport,
} from '../../lib/testers';

// The Tester centre: everything about who is in the closed round, on one
// screen. The sign-up switch, invites issued by name, people who already had
// an account and were tagged, and the waitlist of people turned away. Every
// write goes through an admin_* function that checks for an unlocked admin
// session itself (admin_session_active) and writes the admin log (see
// TESTERS.md) -- nothing here is a direct table write, because RLS filters
// rows and never confers a privilege.

const ROLE_LABELS: Record<string, string> = {
  seller: 'Seller',
  storefront: 'Storefront',
  buyer: 'Buyer',
  consignor: 'Consignor',
};
const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// The server's own words, in a sentence an admin can act on.
function adminError(e: any, fallback: string): string {
  const m: string = e?.message || '';
  if (m.includes('not_admin')) return 'This session is not an admin session. Sign in to the admin panel again.';
  if (m.includes('name_required')) return 'Type the tester’s name first.';
  if (m.includes('roles_required')) return 'Tick at least one role.';
  if (m.includes('no_member_with_that_number')) return 'Nobody has confirmed that number by text message. Send them an invite instead.';
  if (m.includes('not_revocable')) return 'That invite has already been used or cancelled.';
  return fallback;
}

function RoleChips({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <View style={styles.chips}>
      {TESTER_ROLES.map((r) => {
        const on = value.includes(r);
        return (
          <Pressy
            key={r}
            onPress={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{roleLabel(r)}</Text>
          </Pressy>
        );
      })}
    </View>
  );
}

export default function AdminTestersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<TesterCentre | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteName, setInviteName] = useState('');
  const [inviteRoles, setInviteRoles] = useState<string[]>(['seller']);
  const [inviteNote, setInviteNote] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  // The invite just made, kept on screen so it can be shared straight away.
  const [justMade, setJustMade] = useState<{ name: string; code: string } | null>(null);

  const [tagPhone, setTagPhone] = useState('+961');
  const [tagRoles, setTagRoles] = useState<string[]>(['seller']);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagDone, setTagDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await fetchTesterCentre());
    } catch (e: any) {
      setLoadError(adminError(e, 'Could not load the tester centre. Check the connection and refresh.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSignups = () => {
    if (!data) return;
    const closing = data.registrationOpen;
    Alert.alert(
      closing ? 'Make sign-up invite-only?' : 'Open sign-up to everyone?',
      closing
        ? 'New people will need an invite code to create an account. Anyone without one can leave their number on the waitlist. People who already have an account are not affected.'
        : 'Anyone will be able to create an account again, with or without a code. Codes still tag testers when they are used.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: closing ? 'Invite-only' : 'Open to everyone',
          style: closing ? 'destructive' : 'default',
          onPress: async () => {
            setBusy('switch');
            try {
              await setRegistrationOpen(!closing);
              await load();
            } catch (e: any) {
              Alert.alert('Not changed', adminError(e, 'The switch did not change. Try again.'));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const makeInvite = async () => {
    setInviteError(null);
    if (!inviteName.trim()) {
      setInviteError('Type the tester’s name first.');
      return;
    }
    if (inviteRoles.length === 0) {
      setInviteError('Tick at least one role.');
      return;
    }
    setBusy('invite');
    try {
      const made = await createTesterInvite(inviteName.trim(), inviteRoles, inviteNote.trim());
      setJustMade({ name: inviteName.trim(), code: made.code });
      setInviteName('');
      setInviteNote('');
      await load();
    } catch (e: any) {
      setInviteError(adminError(e, 'The invite was not created. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const share = async (name: string, code: string) => {
    const outcome = await shareMessage({ title: 'Your Vevaty invite', message: inviteMessage(name, code) });
    if (outcome === 'copied') Alert.alert('Copied', 'The invite message is on the clipboard — paste it into WhatsApp.');
    else if (outcome === 'error') Alert.alert('Could not share', `Send this code by hand: ${formatInviteCode(code)}`);
  };

  const cancelInvite = (invite: TesterInvite) => {
    Alert.alert('Cancel this invite?', `${invite.testerName}’s code ${formatInviteCode(invite.code)} will stop working.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel invite',
        style: 'destructive',
        onPress: async () => {
          setBusy(invite.id);
          try {
            await revokeTesterInvite(invite.id);
            await load();
          } catch (e: any) {
            Alert.alert('Not cancelled', adminError(e, 'The invite was not cancelled. Try again.'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const tag = async () => {
    setTagError(null);
    setTagDone(null);
    if (tagRoles.length === 0) {
      setTagError('Tick at least one role.');
      return;
    }
    // Normalised here so "70 123 456", "03 123 456" and "+961…" all find the
    // same account -- and the number actually searched for is the one shown
    // if nobody is found, so a mistyped digit is visible.
    const digits = adminPhoneDigits(tagPhone);
    if (digits.length < 8) {
      setTagError('Type the whole number, with or without +961.');
      return;
    }
    setBusy('tag');
    try {
      const member = await tagMemberByPhone(digits, tagRoles);
      setTagDone(
        `${member.fullName || 'That member'} is now tagged as a tester.` +
          (member.admitted
            ? ' Their sign-up had been left waiting for an invite, so this has let them in as well.'
            : '')
      );
      setTagPhone('+961');
      await load();
    } catch (e: any) {
      const m: string = e?.message || '';
      setTagError(
        m.includes('no_member_with_that_number')
          ? `Nobody has confirmed +${digits} by text message. Check the number, or send them an invite instead.`
          : adminError(e, 'Nobody was tagged. Try again.')
      );
    } finally {
      setBusy(null);
    }
  };

  const untag = (userId: string, name: string | null) => {
    Alert.alert(
      'Remove the tester tag?',
      `${name || 'This member'} keeps their account. Their Report a problem tab disappears, and anything they already posted stays marked as test.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove tag',
          style: 'destructive',
          onPress: async () => {
            setBusy(userId);
            try {
              await setTesterRoles(userId, []);
              await load();
            } catch (e: any) {
              Alert.alert('Not removed', adminError(e, 'The tag was not removed. Try again.'));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const shareWaitlist = async () => {
    if (!data || data.waitlistCount === 0) return;
    let phones = data.waitlist.map((w) => w.phone);
    // The list on screen stops at the latest 500. Only past that is the
    // whole list fetched first -- after a network wait, which a browser may
    // no longer count as part of the tap that asked to share or copy, so
    // the ordinary case stays instant.
    if (data.waitlistCount > data.waitlist.length) {
      setBusy('waitlist');
      try {
        phones = await fetchWaitlistExport();
      } catch (e: any) {
        Alert.alert('Not copied', adminError(e, 'The waitlist could not be fetched. Try again.'));
        return;
      } finally {
        setBusy(null);
      }
    }
    const outcome = await shareMessage({ title: 'Vevaty waitlist', message: phones.join('\n') });
    if (outcome === 'copied') Alert.alert('Copied', `${phones.length} numbers are on the clipboard.`);
    else if (outcome === 'error') Alert.alert('Could not share', 'Try again, or copy the numbers from the list below.');
  };

  const removeFromWaitlist = (id: string, phone: string) => {
    Alert.alert('Remove from the waitlist?', phone, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(id);
          try {
            await removeWaitlistEntry(id);
            await load();
          } catch (e: any) {
            Alert.alert('Not removed', adminError(e, 'That number was not removed. Try again.'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  // Spent is used_at, not used_by: deleting an account empties used_by, and
  // its code must not come back as waiting (it cannot be claimed again).
  const spent = (i: TesterInvite) => !!i.usedAt || !!i.usedBy;
  const waiting = data?.invites.filter((i) => !spent(i) && !i.revokedAt) ?? [];
  const used = data?.invites.filter(spent) ?? [];
  const cancelled = data?.invites.filter((i) => !spent(i) && !!i.revokedAt) ?? [];
  // The box under "Create invite" is there to send the code straight away.
  // Once that code is used or cancelled it would be offering a dead one.
  const justMadeRow = justMade ? data?.invites.find((i) => i.code === justMade.code) : undefined;
  const justMadeWaiting = !!justMade && (!justMadeRow || waiting.includes(justMadeRow));

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Tester centre</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!!loadError && <Text style={styles.error}>{loadError}</Text>}

          {data && (
            <>
              {/* ---- The switch ---- */}
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Sign-up</Text>
                <Text style={styles.big}>{data.registrationOpen ? 'Open to everyone' : 'Invite only'}</Text>
                <Text style={styles.soft}>
                  {data.registrationOpen
                    ? 'Anyone can create an account. Switch to invite-only when you send the first invites.'
                    : 'New accounts need an invite code. Everyone else can leave their number on the waitlist below.'}
                </Text>
                <Button
                  label={data.registrationOpen ? 'Make it invite-only' : 'Open to everyone'}
                  variant={data.registrationOpen ? 'primary' : 'secondary'}
                  onPress={toggleSignups}
                  loading={busy === 'switch'}
                  style={{ marginTop: 12 }}
                />
              </View>

              {/* ---- A new invite ---- */}
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Invite a tester</Text>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  value={inviteName}
                  onChangeText={setInviteName}
                  placeholder="Who is this for?"
                  placeholderTextColor={colors.inkSoft}
                  style={styles.input}
                />
                <Text style={styles.fieldLabel}>Role</Text>
                <RoleChips value={inviteRoles} onChange={setInviteRoles} />
                <Text style={styles.fieldLabel}>Note (only you see this)</Text>
                <TextInput
                  value={inviteNote}
                  onChangeText={setInviteNote}
                  placeholder="Android, sells camera gear…"
                  placeholderTextColor={colors.inkSoft}
                  style={styles.input}
                />
                {!!inviteError && <Text style={styles.error}>{inviteError}</Text>}
                <Button label="Create invite" onPress={makeInvite} loading={busy === 'invite'} style={{ marginTop: 12 }} />

                {justMadeWaiting && justMade && (
                  <View style={styles.madeBox}>
                    <Text style={styles.soft}>Invite for {justMade.name}</Text>
                    <Text style={styles.code}>{formatInviteCode(justMade.code)}</Text>
                    <Text style={styles.link} selectable>
                      {inviteLink(justMade.code)}
                    </Text>
                    <Button label="Send invite" onPress={() => share(justMade.name, justMade.code)} style={{ marginTop: 10 }} />
                  </View>
                )}
              </View>

              {/* ---- Someone who already has an account ---- */}
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Tag someone who already has an account</Text>
                <Text style={styles.soft}>
                  For a tester who signed up before the round, or one whose sign-up got stuck waiting for an invite. Use the number they signed up with.
                </Text>
                <TextInput
                  value={tagPhone}
                  onChangeText={setTagPhone}
                  keyboardType="phone-pad"
                  placeholder="+961…"
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.input, { marginTop: 10 }]}
                />
                <Text style={styles.fieldLabel}>Role</Text>
                <RoleChips value={tagRoles} onChange={setTagRoles} />
                {!!tagError && <Text style={styles.error}>{tagError}</Text>}
                {!!tagDone && <Text style={styles.ok}>{tagDone}</Text>}
                <Button label="Tag as tester" variant="secondary" onPress={tag} loading={busy === 'tag'} style={{ marginTop: 12 }} />
              </View>

              {/* ---- Who is in ---- */}
              <Text style={styles.listHeading}>Testers ({data.testers.length})</Text>
              {data.testers.length === 0 && <Text style={styles.empty}>Nobody yet.</Text>}
              {data.testers.map((m) => (
                <View key={m.userId} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{m.fullName || 'No name yet'}</Text>
                    <Text style={styles.soft}>
                      {[m.phone, m.roles.map(roleLabel).join(', ')].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={styles.soft}>
                      {m.testListings} test listing{m.testListings === 1 ? '' : 's'} · {m.reports} report{m.reports === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Pressy onPress={() => untag(m.userId, m.fullName)} style={styles.smallBtn} disabled={busy === m.userId}>
                    <Text style={styles.smallBtnDanger}>Remove tag</Text>
                  </Pressy>
                </View>
              ))}

              <Text style={styles.listHeading}>Invites not used yet ({waiting.length})</Text>
              {waiting.length === 0 && <Text style={styles.empty}>None waiting.</Text>}
              {waiting.map((i) => (
                <View key={i.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{i.testerName}</Text>
                    <Text style={styles.soft}>
                      {formatInviteCode(i.code)} · {i.roles.map(roleLabel).join(', ')} · {when(i.createdAt)}
                    </Text>
                    {!!i.note && <Text style={styles.soft}>{i.note}</Text>}
                  </View>
                  <Pressy onPress={() => share(i.testerName, i.code)} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>Send</Text>
                  </Pressy>
                  <Pressy onPress={() => cancelInvite(i)} style={styles.smallBtn} disabled={busy === i.id}>
                    <Text style={styles.smallBtnDanger}>Cancel</Text>
                  </Pressy>
                </View>
              ))}

              {used.length > 0 && <Text style={styles.listHeading}>Invites used ({used.length})</Text>}
              {used.map((i) => (
                <View key={i.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{i.testerName}</Text>
                    <Text style={styles.soft}>
                      {i.usedBy ? `Joined${i.joinedName ? ` as ${i.joinedName}` : ''}` : 'Joined, account since deleted'} · {when(i.usedAt)} ·{' '}
                      {formatInviteCode(i.code)}
                    </Text>
                  </View>
                </View>
              ))}

              {cancelled.length > 0 && <Text style={styles.listHeading}>Cancelled ({cancelled.length})</Text>}
              {cancelled.map((i) => (
                <View key={i.id} style={[styles.row, styles.rowFaded]}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{i.testerName}</Text>
                    <Text style={styles.soft}>
                      {formatInviteCode(i.code)} · cancelled {when(i.revokedAt)}
                    </Text>
                  </View>
                </View>
              ))}

              {/* ---- Turned away ---- */}
              <View style={styles.waitlistHead}>
                <Text style={[styles.listHeading, { marginTop: 0 }]}>Waitlist ({data.waitlistCount})</Text>
                {data.waitlist.length > 0 && (
                  <Pressy onPress={shareWaitlist} style={styles.smallBtn} disabled={busy === 'waitlist'}>
                    <Text style={styles.smallBtnText}>{busy === 'waitlist' ? 'Fetching…' : 'Copy all'}</Text>
                  </Pressy>
                )}
              </View>
              <Text style={styles.soft}>
                People who tried to sign up without an invite and asked to hear when Vevaty opens. The numbers are not
                verified.
              </Text>
              {data.waitlist.length === 0 && <Text style={styles.empty}>Nobody yet.</Text>}
              {data.waitlist.map((w) => (
                <View key={w.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{w.phone}</Text>
                    <Text style={styles.soft}>
                      {[when(w.createdAt), w.language === 'ar' ? 'Arabic' : w.language === 'en' ? 'English' : w.language, w.platform]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressy onPress={() => removeFromWaitlist(w.id, w.phone)} style={styles.smallBtn} disabled={busy === w.id}>
                    <Text style={styles.smallBtnDanger}>Remove</Text>
                  </Pressy>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 60 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 16,
    marginBottom: 14,
  },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  big: { ...type.h2 },
  soft: { ...type.soft, marginTop: 4 },
  fieldLabel: { ...type.tiny, marginTop: 12, marginBottom: 6 },
  input: {
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.ink,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  chipTextOn: { color: colors.white },
  error: { fontSize: 13, color: colors.danger, marginTop: 10 },
  ok: { fontSize: 13, color: colors.success, marginTop: 10, fontWeight: '600' },
  madeBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
  },
  code: { fontSize: 30, fontWeight: '700', letterSpacing: 4, color: colors.ink, marginTop: 6 },
  link: { ...type.tiny, marginTop: 4, textAlign: 'center' },
  listHeading: { ...type.h3, marginTop: 22, marginBottom: 8 },
  empty: { ...type.soft, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 8,
  },
  rowFaded: { opacity: 0.6 },
  smallBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  smallBtnDanger: { fontSize: 12.5, fontWeight: '600', color: colors.danger },
  waitlistHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
});
