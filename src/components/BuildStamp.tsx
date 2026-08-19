import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { colors, type } from '../theme/theme';

// A one-line "which code is this phone actually running" stamp.
//
// This exists because half a day was spent chasing a bug that was already
// fixed. Photo upload had been moved off vevaty.com and onto the CDN, the
// website was demonstrably using the new path, and the app kept failing in
// the old way -- because expo-updates downloads an update in the
// background and only swaps it in on the NEXT launch. The app was running
// yesterday's bundle and there was no way to see that from inside it, so
// the failure looked like the fix hadn't worked rather than like it hadn't
// arrived.
//
// Small enough to ignore, specific enough to settle the question. The
// update id is the first characters of the EAS update actually loaded;
// "built-in" means no OTA update has been applied and this is the bundle
// that shipped inside the APK.
export default function BuildStamp() {
  // Updates.* throws in Expo Go and in the web build, where there is no
  // update mechanism at all -- and a crash in a diagnostic line would be a
  // particularly stupid way to lose a screen.
  let stamp = 'dev';
  try {
    if (Platform.OS === 'web') {
      stamp = 'web';
    } else if (Updates.isEmbeddedLaunch || !Updates.updateId) {
      stamp = 'built-in';
    } else {
      const created = Updates.createdAt;
      const when = created ? new Date(created).toISOString().slice(0, 16).replace('T', ' ') : '';
      stamp = `${Updates.updateId.slice(0, 8)}${when ? `  ·  ${when}` : ''}`;
    }
  } catch (e) {
    stamp = 'unknown';
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.text} selectable>{`v${Updates.runtimeVersion ?? '?'}  ·  ${stamp}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4, paddingBottom: 12 },
  // Deliberately quiet: this is for answering one question when it comes
  // up, not for decorating the profile screen.
  text: { ...type.tiny, color: colors.inkSoft, textTransform: 'none', letterSpacing: 0 },
});
