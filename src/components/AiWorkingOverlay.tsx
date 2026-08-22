import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme/theme';

// A full-screen, non-dismissable "the AI is working, please wait" overlay --
// distinct from the small inline hints elsewhere in the create-listing wizard
// (aiBackgroundNotice, the translate step's inline loading row), which are
// easy to miss or tap straight past. This is for the two moments where
// letting the seller continue before the AI call resolves would silently
// throw its result away: identifying the item from photos, and translating
// the listing into the other language.
//
// A Modal blocks every control behind it -- Continue, the X, the header
// back arrow, Android hardware back -- for as long as `visible` is true.
// There is deliberately no onRequestClose/backdrop-dismiss here: it closes
// itself only when the caller flips `visible` off, once the AI call this is
// covering actually resolves (or fails -- see each call site's own error
// handling, which still clears the flag so nobody gets stuck behind this).
export default function AiWorkingOverlay({ visible, message }: { visible: boolean; message: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <ActivityIndicator size="large" color={colors.white} />
        <Text style={styles.text}>{message}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,20,18,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  text: { ...type.body, color: colors.white, textAlign: 'center' },
});
