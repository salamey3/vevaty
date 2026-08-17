import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point: sits above the category grid on the
// "what are you selling?" screen, visually separated from it, because it
// isn't a category -- it's the alternative to picking one.
//
// The highlight is a bright dot that travels around the button's border,
// leaving a lit trail, over a permanently visible outline.
//
// This is the third attempt and the first that can actually be seen, so
// the two dead ends are worth recording. A gradient sheen sweeping across
// the button's FACE reads as a loading bar -- light crossing the middle of
// a control says "wait", where light at the edge says "look here". Then a
// rotating conic-style gradient behind a solid panel, which is how this
// effect is usually built on the web: it rendered correctly and was still
// invisible on a phone, because what it produces is a hairline of
// part-transparent white on a dark button seen at arm's length.
//
// So this drops gradients entirely. Discrete views with solid colours,
// moved along the perimeter by interpolating translateX and translateY
// through the four corners. Nothing depends on gradient support, on
// overflow clipping a rotated child, or on a 2px band being legible.
// Position is unambiguous, and brightness is a number you can raise.

// One full circuit. Slow enough to read as a drifting highlight rather
// than a spinner -- below about three seconds it starts to look busy.
const CIRCUIT_MS = 3800;

// The lit dot, and the fainter ones trailing behind it. Each is offset
// slightly earlier in the circuit, which is what makes it read as motion
// with a tail rather than as four separate dots.
const TRAIL = [
  { lag: 0, opacity: 1, size: 26 },
  { lag: 0.035, opacity: 0.55, size: 22 },
  { lag: 0.07, opacity: 0.28, size: 18 },
  { lag: 0.11, opacity: 0.12, size: 14 },
];

const BORDER = 1.5;

export default function MagicListingButton({ onPress }: { onPress: () => void }) {
  const { t } = useLanguage();
  const progress = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (size.width === 0) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: CIRCUIT_MS,
        // Linear on purpose: easing makes the dot appear to hesitate at
        // the corners, which reads as a stutter rather than as motion.
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress, size.width]);

  // Trace the rectangle: across the top, down the right, back along the
  // bottom, up the left. Interpolation is linear between the corner stops,
  // so each quarter of `progress` covers one edge.
  const dotAt = (lag: number, dotSize: number) => {
    const w = Math.max(0, size.width - dotSize);
    const h = Math.max(0, size.height - dotSize);
    // Subtracting the lag and wrapping with modulo isn't possible inside
    // an interpolation, so instead each trailing dot runs the same path on
    // an input range shifted forward by its lag -- same effect, and it
    // stays on the native driver.
    const shift = (v: number) => Math.min(1, Math.max(0, v + lag));
    const input = [0, 0.25, 0.5, 0.75, 1].map(shift);
    // A shifted range can collapse duplicate stops at the end, which
    // interpolate rejects; nudge any duplicate forward by a hair.
    for (let i = 1; i < input.length; i++) {
      if (input[i] <= input[i - 1]) input[i] = input[i - 1] + 0.0001;
    }
    return {
      translateX: progress.interpolate({ inputRange: input, outputRange: [0, w, w, 0, 0] }),
      translateY: progress.interpolate({ inputRange: input, outputRange: [0, 0, h, h, 0] }),
    };
  };

  return (
    <Pressy
      onPress={onPress}
      style={styles.shell}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {size.width > 0 &&
        TRAIL.map((dot, i) => {
          const { translateX, translateY } = dotAt(dot.lag, dot.size);
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                styles.dot,
                {
                  width: dot.size,
                  height: dot.size,
                  borderRadius: dot.size / 2,
                  opacity: dot.opacity,
                  transform: [{ translateX }, { translateY }],
                },
              ]}
            />
          );
        })}

      {/* Sits above the dots and below the text, so the trail glows from
          behind the button's own surface rather than over the words. */}
      <View style={styles.face} pointerEvents="none" />

      <View style={styles.content}>
        <View style={styles.row}>
          <Icon name="wand" size={20} color={colors.white} />
          <Text style={styles.label}>{t('createListing.magicButton')}</Text>
        </View>
        <Text style={styles.sub}>{t('createListing.magicButtonSub')}</Text>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.ink,
    width: '100%',
    position: 'relative',
  },
  dot: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#ffffff',
  },
  // Translucent rather than opaque: the dots pass underneath it, so the
  // light reads as coming through the surface near the edge instead of
  // being a white ball sliding across a button.
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: BORDER,
    borderRadius: radius.md - BORDER,
    backgroundColor: 'rgba(20,20,22,0.86)',
  },
  content: { paddingVertical: 16, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...type.h3, color: colors.white },
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
});
