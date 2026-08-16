import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Shared "is the floating chrome visible right now" flag for mobile's
// auto-hiding category slider (HomeScreen) and bottom tab bar (TabBar) --
// two components that aren't parent/child (TabBar is mounted once by the
// tab navigator, HomeScreen is one of several screens it hosts), so a
// scroll event on HomeScreen's list has no direct way to reach TabBar
// without lifting the flag up to a shared context like this one.
//
// Deliberately NOT built on RN's Animated API: this app is web-only (see
// Pressy.tsx's own comment on this), and Animated's web fallback has real,
// previously-hit bugs there (dropped style-array entries, no native
// driver). Every consumer instead just reads the plain `chromeVisible`
// boolean and flips a couple of CSS-transition-backed style props, same
// pattern Pressy already uses for its press-scale motion.
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
  const lastY = useRef(0);
  const accumulated = useRef(0);

  const showChrome = useCallback(() => {
    lastY.current = 0;
    accumulated.current = 0;
    setChromeVisible(true);
  }, []);

  const onChromeScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    const delta = y - lastY.current;
    lastY.current = y;

    if (y <= TOP_SNAP_ZONE) {
      accumulated.current = 0;
      setChromeVisible(true);
      return;
    }

    accumulated.current = Math.max(
      -DIRECTION_THRESHOLD,
      Math.min(DIRECTION_THRESHOLD, accumulated.current + delta),
    );

    if (accumulated.current >= DIRECTION_THRESHOLD) {
      setChromeVisible(false);
    } else if (accumulated.current <= -DIRECTION_THRESHOLD) {
      setChromeVisible(true);
    }
  }, []);

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
