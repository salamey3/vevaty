import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, type } from '../theme/theme';

// A non-dismissable "the AI is working, please wait" overlay -- distinct
// from the small inline hints elsewhere in the create-listing wizard
// (aiBackgroundNotice, the translate step's inline loading row), which are
// easy to miss or tap straight past. This is for the two moments where
// letting the seller continue before the AI call resolves would silently
// throw its result away: identifying the item from photos, and translating
// the listing into the other language.
//
// The Modal itself still covers the full screen -- that's what blocks
// every control behind it (Continue, the X, the header back arrow, Android
// hardware back) for as long as `visible` is true. Only a small card sits
// in the center of it, on a lightly-tinted backdrop rather than an opaque
// one: the seller can still clearly see the step behind it (the point
// isn't to hide the screen, just to hold them here until the AI call
// lands), while the backdrop's own touch-blocking is unaffected by how
// see-through it looks. There is deliberately no onRequestClose/backdrop-
// dismiss: it closes itself only when the caller flips `visible` off, once
// the AI call this is covering actually resolves (or fails -- see each
// call site's own error handling, which still clears the flag so nobody
// gets stuck behind this).
export default function AiWorkingOverlay({ visible, message }: { visible: boolean; message: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.text}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Just enough of a scrim to read as "this step is on hold" -- the
    // screen behind stays clearly legible, unlike the near-opaque backdrop
    // this started as.
    backgroundColor: 'rgba(15,20,18,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 14,
    maxWidth: 260,
    ...shadow.glass,
  },
  text: { ...type.body, color: colors.ink, textAlign: 'center' },
});
