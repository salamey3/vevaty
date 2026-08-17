import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, ViewStyle } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useIsDesktop } from '../hooks/useResponsive';

// Left/right buttons for a horizontal scroller, for people using a mouse.
//
// Web only, and deliberately so: on a touch screen you swipe, and a pair
// of arrows there would take space away from the content to duplicate a
// gesture everyone already knows. On a desktop there is no swipe -- a
// trackpad's horizontal scroll is discoverable only if you happen to try
// it, and a mouse wheel doesn't do it at all -- so without these, a
// desktop visitor has no way of knowing there is anything past the right
// edge.
//
// The arrows sit in their own gutters either side, never over the
// content. Overlaying them would cover part of a photo, and on a category
// strip would cover the first and last chip, which are exactly the ones
// you reach for. They are always present -- a control that appears only
// on hover can't be discovered by someone who never hovers there -- but
// faint until the pointer is over the carousel, at which point they come
// up to full strength.
const IDLE_OPACITY = 0.22;
const HOVER_OPACITY = 1;
const FADE_MS = 160;

// Gutter reserved on each side. Matches the button, so the content sits
// exactly between them.
export const ARROW_GUTTER = 34;

export default function CarouselArrows({
  children,
  onScrollBy,
  style,
  // How far one press moves the scroller. Callers know their own item
  // width -- a photo pages by its full width, a category strip by a few
  // chips -- so neither is guessed here.
  step,
}: {
  children: React.ReactNode;
  onScrollBy: (delta: number) => void;
  style?: ViewStyle | ViewStyle[];
  step: number;
}) {
  const { isRTL } = useLanguage();
  const isDesktop = useIsDesktop();
  const opacity = useRef(new Animated.Value(IDLE_OPACITY)).current;
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: hovered ? HOVER_OPACITY : IDLE_OPACITY,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [hovered, opacity]);

  // Touch platforms get the carousel exactly as it was, and so does a
  // phone browser: the arrows exist because a desktop has no swipe, and on
  // a narrow screen they would take 68px of width away from the content to
  // duplicate a gesture that already works there.
  if (Platform.OS !== 'web' || !isDesktop) return <>{children}</>;

  // In Arabic the leading edge is the right one, so the arrow that means
  // "back" has to swap sides with it.
  const backwards = isRTL ? step : -step;
  const forwards = isRTL ? -step : step;

  const hoverProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } as any;

  return (
    <View style={[styles.row, style]} {...hoverProps}>
      <Animated.View style={[styles.gutter, { opacity }]}>
        <Pressy onPress={() => onScrollBy(backwards)} style={styles.button} accessibilityLabel="Previous">
          <Icon name="back" size={16} color={colors.ink} />
        </Pressy>
      </Animated.View>

      <View style={styles.content}>{children}</View>

      <Animated.View style={[styles.gutter, { opacity }]}>
        <Pressy onPress={() => onScrollBy(forwards)} style={styles.button} accessibilityLabel="Next">
          <Icon name="chevronRight" size={16} color={colors.ink} />
        </Pressy>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  gutter: { width: ARROW_GUTTER, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, overflow: 'hidden' },
  button: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
});
