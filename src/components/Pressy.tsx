import React from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

type PressyProps = Omit<PressableProps, 'style' | 'children'> & {
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

// A Pressable that scales down slightly on touch, mirroring the :active
// transform micro-motion used throughout the web prototype's cards/buttons.
//
// This used to be a Pressable wrapping a SEPARATE Animated.View (driving the
// scale via an Animated.Value + JS-fallback animation, since native-driver
// animations aren't available on web). That two-element structure caused
// two real, visible bugs:
//   1. Giving both elements the same full style (background/border/etc.)
//      painted two nearly-identical boxes on top of each other, showing up
//      as a faint duplicate outline around every pill/card/button.
//   2. When the outer Pressable's style included a percentage width (as it
//      does for every grid card), the inner Animated.View would silently
//      drop that width -- react-native-web's Animated-on-web JS fallback
//      doesn't reliably carry every entry of a multi-item style array
//      through its style/transform split. That collapsed grid cards (and
//      anything else sized by percentage) down to a sliver a few pixels
//      wide, wrapping their text one character per line.
// A single Pressable sidesteps both: there's only one painted box (no
// duplicate outline is even possible), and its `style` prop is resolved
// through react-native-web's normal single-component path -- the same path
// that's always correctly handled percentage widths -- so grid sizing is no
// longer at the mercy of Animated's web fallback. The press-scale motion
// now comes from Pressable's `pressed` render state plus a CSS transition,
// which is both simpler and smoother than the old JS-driven animation.
export default function Pressy({ children, style, onPressIn, onPressOut, haptic = true, ...rest }: PressyProps) {
  const handleIn = (e: any) => {
    if (haptic) Haptics.selectionAsync().catch(() => {});
    onPressIn?.(e);
  };
  const handleOut = (e: any) => {
    onPressOut?.(e);
  };

  return (
    <Pressable
      onPressIn={handleIn}
      onPressOut={handleOut}
      style={(state) => [style, styles.transition, state.pressed && styles.pressed]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  transition: {
    // Web-only CSS transition properties -- react-native-web passes these
    // straight through to the generated CSS, but they aren't part of RN's
    // own ViewStyle type, hence the cast below.
    transitionProperty: 'transform',
    transitionDuration: '120ms',
    transitionTimingFunction: 'ease-out',
  } as ViewStyle,
  pressed: {
    transform: [{ scale: 0.96 }],
  },
});
