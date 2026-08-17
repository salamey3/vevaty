import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point, and its one piece of theatre: three
// brand-coloured arcs run twice around the button's outline, then peel off
// and land on the wand's three stars, colouring them one by one, ending
// with a glow on the topmost.
//
// It resolves rather than loops. A permanent animation on a screen the
// seller sees on every post stops being a highlight and becomes something
// to sit through; one that plays, finishes and leaves a coloured icon
// behind draws the eye once and then gets out of the way -- and it leaves
// the button visibly different from before it ran, which a loop never
// does.
//
// Fourth technique, and the two failures are worth recording because both
// were invisible rather than wrong. A gradient sheen across the button's
// FACE reads as a loading bar. A rotating gradient behind a solid panel --
// the usual web recipe -- rendered exactly as written and could not be
// seen: it produces a hairline of part-transparent white on a dark button
// at arm's length. The lesson each time was that "more correct" and "more
// legible" are different goals, so this draws the border as a real SVG
// stroke at full colour and animates strokeDashoffset, which is how the
// effect is actually built.

const ARC_COLORS = ['#7c3aed', '#4f46e5', '#ff5757'];

// Which colour each of the wand's stars ends up. The top star takes the
// primary violet because it's the one that glows last, so the sequence
// finishes on the brand's own colour.
const STAR_TOP = '#7c3aed';
const STAR_UPPER_LEFT = '#4f46e5';
const STAR_LOWER_RIGHT = '#ff5757';

const LAP_MS = 1800;
const LAPS = 2;
const FINISH_MS = 2200;
const TOTAL_MS = LAP_MS * LAPS + FINISH_MS;
const TRAVEL_MS = LAP_MS * LAPS;

// Keyframes are written in milliseconds and converted, rather than as raw
// fractions of the timeline. Written as fractions, the first version put
// the glow's peak at 1.07 -- past the end -- so it was silently clamped
// and the sequence finished on a half-lit star. Milliseconds are checkable
// against the durations above by reading them; fractions are not.
const at = (ms: number) => Math.min(1, ms / TOTAL_MS);
const TRAVEL = at(TRAVEL_MS);

const STROKE = 2.5;
const ARC_SHARE = 0.13;

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Same geometry as the `wand` glyph in Icon.tsx, split into its parts so
// each star can be lit on its own.
const WAND_SHAFT = 'M4.5 19.5 13.5 10.5';
const WAND_STAR_TOP = 'M17.5 3 18.5 6 21.5 7 18.5 8 17.5 11 16.5 8 13.5 7 16.5 6 Z';
const WAND_STAR_UPPER_LEFT = 'M8.5 3.5 9 5 10.5 5.5 9 6 8.5 7.5 8 6 6.5 5.5 8 5 Z';
const WAND_STAR_LOWER_RIGHT = 'M19.5 14 19.9 15.1 21 15.5 19.9 15.9 19.5 17 19.1 15.9 18 15.5 19.1 15.1 Z';

export default function MagicListingButton({ onPress }: { onPress: () => void }) {
  const { t } = useLanguage();
  const progress = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (size.width === 0) return;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: TOTAL_MS,
      // Linear: easing makes the arcs visibly slow at the corners, which
      // reads as a stutter rather than as motion.
      easing: Easing.linear,
      // SVG attributes have no native shadow-node property to hand off to,
      // so this can't use the native driver. One driving value feeding a
      // handful of attributes is cheap, it runs once rather than forever,
      // and the button is static on screen while it plays.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, size.width]);

  const { width, height } = size;
  const r = radius.md;
  const inset = STROKE / 2;
  const w = Math.max(0, width - STROKE);
  const h = Math.max(0, height - STROKE);
  // Perimeter of a rounded rectangle: the straight runs, plus one full
  // circle's worth of corner. The dash pattern is measured in user units
  // along this path, so a wrong total makes the arcs drift out of step
  // with the corners as they travel.
  const perimeter = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
  const arc = perimeter * ARC_SHARE;

  // The arcs hold full strength through the laps, then fade as they hand
  // over to the stars.
  const arcOpacity = progress.interpolate({
    inputRange: [0, at(TRAVEL_MS - 150), at(TRAVEL_MS + 350), 1],
    outputRange: [1, 1, 0, 0],
  });

  // Each star lights shortly after the arcs release, one after another,
  // ending on the top one.
  const starOpacity = (order: number) =>
    progress.interpolate({
      inputRange: [
        0,
        at(TRAVEL_MS + 250 + order * 300),
        at(TRAVEL_MS + 550 + order * 300),
        1,
      ],
      outputRange: [0, 0, 1, 1],
      extrapolate: 'clamp',
    });

  // A single soft pulse behind the top star to close the sequence.
  const glowOpacity = progress.interpolate({
    inputRange: [0, at(TRAVEL_MS + 1250), at(TRAVEL_MS + 1800), 1],
    outputRange: [0, 0, 0.6, 0.3],
    extrapolate: 'clamp',
  });
  const glowRadius = progress.interpolate({
    inputRange: [0, at(TRAVEL_MS + 1250), 1],
    outputRange: [1, 1, 5.5],
    extrapolate: 'clamp',
  });

  return (
    <Pressy
      onPress={onPress}
      style={styles.shell}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.content}>
        <View style={styles.row}>
          <View style={styles.wand}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d={WAND_SHAFT}
                stroke={colors.white}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Each star is drawn white first and then over-painted by
                  its coloured twin as that twin fades in, so the icon
                  reads normally before the sequence reaches it. */}
              {[
                { d: WAND_STAR_UPPER_LEFT, color: STAR_UPPER_LEFT, order: 0 },
                { d: WAND_STAR_LOWER_RIGHT, color: STAR_LOWER_RIGHT, order: 1 },
                { d: WAND_STAR_TOP, color: STAR_TOP, order: 2 },
              ].map((star) => (
                <React.Fragment key={star.d}>
                  <Path
                    d={star.d}
                    stroke={colors.white}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <AnimatedPath
                    d={star.d}
                    stroke={star.color}
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={star.color}
                    opacity={starOpacity(star.order)}
                  />
                </React.Fragment>
              ))}
              {/* Centred on the top star's own centre point. */}
              <AnimatedCircle cx={17.5} cy={7} r={glowRadius} fill={STAR_TOP} opacity={glowOpacity} />
            </Svg>
          </View>
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
            {ARC_COLORS.map((color, i) => {
              const start = -i * (perimeter / ARC_COLORS.length);
              return (
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
                  // Each colour starts a third of a lap behind the last, so
                  // they stay evenly spaced the whole way round, and all
                  // three cover LAPS laps in the travel phase.
                  strokeDashoffset={progress.interpolate({
                    inputRange: [0, TRAVEL, 1],
                    outputRange: [start, start - perimeter * LAPS, start - perimeter * LAPS],
                  })}
                  opacity={arcOpacity}
                />
              );
            })}
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
    position: 'relative',
  },
  content: { paddingVertical: 16, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wand: { width: 22, height: 22 },
  label: { ...type.h3, color: colors.white },
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
});
