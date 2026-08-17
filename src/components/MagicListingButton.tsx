import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point: sits above the category grid on the
// "what are you selling?" screen, visually separated from it, because it
// isn't a category -- it's the alternative to picking one.
//
// The light sweep exists to make it read as the recommended path without
// resorting to a "NEW!" badge or a colour that fights the rest of the UI.
// It is deliberately restrained: one slow pass, low opacity, no bounce.
// A stronger animation on a screen the seller sees every time they post
// stops being a highlight and becomes something to endure.

// One full pass of the sweep. Slow enough to read as a sheen rather than
// a loading indicator -- anything under about a second reads as "busy".
const SWEEP_DURATION_MS = 2600;

// Pause between passes, so it draws the eye and then leaves it alone.
const SWEEP_GAP_MS = 2200;

// How wide the moving highlight is, as a fraction of the button's width.
const SWEEP_WIDTH = 0.35;

export default function MagicListingButton({ onPress }: { onPress: () => void }) {
  const { t, isRTL } = useLanguage();
  // 0 -> 1 drives the highlight from one edge to the other. Native driver
  // is safe here: only transform and opacity are animated, never layout.
  const sweep = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = React.useState(0);

  useEffect(() => {
    // No point animating before the button has been measured -- the
    // translate distance is derived from its width.
    if (width === 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: SWEEP_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(SWEEP_GAP_MS),
        // Snap back invisibly: the highlight is off-screen at both ends,
        // so resetting without animating is unnoticeable and avoids a
        // second visible pass in the wrong direction.
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, width]);

  const sweepWidth = Math.max(40, width * SWEEP_WIDTH);
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    // Starts fully off one edge and ends fully off the other. Mirrored in
    // Arabic so the sheen travels with the reading direction rather than
    // against it.
    outputRange: isRTL ? [width, -sweepWidth] : [-sweepWidth, width],
  });

  return (
    <Pressy onPress={onPress} style={styles.button} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* Sits behind the label, clipped by the button's own overflow:hidden
          so it disappears cleanly at the rounded corners. pointerEvents
          none so it never intercepts the tap. */}
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.sweep, { width: sweepWidth, transform: [{ translateX }, { skewX: '-20deg' }] }]}
        />
      )}
      <View style={styles.row}>
        <Icon name="wand" size={20} color={colors.white} />
        <Text style={styles.label}>{t('createListing.magicButton')}</Text>
      </View>
      <Text style={styles.sub}>{t('createListing.magicButtonSub')}</Text>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: 18,
    overflow: 'hidden',
    width: '100%',
  },
  sweep: {
    position: 'absolute',
    top: -20,
    bottom: -20,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...type.h3, color: colors.white },
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
});
