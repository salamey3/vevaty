import React, { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Screen from './Screen';
import Pressy from './Pressy';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { ListingDomain } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

// The sell gate: what kind of thing is this? Asked once, before any photo
// is taken, because it is the one question the photos genuinely cannot
// answer -- an apartment interior really does contain furniture, so a
// classifier choosing between "Apartment" and "Decor Concept" on the same
// pictures is guessing, not failing. See DOMAINS.md.
//
// Laid out as square tiles side by side rather than stacked full-width
// rows, so the whole choice is one glance instead of a list to read down.
// Wrapped in Screen (like ShopChoiceGate, the other in-screen gate) so it
// gets the app background and safe-area insets, and so a wide desktop
// window centres it at 640 instead of stretching three tiles across the
// whole viewport.

// Tiles are measured, not guessed. Their size decides how big the icon and
// label can be, and whether four of them still fit on one row on a phone --
// hardcoding either would mean a layout that only holds at one width and
// one domain count. Below this width a tile can no longer hold an icon and
// a two-line label, so the row breaks into a grid instead.
const MIN_TILE = 88;
// And a ceiling, so two domains on a wide window do not become two huge
// squares -- past this the row just centres inside the space it has.
const MAX_TILE = 200;
const GAP = 10;
const PAD = 14;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function DomainChoiceGate({
  domains,
  onChoose,
  onBack,
  title,
  subtitle,
}: {
  domains: ListingDomain[];
  onChoose: (domainId: string) => void;
  onBack: () => void;
  title: string;
  subtitle: string;
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
  // One row if every tile still clears MIN_TILE; otherwise two rows (the
  // Dubizzle grid). Only reachable at four domains on a narrow phone.
  const cols = inner === 0 || fits(count) >= MIN_TILE ? count : Math.ceil(count / 2);
  const size = inner === 0 ? 0 : Math.min(Math.floor(fits(cols)), MAX_TILE);

  // Everything inside a tile is sized off the tile, so the smallest one
  // that can appear (MIN_TILE, at four domains on a narrow phone) still
  // holds a badge and a two-line label inside its padding rather than
  // spilling over its own border.
  const tight = size < 110;
  const iconSize = clamp(Math.round(size * 0.28), 20, 44);
  const badge = clamp(Math.round(size * 0.46), 40, 76);
  const labelSize = tight ? 12.5 : 14.5;
  const labelLine = tight ? 15 : 18;
  const inset = tight ? 4 : 8;
  const stackGap = tight ? 6 : 10;

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={onBack} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{title}</Text>
        <View style={styles.iconBtn} />
      </View>

      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.cards} onLayout={onRowLayout}>
        {/* Nothing is drawn until the row has been measured -- a tile at a
            guessed size would visibly jump on the first frame. */}
        {size > 0 &&
          domains.map((d) => (
            <Pressy
              key={d.id}
              onPress={() => onChoose(d.id)}
              style={[styles.card, { width: size, height: size, gap: stackGap, paddingVertical: inset }]}
            >
              <View style={[styles.cardIcon, { width: badge, height: badge, borderRadius: badge / 2 }]}>
                <Icon name={d.icon as IconName} size={iconSize} color={colors.primary} />
              </View>
              <Text
                style={[styles.cardTitle, { fontSize: labelSize, lineHeight: labelLine }]}
                numberOfLines={2}
              >
                {language === 'ar' ? d.nameAr : d.nameEn}
              </Text>
            </Pressy>
          ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...type.soft, paddingHorizontal: PAD + 4, marginBottom: 18 },
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
  cardTitle: { fontWeight: '700', color: colors.ink, textAlign: 'center' },
});
