import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import SystemBottomStrip from './SystemBottomStrip';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

type Props = {
  visible: boolean;
  minFrames: number;
  maxFrames: number;
  onFinish: (frameUris: string[]) => void;
  onCancel: () => void;
  onFallbackToLibrary: () => void;
  // Replaces the spin-specific banner across the top of the viewfinder.
  // The camera itself is identical for a 360 spin and for Magic Listing
  // photos; only the instruction differs.
  instructions?: string;
  // Progress line under the viewfinder, given the shots taken so far.
  // Lets the Magic path say "2 of 3 -- one more to go" while the spin
  // path keeps its own wording.
  progressHint?: (count: number, min: number) => string;
  // Close and hand back the moment `minFrames` is reached, instead of
  // waiting for a Done tap. For a fixed-size set (Magic Listing wants
  // exactly three) the extra confirmation is a step with nothing in it --
  // the seller has just watched the counter reach 3/3, so asking them to
  // agree adds a tap and tells them nothing.
  autoFinishAtMin?: boolean;
  // Wording for the Done button. The default says "frames", which is right
  // for a 360 spin and wrong for a handful of ordinary photos.
  finishLabel?: (count: number) => string;
};

type CamState = 'idle' | 'requesting' | 'active' | 'denied';

// Guided in-app 360deg spin capture (Phase 3 item 7), backed by expo-camera's
// CameraView -- works on native (Android/iOS) AND web (it uses getUserMedia
// under the hood there), unlike the previous implementation. That one called
// navigator.mediaDevices.getUserMedia directly, a raw browser API with no
// native equivalent -- feature-detection always failed on-device, so
// startNewSpin() silently kicked straight to onFallbackToLibrary() and a
// seller tapping "capture a 360 spin" never saw an in-app camera at all,
// unlike the plain Photos step (which already used expo-image-picker's
// launchCameraAsync, itself cross-platform). This brings spin capture to
// parity with that. Also means captured frames are now real file:// URIs
// (native) or object URLs handled internally by expo-camera on web, same
// shape as the photos[] array already produced by expo-image-picker, so
// they flow through the exact same upload path (see AppStore) instead of
// the old raw canvas-drawn blob: URLs.
export default function CameraCapture({
  visible,
  minFrames,
  maxFrames,
  onFinish,
  onCancel,
  onFallbackToLibrary,
  instructions,
  progressHint,
  autoFinishAtMin = false,
  finishLabel,
}: Props) {
  const { t } = useLanguage();
  // Android draws this modal edge to edge, so the viewfinder runs under the
  // status bar at the top and under the navigation bar at the bottom. Without
  // these, the close button sits beneath the clock and -- worse -- the Done
  // button sits beneath the navigation bar, where it can't be tapped at all.
  // Same hook the tab bar already uses; the SafeAreaProvider at the App root
  // reaches in here because React context passes through a Modal.
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [camState, setCamState] = useState<CamState>('idle');
  const [frames, setFrames] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);
  const capturingRef = useRef(false);
  const framesRef = useRef<string[]>([]);
  framesRef.current = frames;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFrames([]);
    setCamState('requesting');

    (async () => {
      try {
        const current = permission?.granted ? permission : await requestPermission();
        if (cancelled) return;
        setCamState(current?.granted ? 'active' : 'denied');
      } catch {
        if (!cancelled) setCamState('denied');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleCapture = async () => {
    if (capturingRef.current || framesRef.current.length >= maxFrames || !cameraRef.current) return;
    capturingRef.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: true });
      if (photo?.uri) {
        const next = framesRef.current.length >= maxFrames ? framesRef.current : [...framesRef.current, photo.uri];
        framesRef.current = next;
        setFrames(next);
        // Hand back as soon as the set is complete. Read from the ref
        // rather than waiting for the state round-trip -- the shot that
        // completes the set is the one that should close the camera, and
        // `frames` won't have caught up yet inside this handler.
        if (autoFinishAtMin && next.length >= minFrames) onFinish(next);
      }
    } catch {
      // A single failed capture isn't worth interrupting the session for --
      // the seller can just tap the shutter again.
    } finally {
      capturingRef.current = false;
    }
  };

  const handleDelete = (uri: string) => {
    setFrames((prev) => prev.filter((f) => f !== uri));
  };

  const handleFinish = () => {
    onFinish(framesRef.current);
  };

  if (!visible) return null;

  const count = frames.length;
  const canFinish = count >= minFrames;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
          <Pressy onPress={onCancel} style={styles.iconBtn} accessibilityLabel="Close">
            <Icon name="close" size={18} color={colors.white} />
          </Pressy>
          <Text style={styles.counter}>{count}/{maxFrames}</Text>
          <View style={styles.iconBtn} />
        </View>

        {camState === 'active' && (
          <View style={styles.videoWrap}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <View style={styles.instructionBanner} pointerEvents="none">
              <Text style={styles.instructionText}>{instructions || t('createListing.cameraInstructions')}</Text>
            </View>
          </View>
        )}

        {camState === 'requesting' && (
          <View style={styles.centerMsg}>
            <Text style={styles.centerMsgText}>{t('createListing.cameraRequesting')}</Text>
          </View>
        )}

        {camState === 'denied' && (
          <View style={styles.centerMsg}>
            <Text style={styles.centerMsgTitle}>{t('createListing.cameraUnavailableTitle')}</Text>
            <Text style={styles.centerMsgText}>{t('createListing.cameraUnavailableMessage')}</Text>
            <Pressy onPress={onFallbackToLibrary} style={styles.libraryBtn}>
              <Text style={styles.libraryBtnText}>{t('createListing.cameraChooseFromLibrary')}</Text>
            </Pressy>
            <Pressy onPress={onCancel} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
            </Pressy>
          </View>
        )}

        {camState === 'active' && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 18 }]}>
            <Text style={styles.hintText}>
              {progressHint
                ? progressHint(count, minFrames)
                : count < minFrames
                  ? t('createListing.cameraMinFramesHint', { min: minFrames, count })
                  : ''}
            </Text>

            {count > 0 && (
              <View style={styles.thumbStrip}>
                {frames.map((uri) => (
                  <View key={uri} style={styles.thumbWrap}>
                    <Image source={{ uri }} style={styles.thumb} />
                    <Pressy onPress={() => handleDelete(uri)} style={styles.thumbDelete} accessibilityLabel="Delete frame">
                      <Icon name="close" size={10} color={colors.white} />
                    </Pressy>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.controlsRow}>
              <Pressy
                onPress={handleCapture}
                disabled={count >= maxFrames}
                style={[styles.shutter, count >= maxFrames && styles.shutterDisabled]}
                accessibilityLabel="Capture photo"
              >
                <View style={styles.shutterInner} />
              </Pressy>
            </View>

            <Pressy
              onPress={handleFinish}
              disabled={!canFinish}
              style={[styles.finishBtn, !canFinish && styles.finishBtnDisabled]}
              accessibilityLabel="Finish spin capture"
            >
              <Text style={styles.finishBtnText}>
                {canFinish
                  ? (finishLabel ? finishLabel(count) : t('createListing.cameraFinish', { count }))
                  : `${count}/${minFrames}`}
              </Text>
            </Pressy>
          </View>
        )}
        <SystemBottomStrip />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  counter: { ...type.soft, color: colors.white, fontWeight: '600' },
  videoWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  instructionBanner: {
    position: 'absolute', top: 10, left: 14, right: 14,
    backgroundColor: 'rgba(20,20,22,0.55)', borderRadius: radius.sm, padding: 10,
  },
  instructionText: { ...type.soft, color: colors.white, textAlign: 'center' },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  centerMsgTitle: { ...type.h3, color: colors.white, textAlign: 'center' },
  centerMsgText: { ...type.soft, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 19 },
  libraryBtn: {
    marginTop: 8, backgroundColor: colors.white, borderRadius: radius.pill,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  libraryBtnText: { ...type.body, fontWeight: '600' },
  cancelLink: { paddingVertical: 10 },
  cancelLinkText: { ...type.soft, color: 'rgba(255,255,255,0.75)' },
  bottomBar: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 18, gap: 10 },
  hintText: { ...type.tiny, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  thumbStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  thumbWrap: { width: 40, height: 40, position: 'relative' },
  thumb: { width: 40, height: 40, borderRadius: 6 },
  thumbDelete: {
    position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  controlsRow: { alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  shutter: {
    width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.white },
  finishBtn: {
    alignSelf: 'center', backgroundColor: colors.white, borderRadius: radius.pill,
    paddingHorizontal: 22, paddingVertical: 12, minWidth: 140, alignItems: 'center',
  },
  finishBtnDisabled: { opacity: 0.4 },
  finishBtnText: { ...type.body, fontWeight: '600' },
});
