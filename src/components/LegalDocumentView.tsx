import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { LegalBlock, LegalBody } from '../lib/legal';

// Renders a stored legal document.
//
// The body arrives as structure, not markup, so there is no parser here
// and nothing is trusted: every block type is matched by name and anything
// unrecognised is skipped. A document is displayed to every user of the
// app, and rendering arbitrary HTML from a table would be the wrong shape
// of trust even when we are the ones filling the table.
//
// **bold** is the single inline marker, split by hand below. A markdown
// dependency for one marker would be a new package on the OTA runtime
// fingerprint, which orphans every installed app.

const BOLD = /\*\*([\s\S]+?)\*\*/g;

// Splits a run of text into normal and bold spans. Returns Text children
// rather than a string so the bold parts keep their weight.
function inline(text: string, boldStyle: any) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BOLD.lastIndex = 0;
  while ((m = BOLD.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<Text key={`${m.index}`} style={boldStyle}>{m[1]}</Text>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function LegalDocumentView({ body }: { body: LegalBody }) {
  const { isRTL } = useLanguage();
  const rtl = isRTL ? styles.rtl : null;

  const block = (b: LegalBlock, i: number) => {
    switch (b.t) {
      case 'p':
        if (!b.text) return null;
        return <Text key={i} style={[styles.p, rtl]}>{inline(b.text, styles.bold)}</Text>;

      case 'ul':
        if (!Array.isArray(b.items)) return null;
        return (
          <View key={i} style={styles.ul}>
            {b.items.map((item, j) => (
              <View key={j} style={[styles.li, mirrorRow(isRTL)]}>
                <Text style={styles.bullet}>{'•'}</Text>
                <Text style={[styles.p, styles.liText, rtl]}>{inline(item, styles.bold)}</Text>
              </View>
            ))}
          </View>
        );

      case 'note':
        if (!b.text) return null;
        return (
          <View key={i} style={[styles.note, isRTL ? styles.noteRTL : styles.noteLTR]}>
            <Text style={[styles.p, styles.noteText, rtl]}>{inline(b.text, styles.bold)}</Text>
          </View>
        );

      case 'table':
        if (!Array.isArray(b.cols) || !Array.isArray(b.rows)) return null;
        return (
          <View key={i} style={styles.tableWrap}>
            {b.caption ? <Text style={[styles.caption, rtl]}>{b.caption}</Text> : null}
            {/* Its own horizontal scroller: a table of figures must never
                make the page itself scroll sideways. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.table}>
                <View style={[styles.tr, styles.thead]}>
                  {b.cols.map((c, j) => (
                    <Text
                      key={j}
                      style={[styles.th, isRTL && styles.cellRTL,
                              c.align === 'right' && (isRTL ? styles.figuresRTL : styles.figuresLTR),
                              j === 0 ? styles.colWide : styles.colNarrow]}
                    >
                      {c.label}
                    </Text>
                  ))}
                </View>
                {b.rows.map((row, j) => (
                  <View key={j} style={styles.tr}>
                    {row.map((cell, k) => (
                      <Text
                        key={k}
                        style={[styles.td, isRTL && styles.cellRTL,
                                b.cols[k]?.align === 'right' && (isRTL ? styles.figuresRTL : styles.figuresLTR),
                                k === 0 ? styles.colWide : styles.colNarrow]}
                      >
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        );

      case 'figures':
        if (!Array.isArray(b.rows)) return null;
        return (
          <View key={i} style={styles.figures}>
            <Text style={[styles.figTitle, rtl]}>{b.title}</Text>
            {b.note ? <Text style={[styles.figNote, rtl]}>{b.note}</Text> : null}
            {b.rows.map((r, j) => (
              <View
                key={j}
                style={[styles.figRow, mirrorRow(isRTL), r.kind === 'total' && styles.figTotal]}
              >
                <Text style={[styles.figLabel, rtl, r.kind === 'total' && styles.bold]}>{r.label}</Text>
                <Text
                  style={[styles.figValue, r.kind === 'total' && styles.figValueTotal,
                          r.kind === 'minus' && styles.figValueMinus]}
                >
                  {r.value}
                </Text>
              </View>
            ))}
          </View>
        );

      default:
        // A block type this build does not know about. Skipped rather than
        // rendered as JSON: an older app reading a newer document should
        // show a slightly shorter clause, not a stack trace.
        return null;
    }
  };

  return (
    <View>
      {body.keyTerms && body.keyTerms.length > 0 ? (
        <View style={[styles.keyTerms, mirrorRow(isRTL)]}>
          {body.keyTerms.map((k, i) => (
            <View key={i} style={styles.kt}>
              <Text style={[styles.ktLabel, rtl]}>{k.label}</Text>
              <Text style={[styles.ktValue, rtl]}>{k.value}</Text>
              {k.note ? <Text style={[styles.ktNote, rtl]}>{k.note}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {(body.clauses || []).map((c) => (
        <View key={c.n} style={styles.clause}>
          <View style={[styles.clauseHead, mirrorRow(isRTL)]}>
            <Text style={styles.cn}>{c.n}</Text>
            <Text style={[styles.heading, rtl]}>{c.heading}</Text>
          </View>
          <View style={styles.clauseBody}>{(c.blocks || []).map(block)}</View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  p: { fontSize: 14.5, lineHeight: 21, color: colors.ink, marginBottom: 10 },
  bold: { fontWeight: '700' },

  ul: { marginBottom: 6 },
  li: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  bullet: { fontSize: 14.5, lineHeight: 21, color: colors.inkSoft },
  liText: { flex: 1, marginBottom: 4 },

  note: {
    backgroundColor: colors.warnBg, borderRadius: radius.sm,
    paddingVertical: 11, paddingHorizontal: 13, marginBottom: 11,
  },
  noteLTR: { borderLeftWidth: 3, borderLeftColor: colors.accentDeep },
  noteRTL: { borderRightWidth: 3, borderRightColor: colors.accentDeep },
  noteText: { marginBottom: 0 },

  tableWrap: { marginBottom: 14 },
  caption: { ...type.tiny, fontWeight: '700', marginBottom: 7, letterSpacing: 0.2 },
  table: { minWidth: 260 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line },
  thead: { borderBottomColor: colors.inkSoft },
  th: {
    ...type.tiny, fontWeight: '700', paddingVertical: 7, paddingRight: 14,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  td: { fontSize: 13.5, color: colors.ink, paddingVertical: 8, paddingRight: 14 },
  // A money column hugs the outer edge, which is the RIGHT in English and
  // the LEFT in Arabic. `textAlign: right` for both was correct in exactly
  // one of the two languages.
  figuresLTR: { textAlign: 'right', paddingRight: 0 },
  figuresRTL: { textAlign: 'left', paddingLeft: 0, paddingRight: 14 },
  cellRTL: { textAlign: 'right', paddingRight: 0, paddingLeft: 14 },
  colWide: { minWidth: 150 },
  colNarrow: { minWidth: 84 },

  figures: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    padding: 14, marginBottom: 12, backgroundColor: colors.bg,
  },
  figTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginBottom: 3 },
  figNote: { ...type.tiny, lineHeight: 17, marginBottom: 9 },
  figRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  figTotal: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.inkSoft, marginTop: 2 },
  figLabel: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  figValue: { fontSize: 13.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  figValueRTL: { textAlign: 'left' },
  figValueTotal: { fontWeight: '800', color: colors.primary },
  figValueMinus: { color: colors.inkSoft },

  keyTerms: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22,
  },
  kt: {
    flexGrow: 1, flexBasis: 150, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12,
  },
  ktLabel: {
    ...type.tiny, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 4,
  },
  ktValue: { fontSize: 17, fontWeight: '800', color: colors.primary, marginBottom: 3 },
  ktNote: { ...type.tiny, lineHeight: 16 },

  clause: { marginBottom: 22 },
  clauseHead: { flexDirection: 'row', alignItems: 'baseline', gap: 9, marginBottom: 8 },
  cn: {
    fontSize: 12.5, fontWeight: '800', color: colors.primary,
    minWidth: 18, fontVariant: ['tabular-nums'],
  },
  heading: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink, lineHeight: 21 },
  clauseBody: { paddingLeft: 0 },

  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
