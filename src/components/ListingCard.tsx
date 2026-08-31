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
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';
import { relativeTimeFrom } from '../lib/relativeTime';
import { attrHasValue, formatAttrValue } from '../lib/attributeFormat';
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
  const { categoryById, resolveAttributesForCategory } = useSettings();
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

  // The two specs most worth knowing before you open the listing -- screen
  // size on a TV, year and mileage on a car, storage on a phone. Required
  // attributes come first because a category's admin marked them required
  // precisely by asking "what would you refuse to list this without?",
  // which is close enough to "what does a buyer scan for" to be a good
  // default without a second field to maintain.
  //
  // Two, not more: a browse card is a glance, and a third line of specs
  // starts competing with the price and title for the same attention.
  const topSpecs = useMemo(() => {
    if (!listing.attributes) return [];
    // Skip anything the title already says. A car listing titled "Honda
    // Civic 2018" was showing "Honda · Civic" underneath it -- two lines
    // of the same information, on the one surface where space is
    // scarcest. Dropping the duplicates leaves the line to say what the
    // title doesn't: mileage, transmission, condition.
    //
    // Compared against the full title, not the truncated one on screen,
    // so a long title that gets cut off still suppresses its own terms.
    const haystack = listingTitle(listing, language).toLowerCase();
    const attrs = resolveAttributesForCategory(listing.cat)
      .filter((a) => attrHasValue(listing.attributes[a.slug]))
      .map((a) => ({ attr: a, text: formatAttrValue(a, listing.attributes[a.slug], language) }))
      .filter(({ text }) => {
        const t = text.trim().toLowerCase();
        return t.length > 0 && !haystack.includes(t);
      });
    // Required first: an admin marks a field required by asking "what
    // would I refuse to list this without?", which is close to what a
    // buyer scans for.
    const ordered = [...attrs.filter((a) => a.attr.required), ...attrs.filter((a) => !a.attr.required)];
    return ordered.slice(0, 2).map(({ text }) => text);
  }, [listing, listing.cat, listing.attributes, resolveAttributesForCategory, language]);

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
        isRTL && styles.storefrontPillRTL,
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
      <View style={[styles.info, horizontal && styles.infoHorizontal]}>
        {/* Forest green from the top of this block through the title
            text, with a little extra padding underneath it, before the
            card drops back to its normal white surface. Price and the
            new/used tag share this top line; the tag is a plain gold
            pill now rather than a separate colored line above the price
            (New and Used no longer get different fills -- the pill's
            text is the only thing that changes). */}
        <View style={[styles.infoTop, horizontal && styles.infoTopHorizontal]}>
          <View style={[styles.priceRow, isRTL && styles.priceRowRTL]}>
            {/* A property says what its number IS -- "Buy for $450,000",
                "Rent for $12,000/yr" -- so the figure can never be
                mistaken for the other kind of offer. See listingPriceLines. */}
            <Text style={[styles.price, isRTL && styles.rtlText]} numberOfLines={1}>
              {!!priceLines.primary.label && (
                <Text style={styles.priceLabel}>{priceLines.primary.label} </Text>
              )}
              {priceLines.primary.amount}
            </Text>
            {/* New/Used and wear grades. Any pick the price lines already state -- a
                property's Sale/Rent/Both, an animal's Free is already
                spelled out by the price lines themselves, and repeating it
                as a pill cost enough width to truncate the price it sat
                next to ("$450,..." beside "SALE OR RENT"), so properties
                deliberately show no pill at all.

                Null for a listing posted before this field existed (or one
                of the pre-existing seed rows a migration collapsed from a
                more granular scale with no real "new" value among them) --
                those simply show no tag rather than guessing. */}
            {listing.condition && !conditionShownInPrice(listing.condition) && (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{conditionCardLabel(listing.condition, t)}</Text>
              </View>
            )}
          </View>
          {/* Only ever set for a property offered for sale AND rent: the
              sale price is the headline above, this is the rent under it. */}
          {!!priceLines.secondary && (
            <Text style={[styles.priceSecondary, isRTL && styles.rtlText]} numberOfLines={1}>
              {!!priceLines.secondary.label && (
                <Text style={styles.priceLabel}>{priceLines.secondary.label} </Text>
              )}
              {priceLines.secondary.amount}
            </Text>
          )}
          <Text style={[styles.title, isRTL && styles.rtlText]} numberOfLines={1}>{listingTitle(listing, language)}</Text>
        </View>
        <View style={[styles.infoBottom, horizontal && styles.infoBottomHorizontal]}>
          {topSpecs.length > 0 && (
            <Text style={[styles.specs, isRTL && styles.rtlText]} numberOfLines={1}>
              {topSpecs.join(' · ')}
            </Text>
          )}
          {/* District and relative post time ("3 days ago", not a date --
              on a grid the question is "is this still going?") now share
              one line instead of two. */}
          <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
            <Icon name="location" size={12} color={colors.inkSoft} />
            <Text style={[styles.district, isRTL && styles.rtlText]} numberOfLines={1}>
              {listingDistrict(listing, language)} · {relativeTimeFrom(listing.createdAt, language)}
            </Text>
          </View>
          {/* Shop pill, horizontal layout only -- see the comment by the
              thumb above for why the vertical layout renders this one
              differently. */}
          {horizontal && storefrontPill}
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
  cardHorizontal: { flexDirection: 'row' },
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
  // comment. Height follows from the ratio (112 at this width) -- see
  // infoHorizontal/infoBottomHorizontal below for how the text column
  // beside it is kept close to this same height.
  thumbHorizontal: { width: 112, aspectRatio: 1 },
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
  // Vertical layout: a plain column, no padding of its own -- infoTop
  // and infoBottom below each carry their own. Horizontal layout: see
  // infoHorizontal.
  info: {},
  // Fills whatever's left beside the fixed-width thumbHorizontal. Not
  // vertically centered any more -- now that infoBottom's storefront
  // row and merged meta line keep this column's height close to the
  // photo's own height (see infoBottomHorizontal), centering would just
  // as often nudge it a couple of pixels off top-alignment as fix
  // anything.
  infoHorizontal: { flex: 1 },
  // Forest green from the top of the info block through the title text,
  // with a little extra padding underneath before the card drops back
  // to its normal white surface (see infoBottom). Horizontal layout
  // uses the wider 12px horizontal padding infoHorizontal used to carry
  // itself, and a touch less bottom padding to match the vertical
  // card's proportions at its narrower thumb.
  infoTop: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 14,
  },
  infoTopHorizontal: { paddingHorizontal: 12, paddingBottom: 13 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  priceRowRTL: { flexDirection: 'row-reverse' },
  // flexShrink is what keeps numberOfLines honest here: a flex child
  // defaults to flexShrink 0, so the text would lay out at its full
  // intrinsic width and shove the condition pill past the card's clipped
  // edge instead of ellipsising. Only became reachable once a rental's
  // price line grew from "$1,500" to "$1,500 / month" beside a "For rent"
  // pill; the pill itself must not shrink, or it truncates instead.
  price: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: -0.2, flexShrink: 1 },
  // "Buy for" / "Rent for", nested inline ahead of the figure. Smaller
  // and slightly muted so the number stays the biggest thing on the line:
  // the label is context, the price is what the buyer came for, and if
  // anything has to give on a narrow card it must not be the digits.
  priceLabel: { fontSize: 11.5, fontWeight: '600', opacity: 0.8 },
  // The rent line under the sale price on a property offered both ways --
  // same white-on-forest-green band, stepped down so it reads as the
  // second of two numbers rather than competing with the headline. It now
  // carries its own "Rent for" label rather than a bare figure, so it
  // sits closer to the headline in weight than it did as a bare number.
  priceSecondary: { fontSize: 13.5, fontWeight: '600', color: colors.white, opacity: 0.9, marginTop: 2 },
  // New/used, now a plain gold pill on the price line instead of its
  // own colored line above it -- New and Used no longer get different
  // fills, just different text, so this one style covers both.
  tag: {
    backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingHorizontal: 9, paddingVertical: 3,
    flexShrink: 0,
  },
  // White on the brand gold measures under WCAG's 4.5:1 text minimum
  // (see theme.ts's own note on this exact pair, which is why the
  // corner badge above uses near-black instead) -- kept white here per
  // the approved design; swap to colors.accentInk if legibility turns
  // out to matter more than the look.
  tagText: { fontSize: 10, fontWeight: '800', color: colors.white, textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { marginTop: 5, fontSize: 14, fontWeight: '500', color: colors.white },
  // Fixed regardless of content on the vertical card -- the only thing
  // that still varies once the storefront row moved onto the photo is
  // whether a listing has specs, so this only needs to cover that one
  // line; a card with none just leaves quiet space at the bottom
  // instead of pulling its row of the grid shorter. Not applied on the
  // horizontal layout (see infoBottomHorizontal) -- there the merged
  // meta line and in-flow storefront pill already keep this section
  // close to the photo's own height without needing a floor.
  infoBottom: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 9, minHeight: 54 },
  infoBottomHorizontal: { paddingHorizontal: 12, paddingBottom: 11, minHeight: undefined },
  specs: { ...type.tiny, color: colors.ink, marginBottom: 5 },
  // theme.ts's `textAlign: 'auto'` doesn't actually right-align Arabic
  // text on native (it resolves via I18nManager.isRTL, which this app
  // never flips -- see ListingDetailScreen's rtlText comment for the full
  // story). This explicit override is the real fix.
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Same icon-then-text mirroring as ListingDetailScreen's metaRowRTL --
  // this card's own location row never got the isRTL treatment the
  // detail screen's equivalent row already had, so the pin icon and
  // district text stayed LTR-ordered here even once everything else on
  // the card (title) was fixed.
  metaRowRTL: { flexDirection: 'row-reverse' },
  // Carries the relative post time too now ("West Hills · 3 days ago",
  // was two separate lines) -- the other half of what keeps
  // infoBottomHorizontal's height down near the photo's.
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
  // Flips icon-then-name to name-then-icon for Arabic on both layouts.
  storefrontPillRTL: { flexDirection: 'row-reverse' },
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
