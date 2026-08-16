import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import ListingCard from './ListingCard';
import { colors, type } from '../theme/theme';
import { Category, Listing } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

// One home-page section for a single top-level category: a
// "[Category name] · See all" header row followed by its own
// horizontal-scrolling carousel of that category's listings. Used on the
// mobile home screen (in place of one big combined grid) so listings from
// different categories are never mixed together -- matches the OLX
// reference layout the user asked for.
export default function CategoryCarouselSection({
  category,
  items,
  onSeeAll,
  onPressListing,
}: {
  category: Category;
  items: Listing[];
  onSeeAll: () => void;
  onPressListing: (listing: Listing) => void;
}) {
  const { language, t } = useLanguage();
  const label = language === 'ar' ? category.nameAr : category.nameEn;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>{label}</Text>
        <Pressy onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
        </Pressy>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => (
          <ListingCard key={item.id} listing={item} width={148} onPress={() => onPressListing(item)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 20 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, marginBottom: 10,
  },
  title: { ...type.h3, flex: 1 },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  row: { paddingHorizontal: 18, gap: 12 },
});
