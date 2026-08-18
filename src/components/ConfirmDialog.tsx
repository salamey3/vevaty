import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Button from './Button';
import { colors, type, radius } from '../theme/theme';

// A confirm dialog rendered as an actual in-app modal, NOT react-native's
// Alert.alert -- react-native-web ships Alert.alert as a total no-op
// (`static alert() {}`), so anything relying on it silently does nothing
// on the deployed web build. This component works the same on web and
// native.
export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressy onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="secondary" onPress={onCancel} style={styles.actionBtn} />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              loading={loading}
              style={[styles.actionBtn, destructive ? styles.dangerBtn : undefined] as any}
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
    gap: 6,
  },
  title: { ...type.h3 },
  message: { ...type.soft, lineHeight: 19, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, height: 46 },
  dangerBtn: { backgroundColor: colors.danger },
});
