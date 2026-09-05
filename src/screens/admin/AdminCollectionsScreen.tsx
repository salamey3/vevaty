import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useCollections } from '../../store/CollectionsStore';
import { sizedPhotoUrl } from '../../lib/photoSize';

// This list's row thumbnail, in points. Named here for the same reason
// ListingCard measures its own: a photo is decoded at its source resolution
// however small the view is, so a 44px admin row asking for a browse-card
// width would decode a bitmap tens of times the area it draws. See
// photoSize.ts.
const ADMIN_ROW_THUMB = 56;
import { Collection, CollectionKind, Listing } from '../../types';
import { RootStackParamList } from '../../navigation/types';

const KIND_LABEL: Record<CollectionKind, string> = {
  curated: "Editor's Picks",
  price_drop: 'Hot Deals',
  recent: 'Just Listed',
  featured: 'Featured',
};

// Curates all four collections. Editor's Picks (kind='curated') is 100%
// manual, same as always: the "in this collection" list IS its entire
// membership. Hot Deals/Just Listed/Featured resolve themselves from live
// listing data (Featured = whoever currently has a live featuredUntil, see
// listingSort.ts), but an admin can still PIN a specific listing in (shown
// ahead of the algorithmic picks, same "search and add" flow as Editor's
// Picks) or EXCLUDE a specific listing that would otherwise qualify -- see
// CollectionsStore's resolveCollection for exactly how pins/exclusions
// combine with the algorithmic result.
//
// Every action here (add/remove/reorder/exclude) writes straight to the
// DB and refreshes, same "no separate Save step" convention as
// AdminCategoriesScreen's autosave -- there's no local draft to lose if
// you navigate away mid-edit.
export default function AdminCollectionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { listings: allListings } = useAppStore();
  const {
    collections,
    resolveCollection,
    pinnedListingIds,
    excludedListingIds,
    addCollectionItem,
    removeCollectionItem,
    reorderCollectionItems,
    excludeFromCollection,
    unexcludeFromCollection,
  } = useCollections();

  const [selectedKind, setSelectedKind] = useState<CollectionKind>('curated');
  const collection = collections.find((c) => c.kind === selectedKind);
  const isAlgorithmic = selectedKind !== 'curated';

  // Memoized rather than called inline: 'featured' shuffles its algorithmic
  // candidates on every resolveCollection call (see CollectionsStore/
  // listingSort.ts), and this screen re-renders on every keystroke in the
  // search box below -- without this, the Featured tab's list (and the
  // pinned-block indices `move`/reorder rely on) would visibly reshuffle
  // out from under the admin while they typed. Stable now the same way
  // HomeScreen's collectionCarousels already is, since resolveCollection's
  // own identity only changes when the underlying data actually does.
  const items = useMemo(() => (collection ? resolveCollection(collection) : []), [collection, resolveCollection]);
  const pinnedIds = collection ? new Set(pinnedListingIds(collection.id)) : new Set<string>();
  // resolveCollection puts pinned items first -- so the first pinnedIds.size
  // entries of `items` are exactly the pinned ones, in reorderable order;
  // everything after that is algorithmic and only removable via exclude.
  const pinnedCount = pinnedIds.size;

  const excludedListings = useMemo(() => {
    if (!collection || !isAlgorithmic) return [];
    const byId = new Map(allListings.map((l) => [l.id, l]));
    return excludedListingIds(collection.id)
      .map((id) => byId.get(id))
      .filter((l): l is Listing => !!l);
  }, [collection, isAlgorithmic, excludedListingIds, allListings]);

  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const inCollection = new Set(items.map((l) => l.id));
    return allListings
      .filter((l) => l.status === 'active' && !inCollection.has(l.id))
      .filter((l) => l.titleEn.toLowerCase().includes(q) || l.titleAr.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, allListings, items]);

  const add = async (listing: Listing) => {
    if (!collection || busyId) return;
    setBusyId(listing.id);
    try {
      await addCollectionItem(collection.id, listing.id);
    } catch (e: any) {
      Alert.alert('Could not add listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const unpin = async (listing: Listing) => {
    if (!collection || busyId) return;
    setBusyId(listing.id);
    try {
      await removeCollectionItem(collection.id, listing.id);
    } catch (e: any) {
      Alert.alert('Could not remove listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const exclude = async (listing: Listing) => {
    if (!collection || busyId) return;
    setBusyId(listing.id);
    try {
      await excludeFromCollection(collection.id, listing.id);
    } catch (e: any) {
      Alert.alert('Could not exclude listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const unexclude = async (listing: Listing) => {
    if (!collection || busyId) return;
    setBusyId(listing.id);
    try {
      await unexcludeFromCollection(collection.id, listing.id);
    } catch (e: any) {
      Alert.alert('Could not restore listing', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  // Reordering only ever applies to the pinned block -- an algorithmic
  // item's position comes from the algorithm, not from collection_items,
  // so there's nothing to move it against.
  const move = async (index: number, dir: -1 | 1) => {
    if (!collection || busyId) return;
    const target = index + dir;
    if (target < 0 || target >= pinnedCount) return;
    const pinnedOnly = items.slice(0, pinnedCount).map((l) => l.id);
    [pinnedOnly[index], pinnedOnly[target]] = [pinnedOnly[target], pinnedOnly[index]];
    setBusyId(items[index].id);
    try {
      await reorderCollectionItems(collection.id, pinnedOnly);
    } catch (e: any) {
      Alert.alert('Could not reorder', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const renderThumb = (listing: Listing) => (
    <View style={styles.thumb}>
      {listing.photos[0] ? (
        <Image source={{ uri: sizedPhotoUrl(listing.photos[0], ADMIN_ROW_THUMB)! }} style={styles.thumbImg} />
      ) : (
        <Icon name="bag" size={18} color={colors.inkSoft} />
      )}
    </View>
  );

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Manage collections</Text>
      </View>

      <View style={styles.tabRow}>
        {(Object.keys(KIND_LABEL) as CollectionKind[]).map((kind) => (
          <Pressy
            key={kind}
            onPress={() => setSelectedKind(kind)}
            style={[styles.tab, selectedKind === kind && styles.tabActive]}
          >
            <Text style={[styles.tabText, selectedKind === kind && styles.tabTextActive]}>{KIND_LABEL[kind]}</Text>
          </Pressy>
        ))}
      </View>

      {!collection ? (
        <View style={styles.empty}>
          <Text style={type.soft}>This collection isn't configured yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {isAlgorithmic && (
            <Text style={[type.soft, styles.kindNote]}>
              {KIND_LABEL[selectedKind]} fills itself from live listing data. Pin a listing to show it first, or
              exclude one that qualified but shouldn't be featured.
            </Text>
          )}

          <Text style={styles.sectionLabel}>In this collection ({items.length})</Text>
          {items.length === 0 && (
            <Text style={[type.soft, styles.emptyNote]}>Nothing here yet -- search below to add listings.</Text>
          )}
          <View style={styles.list}>
            {items.map((listing, index) => {
              const pinned = index < pinnedCount;
              return (
                <View key={listing.id} style={styles.rowCard}>
                  {renderThumb(listing)}
                  <View style={styles.rowInfo}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{listing.titleEn}</Text>
                      {isAlgorithmic && (
                        <View style={[styles.tag, pinned ? styles.tagPinned : styles.tagAuto]}>
                          <Text style={[styles.tagText, pinned ? styles.tagTextPinned : styles.tagTextAuto]}>
                            {pinned ? 'Pinned' : 'Auto'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.rowSub} numberOfLines={1}>${listing.price.toLocaleString()} · {listing.district}</Text>
                  </View>
                  <View style={styles.rowControls}>
                    {pinned ? (
                      <>
                        <Pressy onPress={() => move(index, -1)} style={styles.smallBtn} disabled={busyId === listing.id}>
                          <Text style={styles.smallBtnText}>↑</Text>
                        </Pressy>
                        <Pressy onPress={() => move(index, 1)} style={styles.smallBtn} disabled={busyId === listing.id}>
                          <Text style={styles.smallBtnText}>↓</Text>
                        </Pressy>
                        <Pressy onPress={() => unpin(listing)} style={styles.removeBtn} disabled={busyId === listing.id}>
                          <Icon name="close" size={13} color={colors.danger} />
                        </Pressy>
                      </>
                    ) : (
                      <Pressy onPress={() => exclude(listing)} style={styles.excludeBtn} disabled={busyId === listing.id}>
                        <Text style={styles.excludeBtnText}>Exclude</Text>
                      </Pressy>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Add listings</Text>
          <View style={styles.searchWrap}>
            <Icon name="search" size={15} color={colors.inkSoft} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by title…"
              placeholderTextColor={colors.inkSoft}
              style={styles.searchInput}
            />
          </View>
          <View style={styles.list}>
            {searchResults.map((listing) => (
              <View key={listing.id} style={styles.rowCard}>
                {renderThumb(listing)}
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{listing.titleEn}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>${listing.price.toLocaleString()} · {listing.district}</Text>
                </View>
                <Pressy onPress={() => add(listing)} style={styles.addBtn} disabled={busyId === listing.id}>
                  <Text style={styles.addBtnText}>+ Add</Text>
                </Pressy>
              </View>
            ))}
            {query.trim().length >= 2 && searchResults.length === 0 && (
              <Text style={[type.soft, styles.emptyNote]}>No active listings match "{query.trim()}".</Text>
            )}
          </View>

          {isAlgorithmic && (
            <>
              <Text style={styles.sectionLabel}>Excluded from this collection ({excludedListings.length})</Text>
              {excludedListings.length === 0 ? (
                <Text style={[type.soft, styles.emptyNote]}>Nothing excluded.</Text>
              ) : (
                <View style={styles.list}>
                  {excludedListings.map((listing) => (
                    <View key={listing.id} style={styles.rowCard}>
                      {renderThumb(listing)}
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{listing.titleEn}</Text>
                        <Text style={styles.rowSub} numberOfLines={1}>${listing.price.toLocaleString()} · {listing.district}</Text>
                      </View>
                      <Pressy onPress={() => unexclude(listing)} style={styles.addBtn} disabled={busyId === listing.id}>
                        <Text style={styles.addBtnText}>Un-exclude</Text>
                      </Pressy>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 56 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginBottom: 4 },
  tab: {
    flex: 1, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.ink },
  tabTextActive: { color: colors.white },
  scroll: { paddingBottom: 60 },
  empty: { paddingHorizontal: 18, paddingVertical: 24 },
  kindNote: { paddingHorizontal: 18, marginTop: 14 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkSoft,
    paddingHorizontal: 18, marginTop: 18, marginBottom: 8,
  },
  emptyNote: { paddingHorizontal: 18, marginBottom: 8 },
  list: { paddingHorizontal: 18, gap: 8 },
  rowCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  thumb: {
    width: 42, height: 42, borderRadius: 8, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  rowSub: { ...type.tiny, marginTop: 1 },
  tag: { borderRadius: radius.pill, paddingHorizontal: 7, height: 17, alignItems: 'center', justifyContent: 'center' },
  tagPinned: { backgroundColor: colors.accentTint },
  tagAuto: { backgroundColor: colors.surface },
  tagText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  tagTextPinned: { color: colors.accentDeep },
  tagTextAuto: { color: colors.inkSoft },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5E4E2' },
  excludeBtn: {
    height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: '#F5E4E2',
    alignItems: 'center', justifyContent: 'center',
  },
  excludeBtnText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  addBtn: {
    height: 30, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40, marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, height: '100%' },
});
