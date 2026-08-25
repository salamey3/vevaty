import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, NativeScrollEvent, NativeSyntheticEvent, Platform, UIManager } from 'react-native';

// Shared "is the floating chrome visible right now" flag for mobile's
// auto-hiding home-screen chrome (greeting+search row, category slider --
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
  // Per-frame scroll handler for the ONE vertical, page-level scroller
  // (HomeScreen's grid/carousels FlatList) -- the only scroller with a
  // meaningful "near the very top" position, which is what TOP_SNAP_ZONE
  // below keys off. Horizontal carousels have no such position and don't
  // use this -- see beginChromeInteraction/endChromeInteraction.
  onChromeScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  // Gesture-lifecycle pair, wired to onScrollBeginDrag/onScrollEndDrag on
  // EVERY scrollable in the body -- the page's own vertical list AND every
  // horizontal carousel (category rows, collection rows). Direction and
  // axis don't matter: any of them dragging is "the user is doing
  // something," which is what should keep the chrome hidden.
  beginChromeInteraction: () => void;
  endChromeInteraction: () => void;
  showChrome: () => void;
};

const ScrollChromeContext = createContext<ScrollChromeContextValue | null>(null);

// How long, in ms, after the user's finger lifts before the chrome
// reappears -- see endChromeInteraction. Tuned by feel (previously 150,
// raised to 800 after seeing it live) rather than derived from anything
// about scroll physics.
const SCROLL_STOP_DELAY = 800;
// Always keep the chrome visible near the very top of the page -- both so
// the first screenful never starts with it hidden, and so "scroll to top"
// is always enough to get it back regardless of whether a reappear timer
// is pending. Only meaningful for the vertical page scroller (see
// onChromeScroll) -- a horizontal carousel's contentOffset.y is always 0,
// which would make this fire on every horizontal frame if it were ever
// applied there.
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

  // Pending "reveal the chrome" timer, armed only by endChromeInteraction
  // (the user's finger lifting off whichever scrollable they were
  // dragging) -- NOT by scroll motion going quiet. Momentum can keep a
  // list gliding well after the finger is gone; the countdown to
  // reappearing starts at the lift itself, per direct feedback ("when the
  // user lifts up their finger, start only then counting"), not once the
  // list has also fully settled.
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

  // onScrollBeginDrag on any scrollable -- the user has just put a finger
  // down and started dragging it (vertically or horizontally, doesn't
  // matter which). Hide immediately, and drop any reappear timer a
  // PREVIOUS interaction may have armed: starting a new drag before that
  // timer fired means the chrome should stay hidden, not pop back mid-
  // gesture because an earlier countdown happened to land right now.
  const beginChromeInteraction = useCallback(() => {
    clearStopTimer();
    setVisible(false);
  }, [clearStopTimer, setVisible]);

  // onScrollEndDrag on any scrollable -- the finger has lifted. This is
  // the moment the reappear countdown starts, even if momentum scrolling
  // continues on whatever was just released.
  const endChromeInteraction = useCallback(() => {
    clearStopTimer();
    stopTimer.current = setTimeout(() => {
      stopTimer.current = null;
      setVisible(true);
    }, SCROLL_STOP_DELAY);
  }, [clearStopTimer, setVisible]);

  // Per-frame handler for the vertical page scroller only (see the type's
  // own comment). Keeps the chrome hidden through every frame of motion
  // (belt-and-suspenders alongside beginChromeInteraction -- covers
  // momentum/inertial frames and any programmatic scroll that doesn't fire
  // a drag event at all) and force-shows it once back near the top,
  // overriding whatever reappear timer might be pending.
  const onChromeScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y);

    if (y <= TOP_SNAP_ZONE) {
      clearStopTimer();
      setVisible(true);
      return;
    }

    setVisible(false);
  }, [clearStopTimer, setVisible]);

  const value = useMemo(
    () => ({ chromeVisible, onChromeScroll, beginChromeInteraction, endChromeInteraction, showChrome }),
    [chromeVisible, onChromeScroll, beginChromeInteraction, endChromeInteraction, showChrome],
  );

  return <ScrollChromeContext.Provider value={value}>{children}</ScrollChromeContext.Provider>;
}

export function useScrollChrome() {
  const ctx = useContext(ScrollChromeContext);
  if (!ctx) throw new Error('useScrollChrome must be used within a ScrollChromeProvider');
  return ctx;
}
