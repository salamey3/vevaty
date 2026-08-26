import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, ViewStyle } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import Pressy from './Pressy';
import { colors, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useBanners, useBannerForSlot } from '../store/BannerStore';
import { Banner, BannerSlot as BannerSlotKind } from '../types';
import { openBannerLink } from '../lib/bannerLink';
import { RootStackParamList } from '../navigation/types';

// Per-slot sizing, straight from the design spec's Section 2. `width` is a
// CEILING, not a forced size: the box scales up to it but never beyond, and
// never crops. `maxHeight`, where present, is the same kind of ceiling on
// the other axis (keeps a tall image from colliding with what's below it --
// the sidebar footer; the bottom of a short listing page). Whenever a
// creative's own aspect ratio would need more of one axis than its ceiling
// allows, BOTH ceilings shrink together (preserving the aspect ratio) until
// the whole image fits -- see the sizing math in BannerSlotView below. The
// container is always exactly the size of the image it ends up showing;
// there's never a cropped edge and never a background-colored gap around a
// letterboxed creative. 'listing_detail_mobile' and the two home_* slots
// have no maxHeight, so they're unconstrained on that axis by design --
// they sit between two carousels (or above nothing at all), not above a
// footer or a page bottom, so there's nothing below them a tall creative
// could collide with.
const SLOT_SIZE: Record<BannerSlotKind, { width: number | string; maxHeight?: number }> = {
  sidebar_nav: { width: 200, maxHeight: 320 },
  listing_detail_desktop_rail: { width: 440, maxHeight: 800 },
  listing_detail_mobile: { width: '100%' },
  home_after_editors_picks: { width: '100%' },
  home_after_just_listed: { width: '100%' },
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
  // back to. It's still a ceiling, not a fill target -- see the sizing
  // math below -- so a creative that doesn't need all of it just leaves
  // the rest of that space empty rather than being stretched or cropped
  // into it.
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

  if (!banner || !imageUrl || !aspect) return null;

  const size = SLOT_SIZE[slot];
  const maxWidthIsFluid = typeof size.width === 'string'; // '100%' -- no known pixel ceiling
  const effectiveMaxHeight = maxHeight ?? size.maxHeight;

  // Fit-inside-the-box math: scale the creative up to whichever ceiling it
  // hits first, on either axis, preserving its own aspect ratio -- the
  // opposite of resizeMode="cover" (which fills the box and crops
  // whatever doesn't fit). The box then gets shrunk to exactly match, so
  // there's no leftover gap around it either -- it just adjusts to the
  // creative's own final size.
  let boxWidth: number | string;
  let boxHeight: number | undefined;

  if (!maxWidthIsFluid && effectiveMaxHeight != null) {
    // Both axes have a real pixel ceiling (sidebar_nav, listing_detail_desktop_rail,
    // and TabBar's measured sidebar override) -- pick whichever ceiling the
    // creative's own aspect ratio would overflow first, then scale to fit
    // wholly inside it.
    const maxW = size.width as number;
    const heightAtMaxWidth = maxW / aspect;
    if (heightAtMaxWidth <= effectiveMaxHeight) {
      boxWidth = maxW;
      boxHeight = heightAtMaxWidth;
    } else {
      boxHeight = effectiveMaxHeight;
      boxWidth = effectiveMaxHeight * aspect;
    }
  } else if (maxWidthIsFluid) {
    // No pixel width to do fixed math against -- let the box take up to
    // 100% of its parent and derive height from aspectRatio, which sizes
    // itself off however much width CSS actually grants it, so it can
    // never crop and (with no maxHeight on any of these slots -- see
    // SLOT_SIZE above) never gets capped either. If a future slot ever
    // combines a fluid width with a maxHeight, the cap below still holds
    // as a last-resort ceiling with resizeMode="contain" doing the actual
    // no-crop guarantee, at the cost of a possible empty margin instead of
    // the exact-fit box the fixed-width branch achieves.
    boxWidth = size.width;
    boxHeight = undefined;
  } else {
    // Fixed pixel width, no height ceiling -- height is simply whatever
    // the creative's own ratio implies at that width.
    boxWidth = size.width as number;
    boxHeight = (size.width as number) / aspect;
  }

  return (
    <Pressy
      onPress={() => {
        logClick(banner.id);
        openBannerLink(banner, navigation);
      }}
      style={[
        styles.wrap,
        {
          width: boxWidth as any,
          height: boxHeight,
          aspectRatio: boxHeight == null ? aspect : undefined,
          maxHeight: maxWidthIsFluid ? effectiveMaxHeight : undefined,
        },
        style,
      ]}
    >
      {/* contain, not cover -- the box above is already sized to the
          creative's own aspect ratio in every normal case, so this is a
          no-op then; it only does real work as the last-resort guard in
          the fluid-width + maxHeight edge case noted above. */}
      <Image source={{ uri: imageUrl }} style={styles.img} resizeMode="contain" />
    </Pressy>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    // Only visibly matters when a maxHeight ceiling forces the box
    // narrower than its own width ceiling (see the sizing math above) --
    // centers it in that column instead of leaving it pinned to the
    // start edge. A no-op everywhere else, since those boxes already
    // fill the full width they're given.
    alignSelf: 'center',
  },
  img: { width: '100%', height: '100%' },
});
