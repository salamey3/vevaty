import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The deliberate black dead-zone along the bottom of the screen, exactly as
// tall as the phone's own bottom system bar -- Android's navigation bar
// (3-button or gesture pill) or iOS's home indicator.
//
// Why this exists at all: from Expo SDK 54 onward Android is always drawn
// edge to edge, and there is no opting out. The system navigation bar is
// transparent and the app's window extends underneath it, so anything the
// app paints at the bottom of the screen appears *behind* the nav bar --
// which is how the camera's Done button, the 360° preview's Continue
// button and the chat composer each ended up unreachable at various points.
//
// Reserving the space is only half the fix, and it's the half the app
// already did (Screen's SafeAreaView bottom edge, TabBar's own padding).
// The other half is what the reserved strip then LOOKS like: Texture paints
// the app background full-bleed behind everything, so the strip rendered as
// a pale band that read like part of the page and invited taps that the
// system bar would swallow. Painting it solid black instead makes it read
// as what it is -- a piece of the phone, not a piece of the app.
//
// Rendered LAST inside each window (the app root in App.tsx, and separately
// inside every Modal, since a React Native Modal is its own native window
// that the root-level strip cannot reach into) so it paints over whatever
// that window put behind it.
//
// pointerEvents="none" deliberately: nothing interactive is ever laid out
// under here, so there is nothing to guard against, and swallowing touches
// risks interfering with the system's own bottom-edge gestures.
export default function SystemBottomStrip() {
  const insets = useSafeAreaInsets();
  // Zero on desktop web, on Android devices with hardware buttons, and on
  // pre-notch iPhones -- render nothing at all rather than a 0px view.
  if (insets.bottom <= 0) return null;
  return <View pointerEvents="none" style={[styles.strip, { height: insets.bottom }]} />;
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    // Siblings later in the tree already paint on top on native; zIndex is
    // for react-native-web, where the floating tab bar and other absolutely
    // positioned chrome would otherwise win on stacking order alone.
    zIndex: 9999,
  },
});
