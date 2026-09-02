import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { AuctionLotStatus, Listing } from '../../types';
import { listingTitle } from '../../lib/listingText';
import { uploadPhotosWithThumbnails } from '../../lib/photoUpload';
import { conditionOptionsFor } from '../../lib/conditionModes';
import {
  AdminLotRow, addAuctionLot, cancelAuctionLot, createAuctionLot, fetchAdminAuctionLots,
  fetchLotListings, formatBidAmount, removeAuctionLot, updateAuctionLot,
} from '../../lib/auctions';
import { adminMessage } from './AdminAuctionsScreen';
import { useAppStore } from '../../store/AppStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { useSettings } from '../../store/SettingsStore';
import { DESKTOP_CONTENT_MAX_WIDTH } from '../../hooks/useResponsive';
import { RootStackParamList } from '../../navigation/types';

// Adding lots to an auction, two ways.
//
// CONSIGNING an existing listing is the tidy path: the photos, the 360
// spin and the video already exist, made by the app's own posting flow,
// which is the best tooling here for producing them. Adding the lot flips
// that listing's status to 'auction' and remembers what it was, so
// removing the lot puts it back.
//
// BUILDING one from scratch is the path that matches how consignment
// actually works. The item arrives at our door; nobody listed it for sale
// first, and requiring them to would mean every auction item has to be
// posted to the marketplace and then pulled straight back out of it. This
// creates the listing at status 'auction' directly -- it is a lot from the
// first instant and never appears in a browse grid.
//
// Neither path is gated on the auction being a draft. Every guard that
// used to say "only while this is a draft" is gone, deliberately: this
// screen is the instrument for running a sale under test, and an auction
// that cannot be corrected once published is one that has to be deleted
// and rebuilt instead.
const MAX_LOT_PHOTOS = 8;

type ScratchForm = {
  titleEn: string; titleAr: string;
  descriptionEn: string; descriptionAr: string;
  categoryId: string; district: string; condition: string;
  startPrice: string; reserve: string;
  photos: string[];
};

// Every status auction_lots allows. Same reasoning as the auction status
// row: not a workflow, an override, and the only way back for a lot the
// auction cancelled underneath it.
const LOT_STATUSES: AuctionLotStatus[] = [
  'pending', 'live', 'closed', 'won', 'unsold', 'settled', 'cancelled',
];

const EMPTY_SCRATCH: ScratchForm = {
  titleEn: '', titleAr: '', descriptionEn: '', descriptionAr: '',
  categoryId: '', district: '', condition: '',
  startPrice: '', reserve: '', photos: [],
};

export default function AdminAuctionLotsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { auctionId } = useRoute<RouteProp<RootStackParamList, 'AdminAuctionLots'>>().params;
  const { language, t } = useLanguage();
  const { listings, profile } = useAppStore();
  const { allCategories, categoryById, conditionModeForCategory } = useSettings();

  const [lots, setLots] = useState<AdminLotRow[]>([]);
  const [lotListings, setLotListings] = useState<Record<string, Listing>>({});
  const [status, setStatus] = useState<string>('unknown');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // null = nothing open. 'consign' = pick an existing listing.
  // 'scratch' = build the item here.
  const [mode, setMode] = useState<'consign' | 'scratch' | null>(null);
  const [chosen, setChosen] = useState<Listing | null>(null);
  const [startPrice, setStartPrice] = useState('');
  const [reserve, setReserve] = useState('');
  const [scratch, setScratch] = useState<ScratchForm>(EMPTY_SCRATCH);
  const [catQuery, setCatQuery] = useState('');
  // The lot currently being corrected, and the form behind it.
  const [editingLot, setEditingLot] = useState<AdminLotRow | null>(null);
  const [lotEdit, setLotEdit] = useState({
    titleEn: '', titleAr: '', descriptionEn: '', descriptionAr: '',
    startPrice: '', reserve: '',
    status: 'pending' as AuctionLotStatus,
    // Same staleness guard as the auction form: advance_auctions moves lot
    // statuses every minute, so a save must not write back whatever the
    // list happened to show when it was opened.
    statusTouched: false,
  });

  const load = useCallback(async () => {
    try {
      const [{ data: auctionRow, error: auctionErr }, mapped] = await Promise.all([
        supabase.from('auctions').select('status').eq('id', auctionId).maybeSingle(),
        // An RPC, not a select. reserve_price is granted to service_role
        // ONLY, and naming an ungranted column fails the whole statement
        // (@AGENTS.md) -- the first version of this screen selected it and
        // came back empty for every admin, permanently.
        fetchAdminAuctionLots(auctionId),
      ]);
      if (auctionErr) throw auctionErr;
      setStatus(auctionRow?.status || 'unknown');
      setLots(mapped);
      // A lot can go away while its editor is open -- removed here, or
      // deleted from another device. Dropping the editor when its row is
      // gone keeps `editingLot` from hiding the Add buttons forever.
      setEditingLot((cur) => (cur && mapped.some((l) => l.id === cur.id) ? cur : null));
      if (mapped.length) {
        const rows = await fetchLotListings(mapped.map((l) => l.listingId));
        setLotListings(Object.fromEntries(rows.map((r) => [r.id, r])));
      } else {
        setLotListings({});
      }
    } catch (e: any) {
      setStatus('unknown');
      Alert.alert('Could not load lots', adminMessage(e));
    } finally {
      setLoading(false);
    }
  }, [auctionId]);

  useEffect(() => { load(); }, [load]);

  // The admin's OWN listings, whatever state they are in. The ownership
  // filter is the point: consigning flips the row out of the marketplace,
  // and doing that to somebody else's listing from a picker is not
  // something this flow should make easy. A consigned item is posted by
  // the Vevaty account anyway -- that is what custody means. The STATUS
  // filter is gone: a draft or an expired listing is a perfectly good
  // thing to put in a sale, and the database stopped refusing them.
  const candidates = listings.filter((l) => l.sellerId === profile.id && l.status !== 'auction');

  // Only leaves are postable -- the same rule the create-listing flow
  // uses, derived from "has no children" rather than a stored flag, so a
  // category that grows a child stops being offered here automatically.
  const leafCategories = useMemo(() => {
    const parents = new Set(allCategories.map((c) => c.parentId).filter(Boolean) as string[]);
    return allCategories
      .filter((c) => c.active && !parents.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [allCategories]);

  // There are getting on for ninety of these. A 200px window scrubbed
  // through ninety rows is not a picker, it is a search with the search
  // taken out -- so the search goes back in. The selected one is kept in
  // the list whatever the query, or typing after choosing makes the
  // choice look lost.
  const visibleCategories = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    if (!q) return leafCategories;
    return leafCategories.filter(
      (c) =>
        c.id === scratch.categoryId ||
        c.nameEn.toLowerCase().includes(q) ||
        c.nameAr.includes(catQuery.trim()) ||
        c.id.includes(q)
    );
  }, [leafCategories, catQuery, scratch.categoryId]);

  const categoryLabel = useCallback(
    (id: string) => {
      const c = categoryById(id);
      if (!c) return id;
      const parent = c.parentId ? categoryById(c.parentId) : undefined;
      const name = language === 'ar' ? c.nameAr : c.nameEn;
      if (!parent) return name;
      return `${language === 'ar' ? parent.nameAr : parent.nameEn} › ${name}`;
    },
    [categoryById, language]
  );

  // The condition question is not the same question in every category --
  // New/Used for a camera, Sale/Rent for a shop unit, a wear grade for
  // graded goods. Asked through the same table every other surface uses so
  // a lot cannot be saved with a value its category does not recognise.
  const conditionOptions = useMemo(
    () => (scratch.categoryId ? conditionOptionsFor(conditionModeForCategory(scratch.categoryId), t) : []),
    [scratch.categoryId, conditionModeForCategory, t]
  );

  const closeForm = () => {
    setMode(null);
    setChosen(null);
    setStartPrice('');
    setReserve('');
    setScratch(EMPTY_SCRATCH);
    setCatQuery('');
    setEditingLot(null);
  };

  const pickPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo library access to add lot photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: MAX_LOT_PHOTOS,
    });
    if (!result.canceled) {
      setScratch((f) => ({
        ...f,
        photos: [...f.photos, ...result.assets.map((a) => a.uri)].slice(0, MAX_LOT_PHOTOS),
      }));
    }
  };

  const parsePrices = (startText: string, reserveText: string) => {
    const start = Number(startText);
    const res = reserveText.trim() ? Number(reserveText) : null;
    if (!Number.isFinite(start) || start <= 0) {
      Alert.alert('Start price', 'Enter a start price above zero.');
      return null;
    }
    if (res !== null && (!Number.isFinite(res) || res < start)) {
      Alert.alert('Reserve', 'A reserve cannot be below the start price.');
      return null;
    }
    return { start, res };
  };

  const consign = async () => {
    if (!chosen) return;
    const prices = parsePrices(startPrice, reserve);
    if (!prices) return;
    setBusy(true);
    // ONE call. This used to be two writes from here -- insert the lot,
    // then flip the listing -- and either half could land alone. A lot with
    // its listing still active puts an auction item into the browse grid;
    // a flipped listing with no lot is invisible to both the marketplace
    // and the auction, and no screen in the app points at it. Both halves
    // are one transaction inside add_auction_lot now.
    try {
      await addAuctionLot({
        auctionId, listingId: chosen.id, startPrice: prices.start, reservePrice: prices.res,
      });
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not add lot', adminMessage(e));
      return;
    }
    setBusy(false);
    closeForm();
    load();
  };

  const createFromScratch = async () => {
    if (!scratch.titleEn.trim() || !scratch.titleAr.trim()) {
      Alert.alert('Missing title', 'Enter both titles.');
      return;
    }
    if (!scratch.categoryId) {
      Alert.alert('Missing category', 'Pick a category.');
      return;
    }
    const prices = parsePrices(scratch.startPrice, scratch.reserve);
    if (!prices) return;

    setBusy(true);

    // Photos FIRST, and the ordering is the point. uploadPhotosWithThumbnails
    // wants no listing id -- it returns CDN urls -- and doing it after the
    // create left a lot publicly biddable with the placeholder glyph for
    // however long eight uploads take, permanently so if they failed. It
    // also left the admin with a half-finished lot and no way to fix it:
    // every listing screen in this app excludes status='auction'. Failing
    // here means nothing was created at all.
    let uploaded: { url: string; thumbnailUrl: string }[] = [];
    if (scratch.photos.length > 0) {
      // It never rejects: it collects failures, fires its own alert and
      // resolves with whatever got through. That alert says "the listing
      // was saved without them — open the listing, tap Edit and add them
      // again", which is wrong twice over here (nothing is saved yet, and
      // no screen in the app opens a listing at status 'auction'), so the
      // count is checked and the truth said afterwards.
      uploaded = await uploadPhotosWithThumbnails(scratch.photos);
      if (uploaded.length === 0) {
        setBusy(false);
        Alert.alert(
          'Photos did not upload',
          'Nothing was created — the lot has not been saved. Check the connection and try again.'
        );
        return;
      }
    }

    let listingId: string;
    try {
      const created = await createAuctionLot({
        auctionId,
        titleEn: scratch.titleEn.trim(),
        titleAr: scratch.titleAr.trim(),
        descriptionEn: scratch.descriptionEn.trim(),
        descriptionAr: scratch.descriptionAr.trim(),
        categoryId: scratch.categoryId,
        district: scratch.district.trim(),
        // Falls back to the first option its category offers rather than a
        // hardcoded 'used', which is the wrong answer under three of the
        // four condition modes.
        condition: scratch.condition || conditionOptions[0]?.value || 'used',
        startPrice: prices.start,
        reservePrice: prices.res,
      });
      listingId = created.listingId;
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not create lot', adminMessage(e));
      return;
    }

    // The rows, now that there is something to hang them on. RLS lets this
    // through because create_auction_lot made the admin the seller, and
    // `sellers manage their own listing photos` is an ALL policy that does
    // not read the listing's status.
    if (uploaded.length > 0) {
      const { error } = await supabase.from('listing_photos').insert(
        uploaded.map((u, i) => ({
          listing_id: listingId,
          url: u.url,
          thumbnail_url: u.thumbnailUrl,
          sort_order: i,
          kind: 'gallery',
        }))
      );
      if (error) {
        Alert.alert('Lot created, photos did not attach', `${error.message}\n\nUse Add photos on the lot to finish.`);
      } else if (uploaded.length < scratch.photos.length) {
        Alert.alert(
          'Lot created without all its photos',
          `${uploaded.length} of ${scratch.photos.length} uploaded. Use Add photos on the lot to finish.`
        );
      }
    }

    setBusy(false);
    closeForm();
    load();
  };

  // The more destructive of the two, and the one that looks tamer. Remove
  // deletes the lot row, so auction_bids cascades with it: on a lot that
  // sold, the winner, the amount AND the history all go, where withdraw at
  // least leaves the history to reconstruct from.
  const confirmRemove = (lot: AdminLotRow) => {
    const resolved = lot.status === 'won' || lot.status === 'settled';
    Alert.alert(
      `Remove lot ${lot.lotNumber}?`,
      (resolved
        ? 'This lot has a winner. Removing it VOIDS THAT SALE and deletes the bid history ' +
          'with it — nothing about the sale can be reconstructed afterwards. '
        : '') +
        (lot.bidCount > 0
          ? `${lot.bidCount} bid${lot.bidCount === 1 ? '' : 's'} on this lot are deleted with it. `
          : '') +
        'A consigned listing goes back to the status it had before the auction — which may ' +
        'be draft or expired, not necessarily live. An item created for this auction is ' +
        'hidden from the site but kept in the database, so it can be brought back by hand. ' +
        'Later lots renumber to close the gap.' +
        (lot.bidCount > 0 ? ' Withdraw it instead if the bidders should still see what happened.' : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await removeAuctionLot(lot.id);
            } catch (e: any) {
              Alert.alert('Could not remove', adminMessage(e));
            } finally {
              setBusy(false);
              // Or the edit form vanishes with the row while `editingLot`
              // stays set, which hides the two Add buttons -- a screen with
              // nothing on it and no way back but the back arrow.
              setEditingLot((cur) => (cur?.id === lot.id ? null : cur));
              load();
            }
          },
        },
      ]
    );
  };

  // Withdrawing is offered at every status, including one that has already
  // sold, and that is a real difference in consequence rather than a
  // wording nicety: on a resolved lot it voids the sale. The dialog says
  // which of the two it is about to do.
  const confirmWithdraw = (lot: AdminLotRow) => {
    const resolved = lot.status === 'won' || lot.status === 'settled';
    Alert.alert(
      `Withdraw lot ${lot.lotNumber}?`,
      (resolved
        ? 'This lot has a winner. Withdrawing VOIDS THAT SALE: the winner and the winning ' +
          'amount are erased from the lot and can only be reconstructed from the bid ' +
          'history. '
        : 'The lot stops taking bids and shows as withdrawn. ') +
        'Its bid history stays, so anyone who bid can see what became of it. A consigned ' +
        'listing goes back to the status it had before the auction — back on public sale if ' +
        'it was active. An item created for this auction stays attached to the withdrawn ' +
        'lot; remove the lot instead if you want it out of the auction entirely.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await cancelAuctionLot(lot.id);
            } catch (e: any) {
              Alert.alert('Could not withdraw', adminMessage(e));
            } finally {
              setBusy(false);
              load();
            }
          },
        },
      ]
    );
  };

  const openLotEdit = (lot: AdminLotRow) => {
    const l = lotListings[lot.listingId];
    if (!l) {
      // The listing rows arrive in a SECOND fetch after the lots render,
      // and that fetch can fail. Opening the form without them prefills
      // empty boxes over real text, and Save would write them back.
      Alert.alert('Still loading', 'This lot’s item has not loaded yet. Pull back and try again.');
      return;
    }
    setMode(null);
    setEditingLot(lot);
    setLotEdit({
      titleEn: l.titleEn || '',
      titleAr: l.titleAr || '',
      descriptionEn: l.descriptionEn || '',
      descriptionAr: l.descriptionAr || '',
      startPrice: String(lot.startPrice),
      reserve: lot.reservePrice === null ? '' : String(lot.reservePrice),
      status: lot.status as AuctionLotStatus,
      statusTouched: false,
    });
  };

  const saveLotEdit = async () => {
    if (!editingLot) return;
    const prices = parsePrices(lotEdit.startPrice, lotEdit.reserve);
    if (!prices) return;
    setBusy(true);
    try {
      await updateAuctionLot(editingLot.id, {
        startPrice: prices.start,
        // An empty reserve box means REMOVE it -- that is what the field
        // label says, and `clearReserve` is the only way to say it, since
        // a null reservePrice already means "leave it alone" everywhere in
        // the client. Blank titles and descriptions mean the opposite
        // ("leave it") and are handled in SQL, because those boxes can be
        // blank for reasons the admin never chose.
        reservePrice: prices.res ?? undefined,
        clearReserve: prices.res === null,
        titleEn: lotEdit.titleEn.trim(),
        titleAr: lotEdit.titleAr.trim(),
        descriptionEn: lotEdit.descriptionEn,
        descriptionAr: lotEdit.descriptionAr,
        status: lotEdit.statusTouched ? lotEdit.status : undefined,
      });
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not save lot', adminMessage(e));
      return;
    }
    setBusy(false);
    setEditingLot(null);
    load();
  };

  // Adding photos to a lot that already exists -- the only way to fix a
  // lot whose upload failed, since no listing screen in the app will open
  // something at status 'auction'. Straight to listing_photos: the RLS
  // policy is ownership-based and does not read the listing's status.
  const addPhotosToLot = async (lot: AdminLotRow) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo library access to add lot photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: MAX_LOT_PHOTOS,
    });
    if (result.canceled || result.assets.length === 0) return;

    setBusy(true);
    try {
      const uploaded = await uploadPhotosWithThumbnails(result.assets.map((a) => a.uri));
      if (uploaded.length === 0) {
        setBusy(false);
        // Same reason as createFromScratch: the helper's own alert says
        // "the listing was saved without them — open the listing, tap Edit
        // and add them again", and no screen in this app opens a listing at
        // status 'auction'. Say what actually happened instead.
        Alert.alert('No photos were added', 'None of them uploaded. Check the connection and try again.');
        return;
      }
      const existing = lotListings[lot.listingId]?.photos?.length ?? 0;
      const { error } = await supabase.from('listing_photos').insert(
        uploaded.map((u, i) => ({
          listing_id: lot.listingId,
          url: u.url,
          thumbnail_url: u.thumbnailUrl,
          sort_order: existing + i,
          kind: 'gallery',
        }))
      );
      if (error) throw error;
    } catch (e: any) {
      Alert.alert('Could not add photos', e?.message || String(e));
    } finally {
      setBusy(false);
      load();
    }
  };

  const renderLotEditForm = (lot: AdminLotRow) => (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Lot {lot.lotNumber}</Text>
      <Text style={styles.hint}>
        Title and description only change an item this account owns. Prices change on any lot,
        including one that is live — bids already placed are left exactly where they are.
      </Text>

      <Text style={styles.fieldLabel}>Title (English)</Text>
      <TextInput value={lotEdit.titleEn} onChangeText={(v) => setLotEdit((f) => ({ ...f, titleEn: v }))} style={styles.input} placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Title (Arabic)</Text>
      <TextInput value={lotEdit.titleAr} onChangeText={(v) => setLotEdit((f) => ({ ...f, titleAr: v }))} style={styles.input} placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Description (English)</Text>
      <TextInput value={lotEdit.descriptionEn} onChangeText={(v) => setLotEdit((f) => ({ ...f, descriptionEn: v }))} style={[styles.input, styles.inputTall]} multiline placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Description (Arabic)</Text>
      <TextInput value={lotEdit.descriptionAr} onChangeText={(v) => setLotEdit((f) => ({ ...f, descriptionAr: v }))} style={[styles.input, styles.inputTall]} multiline placeholderTextColor={colors.inkSoft} />

      <Text style={styles.fieldLabel}>Start price (USD)</Text>
      <TextInput value={lotEdit.startPrice} onChangeText={(v) => setLotEdit((f) => ({ ...f, startPrice: v }))} keyboardType="numeric" style={styles.input} placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Reserve (blank removes it)</Text>
      <TextInput value={lotEdit.reserve} onChangeText={(v) => setLotEdit((f) => ({ ...f, reserve: v }))} keyboardType="numeric" style={styles.input} placeholderTextColor={colors.inkSoft} />

      <Text style={styles.fieldLabel}>Status</Text>
      <View style={styles.pillRow}>
        {LOT_STATUSES.map((st) => (
          <Pressy
            key={st}
            onPress={() => setLotEdit((f) => ({ ...f, status: st, statusTouched: true }))}
            style={[styles.pill, lotEdit.status === st && styles.pillOn]}
          >
            <Text style={[styles.pillText, lotEdit.status === st && styles.pillTextOn]}>{st}</Text>
          </Pressy>
        ))}
      </View>
      <Text style={styles.hint}>
        Mostly the engine's business — the minute job moves these on its own. It is here so a
        lot the auction cancelled underneath it can be brought back. Setting one live gives it
        a fresh close time if its own has passed. Only won and settled keep a recorded
        winner — every other status drops it. The item follows the lot either way: a lot put
        back into the sale takes its listing out of the marketplace, and a cancelled one
        hands a consigned listing back.
        {!lotEdit.statusTouched && ' Untouched, so this save leaves it alone.'}
      </Text>

      <Pressy onPress={() => addPhotosToLot(lot)} style={styles.addPhotosBtn} disabled={busy}>
        <Icon name="plus" size={15} color={colors.primary} />
        <Text style={styles.altText}>Add photos ({lotListings[lot.listingId]?.photos?.length ?? 0} now)</Text>
      </Pressy>

      <View style={styles.formActions}>
        <Pressy onPress={() => setEditingLot(null)} style={styles.cancelBtn} disabled={busy}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressy>
        <Pressy onPress={saveLotEdit} style={styles.saveBtn} disabled={busy}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Save lot'}</Text>
        </Pressy>
      </View>
    </View>
  );

  const renderConsignForm = () => (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Consign an existing listing</Text>
      <Text style={styles.fieldLabel}>Pick a listing</Text>
      <ScrollView style={styles.pickList} nestedScrollEnabled>
        {candidates.map((l) => (
          <Pressy
            key={l.id}
            onPress={() => setChosen(l)}
            style={[styles.pickRow, chosen?.id === l.id && styles.pickRowOn]}
          >
            <Text style={styles.pickText} numberOfLines={1}>
              {listingTitle(l, language)}{l.status !== 'active' ? ` · ${l.status}` : ''}
            </Text>
            {chosen?.id === l.id && <Icon name="checkCircle" size={15} color={colors.primary} />}
          </Pressy>
        ))}
        {candidates.length === 0 && (
          <Text style={styles.rowSub}>Nothing to consign. Build the item here instead.</Text>
        )}
      </ScrollView>

      <Text style={styles.fieldLabel}>Start price (USD)</Text>
      <TextInput value={startPrice} onChangeText={setStartPrice} keyboardType="numeric" style={styles.input} placeholder="500" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Reserve (optional, never shown to bidders)</Text>
      <TextInput value={reserve} onChangeText={setReserve} keyboardType="numeric" style={styles.input} placeholder="1200" placeholderTextColor={colors.inkSoft} />

      <View style={styles.formActions}>
        <Pressy onPress={closeForm} style={styles.cancelBtn} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></Pressy>
        <Pressy onPress={consign} style={styles.saveBtn} disabled={busy || !chosen}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Add lot'}</Text>
        </Pressy>
      </View>
    </View>
  );

  const renderScratchForm = () => (
    <View style={styles.form}>
      <Text style={styles.formTitle}>Build the item here</Text>
      <Text style={styles.hint}>
        Creates the item as a lot directly. It never appears in the marketplace — it exists
        only inside this auction.
      </Text>

      <Text style={styles.fieldLabel}>Title (English)</Text>
      <TextInput value={scratch.titleEn} onChangeText={(v) => setScratch((f) => ({ ...f, titleEn: v }))} style={styles.input} placeholder="Vintage Rolex Datejust 1601" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Title (Arabic)</Text>
      <TextInput value={scratch.titleAr} onChangeText={(v) => setScratch((f) => ({ ...f, titleAr: v }))} style={styles.input} placeholder="ساعة رولكس ديت جست" placeholderTextColor={colors.inkSoft} />

      <Text style={styles.fieldLabel}>Description (English)</Text>
      <TextInput value={scratch.descriptionEn} onChangeText={(v) => setScratch((f) => ({ ...f, descriptionEn: v }))} style={[styles.input, styles.inputTall]} multiline placeholder="Condition, provenance, what is included." placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Description (Arabic)</Text>
      <TextInput value={scratch.descriptionAr} onChangeText={(v) => setScratch((f) => ({ ...f, descriptionAr: v }))} style={[styles.input, styles.inputTall]} multiline placeholderTextColor={colors.inkSoft} />

      <Text style={styles.fieldLabel}>Category</Text>
      <TextInput
        value={catQuery}
        onChangeText={setCatQuery}
        style={[styles.input, { marginBottom: 6 }]}
        placeholder="Search categories"
        placeholderTextColor={colors.inkSoft}
      />
      <ScrollView style={styles.pickList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {visibleCategories.map((c) => (
          <Pressy
            key={c.id}
            onPress={() => setScratch((f) => ({ ...f, categoryId: c.id, condition: '' }))}
            style={[styles.pickRow, scratch.categoryId === c.id && styles.pickRowOn]}
          >
            <Text style={styles.pickText} numberOfLines={1}>{categoryLabel(c.id)}</Text>
            {scratch.categoryId === c.id && <Icon name="checkCircle" size={15} color={colors.primary} />}
          </Pressy>
        ))}
        {visibleCategories.length === 0 && (
          <Text style={styles.rowSub}>Nothing matches “{catQuery.trim()}”.</Text>
        )}
      </ScrollView>

      {conditionOptions.length > 0 && (
        <>
          <Text style={styles.fieldLabel}>Condition</Text>
          <View style={styles.pillRow}>
            {conditionOptions.map((o) => (
              <Pressy
                key={o.value}
                onPress={() => setScratch((f) => ({ ...f, condition: o.value }))}
                style={[styles.pill, scratch.condition === o.value && styles.pillOn]}
              >
                <Text style={[styles.pillText, scratch.condition === o.value && styles.pillTextOn]}>{o.label}</Text>
              </Pressy>
            ))}
          </View>
        </>
      )}

      <Text style={styles.fieldLabel}>Where it is (optional)</Text>
      <TextInput value={scratch.district} onChangeText={(v) => setScratch((f) => ({ ...f, district: v }))} style={styles.input} placeholder="Beirut" placeholderTextColor={colors.inkSoft} />

      <Text style={styles.fieldLabel}>Photos ({scratch.photos.length}/{MAX_LOT_PHOTOS})</Text>
      <View style={styles.thumbRow}>
        {scratch.photos.map((uri, i) => (
          <Pressy
            key={`${uri}-${i}`}
            onPress={() => setScratch((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
            style={styles.thumbWrap}
          >
            <Image source={{ uri }} style={styles.thumb} />
            <View style={styles.thumbX}><Icon name="close" size={11} color={colors.white} /></View>
          </Pressy>
        ))}
        {scratch.photos.length < MAX_LOT_PHOTOS && (
          <Pressy onPress={pickPhotos} style={styles.thumbAdd}>
            <Icon name="plus" size={16} color={colors.inkSoft} />
          </Pressy>
        )}
      </View>
      <Text style={styles.hint}>
        The first photo is the lot's cover. For a 360 spin or a video, post the item through
        the normal flow and consign it instead — this form takes stills only.
      </Text>

      <Text style={styles.fieldLabel}>Start price (USD)</Text>
      <TextInput value={scratch.startPrice} onChangeText={(v) => setScratch((f) => ({ ...f, startPrice: v }))} keyboardType="numeric" style={styles.input} placeholder="500" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Reserve (optional, never shown to bidders)</Text>
      <TextInput value={scratch.reserve} onChangeText={(v) => setScratch((f) => ({ ...f, reserve: v }))} keyboardType="numeric" style={styles.input} placeholder="1200" placeholderTextColor={colors.inkSoft} />

      <View style={styles.formActions}>
        <Pressy onPress={closeForm} style={styles.cancelBtn} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></Pressy>
        <Pressy onPress={createFromScratch} style={styles.saveBtn} disabled={busy}>
          <Text style={styles.saveText}>{busy ? 'Saving…' : 'Create lot'}</Text>
        </Pressy>
      </View>
    </View>
  );

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Lots</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Held back until the auction row is actually in hand. `status`
            starts at 'unknown' and returns to it on a failed read, and
            this used to render that word at the reader as a description
            of their auction. */}
        {!loading && status !== 'unknown' && (
          <Text style={styles.note}>
            {status === 'draft'
              ? 'Draft — add lots, then publish from the auctions list.'
              : `${status} — lots can still be added, removed and withdrawn. Anything already live is bid on by real people, so removing takes its bids with it.`}
          </Text>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 30 }} color={colors.primary} />
        ) : (
          <>
            {lots.map((lot) => (
              <View key={lot.id}>
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    Lot {lot.lotNumber} · {lotListings[lot.listingId] ? listingTitle(lotListings[lot.listingId], language) : '—'}
                  </Text>
                  <Text style={styles.rowSub}>
                    Start {formatBidAmount(lot.startPrice)}
                    {lot.reservePrice !== null ? ` · Reserve ${formatBidAmount(lot.reservePrice)}` : ' · No reserve'}
                    {' · '}{lot.status}
                  </Text>
                  <Text style={styles.rowSub}>
                    {lot.currentPrice === null ? 'No bids' : `${formatBidAmount(lot.currentPrice)} · ${lot.bidCount} bids`}
                  </Text>
                </View>
                <Pressy
                  onPress={() => (editingLot?.id === lot.id ? setEditingLot(null) : openLotEdit(lot))}
                  style={styles.iconAction}
                  disabled={busy}
                >
                  <Icon name="edit" size={15} color={colors.inkSoft} />
                </Pressy>
                {lot.status !== 'cancelled' && (
                  // Withdrawing, not deleting: bids may have been placed,
                  // and the lot has to stay readable to the people who
                  // placed them.
                  <Pressy onPress={() => confirmWithdraw(lot)} style={styles.iconAction} disabled={busy}>
                    <Icon name="close" size={15} color={colors.inkSoft} />
                  </Pressy>
                )}
                <Pressy onPress={() => confirmRemove(lot)} style={styles.iconAction} disabled={busy}>
                  <Icon name="trash" size={15} color={colors.danger} />
                </Pressy>
              </View>
              {editingLot?.id === lot.id && renderLotEditForm(lot)}
              </View>
            ))}

            {mode === 'consign' && renderConsignForm()}
            {mode === 'scratch' && renderScratchForm()}

            {mode === null && !editingLot && (
              <View style={styles.addRow}>
                <Pressy onPress={() => setMode('consign')} style={styles.altBtn}>
                  <Icon name="plus" size={15} color={colors.primary} />
                  <Text style={styles.altText}>Consign a listing</Text>
                </Pressy>
                <Pressy onPress={() => setMode('scratch')} style={styles.newBtn}>
                  <Icon name="plus" size={16} color={colors.white} />
                  <Text style={styles.newText}>New item</Text>
                </Pressy>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 80 },
  note: { ...type.tiny, marginBottom: 14, lineHeight: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  rowSub: { ...type.tiny },
  iconAction: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  altBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: radius.pill, height: 46, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  altText: { fontSize: 13.5, fontWeight: '800', color: colors.primary },
  newBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.pill, height: 46,
  },
  newText: { fontSize: 14, fontWeight: '800', color: colors.white },
  form: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginTop: 10,
  },
  formTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, marginTop: 10 },
  hint: { ...type.tiny, marginTop: 8, lineHeight: 16 },
  pickList: { maxHeight: 200 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 11, height: 42, marginBottom: 6, backgroundColor: colors.bg,
  },
  pickRowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pickText: { flex: 1, fontSize: 13, color: colors.ink },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 12, height: 32, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pillText: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft },
  pillTextOn: { color: colors.primary },
  input: {
    height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 14.5, color: colors.ink,
  },
  inputTall: { height: 76, paddingTop: 10, textAlignVertical: 'top' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 62, height: 62 },
  thumb: { width: 62, height: 62, borderRadius: radius.md, backgroundColor: colors.line },
  thumbX: {
    position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  thumbAdd: {
    width: 62, height: 62, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
  },
  addPhotosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: radius.pill, height: 42, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.primaryTint, marginTop: 14,
  },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  saveBtn: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13.5, fontWeight: '800', color: colors.white },
});
