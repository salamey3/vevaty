import React from 'react';
import { StyleSheet, Text, ActivityIndicator, ViewStyle } from 'react-native';
import Pressy from './Pressy';
import { colors, radius } from '../theme/theme';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

export default function Button({ label, onPress, variant = 'primary', disabled, loading, style }: Props) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  return (
    <Pressy
      onPress={disabled || loading ? undefined : onPress}
      style={[
        styles.base,
        isPrimary && styles.primary,
        isSecondary && styles.secondary,
        variant === 'ghost' && styles.ghost,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.white : colors.ink} />
      ) : (
        <Text style={[styles.label, isPrimary ? styles.labelPrimary : styles.labelDark]}>{label}</Text>
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 15.5,
    fontWeight: '600',
  },
  labelPrimary: { color: colors.white },
  labelDark: { color: colors.ink },
});
