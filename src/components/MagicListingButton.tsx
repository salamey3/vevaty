import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import Pressy from './Pressy';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point, and its one piece of theatre: a single
// gold line runs twice around the button's outline, then peels off and
// lands on the wand's three stars, colouring them one by one, ending with
// a glow on the topmost.
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

// Forest green face, white contents, one gold line. This used to be a
// light grey panel carrying three borrowed colours -- violet, indigo and
// red -- which predated the brand and belonged to nothing. The button is
// the most prominent single control in the app; it should be the brand
// stating itself, not a fourth palette.
//
// Gold on forest green measures 5.4:1, so the line reads at full strength
// without the panel having to be pale to accommodate it, and the stars end
// visibly brighter than the white they start as rather than dimmer -- which
// was the actual reason the panel went light in the first place.
const FACE = colors.primary;
// The permanent outline the line runs along: a hint of the gold it will
// be, so the path exists before anything travels it.
const EDGE = 'rgba(217,164,65,0.22)';
const ARC_COLOR = colors.accent;

// All three stars land on gold. One colour, arriving three times, reads as
// the same light spreading; three different colours read as decoration.
const STAR_COLOR = colors.accent;

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
// Just under a quarter of the perimeter. Long enough to read as a line
// travelling rather than a dot orbiting, short enough that the gap behind
// it is always obvious and the button never looks merely outlined.
const ARC_SHARE = 0.22;

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
              {/* Each star is drawn in plain ink first and then
                  over-painted by its coloured twin as that twin fades in,
                  so the icon reads normally before the sequence reaches
                  it, and visibly gains colour when it does. */}
              {[
                { d: WAND_STAR_UPPER_LEFT, order: 0 },
                { d: WAND_STAR_LOWER_RIGHT, order: 1 },
                { d: WAND_STAR_TOP, order: 2 },
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
                    stroke={STAR_COLOR}
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={STAR_COLOR}
                    opacity={starOpacity(star.order)}
                  />
                </React.Fragment>
              ))}
              {/* Centred on the top star's own centre point. */}
              <AnimatedCircle cx={17.5} cy={7} r={glowRadius} fill={STAR_COLOR} opacity={glowOpacity} />
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
              stroke={EDGE}
              strokeWidth={STROKE}
            />
            <AnimatedRect
              x={inset}
              y={inset}
              width={w}
              height={h}
              rx={r}
              ry={r}
              fill="none"
              stroke={ARC_COLOR}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${arc},${perimeter - arc}`}
              // Negative offset moves the dash forward along the path, so
              // the line travels clockwise and covers LAPS laps across the
              // travel phase.
              strokeDashoffset={progress.interpolate({
                inputRange: [0, TRAVEL, 1],
                outputRange: [0, -perimeter * LAPS, -perimeter * LAPS],
              })}
              opacity={arcOpacity}
            />
          </Svg>
        </View>
      )}
    </Pressy>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.md,
    backgroundColor: FACE,
    width: '100%',
    position: 'relative',
  },
  content: { paddingVertical: 16, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wand: { width: 22, height: 22 },
  label: { ...type.h3, color: colors.white },
  // Not a flat grey: on a dark panel, grey text reads as disabled. A
  // held-back white keeps it clearly secondary while still looking lit.
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.72)', marginTop: 5 },
});
