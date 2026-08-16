import React, { useState } from 'react';
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
  const { categoryById } = useSettings();
  const { isVerified, profile } = useAppStore();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { language, isRTL } = useLanguage();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const cat = categoryById(listing.cat);
  const widthPct = `${Math.floor((100 - (columns - 1) * 3) / columns)}%` as const;
  const favorited = isFavorite(listing.id);
  const [favBusy, setFavBusy] = useState(false);
  // Nothing to save about your own listing -- same reasoning as
  // ListingDetailScreen hiding its contact CTA from the owner.
  const canFavorite = showFavorite && listing.sellerId !== profile.id;

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
      <View style={[styles.thumb, columns > 2 && styles.thumbWide]}>
        {listing.photos[0] ? (
          <Image source={{ uri: listing.photos[0] }} style={styles.thumbImg} />
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
        <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
          <Icon name="location" size={12} color={colors.inkSoft} />
          <Text style={styles.district} numberOfLines={1}>{listingDistrict(listing, language)}</Text>
        </View>
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
  thumb: {
    height: 120,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWide: { height: 150 },
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
