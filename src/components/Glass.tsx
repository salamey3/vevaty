import React from 'react';
import { StyleSheet, View, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radius } from '../theme/theme';

type Props = ViewProps & { radiusSize?: number; intensity?: number; tint?: 'light' | 'dark' };

// A reusable "liquid glass" surface: blurred, translucent, soft border + shadow.
// This is the native equivalent of the .glass / backdrop-filter treatment used
// throughout the web prototype.
export default function Glass({ style, radiusSize = radius.lg, intensity = 40, tint = 'light', children, ...rest }: Props) {
  return (
    <View style={[{ borderRadius: radiusSize, overflow: 'hidden' }, styles.shadowWrap]} {...rest}>
      <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      <View
        style={[
          styles.tint,
          { borderRadius: radiusSize },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    shadowColor: '#18181a',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  tint: {
    backgroundColor: colors.glassBg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
});
