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

// Per-slot sizing, straight from the design spec's Section 2 -- width is
// fixed per slot, height is auto to the creative's own aspect ratio, and
// the two that need one get a hard cap so a tall image can never collide
// with what's below it (the sidebar footer; the bottom of a short
// listing page). 'listing_detail_mobile' deliberately has no cap, and the
// two home_* slots follow that same no-cap precedent -- they sit between
// two carousels rather than above a footer or a page bottom, so there's
// nothing below them a tall creative could collide with either.
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
  // Overrides SLOT_SIZE's own cap for this one instance. TabBar's sidebar
  // passes the actual space measured between the nav list and the footer,
  // so the banner grows to fill it instead of stopping at the fixed 320px
  // every other sidebar_nav placement falls back to -- see TabBar.tsx's
  // own comment on why a static cap was leaving dead space there.
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
  const widthPct = typeof size.width === 'string';
  const naturalHeight = widthPct ? null : (size.width as number) / aspect;
  // Two different jobs depending on whether a caller passed maxHeight:
  // with no override (every slot except TabBar's sidebar), it's just a
  // ceiling on the creative's own natural height, exactly as before this
  // prop existed. With an override, it's an exact height budget the
  // caller measured (how much room is actually left before it must stop)
  // -- so the box FILLS it, letting resizeMode="cover" crop the image if
  // its aspect ratio doesn't happen to match, rather than leaving
  // whatever gap the creative's natural height falls short by.
  const effectiveMaxHeight = maxHeight ?? size.maxHeight;
  const height =
    maxHeight != null
      ? maxHeight
      : naturalHeight != null && effectiveMaxHeight != null
        ? Math.min(naturalHeight, effectiveMaxHeight)
        : naturalHeight;

  return (
    <Pressy
      onPress={() => {
        logClick(banner.id);
        openBannerLink(banner, navigation);
      }}
      style={[
        styles.wrap,
        { width: size.width as any, maxHeight: effectiveMaxHeight, height: height ?? undefined, aspectRatio: widthPct ? aspect : undefined },
        style,
      ]}
    >
      <Image source={{ uri: imageUrl }} style={styles.img} resizeMode="cover" />
    </Pressy>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  img: { width: '100%', height: '100%' },
});
