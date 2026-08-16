import React, { useRef, useState } from 'react';
import { Image, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import Pressy from './Pressy';
import Icon, { IconName } from '../icons/Icon';
import PhotoLightbox from './PhotoLightbox';
import { colors } from '../theme/theme';
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';

type Props = {
  photos: string[];
  fallbackIconName?: IconName;
};

// Fills its parent container -- callers wrap it in whatever sized box they
// already have (e.g. ListingDetailScreen's styles.photo/styles.desktopPhoto),
// so this component owns no width/height of its own.
//
// Swiping through multiple photos is a discrete page-scroll, not a
// continuous drag -- core RN's own `ScrollView horizontal pagingEnabled`
// already handles this correctly on react-native-web (native momentum
// scrolling, works with touch/trackpad/mouse-drag alike), so this
// deliberately does NOT reuse the app's PanResponder machinery
// (DraggableList.tsx/RangeSlider.tsx) -- that exists to solve a different,
// continuous-drag-to-value problem (see SpinViewer.tsx for that one).
//
// Every photo here is `resizeMode: 'cover'` so mixed-aspect-ratio photos
// still fill this box cleanly edge to edge -- which necessarily crops each
// one. Tapping any photo opens PhotoLightbox, a full-screen swipeable
// viewer showing the whole, uncropped photo (`resizeMode: 'contain'`) --
// that's the only place a buyer sees the complete image.
export default function PhotoGallery({ photos, fallbackIconName }: Props) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(photos.length - 1, i)));
  };

  if (photos.length === 0) {
    return (
      <View style={styles.fill}>
        <Icon name={fallbackIconName || 'bag'} size={56} color={colors.inkSoft} />
      </View>
    );
  }

  if (photos.length === 1) {
    return (
      <>
        <Pressy style={styles.fill} onPress={() => setLightboxIndex(0)} haptic={false} accessibilityLabel="View full photo">
          <Image source={{ uri: sizedPhotoUrl(photos[0], PHOTO_WIDTHS.detail)! }} style={styles.img} />
          <View style={styles.expandHint} pointerEvents="none">
            <Icon name="expand" size={13} color={colors.white} />
          </View>
        </Pressy>
        <PhotoLightbox
          photos={photos}
          visible={lightboxIndex !== null}
          initialIndex={lightboxIndex ?? 0}
          onClose={() => setLightboxIndex(null)}
        />
      </>
    );
  }

  return (
    <View style={styles.fill} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        style={styles.scroll}
      >
        {photos.map((uri, i) => (
          <Pressy
            key={uri}
            style={[styles.page, { width: width || undefined }]}
            onPress={() => setLightboxIndex(i)}
            haptic={false}
            accessibilityLabel="View full photo"
          >
            <Image source={{ uri: sizedPhotoUrl(uri, PHOTO_WIDTHS.detail)! }} style={styles.img} />
          </Pressy>
        ))}
      </ScrollView>
      <View style={styles.expandHint} pointerEvents="none">
        <Icon name="expand" size={13} color={colors.white} />
      </View>
      <View style={styles.dots} pointerEvents="none">
        {photos.map((uri, i) => (
          <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      <PhotoLightbox
        photos={photos}
        visible={lightboxIndex !== null}
        initialIndex={lightboxIndex ?? index}
        onClose={() => setLightboxIndex(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  scroll: { width: '100%', height: '100%' },
  page: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
  expandHint: {
    position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  dots: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 14, backgroundColor: colors.white },
});
