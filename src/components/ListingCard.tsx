import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, Image, ViewStyle, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Pressy from './Pressy';
import CardPreview from './CardPreview';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { Listing } from '../types';
import { useSettings } from '../store/SettingsStore';
import { useAppStore } from '../store/AppStore';
import { useFavorites } from '../store/FavoritesStore';
import { useLanguage } from '../i18n/LanguageContext';
import { listingTitle, listingDistrict, listingShopName } from '../lib/listingText';
import { mirrorRow } from '../lib/mirrorRow';
import { sizedPhotoUrl } from '../lib/photoSize';
import { relativeTimeFrom } from '../lib/relativeTime';
import { cardKindLabel, cardConditionLabel, resolveCardSpecs } from '../lib/cardSpecs';
import { listingPriceLines } from '../lib/priceDisplay';
import { gridCardWidthPct } from '../lib/cardWidth';
import { isFeaturedNow } from '../lib/listingSort';
import SponsoredPill from './SponsoredPill';
import { RootStackParamList } from '../navigation/types';

// How long the cursor has to sit still on a card before its preview
// starts. Not zero: a mouse sweeping across a grid of a dozen cards on
// its way somewhere else would otherwise fire off a network request and a
// decode for every single one it merely crossed. Long enough to filter
// that out, short enough that anyone who's actually looking still reads
// it as instant.
const HOVER_PREVIEW_DELAY_MS = 180;

// The horizontal padding a listing grid puts around itself ON A PHONE. Used
// only for the first-frame estimate of a grid card's width (see
// drawnPhotoWidth), which onLayout then replaces with the measured value --
// so being wrong here costs at most one extra request, and it is exact on the
// phone paths that matter for memory.
const GRID_PADDING = 18;

// gridCardWidthPct is not defined here any more. The grid's percentages and
// the carousels' pixel widths are two answers to one question -- how wide is
// a listing card here -- and they sat in different files long enough to
// drift badly apart. They live together in lib/cardWidth.ts now. Not
// re-exported from here either: nothing outside this file imported it, and a
// second name for one thing is how the drift started.

// The empty box that stands in for a missing card on a short last row. Renders
// nothing and measures exactly one card wide.
export function ListingCardSpacer({ columns }: { columns: number }) {
  return <View style={{ width: gridCardWidthPct(columns) }} />;
}

// A single small badge in the thumbnail's top-right corner -- Editor's
// Picks (sparkle, gold) and Hot Deals (a "-15%" style label, terracotta)
// both use this same slot, one collection row at a time, so it's a plain
// either/or rather than a list. Just Listed intentionally passes none: not
// every row needs to shout, per the approved Collections mockup.
export type CornerBadge = { icon: IconName; color: string } | { text: string; color: string };

// listing.condition is the universal pick, whatever question the
// category makes it ask -- New/Used, Sale/Rent/Both, sale-or-rehome, or a
// wear grade. See Listing.condition and ConditionMode in src/types.
//
// The badge only ever prints the New/Used and graded arms of it: a
// property's or a car's offer type is already in the price lines, and a
// pet's rehoming is the word "Free" there. Where that leaves a category
// with no badge at all, the category can nominate an attribute to supply
// one instead -- see cardConditionLabel, and Category.cardConditionSlug for
// why a car had no New/Used anywhere on its card until it could.
//
// The value-to-label lookup lives in src/lib/conditionModes.ts with every
// other per-value list, so a new mode cannot light up a picker and leave
// this behind -- a silent fall-through to "Used" is exactly the bug that
// arrangement replaced.

export default function ListingCard({
  listing,
  onPress,
  columns = 2,
  width,
  // Some carousels (related listings, category sections) intentionally
  // omit the heart -- it's the card's own listing detail page that's the
  // primary place to save something, this is just a convenience on the
  // main browse grid. Defaults on since that's the common case.
  showFavorite = true,
  // Collection badge (Editor's Picks / Hot Deals) -- see CornerBadge above.
  // Shares the thumbnail's top-right corner with spinBadge; on the rare
  // listing that's both a 360-spin AND in a collection, this one wins the
  // corner and spinBadge shifts down rather than the two overlapping.
  cornerBadge,
  // 'vertical' (default): photo on top, details below -- the shape every
  // grid and carousel on the app has always used. 'horizontal': photo on
  // the left, details on the right, used by CollectionCarouselSection for
  // Hot Deals (every platform) and Editor's Picks (desktop web only) --
  // see that component's own comment for exactly which collection gets
  // which, on which platform. The badges/ribbon inside the thumbnail
  // (favorite, cornerBadge, spinBadge, out-of-stock) don't need their own
  // layout branch: they're positioned absolute within `thumb`, so they
  // just follow whatever size/shape it resolves to.
  layout = 'vertical',
}: {
  listing: Listing;
  onPress: () => void;
  columns?: number;
  // Fixed pixel width, for use inside a horizontal-scrolling carousel
  // instead of a wrapping percentage-based grid. Overrides the
  // columns-derived percentage when set.
  width?: number;
  showFavorite?: boolean;
  cornerBadge?: CornerBadge;
  layout?: 'vertical' | 'horizontal';
}) {
  const { categoryById, resolveAttributesForCategory, cardKindSlugForCategory, cardConditionSlugForCategory } = useSettings();
  const { isVerified, profile } = useAppStore();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { language, isRTL, t } = useLanguage();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth } = useWindowDimensions();
  const cat = categoryById(listing.cat);
  const widthPct = gridCardWidthPct(columns);
  const favorited = isFavorite(listing.id);
  // Paid promotion, disclosed. Featured only -- a Bump Up has no duration
  // to be "currently" anything for; see SponsoredPill for the reasoning.
  // Read straight off the listing rather than recomputed against a clock
  // this component owns: isFeaturedNow is the same test the browse sort
  // uses, so what a buyer is told matches why they are seeing it here.
  const sponsored = isFeaturedNow(listing);
  const [favBusy, setFavBusy] = useState(false);
  // Nothing to save about your own listing -- same reasoning as
  // ListingDetailScreen hiding its contact CTA from the owner.
  const canFavorite = showFavorite && listing.sellerId !== profile.id;
  const horizontal = layout === 'horizontal';
  // Reserve fixed heights for the title, the spec row and the second price
  // line -- but only where this card sits beside another one to line up WITH.
  // A one-column phone grid has no neighbour: there the three floors would
  // add ~55px of blank to every card (a one-line title, an empty spec row and
  // an absent second price, at 18.5 + 20 + 17) on the layout that exists
  // precisely to give the photo room, and buy nothing at all. Anything in a
  // multi-column grid or a carousel has a neighbour.
  const alignsWithNeighbour = horizontal || columns > 1 || width !== undefined;
  // The photo-left thumbnail: 38% of the card, never below 128.
  //
  // The floor is the point. A bare percentage made the photo SMALLER than the
  // 128 it had been on every phone narrower than about 388px -- 117px on a
  // 360px one -- which is under the width this same card had already rejected
  // once as "a stamp on the card". Buying text width by shrinking the photo
  // was the wrong trade, and it stopped being necessary once the district
  // line was allowed to wrap (see metaRow) instead of ellipsising.
  //
  // Not a claim that nothing on this card can ever clip -- the title is
  // capped at two lines and the district at two, and a long enough one of
  // either still ellipsises. What changed is that the line which clipped on
  // an ORDINARY listing at an ordinary width no longer does.
  //
  // No upper cap: it would need a card wider than 444px to bind, and the
  // widest any caller renders is 400.
  //
  // The fallback is only reached if a caller renders a horizontal card
  // without saying how wide it is, which no caller does today.
  const thumbWidth = horizontal ? Math.max(128, Math.round((width ?? 336) * 0.38)) : undefined;

  // How wide this card's photo is ACTUALLY drawn, so the fetch asks for that
  // rather than for one constant covering every card in the app.
  //
  // It matters more than bandwidth. RN decodes a remote bitmap at its SOURCE
  // resolution however small the view is -- the whole premise of
  // photoSize.ts -- so a 224pt related-listing card handed a grid-sized
  // request pays a grid-sized decoded bitmap. With one shared constant,
  // widening the browse grid would have raised the cost on every carousel in
  // the app at once, the touch-preview path included, which mounts five
  // frames for a slideshow and every frame of a spin set (up to 24).
  //
  // Bounded in scope, and worth stating: sizedPhotoUrl only rewrites the
  // seeded picsum URLs. For a real uploaded photo Bunny returns exactly what
  // it was given, so the ceiling there is the thumbnail baked at upload
  // (resizeThumbnailForUpload), and this request width changes nothing.
  //
  // MEASURED, not derived from the window. A grid card is a percentage of
  // its row, and deriving that from the window width is exact on a phone and
  // badly wrong on desktop, where Screen caps content at 1180 and HomeScreen
  // additionally reserves a 232px nav sidebar, a 240px filter sidebar and a
  // 72px gutter -- so a 1920px window holds a 285px card, and asking for the
  // window-derived 628 would request ~5x the pixels the card draws. That is
  // worse than the constant this replaced.
  //
  // The window-derived value is kept only as the FIRST-FRAME estimate, so a
  // photo appears immediately rather than a frame late; onLayout replaces it
  // with the truth. On a phone the two agree exactly, so nothing refetches
  // there; on desktop a card may request once more at the right size.
  const estimatedPhotoWidth = horizontal
    ? thumbWidth!
    : width ?? Math.round((windowWidth - GRID_PADDING * 2) / columns);
  const [measuredPhotoWidth, setMeasuredPhotoWidth] = useState(0);
  // Quantised up to a 40pt step. Without it every pixel of a desktop window
  // drag produces a new URL for every mounted card, so each one refetches and
  // re-decodes continuously through the drag.
  const drawnPhotoWidth = Math.min(
    400,
    Math.ceil((measuredPhotoWidth || estimatedPhotoWidth) / 40) * 40
  );

  // The hover/touch preview (CardPreview) -- mounted only while
  // `previewing` is true, so its images never load for a card nobody's
  // actually looking at. Desktop web gets it from a plain mouse hover
  // (debounced below, HOVER_PREVIEW_DELAY_MS); touch (native app or a
  // phone browser) gets it the instant a finger touches the card, no
  // debounce -- see the Pressy props below for why that's fine even
  // though touching a card is also how almost every scroll starts.
  const [previewing, setPreviewing] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHoverTimer = () => {
    hoverTimerRef.current = setTimeout(() => setPreviewing(true), HOVER_PREVIEW_DELAY_MS);
  };
  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };
  // A card can be recycled out of a FlatList mid-hover (fast scroll while
  // the pending timer is still ticking) -- without this the timeout would
  // fire setPreviewing on a component nobody can see anymore.
  useEffect(() => clearHoverTimer, []);

  // A sale price, or a rental's rent-and-period, or both lines for a
  // property offered either way -- see listingPriceLines. The 'card'
  // variant labels a property's figures ("Buy for $450,000") and
  // abbreviates the period, which together replace the condition pill and
  // stop it from squeezing the price into "$450,...".
  const priceLines = useMemo(() => listingPriceLines(listing, t, { variant: 'card' }), [listing, t]);

  // What this thing IS, and the specs worth knowing before opening it. Both
  // come from src/lib/cardSpecs.ts, which is now the only place that
  // decides -- see that file for why "the required attributes, first two, in
  // form order" had to go, and what it was quietly getting wrong on every
  // single property listing.
  const cardAttrs = useMemo(
    () => resolveAttributesForCategory(listing.cat),
    [listing.cat, resolveAttributesForCategory]
  );
  const fullTitle = listingTitle(listing, language);
  const kindLabel = useMemo(
    () => cardKindLabel(cat, cardKindSlugForCategory(listing.cat), cardAttrs, listing, language),
    [cat, cardKindSlugForCategory, listing, cardAttrs, language]
  );
  const conditionSlug = useMemo(
    () => cardConditionSlugForCategory(listing.cat),
    [listing.cat, cardConditionSlugForCategory]
  );
  const conditionLabel = useMemo(
    () => cardConditionLabel(listing, conditionSlug, cardAttrs, language, t),
    [listing, conditionSlug, cardAttrs, language, t]
  );
  const cardSpecs = useMemo(
    () => resolveCardSpecs(cardAttrs, listing, language, fullTitle, conditionSlug),
    [cardAttrs, listing, language, fullTitle, conditionSlug]
  );

  // Shop attribution -- only present on listings posted through a shop
  // (see the Listing type's shopId doc comment). No standalone
  // "Storefront" label any more, on either layout -- the pill's own
  // building icon carries that meaning by itself; the pill is its own
  // tap target that jumps straight to the shop's page, so it needs the
  // same stopPropagation treatment as the favorite badge above, or a
  // tap on it would also fire the card's own onPress and open the
  // listing instead. Rendered in two different spots depending on
  // `layout` (see below), so it's built once here and placed either
  // way.
  const storefrontPill = listing.shopId && listing.shopSlug ? (
    <Pressy
      onPress={(e: any) => {
        e?.stopPropagation?.();
        navigation.push('Storefront', { shopSlug: listing.shopSlug! });
      }}
      style={[
        styles.storefrontPill,
        // mirrorRow, not a raw `isRTL && row-reverse`: on web the document
        // already has dir="rtl" and reverses this row itself, so a manual
        // row-reverse flips it BACK and puts the building icon on the wrong
        // side of the shop name. See mirrorRow's own comment. Every row in
        // this file went the same way in this change; the one that could not
        // is storefrontPillRTL, which is an alignSelf rather than a
        // direction and has no mirrorRow equivalent -- noted in NEXT.md.
        mirrorRow(isRTL),
        horizontal && isRTL && styles.storefrontPillRTL,
      ]}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Icon name="building" size={11} color={colors.accentDeep} />
      <Text style={styles.storefrontPillName} numberOfLines={1}>
        {listingShopName(listing, language)}
      </Text>
    </Pressy>
  ) : null;

  const handleFavoritePress = async () => {
    if (!isVerified) {
      navigation.navigate('Auth');
      return;
    }
    if (favBusy) return;
    setFavBusy(true);
    try {
      await toggleFavorite(listing.id);
    } catch {
      // Best-effort -- FavoritesStore already rolled back the optimistic
      // flip, nothing else to show for a single heart tap.
    } finally {
      setFavBusy(false);
    }
  };

  return (
    <Pressy
      onPress={onPress}
      style={[styles.card, horizontal && styles.cardHorizontal, { width: width ?? widthPct }]}
      // Desktop web only -- Pressable's hover events don't fire on
      // native touch, so this never competes with the touch handlers
      // below.
      onHoverIn={startHoverTimer}
      onHoverOut={() => {
        clearHoverTimer();
        setPreviewing(false);
      }}
      // Touch (native app or a phone browser): the preview starts the
      // instant a finger touches the card -- no hold, no debounce --
      // mirroring hover's role on desktop, where looking (hovering) and
      // deciding whether to click through are already two separate
      // moments. A touch that turns out to be the start of a scroll
      // still touches down on some card first, so this does mean that
      // card's preview flashes on for an instant before the scroll
      // takes over -- an accepted, deliberately-chosen tradeoff for
      // making the preview feel instant on a touch that IS a deliberate
      // look, rather than debouncing every touch the way hover does.
      // onPressOut ends it the same way regardless of how the touch
      // ended -- released after a tap (the screen navigates away right
      // after, so it's not visible), released after resting in place,
      // or the gesture handed off to the list's own scroll -- Pressable
      // reports all three the same way, which is also what already kept
      // a card's own press-scale animation from getting stuck mid-scroll.
      onPressIn={() => setPreviewing(true)}
      onPressOut={() => setPreviewing(false)}
    >
      <View
        style={[
          styles.thumb,
          horizontal ? styles.thumbHorizontal : styles.thumbVertical,
          horizontal && { width: thumbWidth },
        ]}
        onLayout={(e) => setMeasuredPhotoWidth(Math.round(e.nativeEvent.layout.width))}
      >
        {listing.photos[0] ? (
          // Requested at card size, not the seeded 900x1200 original -- see
          // photoSize.ts for why that mattered so much more than it looks
          // (bitmap heap, not bandwidth).
          //
          // resizeMode="cover" (RN's own default, set explicitly here so it
          // reads as deliberate) fills the frame edge to edge on both
          // layouts -- 4:3 on the vertical card, and on the photo-left one a
          // frame whose height comes from the row rather than from a ratio at
          // all; see thumbVertical and thumbHorizontal for why they differ. A
          // photo shot in a different ratio from the frame gets the excess
          // cropped off whichever axis runs long, rather than being
          // letterboxed to fit inside it. That is the deliberate choice:
          // every card in a row is a uniform, gap-free rectangle whatever
          // shape its source photo was. Which ratio is the forgiving one is
          // argued at `thumbVertical` below. The listing detail page's own
          // photo display is unrelated and keeps its 3:4 crop.
          <Image
            // The real, purpose-made small thumbnail when one exists (see
            // Listing.coverThumbnailUrl's own comment for why only the
            // cover photo gets one), falling back to today's behavior --
            // sizing down the full photo -- for any listing posted before
            // thumbnails existed. sizedPhotoUrl is still worth wrapping the
            // thumbnail in too: it's a no-op for a Bunny URL today, but
            // costs nothing and stays correct if picsum seed data is ever
            // mixed back in.
            source={{ uri: sizedPhotoUrl(listing.coverThumbnailUrl ?? listing.photos[0], drawnPhotoWidth)! }}
            style={styles.thumbImg}
            resizeMode="cover"
          />
        ) : (
          <Icon name={(cat?.icon as any) || 'bag'} size={30} color={colors.inkSoft} />
        )}
        {previewing && <CardPreview photos={listing.photos} spinSets={listing.spinSets ?? []} photoWidth={drawnPhotoWidth} />}
        {/* Only ever true for a 'multiple' stock-mode listing a seller has
            stocked down to zero -- every 'unique'-mode listing defaults to
            (and stays at) stockQty 1, so this never fires for the vast
            majority of the catalog. Still browsable, just clearly marked,
            same "don't hide it, just say so" treatment as an expired
            listing on the seller's own Profile screen. */}
        {listing.stockQty === 0 && (
          <View style={styles.outOfStockRibbon}>
            <Text style={styles.outOfStockRibbonText}>{t('listingCard.outOfStock')}</Text>
          </View>
        )}
        {cornerBadge && (
          <View style={[styles.cornerBadge, { backgroundColor: cornerBadge.color }]}>
            {'icon' in cornerBadge ? (
              <Icon name={cornerBadge.icon} size={11} color={colors.white} />
            ) : (
              <Text style={styles.cornerBadgeText}>{cornerBadge.text}</Text>
            )}
          </View>
        )}
        {(listing.spinSets?.length ?? 0) > 0 && (
          <View style={[styles.spinBadge, cornerBadge && styles.spinBadgeBelowCorner]}>
            <Icon name="rotate" size={11} color={colors.white} />
          </View>
        )}
        {canFavorite && (
          <Pressy
            onPress={(e: any) => { e?.stopPropagation?.(); handleFavoritePress(); }}
            style={styles.favoriteBadge}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="heart" size={14} color={favorited ? colors.danger : colors.white} filled={favorited} />
          </Pressy>
        )}
        {/* Bottom-left stack: Sponsored above the shop pill. Both answer
            "where is this coming from", so they read as one group, and
            neither is a tap target competing with the heart. Derived from
            the listing here rather than passed in as a prop like
            cornerBadge: a boosted listing is boosted on every surface that
            draws a card, and threading a prop through nine call sites is
            how one of them ends up forgotten.

            Lifted clear of the out-of-stock ribbon when there is one --
            that band is full-width at the bottom of the same box, so
            without this the pill would sit on top of the words in it.
            Same treatment as spinBadgeBelowCorner above, for the same
            reason. */}
        {(sponsored || (!horizontal && storefrontPill)) && (
          <View style={[styles.bottomOverlay, listing.stockQty === 0 && styles.bottomOverlayAboveRibbon]}>
            {sponsored && <SponsoredPill compact />}
            {!horizontal && storefrontPill}
          </View>
        )}
      </View>
      {/* One surface, not two. This used to be a forest-green band carrying
          the price and title in white, with the rest of the card dropping
          back to white underneath -- which split every card into two zones
          and forced anything inside the band to be white text. The green is
          still here and still the loudest thing on the card; it just does
          the work as the price, the kind pill and the spec glyphs rather
          than as a filled rectangle. Two consequences worth keeping: there
          is now room for a title that wraps, and a per-domain accent colour
          (see the domain-colour study) recolours a pill and three glyphs
          gracefully where it would have recoloured a solid block loudly. */}
      <View style={[styles.info, horizontal && styles.infoHorizontal]}>
        {/* What kind of thing this is, and -- for the categories where the
            price line does not already say it -- whether it is new or used.
            The kind comes from cardSpecs.cardKindLabel: usually the category
            name, but the attribute value for the two categories collapsed
            into one postable leaf, so this reads "Apartment" rather than
            "Properties". */}
        {(!!kindLabel || !!conditionLabel) && (
          <View style={[styles.pillRow, mirrorRow(isRTL)]}>
            {!!kindLabel && (
              <View style={styles.kindPill}>
                <Text style={[styles.kindPillText, isRTL && styles.rtlText]} numberOfLines={1}>{kindLabel}</Text>
              </View>
            )}
            {/* Usually listing.condition, but the attribute a category
                nominates wherever that column is answering a different
                question -- see cardConditionLabel, which decides between
                them. Still absent where the price lines already say it
                ("Buy for $450,000" makes a "For sale" pill a repetition),
                and on a listing posted before the field existed. */}
            {!!conditionLabel && (
              <View style={styles.tag}>
                <Text style={[styles.tagText, isRTL && styles.rtlText]} numberOfLines={1}>{conditionLabel}</Text>
              </View>
            )}
          </View>
        )}

        {/* Two lines now, not one. A marketplace title is written by a
            seller, not a copywriter, and one line truncated most of them
            mid-word. Two is enough for almost all of them and still bounds
            the card's height, so a grid keeps its rhythm. */}
        <Text
          style={[styles.title, isRTL && styles.rtlText, alignsWithNeighbour && styles.titleReserved]}
          numberOfLines={2}
        >
          {fullTitle}
        </Text>

        {/* A property says what its number IS -- "Buy for $450,000",
            "Rent for $12,000/yr" -- so a figure can never be mistaken for the
            other kind of offer. See listingPriceLines.

            Wrapped in a block that reserves room for the SECOND line whether
            or not this listing has one. Only a property offered for sale and
            rent does, which is a small minority, so nearly every card carries
            a blank line under its price -- and that is the deliberate trade:
            without it, a two-price card pushes its spec row 17px below its
            neighbour's -- priceSecondary's line height exactly, since the
            block carries no gap of its own -- and nothing under the price
            lines up across a row.
            Reserved only where there IS a neighbour, same as the title. */}
        <View style={[styles.priceBlock, alignsWithNeighbour && styles.priceBlockReserved]}>
          <Text style={[styles.price, isRTL && styles.rtlText]} numberOfLines={1}>
            {!!priceLines.primary.label && (
              <Text style={styles.priceLabel}>{priceLines.primary.label} </Text>
            )}
            {priceLines.primary.amount}
          </Text>
          {!!priceLines.secondary && (
            <Text style={[styles.priceSecondary, isRTL && styles.rtlText]} numberOfLines={1}>
              {!!priceLines.secondary.label && (
                <Text style={styles.priceLabel}>{priceLines.secondary.label} </Text>
              )}
              {priceLines.secondary.amount}
            </Text>
          )}
        </View>

        {/* The spec row -- up to three, in the order an admin chose for this
            category. An attribute with no glyph prints its label instead of
            one, which is the right treatment for anything self-describing and
            the reason the glyph set can stay small.

            Rendered even when empty, so specRowReserved's minHeight applies
            to a listing in an uncurated category too -- a conditional row
            would drop the reservation on exactly the cards that need it. The
            cost where the reservation is OFF (a one-column phone grid) is
            info's 5px gap around a zero-height row, which is not worth a
            second condition to avoid. */}
        <View style={[styles.specRow, mirrorRow(isRTL), alignsWithNeighbour && styles.specRowReserved]}>
          {cardSpecs.map((spec) => (
            <View key={spec.slug} style={[styles.spec, mirrorRow(isRTL)]}>
              {spec.icon ? (
                // A tinted disc behind the glyph rather than a bare stroke on
                // white. A 13px line icon on its own reads as decoration next
                // to a bold value; sat on a filled circle it reads as a
                // labelled figure, which is what it is. primaryTint is the
                // brand green at the palette's lightest step, so the row
                // still belongs to the card rather than becoming a second
                // accent.
                <View style={styles.specIconChip}>
                  <Icon name={spec.icon} size={12} color={colors.primary} strokeWidth={1.8} />
                </View>
              ) : (
                <Text style={[styles.specLabel, isRTL && styles.rtlText]} numberOfLines={1}>{spec.label}</Text>
              )}
              <Text style={[styles.specValue, isRTL && styles.rtlText]} numberOfLines={1}>{spec.value}</Text>
            </View>
          ))}
        </View>

        {/* Everything below the specs, pinned to the bottom of the card as
            one block -- see styles.footer. Wrapped rather than hanging the
            auto-margin off the divider itself, because the divider is
            conditional: a card whose category has no curated specs would
            otherwise lose the pin along with the rule and let its district
            line float back up under the price. */}
        <View style={styles.footer}>
          {/* Shop pill, horizontal layout only -- the vertical card puts this
              on the photo instead (see bottomOverlay). INSIDE the footer,
              and above the rule rather than below the district: the footer is
              pinned to the bottom of the card, so a pill hanging underneath it
              would push a shop-sourced card's district line ~26px above a
              plain one's in the same row -- swapping one misalignment for
              another on the very row this pinning exists to line up. */}
          {horizontal && storefrontPill}

          {/* A thin rule between the listing's own facts and where and when it
              was posted. Inset from both edges rather than run edge to edge:
              a full-bleed rule cuts the card in two and re-creates the visual
              split the forest-green band used to have, where the point here
              is only to group. It sits above the meta line because that is
              the one real seam on the card -- pill, title, price and specs
              are all the thing being sold; the district and the age are about
              the listing rather than the property.

              Skipped when there is nothing above it to separate: a rule
              directly under a price reads as a stray line, not a grouping. */}
          {cardSpecs.length > 0 && <View style={styles.metaDivider} />}

          {/* Two lines allowed, not one. This line is what actually truncated
              on the photo-left card -- "Beit ech Chaar · 3 day…" -- and the
              fix is to let it wrap rather than to win pixels back off the
              photo. Still ONE Text: splitting the district and the time into
              two elements in a flexWrap row was tried and does the same job
              worse. It forces the break at the separator rather than wherever
              the line actually runs out, and in Arabic it makes the placement
              of that separator depend on bidi resolution rather than on the
              layout. */}
          <View style={[styles.metaRow, mirrorRow(isRTL)]}>
            <Icon name="location" size={12} color={colors.inkSoft} />
            <Text style={[styles.district, isRTL && styles.rtlText]} numberOfLines={2}>
              {listingDistrict(listing, language)} · {relativeTimeFrom(listing.createdAt, language)}
            </Text>
          </View>
        </View>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    // A long press on a card is OUR gesture -- it opens the preview. iOS
    // Safari otherwise reads the same press as "select this text", pops the
    // magnifier and the copy/share bubble over the card, and leaves the
    // title highlighted afterwards. Android's browser doesn't, which is why
    // this only ever showed up on iPhone.
    //
    // Both properties inherit, so setting them on the card covers its title,
    // price and location text without touching anything else on the page --
    // a listing's description, a phone number and chat messages all stay
    // selectable, because none of them live inside a card.
    //
    // userSelect stops the text selection; WebkitTouchCallout stops the
    // separate long-press sheet iOS offers for the thumbnail ("Save Image",
    // "Copy"). It isn't part of RN's ViewStyle -- react-native-web passes
    // unknown properties straight through to the generated CSS, same as the
    // transition properties in Pressy.tsx, hence the cast.
    userSelect: 'none',
    WebkitTouchCallout: 'none',
  } as ViewStyle,
  // Photo-left/details-right, see the `layout` prop's own comment. Row
  // instead of the default column; everything else (background, radius,
  // border, the overflow:hidden that clips the thumb's square corners to
  // the card's rounded ones) is shared with the vertical card unchanged.
  // Default `stretch`, deliberately -- an earlier version pinned this to
  // flex-start to protect the thumbnail's square ratio, and the square was
  // the wrong thing to protect. The details column is taller than a square
  // photo (a two-line title, a spec row, two price lines), so flex-start left
  // a band of empty white under the picture on exactly the tallest cards.
  // Stretch, plus dropping the ratio from thumbHorizontal, makes the photo
  // fill the card's full height whatever the column beside it does.
  cardHorizontal: { flexDirection: 'row' },
  // The photo frame, shared by both layouts. Its SHAPE is not set here: the
  // vertical card's 4:3 lives on thumbVertical (which also explains why it is
  // not here) and the photo-left card's full-height stretch on
  // thumbHorizontal, each argued at its own style. What is common to both is
  // the fill behind a photo that has not loaded, and the clipping below.
  thumb: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // CardPreview's hover/long-press slideshow (PhotoSlideshow in
    // CardPreview.tsx) renders a row wider than this box -- one frame per
    // photo, sitting side by side -- and slides it left so only one
    // frame's worth shows at a time. Without clipping here, only `card`'s
    // own overflow:hidden (see below) was ever stopping the rest of that
    // row from painting, and `card`'s edge is the whole card, not just
    // this thumbnail. On the vertical layout `thumb` already spans the
    // card's full width, so there was nothing past its own edge for the
    // extra frames to bleed into and this went unnoticed; on the
    // horizontal layout (thumbHorizontal, a fixed narrower column with an
    // `info` column beside it) the un-clipped frames were free to slide
    // out past the thumbnail and paint straight across that info column's
    // text, since nothing local to the thumbnail was stopping them.
    overflow: 'hidden',
  },
  // 4:3 landscape, derived from the card's own width rather than a fixed
  // height, so the same listing is the same shape in every context a vertical
  // card appears in.
  //
  // This was 1:1 until the browse grid went to one column on a phone, and the
  // reasoning genuinely changed with it rather than being overruled. The
  // square was chosen (28 Aug) because Lebanese sellers still shoot landscape
  // out of Facebook/OLX habit, and at a 175px two-column card a square crops
  // a landscape shot and a portrait shot by about the same amount -- a fair
  // middle when the frame is small either way.
  //
  // At full width that argument stops paying. A 354px card with a square
  // photo is 354px of photo before a word of text, so barely one listing
  // fits on a phone screen; and at that size the crop is no longer a
  // rounding error -- taking the sides off a landscape photo of a room
  // removes the room. 4:3 matches the shape the photos were actually taken
  // in, and gives back about 90px of height per card.
  //
  // The cost, stated: a portrait-shot photo now loses more top and bottom
  // than it used to. That is the same trade as before, further along, and it
  // falls on the minority orientation rather than the majority one.
  //
  // Deliberately scoped to the card. ListingDetailScreen keeps its own 3:4
  // display, where there is room for a taller frame and no grid rhythm to
  // hold.
  //
  // It lives HERE and not in `thumb`, so that the photo-left card simply
  // never receives it. The obvious alternative -- put it in `thumb` and clear
  // it with `aspectRatio: undefined` in thumbHorizontal -- is a trap on both
  // renderers, in opposite directions.
  // On native it works at mount and then breaks on UPDATE: RN's style
  // differ compares array entries index by index, and a key whose new value
  // is `undefined` is skipped rather than emitted, so a card that is already
  // mounted when `layout` flips (an iPad crossing the 860pt desktop
  // breakpoint on rotation, which does not remount the list) either keeps a
  // ratio it should have lost or loses one it should have kept -- and a
  // vertical thumb with no ratio has no intrinsic height at all, so the photo
  // vanishes. On web the same `undefined` is dropped from the compiled style
  // entirely, so it never overrides anything and the picture is only correct
  // because CSS resolves stretch-versus-aspect-ratio the opposite way to
  // Yoga. Two renderers agreeing by accident is not agreement.
  thumbVertical: { aspectRatio: 4 / 3 },
  // Absolutely filling the thumb, NOT `width: '100%', height: '100%'`, and
  // that difference is the whole reason the photo-left card ran off the
  // bottom of a phone screen while looking perfect in a browser.
  //
  // Yoga and CSS resolve a percentage against different things, and this is
  // the case where it shows. CSS resolves `height: 100%` against the
  // containing block's height; here that is `auto`, so the rule does not
  // apply, and react-native-web's Image (a div with a background image, no
  // intrinsic size) contributed nothing -- the row took its height from the
  // text, which is what we wanted, by a rule we were not relying on. Yoga
  // resolves it against the AVAILABLE inner height propagated down from the
  // ancestors, which on a phone is the screen less the chrome. So the photo
  // measured at the whole remaining viewport, the thumb took that, and the
  // row and the details column beside it stretched to match. The card's
  // height tracked the phone, not the photo -- a different card on a
  // different device, same result.
  //
  // (Not the photo's own pixels, which was the first guess and is wrong: a
  // React Native Image is a leaf Yoga node with no measure function, so a
  // remote source contributes no intrinsic size at all.)
  //
  // An absolutely positioned child sits outside its parent's measurement
  // entirely, which ends the argument in both engines: the thumb has no
  // intrinsic height now, takes the height the row gives it, and the photo
  // fills whatever that turns out to be. Every other child of this frame --
  // CardPreview, the out-of-stock ribbon, all three badges -- was already
  // absolute. The one child still in flow is the placeholder glyph on the
  // other arm of the ternary, which is fine at 30pt because it can never
  // exceed the details column; it is an exception to watch rather than a
  // second instance of this bug.
  thumbImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // A bounded column instead of the vertical card's full-bleed frame: this
  // thumbnail shares the row with a details column rather than owning the
  // card's whole top edge. Its WIDTH is computed from the card at render time
  // (thumbWidth, near the top of the component), because a fixed 128 on a
  // fixed 300px card was most of what was wrong with this shape.
  //
  // No aspectRatio at all, and that is the point: the height comes from the
  // row, so the photo is exactly as tall as the card. It only works because
  // nothing in flow inside the thumb has a height of its own -- see thumbImg,
  // which is absolute for exactly this reason and was not, for one shipped
  // version. A fixed ratio meant a
  // square photo beside a taller details column, which left a band of empty
  // white beneath the picture -- worst on the cards that have most to say,
  // which are the ones you most want to look at. `alignSelf: stretch` says so
  // explicitly rather than leaning on the parent's default, so this does not
  // quietly break if someone sets alignItems on cardHorizontal again.
  //
  // The trade is a harder crop: a landscape photo in a tall narrow frame
  // loses more of its sides than it did in a square. resizeMode 'cover'
  // centres what survives, and the alternative was the white gap.
  thumbHorizontal: { alignSelf: 'stretch' },
  spinBadge: {
    position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,20,22,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  // Only applied on the rare card that has both a spin set and a
  // cornerBadge -- pushes the spin icon below it instead of overlapping.
  spinBadgeBelowCorner: { top: 30 },
  // Collection badge (Editor's Picks sparkle / Hot Deals "-N%") -- same
  // corner and footprint as spinBadge, since a card only ever shows one
  // collection badge at a time and this takes priority for the slot.
  cornerBadge: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  cornerBadgeText: { fontSize: 8, fontWeight: '800', color: colors.white },
  // Opposite corner from spinBadge above -- the two can both be visible on
  // the same card (a 360°-spin listing someone's favorited) without
  // overlapping.
  favoriteBadge: {
    position: 'absolute', top: 6, left: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(20,20,22,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  outOfStockRibbon: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(20,20,22,0.72)', paddingVertical: 5, alignItems: 'center',
  },
  outOfStockRibbonText: {
    fontSize: 10.5, fontWeight: '700', color: colors.white,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  // One padded column now, where this used to be two stacked blocks with a
  // colour change between them (infoTop on forest green, infoBottom on
  // white). The old `minHeight: 54` floor is gone with them -- not because
  // cards are now uniform (most categories have no curated specs at all yet,
  // see @CARDS.md, so heights vary more than before if anything) but because
  // the grid already equalises them: FlatList's columnWrapperStyle sets no
  // alignItems, so a row stretches its cards to match its tallest. The floor
  // was solving a problem the layout above it had already solved.
  // flex 1 so this column absorbs whatever height the row gives the card.
  // On its own it changes nothing visible -- the leftover space is white
  // either way -- it is what gives footer's `marginTop: 'auto'` something to
  // push against. Without it the auto margin has no free space to consume and
  // the district line stays wherever the content leaves it.
  info: { flex: 1, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 10, gap: 5 },
  // Fills whatever's left beside the fixed-width thumbHorizontal.
  infoHorizontal: { flex: 1, paddingHorizontal: 12 },
  // Kind pill and, where the price does not already say it, new/used. Wraps
  // rather than truncating: "Vacation rental" beside "Like new" does not fit
  // one line on a two-column phone grid, and a clipped pill looks broken in
  // a way a wrapped one does not.
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  // Outlined, not filled. The fill is what made the old green band shout;
  // an outline states the same thing at a fraction of the visual weight,
  // and leaves the price as the loudest element on the card -- which is
  // what a buyer is actually scanning for.
  kindPill: {
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 2.5,
    flexShrink: 1,
  },
  kindPillText: {
    fontSize: 10.5, fontWeight: '700', color: colors.primary,
    letterSpacing: 0.2,
  },
  // New/used and wear grades, in the brand gold. Outlined to match the kind
  // pill beside it -- and it fixes the contrast note this style used to
  // carry: white on #D9A441 measures about 2:1 and failed WCAG outright,
  // where the same gold as an outline plus accentDeep text clears it.
  tag: {
    borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 2.5,
    flexShrink: 1,
  },
  tagText: {
    fontSize: 10, fontWeight: '800', color: colors.accentDeep,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  // Ink on white now rather than white on green, and allowed two lines.
  // lineHeight is set explicitly because a wrapping title with the default
  // leading sets too loose against the pill above it and the price below.
  title: { fontSize: 14, fontWeight: '500', color: colors.ink, lineHeight: 18.5 },
  // Exactly two lines' worth, so a one-line title does not pull everything
  // below it up by 18px relative to the card beside it. Applied only where
  // there IS a card beside it -- see alignsWithNeighbour. Costs almost
  // nothing in practice: a marketplace title is long, and both of the seeded
  // examples already run to two lines.
  titleReserved: { minHeight: 37 },
  // The loudest thing on the card, which is the whole point of giving up
  // the filled band: the green now marks the number a buyer came for
  // instead of a rectangle behind it.
  // The two price lines as one block, so the reservation below can be a
  // single number rather than a sum of gaps. No gap between them: they are
  // two halves of one offer, and spacing them apart made the second read as a
  // separate fact.
  priceBlock: {},
  // Exactly two lines of this block: 21 for the headline + 17 for the rent
  // under it. Both lineHeights are set explicitly for that reason -- an
  // unset lineHeight is platform-dependent, and a reservation computed from a
  // number the renderer is free to change is a reservation that drifts.
  priceBlockReserved: { minHeight: 38 },
  price: {
    fontSize: 16.5, fontWeight: '800', color: colors.primary,
    letterSpacing: -0.2, lineHeight: 21,
  },
  // "Buy for" / "Rent for", nested inline ahead of the figure. Smaller and
  // slightly muted so the number stays the biggest thing on the line: the
  // label is context, the price is what the buyer came for, and if anything
  // has to give on a narrow card it must not be the digits.
  priceLabel: { fontSize: 11.5, fontWeight: '600', color: colors.inkSoft },
  // The rent line under the sale price on a property offered both ways --
  // stepped down so it reads as the second of two numbers rather than
  // competing with the headline.
  priceSecondary: { fontSize: 13, fontWeight: '700', color: colors.primary, opacity: 0.85, lineHeight: 17 },
  // Up to three specs on one line. flexWrap, not truncation: a long value
  // ("Semi-furnished") pushes the third spec onto a second line rather than
  // clipping it mid-word, which costs a few pixels of height on a minority
  // of cards and never shows a half-word.
  specRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  // Same idea as titleReserved: one row's worth of height whether or not the
  // category has curated any specs, so an uncurated listing does not sit a
  // row shorter than the one next to it. 20 and not 18 because the row's
  // height is now set by the icon chip rather than by the text beside it, and
  // it tracks specIconChip's size exactly -- reserving less than a populated
  // row actually stands would defeat the point, and reserving more would put
  // a permanent sliver of blank under every spec row in the app. A row that
  // wraps to two lines still grows past it; that only happens on the
  // narrowest cards.
  specRowReserved: { minHeight: 20 },
  // No directional margin anywhere in this row: mirrorRow flips it on
  // native for Arabic, but marginStart/End still resolve against
  // I18nManager.isRTL, which this app never flips -- so a directional gap
  // would point the wrong way in exactly the layout it was added for.
  spec: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // 20px around a 12px glyph -- 4px of tint on every side, which is the
  // least that still reads as a disc rather than as a smudge behind the
  // icon. Sized DOWN from the 22 this started at, and the reason is width
  // rather than taste: a disc is wider than the bare glyph it replaces, and
  // the spec row is the narrowest thing on the card.
  //
  // The arithmetic, because it is the whole argument. Each spec used to lead
  // with a 13px icon and a 4px gap -- 17px before its value. A 20px disc with
  // the same 4px gap is 24, so three specs cost 21px more than they did. At
  // 22 with a 5px gap it was 30. Those nine pixels do not buy any slack back:
  // a 390-393pt phone (iPhone 12 through 16, Pixel) ends up 6-7px short of
  // fitting three specs on one line where it was 15-16px short, so the row
  // wraps there either way. They are still worth having, because 7px is a size bump
  // or a shorter value away from fitting, and 16 is not. CARDS.md's known
  // limit carries the full derivation, including why the threshold moved 26px
  // of screen rather than 21.
  //
  // borderRadius is half the box, not radius.pill: a pill radius on a square
  // is the same circle, but writing half the size says the shape is meant to
  // be a circle and breaks visibly if the size changes.
  specIconChip: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center',
  },
  // Stands in for a glyph on attributes that do not have one, so the value
  // is never an orphaned number. Muted, because on those attributes the
  // value is the information and the label is only there to name it.
  specLabel: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  specValue: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  // theme.ts's `textAlign: 'auto'` doesn't actually right-align Arabic
  // text on native (it resolves via I18nManager.isRTL, which this app
  // never flips -- see ListingDetailScreen's rtlText comment for the full
  // story). This explicit override is the real fix.
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  // height 1, not StyleSheet.hairlineWidth. Every other rule in this app is
  // 1px (see CreateListingScreen, BatchLocationContactScreen), and a hairline
  // on a 3x Android screen is a third of a physical pixel of #E4E2DA on white
  // -- which is not a subtle separator, it is an absent one.
  //
  // marginHorizontal 6 on top of info's own 10 puts it 16px in from the card
  // edge and visibly short of the text column, so it reads as a deliberate
  // rule rather than as a border that failed to reach the sides. It is
  // symmetric, so it needs no RTL handling at all.
  //
  // No vertical margin of its own: the 5px above comes from info's gap and
  // the 5px below from footer's, so the rule sits centred between the specs
  // and the district. An earlier marginBottom here made it 5 above and 9
  // below.
  metaDivider: {
    height: 1,
    backgroundColor: colors.line,
    marginHorizontal: 6,
  },
  // 'auto' on the top margin is what pins this block -- rule and district
  // together -- to the BOTTOM of the card rather than letting it sit directly
  // under the specs. Wherever cards are stretched to a common height, that
  // puts every district line on the same baseline and the difference in
  // content shows as a gap in the middle instead of as ragged bottoms. That
  // is a grid row (columnWrapperStyle sets no alignItems) and a home carousel
  // whose cards sit in its horizontal row -- INCLUDING the photo-left card,
  // which used to be exempt only because cardHorizontal pinned its children
  // to flex-start, and no longer does. It stays inert in Just Listed's
  // two-row variant, whose cards are column children, and in
  // ListingDetailScreen's related rows, which set flex-start themselves.
  footer: { marginTop: 'auto', gap: 5 },
  // flex-start, because the text beside the pin is allowed two lines now and
  // a centred icon against a two-line block floats in the middle of it. The
  // explicit lineHeight is what keeps the one-line case (every grid card)
  // looking right anyway: type.tiny sets no leading, so the line box came out
  // ~15px against a 12px icon and the pin sat high.
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  // flex: 1 so the text takes the width the icon leaves and wraps inside it,
  // rather than laying out at its intrinsic width and ellipsising.
  district: { ...type.tiny, flex: 1, lineHeight: 13 },
  // Shop-name pill -- same pill shape as ListingDetailScreen's aiTag
  // (warnBg fill, radius.pill) as the visual basis, at a smaller
  // card-appropriate scale. No standalone "Storefront" label next to it
  // any more on either layout -- the building icon carries that meaning
  // on its own. Position on screen differs by layout (bottomOverlay
  // below for vertical; for horizontal it is the first child of the pinned
  // footer, which spaces it with its own gap -- the RTL alignment below is
  // the only extra style it takes there); this base style is shared by both.
  storefrontPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%',
    backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 8, height: 20,
  },
  storefrontPillName: { fontSize: 10.5, fontWeight: '800', color: colors.primary },
  // Right-aligns the pill within the horizontal layout's RTL column,
  // same as every other right-aligned element there -- not used on the
  // vertical layout, whose overlay position stays fixed regardless of
  // language (see bottomOverlay below, and favoriteBadge/cornerBadge
  // above, which are fixed corners for the same reason).
  storefrontPillRTL: { alignSelf: 'flex-end' },
  // Vertical layout only: the shop pill lives on the photo, bottom-left,
  // fixed regardless of RTL -- same reasoning as favoriteBadge/
  // cornerBadge/spinBadge above, none of which mirror for RTL either,
  // since they're all fixed corners/edges of the photo itself rather
  // than flowing text. Just the pill, no wrapping bar or gradient
  // behind it: the pill is already an opaque cream chip, so it reads
  // fine straight on top of any photo without extra scaffolding.
  // Was storefrontOverlay, which held one pill; it holds a stack now (see
  // the Sponsored block in the thumb). alignItems flex-start rather than
  // stretch so each pill is as wide as its own text instead of both being
  // stretched to the widest.
  bottomOverlay: {
    position: 'absolute', left: 8, right: 8, bottom: 8,
    alignItems: 'flex-start', gap: 4,
  },
  // The out-of-stock ribbon is full-width at bottom 0 and about 26 tall.
  bottomOverlayAboveRibbon: { bottom: 34 },
});
