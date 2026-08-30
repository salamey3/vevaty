import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
// Modelled on ShopChoiceGate, which SellHubScreen already renders as an
// in-screen step rather than a route: same shape, same place in the flow,
// one fewer screen in the back stack to reason about.
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

  return (
    <View style={styles.wrap}>
      <View style={styles.topBar}>
        <Pressy onPress={onBack} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{title}</Text>
        <View style={styles.iconBtn} />
      </View>

      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.cards}>
        {domains.map((d) => (
          <Pressy key={d.id} onPress={() => onChoose(d.id)} style={styles.card}>
            <View style={styles.cardIcon}>
              <Icon name={d.icon as IconName} size={22} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>{language === 'ar' ? d.nameAr : d.nameEn}</Text>
            {/* Icon takes no style prop, so the flip lives on a wrapper. */}
            <View style={styles.chevron}>
              <Icon name="back" size={16} color={colors.inkSoft} />
            </View>
          </Pressy>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...type.soft, paddingHorizontal: 22, marginBottom: 18 },
  cards: { paddingHorizontal: 18, gap: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: 18,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { flex: 1, fontSize: 16.5, fontWeight: '700', color: colors.ink },
  // The back chevron flipped to point forward -- there is no separate
  // forward glyph in the icon set.
  chevron: { transform: [{ scaleX: -1 }] },
});
