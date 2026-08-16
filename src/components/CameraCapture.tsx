import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Pressy from './Pressy';
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
};

type CamState = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported';

// Guided in-app 360° spin capture (Phase 3 item 7). No new dependency --
// camera access goes through the browser's own navigator.mediaDevices
// API directly, the same "call the raw Web API, no wrapper library"
// approach already used for navigator.geolocation in CreateListingScreen's
// "Use my current location" button. This is the app's first raw-DOM
// element rendered inside the React tree (<video>, via
// React.createElement rather than a react-native-web component) -- the
// live camera preview has no RN-primitive equivalent. This app ships
// web-only (see theme.ts), so this is unconditionally safe, but the
// feature-detection below is written defensively anyway.
export default function CameraCapture({
  visible,
  minFrames,
  maxFrames,
  onFinish,
  onCancel,
  onFallbackToLibrary,
}: Props) {
  const { t } = useLanguage();
  const [camState, setCamState] = useState<CamState>('idle');
  const [frames, setFrames] = useState<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<any>(null);
  const framesRef = useRef<string[]>([]);
  framesRef.current = frames;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFrames([]);
    setCamState('requesting');

    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    const supported = !!nav && !!nav.mediaDevices && !!nav.mediaDevices.getUserMedia;
    if (!supported) {
      setCamState('unsupported');
      onFallbackToLibrary();
      return;
    }

    nav.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream: MediaStream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoElRef.current) videoElRef.current.srcObject = stream;
        setCamState('active');
      })
      .catch(() => {
        if (!cancelled) setCamState('denied');
      });

    return () => {
      cancelled = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const attachVideoRef = (el: any) => {
    videoElRef.current = el;
    if (el && streamRef.current) el.srcObject = streamRef.current;
  };

  const handleCapture = () => {
    const videoEl = videoElRef.current;
    if (!videoEl || typeof document === 'undefined' || framesRef.current.length >= maxFrames) return;
    const srcW = videoEl.videoWidth || 1280;
    const srcH = videoEl.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(srcW, 1280);
    canvas.height = Math.round(canvas.width * (srcH / srcW));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const uri = URL.createObjectURL(blob);
        setFrames((prev) => (prev.length >= maxFrames ? prev : [...prev, uri]));
      },
      'image/jpeg',
      0.85
    );
  };

  const handleDelete = (uri: string) => {
    URL.revokeObjectURL(uri);
    setFrames((prev) => prev.filter((f) => f !== uri));
  };

  const handleFinish = () => {
    stopStream();
    onFinish(framesRef.current);
  };

  const handleCancel = () => {
    framesRef.current.forEach((uri) => URL.revokeObjectURL(uri));
    stopStream();
    onCancel();
  };

  if (!visible) return null;

  const count = frames.length;
  const canFinish = count >= minFrames;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <View style={styles.topBar}>
          <Pressy onPress={handleCancel} style={styles.iconBtn} accessibilityLabel="Close">
            <Icon name="close" size={18} color={colors.white} />
          </Pressy>
          <Text style={styles.counter}>{count}/{maxFrames}</Text>
          <View style={styles.iconBtn} />
        </View>

        {camState === 'active' && Platform.OS === 'web' && (
          <View style={styles.videoWrap}>
            {React.createElement('video', {
              ref: attachVideoRef,
              autoPlay: true,
              muted: true,
              playsInline: true,
              style: { width: '100%', height: '100%', objectFit: 'cover' },
            } as any)}
            <View style={styles.instructionBanner} pointerEvents="none">
              <Text style={styles.instructionText}>{t('createListing.cameraInstructions')}</Text>
            </View>
          </View>
        )}

        {camState === 'requesting' && (
          <View style={styles.centerMsg}>
            <Text style={styles.centerMsgText}>{t('createListing.cameraRequesting')}</Text>
          </View>
        )}

        {(camState === 'denied' || camState === 'unsupported') && (
          <View style={styles.centerMsg}>
            <Text style={styles.centerMsgTitle}>{t('createListing.cameraUnavailableTitle')}</Text>
            <Text style={styles.centerMsgText}>{t('createListing.cameraUnavailableMessage')}</Text>
            <Pressy
              onPress={() => {
                stopStream();
                onFallbackToLibrary();
              }}
              style={styles.libraryBtn}
            >
              <Text style={styles.libraryBtnText}>{t('createListing.cameraChooseFromLibrary')}</Text>
            </Pressy>
            <Pressy onPress={handleCancel} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
            </Pressy>
          </View>
        )}

        {camState === 'active' && (
          <View style={styles.bottomBar}>
            {count < minFrames && (
              <Text style={styles.hintText}>
                {t('createListing.cameraMinFramesHint', { min: minFrames, count })}
              </Text>
            )}

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
                {canFinish ? t('createListing.cameraFinish', { count }) : `${count}/${minFrames}`}
              </Text>
            </Pressy>
          </View>
        )}
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
