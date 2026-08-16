import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius } from '../theme/theme';

type Props = {
  photos: string[];
  visible: boolean;
  initialIndex: number;
  onClose: () => void;
};

// Enlarged photo viewer, opened by tapping any photo in PhotoGallery.
// PhotoGallery's own thumbnail/page images are `resizeMode: 'cover'` on
// purpose -- that's what makes a grid of mixed-aspect-ratio photos line up
// cleanly inside a fixed-size box -- but it means part of every photo is
// always cropped off (this is what the seller/buyer sees on the listing
// card and at the top of the detail page). This is the one place the
// whole, uncropped photo is shown: `resizeMode: 'contain'`, swipeable
// between every photo on the listing.
//
// Deliberately NOT a literal edge-to-edge fullscreen takeover -- the image
// is enlarged inside a bounded, centered box over a dimmed backdrop (a
// conventional "lightbox", not a new screen), so there's always a visible
// margin of backdrop around it. Clicking that margin (or pressing Escape,
// handled for free by react-native-web's Modal) closes it, same as a
// typical desktop lightbox. Escape's own listener lives inside
// react-native-web's Modal/ModalContent -- see node_modules -- calling the
// `onRequestClose` prop below, so no separate keydown handler is needed
// for that specific key here; only the Left/Right paging shortcut is new.
export default function PhotoLightbox({ photos, visible, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const widthRef = useRef(width);
  widthRef.current = width;

  // Jump straight to whichever photo was tapped -- it should open already
  // showing that one, not visibly page over from photo 0. The timeout lets
  // the ScrollView mount/layout at its final width first (opening a Modal
  // and calling scrollTo in the same tick is a no-op on web).
  useEffect(() => {
    if (!visible) return;
    setIndex(initialIndex);
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: initialIndex * widthRef.current, animated: false });
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialIndex]);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(clamped);
    scrollRef.current?.scrollTo({ x: clamped * widthRef.current, animated: true });
  };

  // Left/Right arrow-key paging -- the swipe/paging gesture already works
  // via the ScrollView (trackpad/touch/mouse-drag), but there was no
  // keyboard equivalent, so a desktop user without a trackpad/magic mouse
  // had no way to move between photos other than clicking-and-dragging the
  // scrollbar. Escape is deliberately not handled here -- see the
  // top-of-file comment, react-native-web's Modal already wires it to
  // `onRequestClose`.
  useEffect(() => {
    if (!visible || typeof document === 'undefined' || photos.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(Math.min(photos.length - 1, indexRef.current + 1));
      else if (e.key === 'ArrowLeft') goTo(Math.max(0, indexRef.current - 1));
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, photos.length]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(photos.length - 1, i)));
  };

  if (!visible || photos.length === 0) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Click-outside-to-close layer -- absoluteFill sits underneath the
            bounded image box below (which is normal-flow, so it paints on
            top and intercepts its own clicks). Anything not covered by the
            image box -- i.e. the visible backdrop margin -- hits this
            Pressy directly and closes the lightbox, same as Escape. */}
        <Pressy onPress={onClose} style={StyleSheet.absoluteFill} haptic={false} />

        <View style={styles.stage} pointerEvents="box-none">
          <View style={styles.imageBox} onLayout={onLayout}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onMomentumEnd}
              style={styles.scroll}
            >
              {photos.map((uri) => (
                <View key={uri} style={[styles.page, { width: width || undefined }]}>
                  <Image source={{ uri }} style={styles.img} resizeMode="contain" />
                </View>
              ))}
            </ScrollView>

            {photos.length > 1 && (
              <View style={styles.counterBadge} pointerEvents="none">
                <Text style={styles.counter}>{index + 1}/{photos.length}</Text>
              </View>
            )}
            <Pressy onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Icon name="close" size={16} color={colors.white} />
            </Pressy>

            {photos.length > 1 && (
              <View style={styles.dots} pointerEvents="none">
                {photos.map((uri, i) => (
                  <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,12,0.92)' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  imageBox: {
    width: '100%', maxWidth: 980, height: '100%', maxHeight: 720,
    borderRadius: radius.lg, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  scroll: { flex: 1 },
  page: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
  counterBadge: {
    position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  counter: { fontSize: 12, fontWeight: '600', color: colors.white },
  closeBtn: {
    position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  dots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { width: 16, backgroundColor: colors.white },
});
