import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius } from '../theme/theme';
import { ListingDomain } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

// The row of square section tiles, shared by the seller's gate
// (DomainChoiceGate) and the buyer's (BrowseGateScreen). One
// implementation on purpose: these are the same question asked of two
// people, and a marketplace where the seller's Properties tile and the
// buyer's look like two different things reads as two different products.
//
// Tiles are measured, not guessed. Their size decides how big the icon and
// label can be, and whether four of them still fit on one row on a phone --
// hardcoding either would mean a layout that only holds at one window width
// and one domain count, and the count changes the day Jobs & Services is
// switched on. Below MIN_TILE a tile can no longer hold an icon and a
// label, so the row breaks into a grid instead.
const MIN_TILE = 88;
// And a ceiling, so two sections on a wide window do not become two huge
// squares -- past this the row just centres inside the space it has.
const MAX_TILE = 200;
const GAP = 10;
const PAD = 14;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function DomainTiles({
  domains,
  onChoose,
  noteFor,
  style,
}: {
  domains: ListingDomain[];
  onChoose: (domainId: string) => void;
  // A second line under the label -- the buyer's gate puts a live listing
  // count here so an empty section reads as honest rather than broken.
  // Its presence costs the label its second line, which is what keeps the
  // smallest tile that can appear from spilling over its own border.
  noteFor?: (domain: ListingDomain) => string | null;
  style?: object;
}) {
  const { language } = useLanguage();
  const [rowWidth, setRowWidth] = useState(0);

  const onRowLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    // Guard against the resize loop a raw setState in onLayout can cause.
    if (Math.abs(w - rowWidth) > 0.5) setRowWidth(w);
  };

  const count = Math.max(domains.length, 1);
  // onLayout reports the row's border box, so its own horizontal padding
  // comes off before the tiles are divided out of it.
  const inner = Math.max(rowWidth - PAD * 2, 0);
  const fits = (cols: number) => (inner - GAP * (cols - 1)) / cols;
  // One row if every tile still clears MIN_TILE; otherwise two rows.
  const cols = inner === 0 || fits(count) >= MIN_TILE ? count : Math.ceil(count / 2);
  const size = inner === 0 ? 0 : Math.min(Math.floor(fits(cols)), MAX_TILE);

  const tight = size < 110;
  const iconSize = clamp(Math.round(size * 0.28), 20, 44);
  const badge = clamp(Math.round(size * 0.46), 40, 76);
  const labelSize = tight ? 12.5 : 14.5;
  const labelLine = tight ? 15 : 18;
  const inset = tight ? 4 : 8;
  const stackGap = tight ? 6 : 10;

  return (
    <View style={[styles.cards, style]} onLayout={onRowLayout}>
      {/* Nothing is drawn until the row has been measured -- a tile at a
          guessed size would visibly jump on the first frame. */}
      {size > 0 &&
        domains.map((d) => {
          const note = noteFor?.(d) ?? null;
          return (
            <Pressy
              key={d.id}
              onPress={() => onChoose(d.id)}
              style={[styles.card, { width: size, height: size, gap: stackGap, paddingVertical: inset }]}
            >
              <View style={[styles.cardIcon, { width: badge, height: badge, borderRadius: badge / 2 }]}>
                <Icon name={d.icon as IconName} size={iconSize} color={colors.primary} />
              </View>
              <View style={styles.cardText}>
                <Text
                  style={[styles.cardTitle, { fontSize: labelSize, lineHeight: labelLine }]}
                  numberOfLines={noteFor ? 1 : 2}
                >
                  {language === 'ar' ? d.nameAr : d.nameEn}
                </Text>
                {!!note && (
                  <Text style={styles.cardNote} numberOfLines={1}>
                    {note}
                  </Text>
                )}
              </View>
            </Pressy>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    paddingHorizontal: PAD, gap: GAP,
  },
  card: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, paddingHorizontal: 6,
  },
  cardIcon: { backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  cardText: { alignItems: 'center', gap: 2 },
  cardTitle: { fontWeight: '700', color: colors.ink, textAlign: 'center' },
  cardNote: { fontSize: 11.5, lineHeight: 14, color: colors.inkSoft, textAlign: 'center' },
});
