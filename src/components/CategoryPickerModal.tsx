import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Icon from '../icons/Icon';
import CategoryPicker from './CategoryPicker';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { CategoryId } from '../types';

// The "browse all categories" fallback on the classify step -- a thin
// sheet around the plain CategoryPicker tree, for a seller who'd rather
// drill down by hand than type into CategorySuggestInput. Same bottom-
// sheet shell MagicListingModal used (backdrop/sheet/headerRow, capped at
// the same 640 the screen underneath is capped to), since it's replacing
// that as this screen's only modal.
export default function CategoryPickerModal({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: CategoryId | null;
  onSelect: (id: CategoryId) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 12) }]}>
          <View style={styles.headerRow}>
            <Text style={type.h3}>{t('createListing.categoryLabel')}</Text>
            <Pressy onPress={onClose} style={styles.iconBtn}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <CategoryPicker
              value={value}
              onSelect={(id) => {
                onSelect(id);
                onClose();
              }}
            />
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
    maxHeight: '90%',
    width: '100%',
    maxWidth: 640,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8 },
});
