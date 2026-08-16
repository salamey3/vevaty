import { useCallback, useMemo, useRef } from 'react';
import { Platform, ScrollView } from 'react-native';

// Shared plumbing for "this horizontal carousel should swipe right-to-left
// in Arabic": the three carousels in the app (home category rows, the home
// categories chip strip, and the related-listings row on a listing) all want
// identical behaviour, and getting it right depends on a platform detail
// that's easy to forget at any one of those call sites.
//
// WHY NOT `transform: scaleX(-1)`, which this replaced:
// Mirroring the scroller and counter-mirroring each child works, but it is
// expensive on Android in two ways that land squarely on the swipe/scroll
// path. A transform on a child blocks React Native's view-flattening
// optimisation, so every counter-flip wrapper becomes a real native view
// (and a candidate for its own hardware layer) rather than being collapsed
// away. Worse, React Native derives a list's clipping rectangles from
// *untransformed* layout coordinates, so on a mirrored parent that math runs
// backwards -- combined with `removeClippedSubviews` it will unmount cards
// that are genuinely on screen while mounting ones that aren't, churning
// views and image decodes on every frame of a swipe.
//
// WHY THE WEB CARVE-OUT:
// On web, LanguageContext sets `document.documentElement.dir = 'rtl'` for
// Arabic (see applyDocumentDirection), and the browser then lays out and
// scrolls every horizontal container right-to-left on its own -- correctly,
// for free. Reversing the data there too would double-apply and put the
// first item back on the left. Native has no equivalent: this app never
// flips I18nManager.isRTL, so on Android/iOS there is no ambient direction
// at all and the order has to be handled explicitly. This is the same
// web-has-real-direction-support / native-doesn't split that made
// `textAlign: 'auto'` silently do nothing on device.
const NEEDS_MANUAL_REVERSE = Platform.OS !== 'web';

export function useRtlCarousel<T>(items: T[], isRTL: boolean) {
  const reverse = isRTL && NEEDS_MANUAL_REVERSE;

  // Reversing the order and parking the viewport at the far end gives the
  // same result the mirror did -- first item at the right edge, dragging
  // rightward walks leftward through the rest -- for the cost of one array
  // copy, and with no transforms anywhere.
  const ordered = useMemo(() => (reverse ? [...items].reverse() : items), [items, reverse]);

  const scrollRef = useRef<ScrollView>(null);
  // Content size only changes when the item set does, so this re-pins to the
  // end when the data changes without fighting an in-progress swipe.
  const onContentSizeChange = useCallback(() => {
    if (reverse) scrollRef.current?.scrollToEnd({ animated: false });
  }, [reverse]);

  return { ordered, scrollRef, onContentSizeChange };
}
