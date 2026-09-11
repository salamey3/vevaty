import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import AdminTable, { AdminColumn, adminErrorText } from './AdminTable';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { RootStackParamList } from '../../navigation/types';
import { buildXlsx, downloadXlsx, sheetFileName } from '../../lib/xlsx';
import {
  AdminMission,
  MISSION_ROLES,
  ROLE_LABEL,
  TesterReportRow,
  TesterReportsAdmin,
  deleteTesterReport,
  fetchTesterReportsAdmin,
  reportLabels,
  reportsSheet,
  saveMission,
} from '../../lib/testerForms';

// Tester centre -> Testers Reports: every mission report, newest first,
// with the Excel file, and the mission list the form offers. See
// @TESTERS.md, "The two forms". "No, I gave up" is the row to read first,
// so it has its own filter.

type Filter = 'all' | 'gave_up' | 'hard' | 'yes';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gave_up', label: 'Gave up' },
  { key: 'hard', label: 'Was hard' },
  { key: 'yes', label: 'Finished' },
];

const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  blocked: { bg: '#f5e4e2', fg: colors.danger },
  annoyed: { bg: colors.warnBg, fg: colors.ink },
  idea: { bg: colors.primaryTint, fg: colors.primary },
};

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Pill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

const COLUMNS: AdminColumn<TesterReportRow>[] = [
  { title: 'Sent', width: 140, cell: (r) => when(r.createdAt) },
  { title: 'Name', width: 120, cell: (r) => r.reporterName },
  { title: 'Mission', width: 210, cell: (r) => reportLabels.mission(r) },
  {
    title: 'Finished?',
    width: 130,
    cell: (r) =>
      r.finished === 'gave_up' ? (
        <Pill text={reportLabels.finished(r.finished)} bg="#f5e4e2" fg={colors.danger} />
      ) : (
        reportLabels.finished(r.finished)
      ),
  },
  { title: 'Where did you get stuck?', width: 320, cell: (r) => r.stuck ?? '' },
  {
    title: 'How bad?',
    width: 110,
    cell: (r) => {
      if (!r.severity) return '';
      const s = SEVERITY_STYLE[r.severity] ?? { bg: colors.surface, fg: colors.inkSoft };
      return <Pill text={reportLabels.severity(r.severity)} bg={s.bg} fg={s.fg} />;
    },
  },
  { title: 'App or website', width: 100, cell: (r) => reportLabels.surface(r.surface) },
  { title: 'Device type', width: 140, cell: (r) => r.deviceType },
  {
    title: 'Screenshot',
    width: 90,
    cell: (r) =>
      r.screenshotUrl ? (
        <Pressy onPress={() => Linking.openURL(r.screenshotUrl!)}>
          <Image source={{ uri: r.screenshotUrl }} style={styles.thumb} resizeMode="cover" />
        </Pressy>
      ) : (
        ''
      ),
  },
  {
    title: 'Recorded',
    width: 220,
    cell: (r) =>
      [r.platform, r.device, r.osVersion, reportLabels.build(r)].filter(Boolean).join(' · '),
  },
  { title: 'Language', width: 80, cell: (r) => reportLabels.language(r.appLanguage) },
  {
    title: 'Account',
    width: 140,
    cell: (r) =>
      [r.accountName || (r.reporterId ? '' : 'account deleted'), r.accountRoles.map((x) => ROLE_LABEL[x] ?? x).join(', ')]
        .filter(Boolean)
        .join(' · '),
  },
];

type Draft = { id: string | null; role: string; position: string; titleEn: string; titleAr: string; active: boolean };

function MissionsEditor({ missions, onChanged }: { missions: AdminMission[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const nextPosition = (role: string) =>
    String(Math.min(99, missions.filter((m) => m.role === role).reduce((n, m) => Math.max(n, m.position), 0) + 1));

  const startNew = () => {
    setError(null);
    setDraft({ id: null, role: 'seller', position: nextPosition('seller'), titleEn: '', titleAr: '', active: true });
  };
  const startEdit = (m: AdminMission) => {
    setError(null);
    setDraft({ id: m.id, role: m.role, position: String(m.position), titleEn: m.titleEn, titleAr: m.titleAr ?? '', active: m.active });
  };

  const save = async () => {
    if (!draft) return;
    const position = Number(draft.position.trim());
    if (!Number.isInteger(position) || position < 1 || position > 99) {
      setError('The number has to be between 1 and 99.');
      return;
    }
    if (!draft.titleEn.trim()) {
      setError('Type the mission’s name in English.');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      await saveMission({ ...draft, position, titleEn: draft.titleEn.trim(), titleAr: draft.titleAr.trim() });
      setDraft(null);
      await onChanged();
    } catch (e: any) {
      setError(adminErrorText(e, 'The mission was not saved. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (m: AdminMission) => {
    setBusy(m.id);
    try {
      await saveMission({ id: m.id, role: m.role, position: m.position, titleEn: m.titleEn, titleAr: m.titleAr ?? '', active: !m.active });
      await onChanged();
    } catch (e: any) {
      Alert.alert('Not changed', adminErrorText(e, 'The mission was not changed. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const groups = MISSION_ROLES.map((role) => ({ role, missions: missions.filter((m) => m.role === role) })).filter(
    (g) => g.missions.length > 0
  );

  return (
    <View style={styles.card}>
      <Pressy onPress={() => setOpen((o) => !o)} style={styles.headRow} haptic={false}>
        <View style={styles.flex}>
          <Text style={styles.sectionLabel}>The missions</Text>
          <Text style={styles.soft}>
            What testers choose from under “Which mission”, numbered as on the role sheets. {missions.filter((m) => m.active).length}{' '}
            shown, {missions.filter((m) => !m.active).length} hidden.
          </Text>
        </View>
        <Text style={styles.chev}>{open ? 'Close' : 'Edit'}</Text>
      </Pressy>

      {open && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.tiny}>
            A tester sees the missions of their own role sheet, plus any marked Everyone. A report keeps the name it was
            sent with, so renaming a mission never changes old reports. Hiding one takes it off the form.
          </Text>
          {groups.map((g) => (
            <View key={g.role} style={{ marginTop: 14 }}>
              <Text style={styles.groupLabel}>{ROLE_LABEL[g.role] ?? g.role}</Text>
              {g.missions.map((m) => (
                <View key={m.id} style={[styles.missionRow, !m.active && styles.faded]}>
                  <View style={styles.flex}>
                    <Text style={type.body}>
                      {m.position}. {m.titleEn}
                      {!m.active ? '  (hidden)' : ''}
                    </Text>
                    {!!m.titleAr && <Text style={[styles.soft, styles.arabic]}>{m.titleAr}</Text>}
                    <Text style={styles.tiny}>
                      {m.reports} report{m.reports === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Pressy onPress={() => startEdit(m)} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>Edit</Text>
                  </Pressy>
                  <Pressy onPress={() => toggle(m)} style={styles.smallBtn} disabled={busy === m.id}>
                    <Text style={styles.smallBtnText}>{m.active ? 'Hide' : 'Show'}</Text>
                  </Pressy>
                </View>
              ))}
            </View>
          ))}

          {draft ? (
            <View style={styles.editor}>
              <Text style={styles.sectionLabel}>{draft.id ? 'Change the mission' : 'A new mission'}</Text>
              <Text style={styles.fieldLabel}>Role sheet</Text>
              <View style={styles.chips}>
                {MISSION_ROLES.map((r) => {
                  const on = draft.role === r;
                  return (
                    <Pressy
                      key={r}
                      onPress={() =>
                        setDraft((d) => (d ? { ...d, role: r, position: d.id ? d.position : nextPosition(r) } : d))
                      }
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{ROLE_LABEL[r]}</Text>
                    </Pressy>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Number on the role sheet</Text>
              <TextInput
                value={draft.position}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, position: v.replace(/[^0-9]/g, '') } : d))}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, { width: 80 }]}
              />
              <Text style={styles.fieldLabel}>Name in English</Text>
              <TextInput
                value={draft.titleEn}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, titleEn: v } : d))}
                placeholder="As written on the role sheet"
                placeholderTextColor={colors.inkSoft}
                maxLength={200}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Name in Arabic (shown when the app is in Arabic)</Text>
              <TextInput
                value={draft.titleAr}
                onChangeText={(v) => setDraft((d) => (d ? { ...d, titleAr: v } : d))}
                maxLength={200}
                style={[styles.input, styles.arabic]}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.buttons}>
                <Button label="Save" onPress={save} loading={busy === 'save'} style={styles.button} />
                <Button label="Cancel" variant="secondary" onPress={() => setDraft(null)} style={styles.button} />
              </View>
            </View>
          ) : (
            <Button label="Add a mission" variant="secondary" onPress={startNew} style={{ marginTop: 14 }} />
          )}
        </View>
      )}
    </View>
  );
}

export default function AdminTesterReportsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<TesterReportsAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await fetchTesterReportsAdmin());
    } catch (e: any) {
      console.warn('[AdminTesterReports] load failed:', e?.message || e);
      setLoadError(adminErrorText(e, 'Could not load the reports. Check the connection and refresh.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.finished === filter)), [rows, filter]);
  const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.finished === f).length);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const thisWeek = rows.filter((r) => new Date(r.createdAt).getTime() > weekAgo).length;

  const exportExcel = () => {
    const ok = downloadXlsx(buildXlsx(reportsSheet(rows)), sheetFileName('vevaty-testers-reports'));
    if (!ok) Alert.alert('Use the website', 'The Excel file downloads from vevaty.com/control-room in a browser.');
  };

  const remove = (r: TesterReportRow) => {
    Alert.alert('Delete this report?', `${r.reporterName} — ${reportLabels.mission(r)}. This cannot be undone.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(r.id);
          try {
            await deleteTesterReport(r.id);
            await load();
          } catch (e: any) {
            Alert.alert('Not deleted', adminErrorText(e, 'The report was not deleted. Try again.'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen maxWidth={1180}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Testers Reports</Text>
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
              <View style={styles.headRow}>
                <Text style={[styles.soft, styles.flex]}>
                  {rows.length} report{rows.length === 1 ? '' : 's'}, {thisWeek} in the last seven days. Testers send them from
                  vevaty.com/testers/report, from Profile, or from the Report a problem sheet.
                </Text>
                {rows.length > 0 && (
                  <Pressy onPress={exportExcel} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>{Platform.OS === 'web' ? 'Download Excel' : 'Excel (website)'}</Text>
                  </Pressy>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
                {FILTERS.map((f) => (
                  <Pressy key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]}>
                    <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>
                      {f.label} ({count(f.key)})
                    </Text>
                  </Pressy>
                ))}
              </ScrollView>

              <AdminTable
                columns={COLUMNS}
                rows={shown}
                rowKey={(r) => r.id}
                empty={rows.length === 0 ? 'No reports yet.' : 'None of these.'}
                actions={(r) => (
                  <Pressy onPress={() => remove(r)} style={styles.smallBtn} disabled={busyId === r.id}>
                    <Text style={styles.smallBtnDanger}>Delete</Text>
                  </Pressy>
                )}
              />

              <View style={{ height: 24 }} />
              <MissionsEditor missions={data.missions} onChanged={load} />
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
    maxWidth: 760,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  flex: { flex: 1 },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  soft: { ...type.soft },
  tiny: { ...type.tiny, marginTop: 2 },
  chev: { fontSize: 13, fontWeight: '600', color: colors.primary },
  groupLabel: { ...type.tiny, fontWeight: '700', color: colors.ink, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  faded: { opacity: 0.5 },
  arabic: { writingDirection: 'rtl', textAlign: 'right' },
  editor: {
    marginTop: 16,
    padding: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  fieldLabel: { ...type.tiny, marginTop: 12, marginBottom: 6 },
  input: {
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.ink,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  button: { flexGrow: 1, minWidth: 140 },
  chipRow: { flexGrow: 0, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextOn: { color: colors.white },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 11.5, fontWeight: '700' },
  thumb: { width: 48, height: 80, borderRadius: 6, backgroundColor: colors.surface },
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
