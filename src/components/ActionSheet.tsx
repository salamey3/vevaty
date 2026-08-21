import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';

export type ActionSheetOption = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title?: string;
  options: ActionSheetOption[];
  cancelLabel: string;
  onCancel: () => void;
};

// A generic "tap something -> choose one of a few actions" bottom sheet,
// styled after the iOS/Android action-sheet convention (a rounded card of
// options, a gap, then a separate Cancel row) -- there was no reusable
// popup-menu component in this codebase before this (only full dialogs
// like ConfirmDialog and bottom sheets built one-off per screen, e.g.
// MagicListingModal), so this one is deliberately generic rather than
// avatar-specific, in case a later screen wants the same "tap a photo,
// pick delete or replace" interaction MyStorefrontScreen's logo picker
// still handles as two always-visible buttons instead.
export default function ActionSheet({ visible, title, options, cancelLabel, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressy onPress={onCancel} style={StyleSheet.absoluteFill} haptic={false} />
        <View style={[styles.wrap, { paddingBottom: Math.max(18, insets.bottom + 12) }]}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          <View style={styles.card}>
            {options.map((opt, i) => (
              <Pressy
                key={opt.label}
                onPress={opt.onPress}
                style={[styles.row, i > 0 && styles.rowDivider]}
              >
                {!!opt.icon && (
                  <Icon name={opt.icon} size={17} color={opt.destructive ? colors.danger : colors.ink} />
                )}
                <Text style={[styles.rowLabel, opt.destructive && styles.rowLabelDestructive]}>{opt.label}</Text>
              </Pressy>
            ))}
          </View>
          <Pressy onPress={onCancel} style={styles.cancelCard}>
            <Text style={styles.cancelLabel}>{cancelLabel}</Text>
          </Pressy>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  wrap: { width: '100%', maxWidth: 420, paddingHorizontal: 12 },
  title: {
    ...type.tiny,
    textAlign: 'center',
    color: colors.inkSoft,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { fontSize: 16, fontWeight: '600', color: colors.ink },
  rowLabelDestructive: { color: colors.danger },
  cancelCard: {
    marginTop: 10,
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
