import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useCollections } from '../../store/CollectionsStore';
import { sizedPhotoUrl, PHOTO_WIDTHS } from '../../lib/photoSize';
import { Listing } from '../../types';
import { RootStackParamList } from '../../navigation/types';

// Curates Editor's Picks (the only collection kind an admin has any input
// into -- Hot Deals and Just Listed resolve themselves entirely from live
// listing data, see CollectionsStore's resolveCollection). Every action
// here (add/remove/reorder) writes straight to the DB and refreshes, same
// "no separate Save step" convention as AdminCategoriesScreen's autosave --
// there's no local draft to lose if you navigate away mid-edit.
export default function AdminCollectionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { listings: allListings } = useAppStore();
  const { collections, resolveCollection, addCollectionItem, removeCollectionItem, reorderCollectionItems } = useCollections();

  // Exactly one curated collection is seeded today (editors-picks); this
  // screen only knows how to curate "the" curated collection rather than
  // offering a picker, since there's nothing to pick between yet.
  const collection = collections.find((c) => c.kind === 'curated');
  const items = collection ? resolveCollection(collection) : [];

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

  const remove = async (listing: Listing) => {
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

  const move = async (index: number, dir: -1 | 1) => {
    if (!collection || busyId) return;
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((l) => l.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(items[index].id);
    try {
      await reorderCollectionItems(collection.id, ids);
    } catch (e: any) {
      Alert.alert('Could not reorder', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const renderThumb = (listing: Listing) => (
    <View style={styles.thumb}>
      {listing.photos[0] ? (
        <Image source={{ uri: sizedPhotoUrl(listing.photos[0], PHOTO_WIDTHS.card)! }} style={styles.thumbImg} />
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
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>Curate: Editor's Picks</Text>
          {!!collection && <Text style={styles.topSub}>{items.length} listings</Text>}
        </View>
      </View>

      {!collection ? (
        <View style={styles.empty}>
          <Text style={type.soft}>No curated collection is configured yet.</Text>
        </View>
      ) : (
        <View style={styles.scroll}>
          <Text style={styles.sectionLabel}>In this collection ({items.length})</Text>
          {items.length === 0 && (
            <Text style={[type.soft, styles.emptyNote]}>Nothing added yet -- search below to add listings.</Text>
          )}
          <View style={styles.list}>
            {items.map((listing, index) => (
              <View key={listing.id} style={styles.rowCard}>
                {renderThumb(listing)}
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{listing.titleEn}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>${listing.price.toLocaleString()} · {listing.district}</Text>
                </View>
                <View style={styles.rowControls}>
                  <Pressy onPress={() => move(index, -1)} style={styles.smallBtn} disabled={busyId === listing.id}>
                    <Text style={styles.smallBtnText}>↑</Text>
                  </Pressy>
                  <Pressy onPress={() => move(index, 1)} style={styles.smallBtn} disabled={busyId === listing.id}>
                    <Text style={styles.smallBtnText}>↓</Text>
                  </Pressy>
                  <Pressy onPress={() => remove(listing)} style={styles.removeBtn} disabled={busyId === listing.id}>
                    <Icon name="close" size={13} color={colors.danger} />
                  </Pressy>
                </View>
              </View>
            ))}
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
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 56 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  topSub: { ...type.tiny, marginTop: 1 },
  scroll: { paddingBottom: 60 },
  empty: { paddingHorizontal: 18, paddingVertical: 24 },
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
  rowTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  rowSub: { ...type.tiny, marginTop: 1 },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5E4E2' },
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
