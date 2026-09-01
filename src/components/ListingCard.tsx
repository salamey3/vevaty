import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, Image, ViewStyle } from 'react-native';
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
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';
import { relativeTimeFrom } from '../lib/relativeTime';
import { cardKindLabel, resolveCardSpecs } from '../lib/cardSpecs';
import { listingPriceLines } from '../lib/priceDisplay';
import { conditionShownInPrice } from '../lib/rentTerms';
import { conditionCardLabel } from '../lib/conditionModes';
import { RootStackParamList } from '../navigation/types';

// How long the cursor has to sit still on a card before its preview
// starts. Not zero: a mouse sweeping across a grid of a dozen cards on
// its way somewhere else would otherwise fire off a network request and a
// decode for every single one it merely crossed. Long enough to filter
// that out, short enough that anyone who's actually looking still reads
// it as instant.
const HOVER_PREVIEW_DELAY_MS = 180;

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
// In practice the card only reaches the New/Used and graded arms now:
// properties carry their offer in the price lines instead and render no
// pill at all (see the call site). The lookup covers the whole union
// regardless -- the pill is one styling decision away from coming back,
// and a silent fall-through to "Used" is exactly the bug it replaced.
// It lives in src/lib/conditionModes.ts with every other per-value list,
// so a new mode cannot light up a picker and leave this behind.

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
  const { categoryById, resolveAttributesForCategory, cardKindSlugForCategory } = useSettings();
  const { isVerified, profile } = useAppStore();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { language, isRTL, t } = useLanguage();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const cat = categoryById(listing.cat);
  // Gutter between cards, as a percentage of the row. 3% reads well at two
  // columns and far too wide at four or six -- the same proportion of a
  // wider row is a much bigger gap in pixels, which is what left the
  // desktop grid looking sparse. Scale it down as the columns go up.
  //
  // Not floored: rounding each card down left the remainder to
  // space-between, which quietly widened the gutters again beyond whatever
  // was set here.
  const gutterPct = columns > 4 ? 0.5 : columns > 2 ? 0.7 : 1.2;
  const widthPct: `${number}%` = `${Number(((100 - (columns - 1) * gutterPct) / columns).toFixed(3))}%`;
  const favorited = isFavorite(listing.id);
  const [favBusy, setFavBusy] = useState(false);
  // Nothing to save about your own listing -- same reasoning as
  // ListingDetailScreen hiding its contact CTA from the owner.
  const canFavorite = showFavorite && listing.sellerId !== profile.id;
  const horizontal = layout === 'horizontal';

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
  const cardSpecs = useMemo(
    () => resolveCardSpecs(cardAttrs, listing, language, fullTitle),
    [cardAttrs, listing, language, fullTitle]
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
        // is storefrontPillInlineRTL, which is an alignSelf rather than a
        // direction and has no mirrorRow equivalent -- noted in NEXT.md.
        mirrorRow(isRTL),
        horizontal && styles.storefrontPillInline,
        horizontal && isRTL && styles.storefrontPillInlineRTL,
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
      <View style={[styles.thumb, horizontal && styles.thumbHorizontal]}>
        {listing.photos[0] ? (
          // Requested at card size, not the seeded 900x1200 original -- see
          // photoSize.ts for why that mattered so much more than it looks
          // (bitmap heap, not bandwidth).
          //
          // resizeMode="cover" (RN's own default, set explicitly here so
          // it reads as deliberate) always fills the square frame edge to
          // edge, on both layouts -- see thumb/thumbHorizontal's own
          // comments for why they're both 1:1. A photo shot in a
          // different ratio than the frame (portrait, landscape,
          // whatever the seller's camera produced) gets the excess
          // cropped off whichever axis runs long, rather than being
          // letterboxed down to fit inside it -- that's the deliberate
          // choice here: every card in a row stays a uniform, gap-free
          // square regardless of what shape the source photo was, and a
          // square crop is close to equally forgiving of both a vertical
          // phone-camera shot and a horizontal one, which is the whole
          // reason this became the card thumbnail's ratio (see thumb
          // below). The listing detail page's own photo display is
          // unrelated to this and keeps its original 3:4 crop.
          <Image
            // The real, purpose-made small thumbnail when one exists (see
            // Listing.coverThumbnailUrl's own comment for why only the
            // cover photo gets one), falling back to today's behavior --
            // sizing down the full photo -- for any listing posted before
            // thumbnails existed. sizedPhotoUrl is still worth wrapping the
            // thumbnail in too: it's a no-op for a Bunny URL today, but
            // costs nothing and stays correct if picsum seed data is ever
            // mixed back in.
            source={{ uri: sizedPhotoUrl(listing.coverThumbnailUrl ?? listing.photos[0], PHOTO_WIDTHS.card)! }}
            style={styles.thumbImg}
            resizeMode="cover"
          />
        ) : (
          <Icon name={(cat?.icon as any) || 'bag'} size={30} color={colors.inkSoft} />
        )}
        {previewing && <CardPreview photos={listing.photos} spinSets={listing.spinSets ?? []} />}
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
        {/* Shop pill, vertical layout only -- lives on the photo itself
            (bottom-left, fixed regardless of RTL, same as every other
            badge in this thumb) rather than in the white section below.
            The horizontal layout keeps it in its original in-flow spot
            instead -- see storefrontPillInline below. */}
        {!horizontal && storefrontPill && (
          <View style={styles.storefrontOverlay}>{storefrontPill}</View>
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
        {(!!kindLabel || (listing.condition && !conditionShownInPrice(listing.condition))) && (
          <View style={[styles.pillRow, mirrorRow(isRTL)]}>
            {!!kindLabel && (
              <View style={styles.kindPill}>
                <Text style={[styles.kindPillText, isRTL && styles.rtlText]} numberOfLines={1}>{kindLabel}</Text>
              </View>
            )}
            {/* Null for a listing posted before this field existed, and
                deliberately absent wherever the price lines already say it
                ("Buy for $450,000" makes a "For sale" pill a repetition). */}
            {listing.condition && !conditionShownInPrice(listing.condition) && (
              <View style={styles.tag}>
                <Text style={[styles.tagText, isRTL && styles.rtlText]} numberOfLines={1}>{conditionCardLabel(listing.condition, t)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Two lines now, not one. A marketplace title is written by a
            seller, not a copywriter, and one line truncated most of them
            mid-word. Two is enough for almost all of them and still bounds
            the card's height, so a grid keeps its rhythm. */}
        <Text style={[styles.title, isRTL && styles.rtlText]} numberOfLines={2}>{fullTitle}</Text>

        {/* A property says what its number IS -- "Buy for $450,000",
            "Rent for $12,000/yr" -- so a figure can never be mistaken for
            the other kind of offer. See listingPriceLines. */}
        <Text style={[styles.price, isRTL && styles.rtlText]} numberOfLines={1}>
          {!!priceLines.primary.label && (
            <Text style={styles.priceLabel}>{priceLines.primary.label} </Text>
          )}
          {priceLines.primary.amount}
        </Text>
        {/* Only ever set for a property offered for sale AND rent: the sale
            price is the headline above, this is the rent under it. */}
        {!!priceLines.secondary && (
          <Text style={[styles.priceSecondary, isRTL && styles.rtlText]} numberOfLines={1}>
            {!!priceLines.secondary.label && (
              <Text style={styles.priceLabel}>{priceLines.secondary.label} </Text>
            )}
            {priceLines.secondary.amount}
          </Text>
        )}

        {/* The spec row -- up to three, in the order an admin chose for this
            category. An attribute with no glyph prints its label instead of
            one ("Seats 5"), which is the right treatment for anything
            self-describing and the reason the glyph set can stay small. */}
        {cardSpecs.length > 0 && (
          <View style={[styles.specRow, mirrorRow(isRTL)]}>
            {cardSpecs.map((spec) => (
              <View key={spec.slug} style={[styles.spec, mirrorRow(isRTL)]}>
                {spec.icon ? (
                  <Icon name={spec.icon} size={13} color={colors.primary} strokeWidth={1.7} />
                ) : (
                  <Text style={[styles.specLabel, isRTL && styles.rtlText]} numberOfLines={1}>{spec.label}</Text>
                )}
                <Text style={[styles.specValue, isRTL && styles.rtlText]} numberOfLines={1}>{spec.value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* District and relative post time ("3 days ago", not a date -- on a
            grid the question is "is this still going?") share one line. */}
        <View style={[styles.metaRow, mirrorRow(isRTL)]}>
          <Icon name="location" size={12} color={colors.inkSoft} />
          <Text style={[styles.district, isRTL && styles.rtlText]} numberOfLines={1}>
            {listingDistrict(listing, language)} · {relativeTimeFrom(listing.createdAt, language)}
          </Text>
        </View>

        {/* Shop pill, horizontal layout only -- see the comment by the thumb
            above for why the vertical layout renders this one differently. */}
        {horizontal && storefrontPill}
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
  // alignItems 'flex-start' is load-bearing now, not decoration. The text
  // column beside the thumbnail used to be about the thumbnail's own height,
  // so the default `stretch` never mattered; a two-line title plus a spec row
  // has made that column meaningfully taller, and under `stretch` a
  // fixed-width box with an aspectRatio has to fight the stretch to stay
  // square. Pinning it to the top settles it.
  cardHorizontal: { flexDirection: 'row', alignItems: 'flex-start' },
  // Square 1:1, derived from the card's own width rather than a fixed
  // height. The old fixed 120/150px meant the shape changed with every
  // context the card appeared in -- roughly square in a 2-column grid,
  // letterboxed in a wide carousel, different again on desktop -- so the
  // same listing looked like a different product depending on where you
  // met it, and a grid of them had no consistent rhythm.
  //
  // This used to be 3:4, chosen to match the source photos (seeded
  // catalogue at 900x1200, and phone cameras shoot 3:4 by default). But
  // marketplace sellers -- unlike social media -- overwhelmingly still
  // shoot horizontally, carried over from posting the same photos on
  // Facebook Marketplace/OLX, where the common frame is landscape. A
  // portrait 3:4 card cropped a lot off the sides of those shots. Square
  // is the middle ground: it crops a vertical shot's top/bottom and a
  // horizontal shot's left/right by roughly the same amount, so neither
  // orientation is the "wrong" one to have shot in. Deliberately scoped
  // to just the card thumbnail -- the listing detail page's own photo
  // display (ListingDetailScreen.tsx) keeps its original 3:4 crop, where
  // there's room for a taller frame and no grid rhythm to keep uniform.
  thumb: {
    aspectRatio: 1,
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
  thumbImg: { width: '100%', height: '100%' },
  // A fixed-width column instead of the vertical card's full-bleed
  // square -- this thumbnail now shares the row with a details column
  // instead of owning the card's whole top edge, so it needs its own
  // bounded width rather than stretching to `card`'s width. Same 1:1
  // ratio as `thumb` above, for the same reasoning as that style's own
  // comment. Height follows from the ratio; the text
  // column beside it (infoHorizontal) simply grows to whatever its content
  // needs, which since the two-line title and the spec row is usually a
  // little more than this.
  // 128, up from 112. The text column grew by a line of title and a row of
  // specs, and at 112 the photo was left floating in the corner of a card
  // nearly twice its height. This does not make them equal -- the column is
  // still taller -- but it keeps the photo a substantial part of the card
  // rather than a stamp on it.
  thumbHorizontal: { width: 128, aspectRatio: 1 },
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
  info: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 10, gap: 5 },
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
  // The loudest thing on the card, which is the whole point of giving up
  // the filled band: the green now marks the number a buyer came for
  // instead of a rectangle behind it.
  price: { fontSize: 16.5, fontWeight: '800', color: colors.primary, letterSpacing: -0.2 },
  // "Buy for" / "Rent for", nested inline ahead of the figure. Smaller and
  // slightly muted so the number stays the biggest thing on the line: the
  // label is context, the price is what the buyer came for, and if anything
  // has to give on a narrow card it must not be the digits.
  priceLabel: { fontSize: 11.5, fontWeight: '600', color: colors.inkSoft },
  // The rent line under the sale price on a property offered both ways --
  // stepped down so it reads as the second of two numbers rather than
  // competing with the headline.
  priceSecondary: { fontSize: 13, fontWeight: '700', color: colors.primary, opacity: 0.85 },
  // Up to three specs on one line. flexWrap, not truncation: a long value
  // ("Semi-furnished") pushes the third spec onto a second line rather than
  // clipping it mid-word, which costs a few pixels of height on a minority
  // of cards and never shows a half-word.
  specRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  // No directional margin anywhere in this row: mirrorRow flips it on
  // native for Arabic, but marginStart/End still resolve against
  // I18nManager.isRTL, which this app never flips -- so a directional gap
  // would point the wrong way in exactly the layout it was added for.
  spec: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Carries the relative post time too ("West Hills · 3 days ago", was two
  // separate lines).
  district: { ...type.tiny },
  // Shop-name pill -- same pill shape as ListingDetailScreen's aiTag
  // (warnBg fill, radius.pill) as the visual basis, at a smaller
  // card-appropriate scale. No standalone "Storefront" label next to it
  // any more on either layout -- the building icon carries that meaning
  // on its own. Position on screen differs by layout (storefrontOverlay
  // below for vertical, storefrontPillInline for horizontal); this base
  // style is shared by both.
  storefrontPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', maxWidth: '100%',
    backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 8, height: 20,
  },
  storefrontPillName: { fontSize: 10.5, fontWeight: '800', color: colors.primary },
  // Horizontal layout only: kept in its original in-flow spot below the
  // meta row, rather than moved onto the photo.
  storefrontPillInline: { marginTop: 6 },
  // Right-aligns the pill within the horizontal layout's RTL column,
  // same as every other right-aligned element there -- not used on the
  // vertical layout, whose overlay position stays fixed regardless of
  // language (see storefrontOverlay below, and favoriteBadge/cornerBadge
  // above, which are fixed corners for the same reason).
  storefrontPillInlineRTL: { alignSelf: 'flex-end' },
  // Vertical layout only: the shop pill lives on the photo, bottom-left,
  // fixed regardless of RTL -- same reasoning as favoriteBadge/
  // cornerBadge/spinBadge above, none of which mirror for RTL either,
  // since they're all fixed corners/edges of the photo itself rather
  // than flowing text. Just the pill, no wrapping bar or gradient
  // behind it: the pill is already an opaque cream chip, so it reads
  // fine straight on top of any photo without extra scaffolding.
  storefrontOverlay: { position: 'absolute', left: 8, right: 8, bottom: 8, alignItems: 'flex-start' },
});
