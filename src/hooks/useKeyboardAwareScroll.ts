import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, TextInput } from 'react-native';

// Keeps the focused text field visible above the on-screen keyboard inside a
// ScrollView.
//
// Why this exists rather than just KeyboardAvoidingView: KAV only resizes
// its own frame. Shrinking the scroll viewport is necessary but not
// sufficient -- something still has to scroll the focused field up into the
// part that's left, and on Android nothing does. Expo's edge-to-edge mode
// stops the window resizing when the keyboard opens, which is what used to
// trigger the platform's own "keep the focused input visible" behavior. The
// visible symptom is a form that shifts slightly and then leaves the field
// you tapped still half-buried under the keyboard.
//
// So: measure where the focused input actually is, work out how far it sits
// below the top of the keyboard, and scroll by exactly that much.
//
// Deliberately JS-only. The alternatives are a native keyboard library or
// changing android:windowSoftInputMode, and both mean a full rebuild off the
// quota rather than a one-minute over-the-air update.

// Breathing room between the bottom of the field and the top of the
// keyboard, so the field doesn't sit flush against it.
const GAP_ABOVE_KEYBOARD = 16;

// The keyboard reports its size before the layout around it has settled;
// measuring a frame later gets the position the field actually ends up at.
const SETTLE_MS = 50;

export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Top edge of the keyboard in screen coordinates, or null when closed.
  const keyboardTop = useRef<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const scrollFocusedIntoView = useCallback(() => {
    const top = keyboardTop.current;
    if (top == null) return;
    // Whichever input has focus, without every screen having to wire up a
    // ref per field.
    const input = (TextInput as unknown as { State?: { currentlyFocusedInput?: () => any } }).State
      ?.currentlyFocusedInput?.();
    if (!input?.measureInWindow) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const overlap = y + h + GAP_ABOVE_KEYBOARD - top;
      if (overlap > 0) scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
    });
  }, []);

  useEffect(() => {
    // iOS announces the keyboard before it animates in, so the scroll rides
    // along with it; Android only reports it afterwards.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(scrollFocusedIntoView, SETTLE_MS);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollFocusedIntoView]);

  // Moving from one field to another fires no keyboard event at all -- the
  // keyboard is already open and unchanged -- so focus has to trigger the
  // same correction, or only the first field you tap gets it.
  const onInputFocus = useCallback(() => {
    setTimeout(scrollFocusedIntoView, SETTLE_MS);
  }, [scrollFocusedIntoView]);

  return { scrollRef, onScroll, onInputFocus, keyboardHeight };
}
