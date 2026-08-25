import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, NativeScrollEvent, NativeSyntheticEvent, Platform, UIManager } from 'react-native';

// Shared "is the floating chrome visible right now" flag for mobile's
// auto-hiding home-screen chrome (greeting, search bar, category slider --
// HomeScreen) and the bottom tab bar (TabBar) -- two components that aren't
// parent/child (TabBar is mounted once by the tab navigator, HomeScreen is
// one of several screens it hosts), so a scroll event on HomeScreen's list
// has no direct way to reach TabBar without lifting the flag up to a shared
// context like this one.
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

// How long, in ms, a scroll has to go quiet before the chrome reappears.
// Motion is what hides the chrome now, not direction -- scrolling up used
// to snap it back visible (and sticky) immediately, which is exactly the
// behavior that was reported as the complaint: the user wants it gone
// while they're actively scrolling either way, and back only once they've
// actually stopped. Momentum/deceleration scrolling still fires onScroll
// events several times a second right up until it genuinely stops
// (scrollEventThrottle=16 below means ~16ms between frames while actively
// moving), so this only needs to comfortably clear the gap between two
// consecutive in-motion frames -- long enough that natural frame-to-frame
// jitter never flickers the chrome back mid-scroll, short enough that it
// doesn't feel sluggish to reappear once the list actually settles.
const SCROLL_STOP_DELAY = 150;
// Always keep the chrome visible near the very top -- both so the first
// screenful never starts with it hidden, and so "scroll to top" is always
// enough to get it back regardless of whether a stop timer is pending.
const TOP_SNAP_ZONE = 24;

export function ScrollChromeProvider({ children }: { children: React.ReactNode }) {
  const [chromeVisible, setChromeVisible] = useState(true);
  // Mirrors chromeVisible synchronously for the callbacks below (which are
  // stable useCallbacks with `[]`/near-`[]` deps, so they'd otherwise only
  // ever see the initial value) -- lets each call site check "is this
  // visibility change actually a change" before bothering to animate,
  // instead of reconfiguring LayoutAnimation on every single scroll frame
  // near the top (TOP_SNAP_ZONE calls setVisible(true) unconditionally on
  // every event while in that zone, not just once on entry).
  const chromeVisibleRef = useRef(true);
  const setVisible = useCallback((next: boolean) => {
    if (chromeVisibleRef.current === next) return;
    chromeVisibleRef.current = next;
    animateChromeTransition();
    setChromeVisible(next);
  }, []);

  // Pending "the scroll has gone quiet" timer -- (re)armed on every scroll
  // event and cleared on the next one, so it only ever actually fires once
  // nothing has re-armed it for SCROLL_STOP_DELAY ms, i.e. the scroll has
  // truly stopped rather than just changed direction.
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStopTimer = useCallback(() => {
    if (stopTimer.current != null) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);
  // Belt-and-suspenders: drop any pending timer if the provider itself ever
  // unmounts (it doesn't in practice -- mounted once for the whole app --
  // but a leaked setTimeout calling setState after unmount is a cheap thing
  // to rule out for free).
  useEffect(() => () => clearStopTimer(), [clearStopTimer]);

  const showChrome = useCallback(() => {
    clearStopTimer();
    setVisible(true);
  }, [clearStopTimer, setVisible]);

  const onChromeScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);
    clearStopTimer();

    if (y <= TOP_SNAP_ZONE) {
      setVisible(true);
      return;
    }

    setVisible(false);
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      setVisible(true);
    }, SCROLL_STOP_DELAY);
  }, [clearStopTimer, setVisible]);

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
