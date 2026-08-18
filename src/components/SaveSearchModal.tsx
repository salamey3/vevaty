import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet } from 'react-native';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Button from './Button';
import { colors, type, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// Small "name this search" prompt, shown when a shopper taps "Save this
// search" on Home's filter sidebar/modal. Modeled on ConfirmDialog.tsx's
// Modal shape (react-native-web's Alert.alert is a no-op, and there's no
// Alert.prompt equivalent anyway since this needs actual text entry).
export default function SaveSearchModal({
  visible,
  defaultLabel,
  loading,
  onSave,
  onCancel,
}: {
  visible: boolean;
  defaultLabel: string;
  loading?: boolean;
  onSave: (label: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [label, setLabel] = useState(defaultLabel);

  // Reseed the input from the current filter state's suggested label every
  // time the modal opens (not just on first mount, since HomeScreen reuses
  // one modal instance across repeated opens with different defaults).
  useEffect(() => {
    if (visible) setLabel(defaultLabel);
  }, [visible, defaultLabel]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressy onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <Text style={styles.title}>{t('home.savedSearches.saveTitle')}</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={t('home.savedSearches.labelPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
            autoFocus
          />
          <View style={styles.actions}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} style={styles.actionBtn} />
            <Button
              label={t('common.save')}
              onPress={() => onSave(label.trim())}
              loading={loading}
              disabled={label.trim().length === 0}
              style={styles.actionBtn}
            />
          </View>
        </View>
        <SystemBottomStrip />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 22,
    gap: 12,
  },
  title: { ...type.h3 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
  },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, height: 46 },
});
