import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Button from './Button';
import { colors, type, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { registerAlertHost, AlertButton } from '../lib/alertShim';

// Renders whatever the alertShim's `Alert.alert(...)` calls ask for, as an
// actual in-app modal (react-native's own Alert.alert is a no-op on web --
// see alertShim.ts for the full story). Mount this once near the app root;
// every screen's `Alert.alert(...)` call (via the shim) shows up here.
export default function AlertHost() {
  const { t } = useLanguage();
  const [state, setState] = useState<{ title: string; message?: string; buttons: AlertButton[] } | null>(null);

  useEffect(() => {
    registerAlertHost((title, message, buttons) => {
      const resolved = buttons && buttons.length > 0 ? buttons : [{ text: t('common.ok'), style: 'default' as const }];
      setState({ title, message, buttons: resolved });
    });
    return () => registerAlertHost(null);
  }, [t]);

  if (!state) return null;

  const close = () => setState(null);
  const press = (btn: AlertButton) => {
    close();
    btn.onPress?.();
  };

  // A 'cancel' style button renders first (left), matching the Cancel/Delete
  // layout already used elsewhere (e.g. ConfirmDialog).
  const ordered = [...state.buttons].sort((a, b) => {
    const rank = (s?: AlertButton['style']) => (s === 'cancel' ? 0 : 1);
    return rank(a.style) - rank(b.style);
  });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressy onPress={close} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <Text style={styles.title}>{state.title}</Text>
          {!!state.message && <Text style={styles.message}>{state.message}</Text>}
          <View style={styles.actions}>
            {ordered.map((btn, i) => (
              <Button
                key={i}
                label={btn.text || t('common.ok')}
                variant={btn.style === 'cancel' ? 'secondary' : 'primary'}
                onPress={() => press(btn)}
                style={[styles.actionBtn, btn.style === 'destructive' ? styles.dangerBtn : undefined] as any}
              />
            ))}
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
