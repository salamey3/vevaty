import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, NativeScrollEvent, NativeSyntheticEvent, Platform, UIManager } from 'react-native';

// Shared "is the floating chrome visible right now" flag for mobile's
// auto-hiding category slider (HomeScreen) and bottom tab bar (TabBar) --
// two components that aren't parent/child (TabBar is mounted once by the
// tab navigator, HomeScreen is one of several screens it hosts), so a
// scroll event on HomeScreen's list has no direct way to reach TabBar
// without lifting the flag up to a shared context like this one.
//
// Consumers still just read the plain `chromeVisible` boolean and flip a
// couple of CSS-transition-backed style props (transitionProperty/
// transitionDuration) -- that's a react-native-web-only feature, and it's
// genuinely what animates the fade/slide on the web build. But on the real
// native build there's no CSS engine to interpret those props at all, so
// the style change (e.g. the category chip row's height snapping between
// 94 and 0) applied INSTANTLY with no animation. An ~94px layout change
// happening synchronously, right above an actively-scrolling list, mid-
// gesture, was enough to visibly disturb the list's own scroll position on
// Android (content jumping backward, already-loaded images re-flashing
// their placeholder state) -- reported as "scrolling acts up" on-device.
// LayoutAnimation is native RN's own mechanism for exactly this (animating
// a layout change that's about to happen, without wiring an Animated.Value
// per style prop) and is a no-op on web, so triggering it here -- right
// before every setChromeVisible call, guarded to non-web -- smooths the
// transition on native without touching the working web CSS path at all.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const animateChromeTransition = () => {
  if (Platform.OS === 'web') return;
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
};
type ScrollChromeContextValue = {
  chromeVisible: boolean;
  onChromeScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  showChrome: () => void;
};

const ScrollChromeContext = createContext<ScrollChromeContextValue | null>(null);

// Hysteresis band, in px, that the accumulator below is clamped to. Once a
// scroll run has pushed the accumulator all the way to +THRESHOLD (hidden)
// or -THRESHOLD (visible), a small reversal only nudges it partway back --
// it takes a full swing across the whole band to actually flip visibility.
// This (not a hard reset on every direction change) is what keeps a
// deceleration curve's small backward jitter at the end of a scroll gesture
// from flapping the chrome hidden/visible/hidden right as the scroll settles
// (confirmed with a Playwright test against a real wheel-scroll animation --
// a plain "reset the accumulator on any sign flip" version visibly did).
const DIRECTION_THRESHOLD = 18;
// Always keep the chrome visible near the very top -- both so the first
// screenful never starts with it hidden, and so "scroll to top" is always
// enough to get the category slider/tab bar back regardless of direction
// bookkeeping.
const TOP_SNAP_ZONE = 24;

export function ScrollChromeProvider({ children }: { children: React.ReactNode }) {
  const [chromeVisible, setChromeVisible] = useState(true);
  // Mirrors chromeVisible synchronously for the callbacks below (which are
  // stable useCallbacks with `[]` deps, so they'd otherwise only ever see
  // the initial value) -- lets each call site check "is this visibility
  // change actually a change" before bothering to animate, instead of
  // reconfiguring LayoutAnimation on every single scroll frame near the top
  // (TOP_SNAP_ZONE calls setChromeVisible(true) unconditionally on every
  // event while in that zone, not just once on entry).
  const chromeVisibleRef = useRef(true);
  const setVisible = useCallback((next: boolean) => {
    if (chromeVisibleRef.current === next) return;
    chromeVisibleRef.current = next;
    animateChromeTransition();
    setChromeVisible(next);
  }, []);
  const lastY = useRef(0);
  const accumulated = useRef(0);

  const showChrome = useCallback(() => {
    lastY.current = 0;
    accumulated.current = 0;
    setVisible(true);
  }, [setVisible]);

  const onChromeScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastY.current;
    lastY.current = y;

    if (y <= TOP_SNAP_ZONE) {
      accumulated.current = 0;
      setVisible(true);
      return;
    }

    accumulated.current = Math.max(
      -DIRECTION_THRESHOLD,
      Math.min(DIRECTION_THRESHOLD, accumulated.current + delta),
    );

    if (accumulated.current >= DIRECTION_THRESHOLD) {
      setVisible(false);
    } else if (accumulated.current <= -DIRECTION_THRESHOLD) {
      setVisible(true);
    }
  }, [setVisible]);

  const value = useMemo(
    () => ({ chromeVisible, onChromeScroll, showChrome }),
    [chromeVisible, onChromeScroll, showChrome],
  );

  return <ScrollChromeContext.Provider value={value}>{children}</ScrollChromeContext.Provider>;
}

export function useScrollChrome() {
  const ctx = useContext(ScrollChromeContext);
  if (!ctx) throw new Error('useScrollChrome must be used within a ScrollChromeProvider');
  return ctx;
}
