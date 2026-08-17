import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// The Magic Listing entry point: sits above the category grid on the
// "what are you selling?" screen, visually separated from it, because it
// isn't a category -- it's the alternative to picking one.
//
// The highlight is a light that travels around the button's outline,
// rather than a sheen sweeping across its face. Done the way that effect
// is normally done: a large gradient square spins behind the button, and
// a solid inner panel covers all of it except a hairline at the edges --
// so what you see is a bright arc chasing the perimeter, brightest at one
// corner and fading away behind it.
//
// A face sweep was the first attempt and it reads as a loading bar: light
// crossing the middle of a button says "wait", where light around the
// edge says "look here". Same restraint applies either way -- one slow
// revolution, low opacity, no bounce. This screen is seen on every post,
// and a livelier animation stops being a highlight and becomes something
// to endure.

// One full revolution. Slow enough to read as a drifting highlight rather
// than a spinner; a spinner is what it becomes below about three seconds.
const REVOLUTION_MS = 4200;

// Thickness of the glowing edge.
//
// This started at 1.5px and was effectively invisible on a phone: a
// hairline of a mostly-transparent gradient, over a dark button, on a
// screen held at arm's length. The effect was rendering exactly as
// written and still could not be seen, which is the same thing as not
// working. 2.5 is enough to read as a lit edge without becoming a frame.
const EDGE = 2.5;

export default function MagicListingButton({ onPress }: { onPress: () => void }) {
  const { t } = useLanguage();
  const spin = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (size.width === 0) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: REVOLUTION_MS,
        // Linear, deliberately: any easing makes the light appear to
        // hesitate at the corners, which reads as a stutter rather than
        // as motion.
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin, size.width]);

  // The spinning gradient has to cover the button at every angle, so it's
  // a square as wide as the button's diagonal.
  const diagonal = Math.ceil(Math.sqrt(size.width ** 2 + size.height ** 2)) || 0;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Pressy
      onPress={onPress}
      style={styles.shell}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {diagonal > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.spinner,
            {
              width: diagonal,
              height: diagonal,
              left: (size.width - diagonal) / 2,
              top: (size.height - diagonal) / 2,
              transform: [{ rotate }],
            },
          ]}
        >
          {/* Most of the sweep is transparent, so only a short arc of the
              perimeter is lit at any moment -- the light reads as one
              travelling point rather than a rotating halo. */}
          <LinearGradient
            colors={[
              'rgba(255,255,255,0)',
              'rgba(255,255,255,0)',
              'rgba(255,255,255,0.35)',
              'rgba(255,255,255,1)',
            ]}
            locations={[0, 0.45, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* Covers the spinning gradient except for a hairline at the edge,
          which is the whole trick. */}
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
    // The ring's resting colour, visible wherever the travelling light
    // isn't. Without it the edge vanishes for most of each revolution and
    // the button looks like it's flickering rather than glowing.
    backgroundColor: 'rgba(255,255,255,0.22)',
    width: '100%',
    // Sized by its content, with the glowing edge added around it.
    padding: EDGE,
  },
  spinner: { position: 'absolute' },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: EDGE,
    borderRadius: radius.md - EDGE,
    backgroundColor: colors.ink,
  },
  content: { paddingVertical: 16, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { ...type.h3, color: colors.white },
  sub: { ...type.tiny, color: 'rgba(255,255,255,0.7)', marginTop: 5 },
});
