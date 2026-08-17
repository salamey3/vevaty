import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point: sits above the category grid on the
// "what are you selling?" screen, visually separated from it, because it
// isn't a category -- it's the alternative to picking one.
//
// The highlight is four coloured arcs chasing each other around the
// button's outline, in the manner of the Google TV logo animation.
//
// Fourth attempt, and the technique changed each time for a reason worth
// recording, because two of the three failures were invisible rather than
// wrong. (1) A gradient sheen across the button's FACE: light crossing the
// middle of a control reads as a loading bar. (2) A rotating gradient
// behind a solid panel, which is how this is normally built on the web: it
// rendered exactly as written and could not be seen, because what it
// produces is a hairline of part-transparent white on a dark button at
// arm's length. (3) Solid dots travelling the perimeter: visible at last,
// but dots are not arcs -- they read as something orbiting the button
// rather than the button's own edge lighting up.
//
// This draws the border as a real SVG stroke and animates strokeDashoffset,
// which is how the effect is actually done. Each colour is the same
// rounded rectangle with a dash pattern of one short segment and one long
// gap, offset by a quarter-perimeter from the one before, so four arcs
// travel the outline in convoy. It is the outline itself that moves, at
// full colour, which is what makes it legible where the earlier attempts
// were not.
const BRAND_ARCS = ['#7c3aed', '#ffffff', '#4f46e5', '#ff5757'];

// One full lap. Slow enough to read as a drift rather than a spinner.
const LAP_MS = 3600;

const STROKE = 2.5;

// Each arc covers this share of the perimeter. Short enough that the four
// stay separate with dark between them, long enough to read as an arc of
// the edge rather than a dash.
const ARC_SHARE = 0.13;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export default function MagicListingButton({ onPress }: { onPress: () => void }) {
  const { t } = useLanguage();
  const progress = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (size.width === 0) return;
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: LAP_MS,
        // Linear: easing makes the arcs visibly slow at the corners, which
        // reads as a stutter rather than as motion.
        easing: Easing.linear,
        // SVG attributes can't go through the native driver -- there is no
        // native shadow-node property to hand them to. One driving value
        // updating four dash offsets is cheap enough, and this button is
        // static on screen while it plays.
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress, size.width]);

  const { width, height } = size;
  const r = radius.md;
  // Perimeter of a rounded rectangle: the straight runs, plus one full
  // circle's worth of corner. The dash pattern is measured in user units
  // along this path, so it has to be right or the arcs drift out of step
  // with the corners.
  const inset = STROKE / 2;
  const w = Math.max(0, width - STROKE);
  const h = Math.max(0, height - STROKE);
  const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
  const arc = perimeter * ARC_SHARE;

  return (
    <Pressy
      onPress={onPress}
      style={styles.shell}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.content}>
        <View style={styles.row}>
          <Icon name="wand" size={20} color={colors.white} />
          <Text style={styles.label}>{t('createListing.magicButton')}</Text>
        </View>
        <Text style={styles.sub}>{t('createListing.magicButtonSub')}</Text>
      </View>

      {width > 0 && perimeter > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={width} height={height}>
            {/* A permanent faint outline underneath, so the button always
                has an edge and the arcs read as light running along
                something rather than appearing out of nothing. */}
            <Rect
              x={inset}
              y={inset}
              width={w}
              height={h}
              rx={r}
              ry={r}
              fill="none"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth={STROKE}
            />
            {BRAND_ARCS.map((color, i) => (
              <AnimatedRect
                key={color}
                x={inset}
                y={inset}
                width={w}
                height={h}
                rx={r}
                ry={r}
                fill="none"
                stroke={color}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${arc},${perimeter - arc}`}
                // Negative offset moves the dash forward along the path.
                // Each colour starts a quarter-lap behind the last, so they
                // stay evenly spaced the whole way round.
                strokeDashoffset={progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-i * (perimeter / BRAND_ARCS.length), -i * (perimeter / BRAND_ARCS.length) - perimeter],
                })}
              />
            ))}
          </Svg>
        </View>
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    width: '100%',
    // No overflow:hidden -- the stroke is drawn inside the bounds and
    // clipping a rounded SVG against a rounded parent only ever costs a
    // half-pixel of the outline on Android.
    position: 'relative',
  },
  content: { paddingVertical: 16, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...type.h3, color: colors.white },
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
});
