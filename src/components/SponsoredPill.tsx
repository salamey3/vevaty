import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The buyer-facing mark on a listing whose seller has paid points to have it
// promoted. Gold, matching the Featured badge the seller already sees on
// their own My Listings row, so the thing they bought looks like one thing
// across the app.
//
// "Currently boosted" means FEATURED, and only featured. A Bump Up is the
// other boost, and it deliberately gets no pill: it has no duration -- it
// moves the listing once, the way re-posting would -- so there is no window
// during which it would be true to call the listing sponsored, and marking
// it for some invented number of days would be a claim the database cannot
// back. isFeaturedNow (see lib/listingSort.ts) is the single test, used by
// both surfaces that show this.
export default function SponsoredPill({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <View style={[styles.pill, compact && styles.pillCompact]}>
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>
        {t('listing.sponsored')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The grid card is a third of a phone's width at its narrowest, where a
  // full-size pill eats the photo it is sitting on.
  pillCompact: { paddingHorizontal: 7, height: 18 },
  text: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textCompact: { fontSize: 9, letterSpacing: 0.3 },
});
