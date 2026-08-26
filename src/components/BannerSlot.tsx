import React, { useCallback, useEffect, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View, ViewStyle } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import Pressy from './Pressy';
import { colors, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useBanners, useBannerForSlot } from '../store/BannerStore';
import { Banner, BannerSlot as BannerSlotKind } from '../types';
import { openBannerLink } from '../lib/bannerLink';
import { RootStackParamList } from '../navigation/types';

// Per-slot sizing, straight from the design spec's Section 2. Both numbers
// are CEILINGS, never a forced/fixed size: the box scales up to them but
// never beyond, and never crops. `maxWidth`, where present, keeps a slot
// from growing wider than the design calls for on a roomy desktop screen;
// `maxHeight` keeps a tall image from colliding with what's below it (the
// sidebar footer; the bottom of a short listing page).
//
// Neither ceiling is applied as CSS (no percentage width, no aspectRatio
// style) -- BannerSlotView measures its own real available width via
// onLayout and computes an exact pixel width/height in JS instead. That's
// deliberate, not just belt-and-suspenders: RN-Web was observed rendering
// a `width: '100%'` + `aspectRatio` box WIDER than its actual flex parent
// on the live mobile site (the creative overflowed off the right edge of
// the screen and got clipped by the viewport, not by this component), and
// a plain fixed pixel width doesn't shrink below its ceiling on a narrower
// parent either (same clipping, just triggered by a small screen or a
// browser zoom level instead). Measuring the real box and computing exact
// numbers sidesteps both failure modes -- see the sizing math below.
//
// 'listing_detail_mobile' and the two home_* slots have no maxHeight, so
// they're unconstrained on that axis by design -- they sit between two
// carousels (or above nothing at all), not above a footer or a page
// bottom, so there's nothing below them a tall creative could collide
// with.
const SLOT_SIZE: Record<BannerSlotKind, { maxWidth?: number; maxHeight?: number }> = {
  sidebar_nav: { maxWidth: 200, maxHeight: 320 },
  listing_detail_desktop_rail: { maxWidth: 440, maxHeight: 800 },
  listing_detail_mobile: {},
  home_after_editors_picks: {},
  home_after_just_listed: {},
};

// Reads the creative's own natural size once, so the container can be
// sized to its real aspect ratio (width/height) instead of guessing --
// without this, every banner would need to be authored at one fixed
// ratio, which is exactly what the "dynamically expands to fit whatever
// design we put inside it" requirement rules out.
function useImageAspect(uri: string | null): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    setAspect(null);
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && h > 0) setAspect(w / h);
      },
      () => {
        // Couldn't read it (bad URL, offline) -- render nothing rather
        // than a broken-image box; same "no empty state noise" rule as
        // every other optional section in this app.
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return aspect;
}

// Renders the currently-selected banner for one slot, or nothing if none
// is active there. Handles its own reroll-on-focus (see useBannerForSlot)
// -- callers just drop <BannerSlot slot="..." /> where the design calls
// for it and don't need to know about the shuffle bag at all.
export default function BannerSlot({ slot, style }: { slot: BannerSlotKind; style?: ViewStyle }) {
  const banner = useBannerForSlot(slot);
  return <BannerSlotView banner={banner} slot={slot} style={style} />;
}

// Split out so TabBar's sidebar (which rerolls on its own tab-focus
// effect rather than useBannerForSlot's screen-focus one -- see
// BannerStore.tsx's doc comment on why) can render the same visuals
// without going through the screen-focus hook.
export function BannerSlotView({
  banner,
  slot,
  style,
  maxHeight,
}: {
  banner: Banner | null;
  slot: BannerSlotKind;
  style?: ViewStyle;
  // Overrides SLOT_SIZE's own maxHeight ceiling for this one instance.
  // TabBar's sidebar passes the actual space measured between the nav list
  // and the footer, so the banner can grow up to that much instead of
  // stopping at the fixed 320px every other sidebar_nav placement falls
  // back to. It's still a ceiling, not a fill target -- so a creative that
  // doesn't need all of it just leaves the rest of that space empty
  // rather than being stretched or cropped into it.
  maxHeight?: number;
}) {
  const { language } = useLanguage();
  const { logClick } = useBanners();
  // Typed as the plain NavigationProp -- not NativeStackNavigationProp --
  // because that's what openBannerLink (bannerLink.ts) accepts: it's
  // shared by every BannerSlot regardless of which navigator rendered it
  // (TabBar's sidebar isn't inside a native-stack screen at all), and the
  // two navigation-prop generics aren't structurally assignable to each
  // other despite both offering .navigate().
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const imageUrl = banner ? (language === 'ar' ? banner.imageUrlAr : banner.imageUrlEn) : null;
  const aspect = useImageAspect(imageUrl);

  // The real, current width this slot's own layout box has to work with --
  // i.e. whatever's left after the parent's flex sizing, any padding on
  // `style` below, and the current viewport/zoom level have all been
  // applied. Re-fires on every resize/reflow (a browser zoom change is
  // exactly that), which is what makes this responsive to zoom and screen
  // size rather than fixed at whatever the first render happened to see.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const onMeasure = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setMeasuredWidth((prev) => (prev === w ? prev : w));
  }, []);

  if (!banner || !imageUrl || !aspect) return null;

  const size = SLOT_SIZE[slot];
  const effectiveMaxHeight = maxHeight ?? size.maxHeight;

  // Fit-inside-the-box math, done in real pixels rather than CSS percentages
  // or aspectRatio (see SLOT_SIZE's comment on why): start from whatever
  // width this instance actually got handed, cap it at the slot's own
  // maxWidth design ceiling if it has one, then check whether the
  // creative's own aspect ratio would make that width taller than the
  // maxHeight ceiling (if any) allows. If so, shrink BOTH dimensions
  // together from the height ceiling instead, preserving the aspect ratio
  // -- the opposite of resizeMode="cover" cropping whatever doesn't fit.
  // Either way the box ends up exactly the size of the image it's
  // showing: no cropped edge, no empty background gap around a
  // letterboxed creative.
  let boxWidth: number | null = null;
  let boxHeight: number | null = null;
  if (measuredWidth != null) {
    const availableWidth = size.maxWidth != null ? Math.min(measuredWidth, size.maxWidth) : measuredWidth;
    const heightAtAvailableWidth = availableWidth / aspect;
    if (effectiveMaxHeight != null && heightAtAvailableWidth > effectiveMaxHeight) {
      boxHeight = effectiveMaxHeight;
      boxWidth = effectiveMaxHeight * aspect;
    } else {
      boxWidth = availableWidth;
      boxHeight = heightAtAvailableWidth;
    }
  }

  return (
    // Outer view carries the caller's own spacing (margins, horizontal
    // insets) and is what actually gets measured -- its rendered width IS
    // "100% of the real parent, minus that spacing", which onLayout
    // reports honestly regardless of viewport size or browser zoom, unlike
    // the CSS width:'100%'/aspectRatio combination this replaced.
    // alignItems: 'center' centers the inner box on the rare occasion it
    // ends up narrower than the full measured width (the maxHeight-capped
    // branch above).
    <View style={[styles.measure, style]} onLayout={onMeasure}>
      {boxWidth != null && boxHeight != null && (
        <Pressy
          onPress={() => {
            logClick(banner.id);
            openBannerLink(banner, navigation);
          }}
          style={[styles.wrap, { width: boxWidth, height: boxHeight }]}
        >
          {/* contain, not cover -- belt-and-suspenders alongside the exact
              sizing above: the box is already computed to the creative's
              own aspect ratio, so this never actually has to shrink
              anything, but it guarantees no crop even if a stale
              measurement briefly makes the box's ratio not match. */}
          <Image source={{ uri: imageUrl }} style={styles.img} resizeMode="contain" />
        </Pressy>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  measure: {
    width: '100%',
    alignItems: 'center',
  },
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  img: { width: '100%', height: '100%' },
});
