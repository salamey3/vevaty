import React, { useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Modal, PanResponder, StyleSheet, Text, View, ViewStyle } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import Button from './Button';
import RangeSlider from './RangeSlider';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

type Props = {
  visible: boolean;
  // The freshly-picked local photo (from expo-image-picker) to crop --
  // null while nothing is queued, so the caller can keep this mounted
  // and just flip `visible` rather than conditionally rendering it.
  uri: string | null;
  // Both current call sites (a person's own avatar, a shop's logo) show
  // the result inside a fixed square -- circular for the avatar, softly
  // rounded for the logo -- so this is a preview-only cosmetic choice.
  // The actual crop rectangle is always 1:1, regardless of shape.
  shape?: 'circle' | 'square';
  title?: string;
  onCancel: () => void;
  // Receives the local URI of the cropped/resized result (already run
  // through expo-image-manipulator) -- the caller still owns uploading
  // it, same as it owned uploading the picker's raw URI before.
  onConfirm: (croppedUri: string) => void | Promise<void>;
};

// The square result is always this many pixels on a side. Sharp enough for
// a profile photo or shop logo at any size this app actually displays one
// (the largest is StorefrontScreen's 54x54 hero circle, @3x is still under
// 200px), without shipping a print-resolution image for what is, at most,
// a small circular thumbnail everywhere it's shown.
const OUTPUT_SIZE = 640;
// 1x is "the shorter side exactly fills the frame" (see baseScale below) --
// there is no reason to allow zooming OUT past that and leaving the frame
// partly empty. 3x is enough to crop tightly into a face or a wordmark
// without the slider feeling like it has no range.
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// How far the image can be panned, in frame-space pixels, before its
// edge would reveal empty space inside the frame -- i.e. half of however
// much the scaled image overhangs the frame on that axis. Shared by the
// pan handler (to clamp while dragging) and the zoom handler (to re-clamp
// the existing offset when zooming out shrinks how far it's allowed to be).
function maxOffset(displayScale: number, frameSize: number, natural: { width: number; height: number }) {
  const dispW = natural.width * displayScale;
  const dispH = natural.height * displayScale;
  return { maxX: Math.max(0, (dispW - frameSize) / 2), maxY: Math.max(0, (dispH - frameSize) / 2) };
}

// A from-scratch crop/pan/zoom surface rather than expo-image-picker's
// `allowsEditing` -- that option opens the OS's native crop tool on
// iOS/Android (fine, but inconsistent with this screen's own look and not
// reachable from here for a re-crop after the fact) and does literally
// nothing on web (react-native-web's ImagePicker has no editing UI at
// all), which is exactly where this app also runs as vevaty.com. Panning
// is plain core-RN PanResponder, not react-native-gesture-handler's pinch
// handler -- same choice RangeSlider.tsx made for its thumbs, for the same
// reason: one PanResponder instance, created once and never rebuilt, read
// through refs so it always sees the latest zoom/offset (see that file's
// comment for why a responder rebuilt on every render silently breaks
// dragging on web). Zoom is a slider (reusing RangeSlider) rather than a
// two-finger pinch, on purpose: a pinch gesture has no equivalent for a
// mouse, so a slider is the one control that behaves identically with a
// finger, a trackpad, or a mouse.
export default function ImageCropModal({ visible, uri, shape = 'circle', title, onCancel, onConfirm }: Props) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [frameSize, setFrameSize] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);

  const naturalRef = useRef(natural);
  naturalRef.current = natural;
  const frameSizeRef = useRef(frameSize);
  frameSizeRef.current = frameSize;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const grantOffsetRef = useRef({ x: 0, y: 0 });

  // A freshly opened photo always starts centered and un-zoomed -- carrying
  // over the previous photo's pan/zoom would be a leftover-state bug the
  // moment a seller cancels and picks a second photo.
  useEffect(() => {
    if (!uri) return;
    setNatural(null);
    setLoadError(false);
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    Image.getSize(
      uri,
      (width, height) => setNatural({ width, height }),
      () => setLoadError(true)
    );
  }, [uri]);

  const baseScale = (frame: number, n: { width: number; height: number }) => frame / Math.min(n.width, n.height);

  const responderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const getResponder = () => {
    if (responderRef.current) return responderRef.current;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grantOffsetRef.current = offsetRef.current;
      },
      onPanResponderMove: (_evt, gesture) => {
        const n = naturalRef.current;
        const frame = frameSizeRef.current;
        if (!n || !frame) return;
        const displayScale = baseScale(frame, n) * zoomRef.current;
        const { maxX, maxY } = maxOffset(displayScale, frame, n);
        const next = {
          x: clamp(grantOffsetRef.current.x + gesture.dx, -maxX, maxX),
          y: clamp(grantOffsetRef.current.y + gesture.dy, -maxY, maxY),
        };
        offsetRef.current = next;
        setOffset(next);
      },
    });
    responderRef.current = responder;
    return responder;
  };

  const handleZoomChange = (z: number) => {
    const n = naturalRef.current;
    const frame = frameSizeRef.current;
    zoomRef.current = z;
    setZoom(z);
    if (!n || !frame) return;
    // Zooming back out can leave the previous offset pointing further from
    // center than the new, smaller overhang allows -- re-clamp immediately
    // so the frame never shows a gap of empty space after the slider moves.
    const displayScale = baseScale(frame, n) * z;
    const { maxX, maxY } = maxOffset(displayScale, frame, n);
    const next = { x: clamp(offsetRef.current.x, -maxX, maxX), y: clamp(offsetRef.current.y, -maxY, maxY) };
    offsetRef.current = next;
    setOffset(next);
  };

  const onFrameLayout = (e: LayoutChangeEvent) => setFrameSize(Math.round(e.nativeEvent.layout.width));

  const handleConfirm = async () => {
    const n = naturalRef.current;
    const frame = frameSizeRef.current;
    if (!uri || !n || !frame) return;
    setProcessing(true);
    try {
      const displayScale = baseScale(frame, n) * zoomRef.current;
      const dispW = n.width * displayScale;
      const dispH = n.height * displayScale;
      // The frame's visible window, expressed in the DISPLAYED image's own
      // pixel space (i.e. before dividing back out by displayScale) --
      // "how far the image's top-left corner sits above/left of the
      // frame's top-left corner", which is the mirror image of how the
      // image is positioned on screen (see the `left`/`top` style below).
      const visibleLeft = (dispW - frame) / 2 - offsetRef.current.x;
      const visibleTop = (dispH - frame) / 2 - offsetRef.current.y;
      const cropSize = frame / displayScale;
      let originX = Math.round(visibleLeft / displayScale);
      let originY = Math.round(visibleTop / displayScale);
      let width = Math.round(cropSize);
      let height = Math.round(cropSize);
      // Pan/zoom are clamped continuously above, so this rect should
      // already sit inside the source image -- this is just a defensive
      // final clamp against float/rounding drift, not load-bearing logic.
      originX = clamp(originX, 0, Math.max(0, n.width - width));
      originY = clamp(originY, 0, Math.max(0, n.height - height));
      width = Math.min(width, n.width - originX);
      height = Math.min(height, n.height - originY);

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX, originY, width, height } }, { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      await onConfirm(result.uri);
    } finally {
      setProcessing(false);
    }
  };

  if (!visible || !uri) return null;

  const displayScale = natural && frameSize ? baseScale(frameSize, natural) * zoom : 0;
  const dispW = natural ? natural.width * displayScale : 0;
  const dispH = natural ? natural.height * displayScale : 0;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Pressy onPress={onCancel} style={StyleSheet.absoluteFill} haptic={false} />
        <View style={styles.card}>
          <View style={styles.topBar}>
            <View style={styles.iconBtn} />
            <Text style={type.h3}>{title || t('imageCrop.title')}</Text>
            <Pressy onPress={onCancel} style={styles.iconBtn} accessibilityLabel={t('common.cancel')}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>

          {loadError ? (
            <View style={styles.frameOuter}>
              <Text style={styles.errorText}>{t('imageCrop.loadFailed')}</Text>
            </View>
          ) : (
            <>
              <View
                style={[styles.frameOuter, shape === 'circle' && styles.frameOuterCircle]}
                onLayout={onFrameLayout}
                {...getResponder().panHandlers}
                testID="image-crop-frame"
              >
                {natural && frameSize > 0 && (
                  <Image
                    source={{ uri }}
                    style={[
                      styles.image,
                      {
                        width: dispW,
                        height: dispH,
                        left: (frameSize - dispW) / 2 + offset.x,
                        top: (frameSize - dispH) / 2 + offset.y,
                      },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.hint}>{t('imageCrop.hint')}</Text>

              <View style={styles.zoomRow}>
                <Text style={styles.zoomGlyph}>−</Text>
                <View style={styles.zoomSlider}>
                  <RangeSlider
                    mode="single"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={zoom}
                    onChange={handleZoomChange}
                    testID="image-crop-zoom"
                  />
                </View>
                <Text style={[styles.zoomGlyph, styles.zoomGlyphBig]}>+</Text>
              </View>
            </>
          )}

          <View style={styles.actions}>
            <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} style={styles.actionBtn} />
            <Button
              label={t('imageCrop.usePhoto')}
              onPress={handleConfirm}
              loading={processing}
              disabled={!natural || loadError}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const FRAME_MAX = 320;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 18,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  frameOuter: {
    width: '100%',
    maxWidth: FRAME_MAX,
    aspectRatio: 1,
    alignSelf: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    // Stops a native browser's own touch-scroll/pull-to-refresh from
    // fighting the drag, same reasoning as RangeSlider's thumb style.
    touchAction: 'none',
  } as unknown as ViewStyle,
  frameOuterCircle: { borderRadius: FRAME_MAX / 2 },
  image: { position: 'absolute' },
  errorText: { ...type.soft, textAlign: 'center', paddingHorizontal: 20 },
  hint: { ...type.tiny, color: colors.inkSoft, textAlign: 'center', marginTop: 10 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, paddingHorizontal: 4 },
  zoomSlider: { flex: 1 },
  zoomGlyph: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', width: 14, textAlign: 'center' },
  zoomGlyphBig: { fontSize: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  actionBtn: { flex: 1, height: 48 },
});
