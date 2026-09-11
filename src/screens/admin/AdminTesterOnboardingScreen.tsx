import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import AdminTable, { AdminColumn, adminErrorText } from './AdminTable';
import { Alert } from '../../lib/alertShim';
import { shareMessage } from '../../lib/share';
import { colors, radius, type } from '../../theme/theme';
import { RootStackParamList } from '../../navigation/types';
import { buildXlsx, downloadXlsx, sheetFileName } from '../../lib/xlsx';
import {
  OnboardingAdmin,
  OnboardingRow,
  deleteOnboardingRow,
  fetchOnboardingAdmin,
  formatLebanese,
  onboardingLabels,
  onboardingLink,
  onboardingMessage,
  onboardingSheet,
  rotateOnboardingLink,
  suggestedRole,
} from '../../lib/testerForms';

// Tester centre -> Vevaty Tester Onboarding: the link to send, and what
// everyone who used it answered, with the Excel file. See @TESTERS.md, "The
// two forms". Every read and write goes through an admin_* function that
// asks for an unlocked admin session itself.

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const COLUMNS: AdminColumn<OnboardingRow>[] = [
  { title: 'Sent', width: 140, cell: (o) => when(o.createdAt) },
  { title: 'Full name', width: 150, cell: (o) => o.fullName },
  { title: 'Phone', width: 130, cell: (o) => formatLebanese(o.phone) },
  { title: 'Email', width: 190, cell: (o) => o.email },
  { title: 'Sells regularly?', width: 150, cell: (o) => onboardingLabels.sells(o.sells) },
  { title: 'Shop or personal', width: 160, cell: (o) => onboardingLabels.sellerType(o.sellerType) },
  {
    title: 'Mostly sells',
    width: 190,
    cell: (o) => (o.sells === 'shopper' ? '' : onboardingLabels.categories(o.categories, o.categoriesOther)),
  },
  {
    title: 'Mostly buys',
    width: 190,
    cell: (o) => (o.sells === 'shopper' ? onboardingLabels.categories(o.categories, o.categoriesOther) : ''),
  },
  { title: 'Buys/sells on', width: 110, cell: (o) => onboardingLabels.devicePreference(o.devicePreference) },
  { title: 'Phone type', width: 90, cell: (o) => onboardingLabels.phoneType(o.phoneType) },
  { title: 'On mobile', width: 150, cell: (o) => onboardingLabels.mobilePreference(o.mobilePreference) },
  { title: 'Suggested role', width: 110, cell: (o) => onboardingLabels.role(suggestedRole(o.sells, o.sellerType)) },
  { title: 'Language', width: 80, cell: (o) => onboardingLabels.language(o.language) },
];

export default function AdminTesterOnboardingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<OnboardingAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await fetchOnboardingAdmin());
    } catch (e: any) {
      console.warn('[AdminTesterOnboarding] load failed:', e?.message || e);
      setLoadError(adminErrorText(e, 'Could not load the answers. Check the connection and refresh.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const key = data?.linkKey ?? null;
  const link = key ? onboardingLink(key) : null;

  const sendLink = async () => {
    if (!key || !link) return;
    const outcome = await shareMessage({ title: 'Vevaty tester form', message: onboardingMessage(key) });
    if (outcome === 'copied') Alert.alert('Copied', 'The message with the link is on the clipboard — paste it into WhatsApp.');
    else if (outcome === 'error') Alert.alert('Could not share', `Send this link by hand: ${link}`);
  };

  const newLink = () => {
    Alert.alert(
      'Make a new link?',
      'The link you have sent until now will stop working. Anyone who has not filled in the form yet will need the new one. The answers already in stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New link',
          style: 'destructive',
          onPress: async () => {
            setBusy('rotate');
            try {
              await rotateOnboardingLink();
              await load();
            } catch (e: any) {
              Alert.alert('Not changed', adminErrorText(e, 'The link did not change. Try again.'));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const exportExcel = () => {
    if (!data) return;
    const ok = downloadXlsx(buildXlsx(onboardingSheet(data.rows)), sheetFileName('vevaty-tester-onboarding'));
    if (!ok) Alert.alert('Use the website', 'The Excel file downloads from vevaty.com/control-room in a browser.');
  };

  const remove = (row: OnboardingRow) => {
    Alert.alert(
      'Remove this answer?',
      `${row.fullName} (${formatLebanese(row.phone)}) will be able to fill in the form again with that number.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(row.id);
            try {
              await deleteOnboardingRow(row.id);
              await load();
            } catch (e: any) {
              Alert.alert('Not removed', adminErrorText(e, 'That answer was not removed. Try again.'));
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  return (
    <Screen maxWidth={1180}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Vevaty Tester Onboarding</Text>
        <Pressy onPress={load} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!!loadError && <Text style={styles.error}>{loadError}</Text>}
          {data && (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>The link to send</Text>
                <Text style={styles.soft}>
                  Send it on WhatsApp to people who have agreed to test. It opens the form on the website — no account
                  needed. One answer per phone number.
                </Text>
                {link ? (
                  <Text style={styles.link} selectable>
                    {link}
                  </Text>
                ) : (
                  <Text style={styles.error}>There is no link yet. Make one below.</Text>
                )}
                <View style={styles.buttons}>
                  {!!link && <Button label="Send link" onPress={sendLink} style={styles.button} />}
                  <Button
                    label="Make a new link"
                    variant="secondary"
                    onPress={newLink}
                    loading={busy === 'rotate'}
                    style={styles.button}
                  />
                </View>
                <Text style={styles.tiny}>
                  A new link shuts the old one — use it if the link has gone further than you meant.
                </Text>
              </View>

              <View style={styles.headRow}>
                <Text style={[type.h3, styles.flex]}>
                  Answers ({data.rows.length})
                </Text>
                {data.rows.length > 0 && (
                  <Pressy onPress={exportExcel} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>{Platform.OS === 'web' ? 'Download Excel' : 'Excel (website)'}</Text>
                  </Pressy>
                )}
              </View>

              <AdminTable
                columns={COLUMNS}
                rows={data.rows}
                rowKey={(o) => o.id}
                empty="Nobody has filled in the form yet."
                actions={(o) => (
                  <Pressy onPress={() => remove(o)} style={styles.smallBtn} disabled={busy === o.id}>
                    <Text style={styles.smallBtnDanger}>Remove</Text>
                  </Pressy>
                )}
              />
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
    marginBottom: 18,
    maxWidth: 720,
  },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  soft: { ...type.soft },
  tiny: { ...type.tiny, marginTop: 10 },
  link: { ...type.body, fontWeight: '600', marginTop: 12, color: colors.primary },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  button: { flexGrow: 1, minWidth: 180 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  flex: { flex: 1 },
  error: { fontSize: 13, color: colors.danger, marginVertical: 8 },
  smallBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  smallBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  smallBtnDanger: { fontSize: 12.5, fontWeight: '600', color: colors.danger },
});
