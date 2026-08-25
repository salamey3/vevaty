import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { pickText } from '../lib/listingText';
import { useLanguage } from '../i18n/LanguageContext';
import { Category } from '../types';

// The storefronts directory's category filter -- see ShopsDirectoryScreen.
// Replaces what used to be a horizontally-scrolling chip row: with more
// than a handful of categories in use, a swipeable strip hides most of its
// options off the right edge with no visual hint there's more to see. This
// is the same "tap a button, get a bottom sheet you can actually scroll
// through" shape CategoryPickerModal already uses for the same underlying
// problem on the listing-creation flow, just over the flat categoriesInUse
// list this screen already computes rather than the full category tree.
export default function ShopCategoryFilterModal({
  visible,
  categories,
  activeCategoryId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  categories: Category[];
  activeCategoryId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t, language, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressy onPress={onClose} style={StyleSheet.absoluteFill} haptic={false} />
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 12) }]}>
          <View style={[styles.headerRow, mirrorRow(isRTL)]}>
            <Text style={type.h3}>{t('shopsDirectory.filterModalTitle')}</Text>
            <Pressy onPress={onClose} style={styles.iconBtn}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {categories.map((c, i) => {
              const active = c.id === activeCategoryId;
              return (
                <Pressy
                  key={c.id}
                  onPress={() => onSelect(c.id)}
                  style={[styles.row, mirrorRow(isRTL), i > 0 && styles.rowDivider]}
                >
                  <Text
                    style={[styles.rowLabel, isRTL && styles.rtlText, active && styles.rowLabelActive]}
                    numberOfLines={1}
                  >
                    {pickText(c.nameEn, c.nameAr, language)}
                  </Text>
                  {active && <Icon name="check" size={17} color={colors.ink} />}
                </Pressy>
              );
            })}
          </ScrollView>
        </View>
        <SystemBottomStrip />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,20,22,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 640,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16 },
  bodyContent: { paddingBottom: 8, paddingTop: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, height: 52,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { fontSize: 15.5, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  rtlText: { textAlign: 'right' },
  rowLabelActive: { color: colors.ink, fontWeight: '700' },
});
