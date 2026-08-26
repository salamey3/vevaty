import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import Pressy from './Pressy';
import Icon, { IconName } from '../icons/Icon';
import PhotoLightbox from './PhotoLightbox';
import { colors } from '../theme/theme';
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';

type Props = {
  photos: string[];
  fallbackIconName?: IconName;
  // Which photo is showing. Reported upward because the arrows live
  // outside this component (see the handle below) and need to know when
  // they've run out of photos in one direction.
  onIndexChange?: (index: number) => void;
  // Whether tapping a photo opens PhotoLightbox for the full, uncropped
  // view. Defaults on (every existing caller keeps today's behavior --
  // e.g. CreateListingScreen's review step, which is the seller checking
  // their own upload, not a buyer on the listing page). ListingDetailScreen
  // passes `isDesktop` here: on a phone (native app or mobile web) a
  // buyer's photo browsing stays inside the slider they're already
  // swiping -- no separate enlarged view to escape from -- while desktop
  // web keeps the lightbox, since a mouse pointer/scroll-wheel makes a
  // bigger, uncropped view worth the extra click there.
  allowFullscreen?: boolean;
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
// one. When `allowFullscreen` is on (the default), tapping any photo opens
// PhotoLightbox, a swipeable viewer showing the whole, uncropped photo
// (`resizeMode: 'contain'`) -- that's the only place a buyer sees the
// complete image. When it's off, tapping does nothing at all: the photo
// stays cropped exactly as shown here, and browsing is whatever this
// component itself already offers -- swiping between pages, plus the
// arrows/dots the caller wraps around it.
// Paging is exposed to the parent rather than handled by arrows inside
// this component. The photo box is a fixed-size, overflow-hidden frame, so
// anything rendered in here is necessarily ON the photo -- and arrows
// belong beside it, not over it. Only the caller knows where "beside" is.
export type PhotoGalleryHandle = { page: (direction: number) => void };

function PhotoGalleryInner(
  { photos, fallbackIconName, onIndexChange, allowFullscreen = true }: Props,
  ref: React.Ref<PhotoGalleryHandle>,
) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // One press moves exactly one photo. `index` is tracked already for the
  // dots, so paging is a clamp on it rather than an offset computation --
  // which keeps the arrows, the dots and a manual swipe all agreeing on
  // which photo is current.
  const pageBy = (delta: number) => {
    if (width <= 0) return;
    const next = Math.min(photos.length - 1, Math.max(0, index + Math.sign(delta)));
    setIndex(next);
    onIndexChange?.(next);
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  useImperativeHandle(ref, () => ({ page: pageBy }), [width, index, photos.length]);
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    const next = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(next);
    // A swipe or trackpad scroll moves the gallery without going through
    // pageBy, so the arrows would otherwise keep showing the state from
    // whenever one was last pressed.
    onIndexChange?.(next);
  };

  if (photos.length === 0) {
    return (
      <View style={styles.fill}>
        <Icon name={fallbackIconName || 'bag'} size={56} color={colors.inkSoft} />
      </View>
    );
  }

  if (photos.length === 1) {
    if (!allowFullscreen) {
      return (
        <View style={styles.fill}>
          <Image source={{ uri: sizedPhotoUrl(photos[0], PHOTO_WIDTHS.detail)! }} style={styles.img} />
        </View>
      );
    }
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
        {photos.map((uri, i) =>
          allowFullscreen ? (
            <Pressy
              key={uri}
              style={[styles.page, { width: width || undefined }]}
              onPress={() => setLightboxIndex(i)}
              haptic={false}
              accessibilityLabel="View full photo"
            >
              <Image source={{ uri: sizedPhotoUrl(uri, PHOTO_WIDTHS.detail)! }} style={styles.img} />
            </Pressy>
          ) : (
            <View key={uri} style={[styles.page, { width: width || undefined }]}>
              <Image source={{ uri: sizedPhotoUrl(uri, PHOTO_WIDTHS.detail)! }} style={styles.img} />
            </View>
          ),
        )}
      </ScrollView>
      {allowFullscreen && (
        <View style={styles.expandHint} pointerEvents="none">
          <Icon name="expand" size={13} color={colors.white} />
        </View>
      )}
      <View style={styles.dots} pointerEvents="none">
        {photos.map((uri, i) => (
          <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
      {allowFullscreen && (
        <PhotoLightbox
          photos={photos}
          visible={lightboxIndex !== null}
          initialIndex={lightboxIndex ?? index}
          onClose={() => setLightboxIndex(null)}
        />
      )}
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

const PhotoGallery = forwardRef(PhotoGalleryInner);
export default PhotoGallery;
