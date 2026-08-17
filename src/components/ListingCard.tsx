import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { Listing } from '../types';
import { useSettings } from '../store/SettingsStore';
import { useAppStore } from '../store/AppStore';
import { useFavorites } from '../store/FavoritesStore';
import { useLanguage } from '../i18n/LanguageContext';
import { listingTitle, listingDistrict } from '../lib/listingText';
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../lib/photoSize';
import { relativeTimeFrom } from '../lib/relativeTime';
import { attrHasValue, formatAttrValue } from '../lib/attributeFormat';
import { RootStackParamList } from '../navigation/types';

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
}: {
  listing: Listing;
  onPress: () => void;
  columns?: number;
  // Fixed pixel width, for use inside a horizontal-scrolling carousel
  // instead of a wrapping percentage-based grid. Overrides the
  // columns-derived percentage when set.
  width?: number;
  showFavorite?: boolean;
}) {
  const { categoryById, resolveAttributesForCategory } = useSettings();
  const { isVerified, profile } = useAppStore();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { language, isRTL } = useLanguage();
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
  const gutterPct = columns > 4 ? 1.1 : columns > 2 ? 1.6 : 3;
  const widthPct: `${number}%` = `${Number(((100 - (columns - 1) * gutterPct) / columns).toFixed(3))}%`;
  const favorited = isFavorite(listing.id);
  const [favBusy, setFavBusy] = useState(false);
  // Nothing to save about your own listing -- same reasoning as
  // ListingDetailScreen hiding its contact CTA from the owner.
  const canFavorite = showFavorite && listing.sellerId !== profile.id;

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
    <Pressy onPress={onPress} style={[styles.card, { width: width ?? widthPct }]}>
      <View style={styles.thumb}>
        {listing.photos[0] ? (
          // Requested at card size, not the seeded 900x1200 original -- see
          // photoSize.ts for why that mattered so much more than it looks
          // (bitmap heap, not bandwidth).
          <Image source={{ uri: sizedPhotoUrl(listing.photos[0], PHOTO_WIDTHS.card)! }} style={styles.thumbImg} />
        ) : (
          <Icon name={(cat?.icon as any) || 'bag'} size={30} color={colors.inkSoft} />
        )}
        {(listing.spinSets?.length ?? 0) > 0 && (
          <View style={styles.spinBadge}>
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
      </View>
      <View style={styles.info}>
        <Text style={[styles.price, isRTL && styles.rtlText]}>${listing.price.toLocaleString()}</Text>
        <Text style={[styles.title, isRTL && styles.rtlText]} numberOfLines={1}>{listingTitle(listing, language)}</Text>
        {topSpecs.length > 0 && (
          <Text style={[styles.specs, isRTL && styles.rtlText]} numberOfLines={1}>
            {topSpecs.join(' · ')}
          </Text>
        )}
        <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
          <Icon name="location" size={12} color={colors.inkSoft} />
          <Text style={styles.district} numberOfLines={1}>{listingDistrict(listing, language)}</Text>
        </View>
        {/* Relative, not a date: on a grid the question is "is this still
            going?", and "3 days ago" answers it without the reader first
            working out what today is. */}
        <Text style={[styles.posted, isRTL && styles.rtlText]} numberOfLines={1}>
          {relativeTimeFrom(listing.createdAt, language)}
        </Text>
      </View>
    </Pressy>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  // Portrait 3:4, derived from the card's own width rather than a fixed
  // height. The old fixed 120/150px meant the shape changed with every
  // context the card appeared in -- roughly square in a 2-column grid,
  // letterboxed in a wide carousel, different again on desktop -- so the
  // same listing looked like a different product depending on where you
  // met it, and a grid of them had no consistent rhythm.
  //
  // 3:4 also matches the source photos: the seeded catalogue is 900x1200,
  // and phone cameras shoot 3:4 by default, so the common case now fills
  // the frame instead of being cropped to a letterbox.
  thumb: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  spinBadge: {
    position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,20,22,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  // Opposite corner from spinBadge above -- the two can both be visible on
  // the same card (a 360°-spin listing someone's favorited) without
  // overlapping.
  favoriteBadge: {
    position: 'absolute', top: 6, left: 6, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(20,20,22,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  info: { paddingHorizontal: 10, paddingVertical: 9 },
  specs: { ...type.tiny, color: colors.ink, marginBottom: 3 },
  posted: { ...type.tiny, color: colors.inkSoft, marginTop: 3 },
  price: { ...type.h3, marginBottom: 2 },
  title: { ...type.soft, marginBottom: 4 },
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
  district: { ...type.tiny },
});
