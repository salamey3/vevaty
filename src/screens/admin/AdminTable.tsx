import React from 'react';
import { ScrollView, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { colors, radius, type } from '../../theme/theme';

// A table for the admin's lists of answers -- the tester forms. A real table
// with columns on a computer, where the answers are read side by side; one
// card per row on a phone, where eleven columns would be a sideways scroll
// through a keyhole. Both come from the same column list.
//
// Always left to right: the headings are English, and on the website an
// Arabic-language admin session would otherwise mirror the columns.

export type AdminColumn<T> = {
  title: string;
  width: number;
  // Text, or an element (a link, a thumbnail). Empty text leaves the line
  // out of a phone card.
  cell: (row: T) => React.ReactNode;
};

const ACTIONS_WIDTH = 110;
const WIDE = 900;

export default function AdminTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  empty,
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  actions?: (row: T) => React.ReactNode;
  empty: string;
}) {
  const { width } = useWindowDimensions();
  if (rows.length === 0) return <Text style={styles.empty}>{empty}</Text>;

  const render = (v: React.ReactNode, textStyle: object) =>
    typeof v === 'string' || typeof v === 'number' ? (
      <Text style={textStyle} selectable>
        {v}
      </Text>
    ) : (
      v
    );

  if (width < WIDE) {
    return (
      <View style={styles.ltr}>
        {rows.map((r) => (
          <View key={rowKey(r)} style={styles.card}>
            {columns.map((c, i) => {
              const v = c.cell(r);
              if (v === '' || v === null || v === undefined || v === false) return null;
              return (
                <View key={i} style={styles.cardLine}>
                  <Text style={styles.cardLabel}>{c.title}</Text>
                  <View style={styles.cardValueWrap}>{render(v, styles.cardValue)}</View>
                </View>
              );
            })}
            {!!actions && <View style={styles.cardActions}>{actions(r)}</View>}
          </View>
        ))}
      </View>
    );
  }

  const total = columns.reduce((n, c) => n + c.width, 0) + (actions ? ACTIONS_WIDTH : 0);
  return (
    <ScrollView horizontal style={styles.ltr} contentContainerStyle={styles.scrollContent}>
      <View style={[styles.table, { width: total }]}>
        <View style={[styles.tr, styles.thead]}>
          {columns.map((c, i) => (
            <Text key={i} style={[styles.th, { width: c.width }]}>
              {c.title}
            </Text>
          ))}
          {!!actions && <View style={{ width: ACTIONS_WIDTH }} />}
        </View>
        {rows.map((r, i) => (
          <View key={rowKey(r)} style={[styles.tr, i % 2 === 1 && styles.zebra]}>
            {columns.map((c, i) => (
              <View key={i} style={[styles.td, { width: c.width }]}>
                {render(c.cell(r), styles.tdText)}
              </View>
            ))}
            {!!actions && <View style={[styles.td, { width: ACTIONS_WIDTH }]}>{actions(r)}</View>}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// The server's own words, in a sentence an admin can act on. Shared by the
// two tester form screens.
export function adminErrorText(e: unknown, fallback: string): string {
  const m = (e as { message?: string } | null)?.message || '';
  if (m.includes('not_admin')) return 'This session is not an unlocked admin session. Sign in to the admin panel again, or enter your code.';
  if (m.includes('not_found')) return 'That is no longer there — someone may have removed it already. Refresh the page.';
  if (m.includes('title_required')) return 'Type the mission’s name in English.';
  if (m.includes('title_too_long')) return 'That name is too long — 200 characters at most.';
  if (m.includes('bad_position')) return 'The number has to be between 1 and 99.';
  if (m.includes('bad_role')) return 'Choose which role sheet the mission belongs to.';
  return fallback;
}

const styles = StyleSheet.create({
  ltr: { direction: 'ltr' } as ViewStyle,
  empty: { ...type.soft, marginVertical: 10 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 8,
    gap: 6,
  },
  cardLine: { gap: 1 },
  cardLabel: { ...type.tiny, textAlign: 'left' },
  cardValueWrap: { alignItems: 'flex-start' },
  cardValue: { ...type.body, textAlign: 'left' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  scrollContent: { flexGrow: 1 },
  table: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  thead: { backgroundColor: colors.surface },
  zebra: { backgroundColor: '#FAFAF7' },
  th: { ...type.tiny, fontWeight: '700', color: colors.ink, paddingHorizontal: 10, paddingVertical: 9, textAlign: 'left' },
  td: { paddingHorizontal: 10, paddingVertical: 9, justifyContent: 'flex-start' },
  tdText: { fontSize: 13, color: colors.ink, lineHeight: 18, textAlign: 'left' },
});
