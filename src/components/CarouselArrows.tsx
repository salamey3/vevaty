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
// you reach for.
//
// Each arrow shows only when there is something in that direction, so the
// pair doubles as a position indicator: right-only means "more this way",
// both means "you're in the middle", left-only means "you've reached the
// end". An arrow that is always visible and sometimes does nothing
// teaches people to stop trusting it.
//
// The gutters stay reserved either way. Removing the space along with the
// button would shift the photo sideways every time you reached either
// end, which is a far worse artefact than an empty 34px margin.
//
// Visible arrows are faint until the pointer is over the carousel, then
// come up to full strength -- present enough to be discovered without
// hovering, quiet enough not to compete with the photograph.
const IDLE_OPACITY = 0.22;
const HOVER_OPACITY = 1;
const FADE_MS = 160;

// Gutter reserved on each side. Matches the button, so the content sits
// exactly between them.
export const ARROW_GUTTER = 34;

export default function CarouselArrows({
  children,
  onScrollBy,
  canScrollBack = true,
  canScrollForward = true,
  style,
  // How far one press moves the scroller. Callers know their own item
  // width -- a photo pages by its full width, a category strip by a few
  // chips -- so neither is guessed here.
  step,
}: {
  children: React.ReactNode;
  onScrollBy: (delta: number) => void;
  // Whether there is anything left to reach in each direction. Both
  // default true so a caller that can't cheaply know still gets arrows.
  canScrollBack?: boolean;
  canScrollForward?: boolean;
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
      <View style={styles.gutter}>
        {canScrollBack && (
          <Animated.View style={{ opacity }}>
            <Pressy onPress={() => onScrollBy(backwards)} style={styles.button} accessibilityLabel="Previous">
              <Icon name="back" size={16} color={colors.ink} />
            </Pressy>
          </Animated.View>
        )}
      </View>

      <View style={styles.content}>{children}</View>

      <View style={styles.gutter}>
        {canScrollForward && (
          <Animated.View style={{ opacity }}>
            <Pressy onPress={() => onScrollBy(forwards)} style={styles.button} accessibilityLabel="Next">
              <Icon name="chevronRight" size={16} color={colors.ink} />
            </Pressy>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 'stretch', not 'center'. Centring makes a flex row size its children
  // to their own content height -- which, for a child that fills its
  // parent, is nothing. That is what made the photo carousel vanish and
  // leave two arrows floating in an empty box.
  // alignSelf stretch rather than width:'100%'. This wraps two different
  // shapes -- a full-width category strip and a fixed-width photo column
  // -- and a hard 100% is wrong for the second: the column's width comes
  // from this row's content, so asking for 100% of it is circular.
  row: { flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch' },
  gutter: { width: ARROW_GUTTER, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
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
