import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import CameraCapture from '../../components/CameraCapture';
import SpinPreviewModal from '../../components/SpinPreviewModal';
import { Alert } from '../../lib/alertShim';
import { colors, radius, type } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { AuctionLotStatus, Listing } from '../../types';
import { listingTitle } from '../../lib/listingText';
import { uploadPhotos, uploadPhotosWithThumbnails } from '../../lib/photoUpload';
import { SPIN_MAX_FRAMES, SPIN_MIN_FRAMES, deleteSpinSet, nextSpinSortOrder, writeSpinSets } from '../../lib/listingMedia';
import {
  BUNNY_MEDIA_HEADERS, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, UploadHandle,
  createVideoUploadTicket, deleteVideo, fetchVideoStatus, isUploadAborted,
  measureVideoSeconds, nudgeVideoStatus, uploadVideoToBunny, videoThumbnailUrl,
} from '../../lib/bunnyVideo';
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

// Quick-pick names for a spin, the admin equivalent of the category-aware
// chips the seller gets. Deliberately generic: a consignment catalogue is
// watches one fortnight and cars the next, so a fixed set that reads
// sensibly for any object beats one keyed to a category the lot may not
// even have yet when the spin is shot.
// '360' is deliberately NOT here: it is already the automatic default, so
// offering it as a chip is a one-tap route to two sets called the same
// thing, on a screen whose only way to tell them apart is that name.
const SPIN_LABEL_SUGGESTIONS = ['Exterior', 'Interior', 'Detail', 'Movement'];

// One picked video, held locally until there is a lot to attach it to.
// Kept as the fields validation needs rather than the whole asset, because
// what comes back from the picker differs by platform and only these three
// are ever read.
type PickedVideo = { uri: string; mimeType: string | null; seconds: number | null };

type ScratchForm = {
  titleEn: string; titleAr: string;
  descriptionEn: string; descriptionAr: string;
  categoryId: string; district: string; condition: string;
  startPrice: string; reserve: string;
  photos: string[];
  // Chosen here, uploaded when Create lot is tapped. The 360 set needs a
  // listing to hang its rows off and the video needs one to attach to, so
  // neither can be written before the lot exists -- but making the admin
  // create the lot and then go and find the pencil to add the two things
  // the auction is actually built around was a worse answer, and it read
  // as the feature simply not being there.
  spinFrames: string[];
  // Whatever the preview asked the admin to call it. Blank falls back to
  // the numbered default, same as the editor's.
  spinLabel: string;
  video: PickedVideo | null;
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
  startPrice: '', reserve: '', photos: [], spinFrames: [], spinLabel: '', video: null,
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
  // The in-app camera, shared by both media surfaces on this screen.
  //
  // CameraCapture is the SAME component the seller's posting flow mounts
  // three different ways -- it takes its frame limits, its instructions and
  // its Done wording as props and works on native and on the web build. It
  // was always reusable; this screen simply was not using it, which is why
  // an admin building a lot could upload from the library but not shoot.
  //
  // Each of these holds WHO the camera is open for: 'new' for the create
  // form, or a lot id for the editor. One instance of each serves every
  // row, the way the wizard's one instance serves every verification
  // prompt.
  const [photoCameraFor, setPhotoCameraFor] = useState<string | null>(null);
  // Who the spin being captured or previewed belongs to, and which of the
  // two is on screen. One target rather than one per modal, because a spin
  // moves camera -> preview -> commit and losing the owner half way is how
  // frames end up on the wrong lot.
  const [spinFor, setSpinFor] = useState<string | null>(null);
  const [spinCameraOpen, setSpinCameraOpen] = useState(false);
  // Whether the frames in hand were SHOT or PICKED. Retake has to go back
  // to the surface they came from: sending a library-picked draft to the
  // camera throws away twenty selected frames and demands twelve fresh
  // ones, with no route back to the selection.
  const [spinFromCamera, setSpinFromCamera] = useState(false);
  const [spinPreviewOpen, setSpinPreviewOpen] = useState(false);
  // Frames just captured or picked, held between the camera closing and
  // the preview being accepted. Nothing is written until Continue.
  const [draftSpin, setDraftSpin] = useState<string[]>([]);
  const [draftSpinLabel, setDraftSpinLabel] = useState('');
  // A video upload's progress, held at screen level rather than inside the
  // editor's render so that closing and reopening the pencil does not
  // orphan an upload that is still running. Shared by BOTH callers: the
  // lot editor reports through these and so does the create form, which
  // owns them as `videoUploadingFor === 'new'`. The upload itself lives in
  // the owned slot below.
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoUploadingFor, setVideoUploadingFor] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  // ONE upload at a time, and it knows whose it is.
  //
  // These were two bare refs, and two callers could reach them: the lot
  // editor, whose upload deliberately survives the editor being closed, and
  // the create form, which becomes reachable again the moment it is. The
  // second caller overwrote the first's handle and guid, so a failure in
  // the first then read the SECOND's guid and deleted a video that was
  // uploading fine -- while its own object was left on Bunny for ever.
  // An owner token makes that unrepresentable: a claim fails if the slot is
  // taken, and only the owner can release it.
  const uploadRef = useRef<{ owner: string; handle: UploadHandle | null; guid: string | null } | null>(null);

  const claimUpload = (owner: string): boolean => {
    if (uploadRef.current) return false;
    uploadRef.current = { owner, handle: null, guid: null };
    return true;
  };
  // Returns the guid this owner still holds, and gives the slot back. Null
  // if somebody else holds it, or if it was already released -- which is
  // exactly what stops a second deleteVideo on the same object.
  const releaseUpload = (owner: string): string | null => {
    if (uploadRef.current?.owner !== owner) return null;
    const guid = uploadRef.current.guid;
    uploadRef.current = null;
    return guid;
  };
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

  // A video stuck on 'processing' for ever is the whole feature failing
  // quietly, and it is one dropped HTTP request away: our row only leaves
  // 'processing' when Bunny's webhook arrives, and Bunny does not document
  // whether it retries a failed delivery. The seller flow does not trust it
  // either -- CreateListingScreen polls the same way. Without this the
  // editor's own hint ("reopening this lot re-reads it") is a lie: re-reading
  // our row returns what it already said, for ever, and the only recovery is
  // to delete the video and upload it again.
  const openVideo = editingLot ? lotListings[editingLot.listingId]?.video ?? null : null;
  useEffect(() => {
    // BOTH non-terminal states, not just 'processing'. The row is created
    // at 'uploading' and only a webhook or a nudge moves it on, and load()
    // routinely wins the race against the nudge fired when the bytes land
    // -- so the status this screen reads straight after an upload is
    // usually 'uploading'. Polling only 'processing' meant the guard for a
    // dropped webhook did not cover the case it was written for, and did
    // it non-deterministically, which is worse than not covering it.
    const pollable = openVideo?.status === 'processing' || openVideo?.status === 'uploading';
    // Not while the bytes are still going up: addLotVideo owns that, and a
    // nudge mid-upload asks Bunny about a video it has not finished
    // receiving.
    if (!pollable || videoUploadingFor === editingLot?.id) return;
    const guid = openVideo!.guid;
    // The status this poll STARTED from, not a hardcoded one. Widening
    // `pollable` to cover 'uploading' without widening this turned the
    // guard into a six-second reload loop: a row sitting at 'uploading' is
    // not 'processing', so every tick called load(), load() changed
    // neither dep, the interval survived, and on a flaky connection each
    // one raised "Could not load lots" through the global alert host --
    // a modal that came back six seconds after being dismissed, in exactly
    // the failure this was written to cover.
    const was = openVideo!.status;
    let cancelled = false;
    const tick = async () => {
      await nudgeVideoStatus(guid);
      const fresh = await fetchVideoStatus(guid);
      if (cancelled || !fresh || fresh.status === was) return;
      // Straight back through the normal read, so the editor and the lot
      // list cannot disagree about what this lot carries.
      load();
    };
    tick();
    const timer = setInterval(tick, 6000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openVideo?.guid, openVideo?.status, videoUploadingFor, editingLot?.id]);

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

  // Leaving the screen mid-upload aborts it rather than letting tus go on
  // sending into a component nobody can see, and then calling setState on
  // it. The half-uploaded video object is deleted from Bunny in the same
  // breath: there is NO orphan sweep in this project -- the only scheduled
  // jobs are the expiry reminders and the removed-listing purge -- so
  // anything left behind here is stored and billed for ever.
  // Now that an abort REJECTS rather than hanging, addLotVideo resumes
  // after this screen is gone and runs its finally -- which reloads, and
  // on failure raises an alert through the global AlertHost, over whatever
  // the admin navigated to. It used to be unreachable only because the
  // promise never settled.
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    const slot = uploadRef.current;
    uploadRef.current = null;
    slot?.handle?.abort();
    if (slot?.guid) deleteVideo(slot.guid).catch(() => {});
  }, []);

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
  // The create form holds its photos locally, so its budget is what is
  // left of the cap; the editor uploads each batch as it is taken, so a
  // full cap each time is right there.
  const photoCameraRemaining =
    photoCameraFor === 'new'
      ? Math.max(1, MAX_LOT_PHOTOS - scratch.photos.length)
      : MAX_LOT_PHOTOS;

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
    setVideoError(null);
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

  // One rule, and both pickers ask it -- the create form's and the
  // editor's. Checked before a byte is sent: neither the web capture
  // attribute nor Android's camera app takes a length limit from us, so
  // this is the only point where a 90-second clip can be refused without
  // first spending minutes of upload on it.
  const videoRejection = (seconds: number | null, fileSize: number | undefined): string | null => {
    if (seconds != null && seconds > MAX_VIDEO_SECONDS + 1) {
      return `That clip is ${Math.round(seconds)}s. The limit is ${MAX_VIDEO_SECONDS}s.`;
    }
    if (typeof fileSize === 'number' && fileSize > MAX_VIDEO_BYTES) {
      return 'That file is too large to upload.';
    }
    return null;
  };

  // Library frames for a spin, for either surface. Both routes -- this and
  // the camera -- end at the same preview, so the admin sees the assembled
  // rotation before it is committed rather than a grid of thumbnails.
  // Returns whether frames were actually produced, so a caller replacing an
  // EXISTING draft can put the preview back when the picker is cancelled --
  // which on the web build is the ordinary outcome of dismissing the file
  // dialog, not an edge case.
  const pickSpinFrames = async (owner: string, keepLabel = ''): Promise<boolean> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo library access to add a 360 set.');
      return false;
    }
    // The web picker REJECTS on a file it cannot read -- pick "All files"
    // in the dialog and choose something the browser types as
    // application/octet-stream and expo-image-picker throws. Caught here
    // rather than at each call site, so every caller gets the same plain
    // false and none of them can leave a half-open interaction behind.
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: SPIN_MAX_FRAMES,
      });
    } catch (e: any) {
      Alert.alert('Those files could not be read', `${e?.message || String(e)}\n\nPick images only.`);
      return false;
    }
    if (result.canceled || result.assets.length === 0) return false;
    // selectionLimit is native-only; the web picker ignores it.
    if (result.assets.length > SPIN_MAX_FRAMES) {
      Alert.alert('Too many frames', `You picked ${result.assets.length}. Only the first ${SPIN_MAX_FRAMES} are kept.`);
    }
    const frames = result.assets.slice(0, SPIN_MAX_FRAMES).map((a) => a.uri);
    // The camera enforces this with minFrames; the library cannot, so the
    // library path is the only one that can still produce a stuttering
    // spin -- and the only one that needs to say so.
    if (frames.length < SPIN_MIN_FRAMES) {
      Alert.alert(
        'That is a short spin',
        `${frames.length} frames will jump rather than turn. Around ${SPIN_MAX_FRAMES} evenly ` +
          `spaced shots is what reads as a rotation, and under ${SPIN_MIN_FRAMES} shows. ` +
          // NOT "adding them anyway": nothing is written here. The frames
          // go to the preview, and only Continue commits them.
          'Keeping them anyway — judge it in the preview before you continue.'
      );
    }
    setSpinFor(owner);
    setSpinFromCamera(false);
    setDraftSpin(frames);
    setDraftSpinLabel(keepLabel);
    setSpinPreviewOpen(true);
    return true;
  };

  const openSpinCamera = (owner: string, keepLabel = '') => {
    setSpinFor(owner);
    setSpinFromCamera(true);
    setDraftSpin([]);
    setDraftSpinLabel(keepLabel);
    setSpinCameraOpen(true);
  };

  const closeSpin = () => {
    setSpinPreviewOpen(false);
    setSpinCameraOpen(false);
    setSpinFor(null);
    setSpinFromCamera(false);
    setDraftSpin([]);
    setDraftSpinLabel('');
  };

  // Photos straight from the camera, for either surface. The create form
  // holds them; the editor uploads them against the lot it was opened for.
  const onPhotosCaptured = (owner: string, uris: string[]) => {
    setPhotoCameraFor(null);
    if (uris.length === 0) return;
    if (owner === 'new') {
      setScratch((f) => ({ ...f, photos: [...f.photos, ...uris].slice(0, MAX_LOT_PHOTOS) }));
      return;
    }
    const lot = lots.find((l) => l.id === owner);
    if (lot) uploadPhotosToLot(lot, uris);
    else Alert.alert('That lot is gone', 'It was removed while you were shooting, so nothing was saved.');
  };

  const pickScratchVideo = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Video', 'Allow access to add a video.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: MAX_VIDEO_SECONDS,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsMultipleSelection: false,
          selectionLimit: 1,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const seconds = await measureVideoSeconds(asset.uri, asset.duration ?? null);
    // Refused at PICK time, not at save time: finding out the clip was too
    // long only after filling in the whole form is the worse order.
    const rejection = videoRejection(seconds, asset.fileSize);
    if (rejection) { Alert.alert('Video', rejection); return; }
    setScratch((f) => ({
      ...f,
      video: { uri: asset.uri, mimeType: asset.mimeType ?? null, seconds },
    }));
  };

  // Where a finished spin goes, whichever surface asked for it and however
  // the frames were obtained. The create form holds them until the lot
  // exists; the editor has a lot already and writes them now.
  const commitSpin = async (owner: string, frames: string[], label: string) => {
    if (frames.length === 0) return;
    if (owner === 'new') {
      setScratch((f) => ({ ...f, spinFrames: frames, spinLabel: label.trim() }));
      return;
    }
    const lot = lots.find((l) => l.id === owner);
    if (!lot) {
      // The list reloads on its own while a video encodes, so a lot removed
      // from another device can disappear while the camera is open. Twenty
      // frames vanishing without a word is the wrong way to find that out.
      Alert.alert('That lot is gone', 'It was removed while you were shooting, so nothing was saved.');
      return;
    }
    setBusy(true);
    try {
      const nextOrder = await nextSpinSortOrder(lot.listingId);
      // The default is derived from the same strictly-increasing number the
      // ORDER comes from, so it never repeats. A typed one can, though --
      // the label field is free text -- and two sets called the same thing
      // are indistinguishable in the list and in the delete confirmation,
      // which is the one place it matters. So a duplicate gets a suffix.
      const taken = new Set((lotListings[lot.listingId]?.spinSets ?? []).map((set) => set.label));
      const wanted = label.trim() || (nextOrder === 0 ? '360' : `360 (${nextOrder + 1})`);
      let unique = wanted;
      for (let n = 2; taken.has(unique); n++) unique = `${wanted} (${n})`;
      const written = await writeSpinSets(
        lot.listingId,
        [{
          id: '',
          label: unique,
          frames,
        }],
        { startSortOrder: nextOrder, strict: true, silent: true }
      );
      if (written[0] && written[0].frames.length < frames.length) {
        Alert.alert(
          'The 360 set is missing frames',
          `${written[0].frames.length} of ${frames.length} uploaded — a spin with gaps in it ` +
            'jumps. Remove the set and add it again.'
        );
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      // The listing behind a CONSIGNED lot can belong to another seller --
      // add_auction_lot takes any listing id -- and RLS refuses media on
      // it. That is not something a retry fixes, so it is named.
      const denied = /row-level security|permission|policy/i.test(e?.message || '');
      Alert.alert(
        'Could not add the 360 set',
        denied
          ? "This lot's item belongs to another seller, so its media cannot be edited here."
          : e?.message || String(e)
      );
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        load();
      }
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
    if (scratch.video && videoUploadingFor) {
      // Refused before a byte is sent rather than half way through: there
      // is one upload slot, and the button below is disabled for the same
      // reason -- this is the guard for the tap that got in first.
      Alert.alert('A video is already uploading', 'Wait for it to finish before creating another lot with one.');
      return;
    }

    setBusy(true);
    // Collected rather than alerted as they happen -- see the single report
    // at the end of this function for why.
    const problems: string[] = [];

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
        // Guarded, like every other alert on a path that can run for
        // minutes: eight photos with three retries each is long enough for
        // the admin to have walked away, and AlertHost is global -- an
        // unguarded alert lands over whatever screen they are on now.
        if (mountedRef.current) {
          Alert.alert(
            'Photos did not upload',
            'Nothing was created — the lot has not been saved. Check the connection and try again.'
          );
        }
        return;
      }
    }

    // 360 frames too, and for the same reason. uploadPhotos hands back CDN
    // urls without needing a listing; writeSpinSets below takes them as
    // already-hosted and re-inserts rather than re-uploading, which is the
    // path the seller's edit flow uses. So the slow part is over before
    // anything is created, and a total failure means no LOT exists -- the
    // stills that did upload are already on storage with nothing pointing
    // at them, which costs a retry rather than a wrong lot.
    let spinUrls: string[] = [];
    if (scratch.spinFrames.length > 0) {
      // silent: uploadPhotos' own alert tells the reader to open the
      // listing and tap Edit. There is no listing yet, and there will never
      // be a screen that opens one at status 'auction'.
      spinUrls = await uploadPhotos(scratch.spinFrames, { silent: true });
      if (spinUrls.length === 0) {
        setBusy(false);
        if (mountedRef.current) {
          Alert.alert(
            'The 360 frames did not upload',
            'The lot has not been created. Check the connection and try again — the photos you ' +
              'already picked will upload again with it.'
          );
        }
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
      // Same guard as the two upload failures above: by the time this can
      // fire, minutes of uploading have happened and the admin may be two
      // screens away.
      if (mountedRef.current) Alert.alert('Could not create lot', adminMessage(e));
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
      if (error) problems.push(`The photos did not attach (${error.message}).`);
      else if (uploaded.length < scratch.photos.length) {
        problems.push(`Only ${uploaded.length} of ${scratch.photos.length} photos uploaded.`);
      }
    }

    // The 360 set, from urls that are already hosted -- writeSpinSets keeps
    // those and uploads nothing, so this is two inserts, not another wait.
    if (spinUrls.length > 0) {
      try {
        await writeSpinSets(
          listingId,
          [{ id: '', label: scratch.spinLabel.trim() || '360', frames: spinUrls }],
          { strict: true }
        );
        if (spinUrls.length < scratch.spinFrames.length) {
          problems.push(
            `Only ${spinUrls.length} of ${scratch.spinFrames.length} 360 frames uploaded — a spin ` +
              'with gaps in it jumps.'
          );
        }
      } catch (e: any) {
        problems.push(`The 360 set was not attached (${e?.message || String(e)}).`);
      }
    }

    // The video LAST, because it is the only step measured in minutes and
    // the only one whose failure leaves something usable behind: by this
    // point the lot exists with its photos and its spin, and the editor can
    // finish the job. Blocking creation on it would be the photo-ordering
    // mistake again, one level up.
    // Not on a dead screen. Nothing between setBusy above and here can be
    // aborted -- photo and spin uploads have no handle -- so this function
    // runs on after the admin backs out, and starting a MINUTES-long video
    // upload at that point escapes the cleanup entirely: it already ran,
    // found an empty slot, and will never run again. The object would be
    // orphaned on Bunny with nothing in the app able to reach it.
    if (scratch.video && !mountedRef.current) {
      // Nothing can be reported from here either, so the guid is the only
      // thing worth caring about -- and there is none yet. The lot exists
      // with its photos and its spin; the editor can finish it.
      return;
    }
    // Checked, not assumed. If the claim ever failed and this ran anyway,
    // the handle and the guid below would be recorded nowhere -- precisely
    // the untracked upload the owned slot exists to prevent.
    if (scratch.video && !claimUpload('new')) {
      problems.push('The video was not uploaded — another upload was already running.');
    } else if (scratch.video) {
      setVideoUploadingFor('new');
      try {
        setVideoProgress(0);
        const ticket = await createVideoUploadTicket({
          title: scratch.titleEn.trim() || 'Vevaty auction lot',
          listingId,
        });
        // The guid is recorded the INSTANT it exists, before a byte is
        // sent. The mountedRef check above is a check-then-act: the object
        // comes into being during this await, so an unmount that lands in
        // between finds an empty slot, aborts nothing, and never runs
        // again -- and without this, the upload would then start on a dead
        // screen with its guid recorded nowhere. Losing the slot means
        // somebody else owns it or the screen is gone; either way this
        // object has to go back rather than be uploaded to.
        if (uploadRef.current?.owner !== 'new') {
          deleteVideo(ticket.videoId).catch(() => {});
          return;
        }
        uploadRef.current.guid = ticket.videoId;
        const { promise, handle } = uploadVideoToBunny(scratch.video.uri, ticket, {
          mimeType: scratch.video.mimeType,
          title: scratch.titleEn.trim() || 'Vevaty auction lot',
          onProgress: (fraction) => setVideoProgress(fraction),
        });
        if (uploadRef.current?.owner === 'new') uploadRef.current.handle = handle;
        await promise;
        releaseUpload('new');
        await nudgeVideoStatus(ticket.videoId);
      } catch (e: any) {
        // Same orphan rule as the editor: nothing sweeps Bunny, so the
        // object this ticket created has to go back if it is not going to
        // be used.
        const guid = releaseUpload('new');
        if (guid) deleteVideo(guid).catch(() => {});
        if (!isUploadAborted(e)) problems.push(`The video did not upload (${e?.message || String(e)}).`);
      } finally {
        if (mountedRef.current) {
          setVideoUploadingFor(null);
          setVideoProgress(0);
        }
      }
    }

    if (!mountedRef.current) return;
    // ONE report, at the end. AlertHost holds a single alert and a new one
    // REPLACES it, so firing these as they happened meant the photo problem
    // was silently overwritten by the 360 problem a fraction of a second
    // later -- and the admin published a lot believing its gallery was
    // complete. Everything that went wrong is said once, together.
    if (problems.length > 0) {
      Alert.alert(
        'Lot created, with problems',
        `${problems.join('\n\n')}\n\nFix what is missing from the lot editor — the pencil on its row.`
      );
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
    setVideoError(null);
    setEditingLot(lot);
    // The media shown here comes from lotListings, which is only refetched
    // by load(). Without this, a video that finished encoding since the
    // screen was opened still reads "processing" no matter how many times
    // the pencil is tapped, which is exactly what the hint tells the admin
    // to do.
    load();
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
    uploadPhotosToLot(lot, result.assets.map((a) => a.uri));
  };

  // The upload half, shared by the library picker above and the camera --
  // the two differ only in where the local uris came from.
  const uploadPhotosToLot = async (lot: AdminLotRow, uris: string[]) => {
    setBusy(true);
    try {
      const uploaded = await uploadPhotosWithThumbnails(uris);
      if (uploaded.length === 0) {
        setBusy(false);
        // Same reason as createFromScratch: the helper's own alert says
        // "the listing was saved without them — open the listing, tap Edit
        // and add them again", and no screen in this app opens a listing at
        // status 'auction'. Say what actually happened instead.
        if (mountedRef.current) {
          Alert.alert('No photos were added', 'None of them uploaded. Check the connection and try again.');
        }
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
      if (mountedRef.current) Alert.alert('Could not add photos', e?.message || String(e));
    } finally {
      // Guarded like commitSpin's: eight photos with three retries each can
      // run for minutes with no abort handle, and load()'s own failure
      // raises an alert through the global host -- over whatever screen the
      // admin walked to in the meantime.
      if (mountedRef.current) {
        setBusy(false);
        load();
      }
    }
  };

  // ------------------------------------------------------------------
  // A lot's 360 spin and its video
  // ------------------------------------------------------------------
  //
  // The create form takes all three of these too. It did not at first, on
  // the reasoning that a video has to attach to a listing that already
  // exists -- true, and beside the point: what it produced was an admin
  // building a lot, looking at the form, and concluding the feature was not
  // there, because the media lived behind a pencil on a row that did not
  // exist yet. The ordering solves the real problem (the video goes last,
  // after the lot is saved), not the placement.
  //
  // These stay, and they are the ONLY way to correct a lot's media: no
  // screen in this app opens a listing at status 'auction'.
  //
  // Both write straight to the tables. RLS allows it on ownership alone --
  // `sellers manage their own listing spin sets` and `... videos` are ALL
  // policies with no status test -- so an item this account owns is
  // editable at status 'auction' exactly as it would be at 'active'. An
  // item consigned from somebody ELSE's listing is not, and the error says
  // so; that is the same boundary update_auction_lot draws around a
  // listing's title.

  const confirmRemoveSpinSet = (setId: string, label: string, frames: number) => {
    Alert.alert(
      `Remove "${label}"?`,
      `Its ${frames} frame${frames === 1 ? '' : 's'} are deleted with it. The lot's ordinary photos are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteSpinSet(setId);
            } catch (e: any) {
              Alert.alert('Could not remove', e?.message || String(e));
            } finally {
              setBusy(false);
              load();
            }
          },
        },
      ]
    );
  };

  // Replacing is a DELETE the admin has not been asked about: passing the
  // listing id to createVideoUploadTicket makes the server drop the
  // existing video from Bunny and from our table before a byte of the new
  // one is sent. If the new upload then fails, or they back out, the old
  // one is simply gone. Removing gets a confirmation; replacing was one
  // tap away and got none, with a hint that framed it as tidiness.
  const startLotVideo = (lot: AdminLotRow, fromCamera: boolean) => {
    if (!lotListings[lot.listingId]?.video) { addLotVideo(lot, fromCamera); return; }
    Alert.alert(
      'Replace the video?',
      'The current one is deleted from Bunny as soon as you pick the new file — before it ' +
        'uploads. If the new upload fails or you leave, the old video does not come back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => addLotVideo(lot, fromCamera) },
      ]
    );
  };

  const addLotVideo = async (lot: AdminLotRow, fromCamera: boolean) => {
    setVideoError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Video', 'Allow access to add a video.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          videoMaxDuration: MAX_VIDEO_SECONDS,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Videos,
          allowsMultipleSelection: false,
          selectionLimit: 1,
        });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    // Checked before a single byte is sent. Neither the web capture
    // attribute nor Android's camera app takes a length limit from us, so
    // refusing here is the only place it can happen that does not first
    // spend minutes of upload.
    const seconds = await measureVideoSeconds(asset.uri, asset.duration ?? null);
    const rejection = videoRejection(seconds, asset.fileSize);
    if (rejection) { setVideoError(rejection); return; }

    const title = lotListings[lot.listingId]
      ? listingTitle(lotListings[lot.listingId], language)
      : `Lot ${lot.lotNumber}`;

    // One upload at a time, screen-wide: the editor's survives the editor
    // closing, which puts the create form back within reach, and two live
    // uploads sharing one slot is how one of them deleted the other's video.
    if (!claimUpload(lot.id)) {
      Alert.alert('A video is already uploading', 'Wait for it to finish before starting another.');
      return;
    }

    try {
      setVideoProgress(0);
      setVideoUploadingFor(lot.id);
      // Passing the listing id is what lets the server delete the video
      // being REPLACED instead of orphaning it on Bunny and billing for it.
      const ticket = await createVideoUploadTicket({ title, listingId: lot.listingId });
      // Recorded before a byte is sent -- see the same three lines in
      // createFromScratch. An unmount landing inside the await above takes
      // the slot and finds no guid to delete, so the object has to be
      // claimed the moment it exists or given straight back.
      if (uploadRef.current?.owner !== lot.id) {
        deleteVideo(ticket.videoId).catch(() => {});
        return;
      }
      uploadRef.current.guid = ticket.videoId;
      const { promise, handle } = uploadVideoToBunny(asset.uri, ticket, {
        mimeType: asset.mimeType ?? null,
        title,
        onProgress: (fraction) => setVideoProgress(fraction),
      });
      if (uploadRef.current?.owner === lot.id) uploadRef.current.handle = handle;
      await promise;
      // Released BEFORE the nudge: the bytes are Bunny's now, so no later
      // failure path may delete this object.
      releaseUpload(lot.id);
      setVideoProgress(1);
      // Bunny having the bytes is not the video being playable. Encoding
      // follows, reported by the webhook -- ask rather than waiting for it.
      // AWAITED, so the row has left 'uploading' before the load() below
      // reads it; un-awaited, the two raced and the reload usually won.
      await nudgeVideoStatus(ticket.videoId);
    } catch (e: any) {
      // Whatever went wrong, the Bunny object this ticket created must not
      // be left behind: nothing sweeps them. releaseUpload hands the guid
      // back to its OWNER and only once, so this and the unmount handler
      // cannot both delete it -- and neither can reach another caller's,
      // which is what the two bare refs used to allow. The swallow is for a
      // delete of an object Bunny never finished creating, which 404s.
      const guid = releaseUpload(lot.id);
      if (guid) deleteVideo(guid).catch(() => {});
      if (!mountedRef.current) return;
      setVideoProgress(0);
      // An abort is this screen's own doing -- leaving the screen, or
      // removing the video. Not a failure to report.
      if (!isUploadAborted(e)) setVideoError(e?.message || String(e));
    } finally {
      if (mountedRef.current) {
        setVideoUploadingFor(null);
        load();
      }
    }
  };

  const confirmRemoveLotVideo = (lot: AdminLotRow, guid: string) => {
    Alert.alert(
      'Remove the video?',
      'It is deleted from Bunny as well as from the lot — not just hidden — so it stops being ' +
        'stored and billed. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            // ONLY if the upload still running belongs to this lot. There
            // is one ref for the whole screen and an upload deliberately
            // survives the editor being closed, so an unconditional abort
            // here killed a different lot's upload -- silently, since an
            // abort is not reported, and invisibly, since clearing
            // videoUploadingFor removed the last trace it had been running.
            if (videoUploadingFor === lot.id) {
              // Defensive: the render shows the uploading row INSTEAD of
              // the trash icon while this lot is uploading, so today there
              // is no way to reach here mid-upload. Kept in the shape that
              // would be correct if that ever changes -- released as the
              // owner rather than nulled by hand, because nulling the ref
              // makes the catch's releaseUpload return null and the
              // half-uploaded object is then never deleted. The handle is
              // read before the release, which clears the slot.
              const handle = uploadRef.current?.owner === lot.id ? uploadRef.current.handle : null;
              const guid = releaseUpload(lot.id);
              handle?.abort();
              if (guid) deleteVideo(guid).catch(() => {});
              setVideoUploadingFor(null);
            }
            setBusy(true);
            setVideoError(null);
            try {
              await deleteVideo(guid);
            } catch (e: any) {
              Alert.alert('Could not remove the video', e?.message || String(e));
            } finally {
              // Only this lot's, or removing lot B's video visibly resets
              // the percentage on lot A's running upload.
              if (videoUploadingFor === lot.id || !videoUploadingFor) setVideoProgress(0);
              setBusy(false);
              load();
            }
          },
        },
      ]
    );
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

      <Text style={styles.fieldLabel}>Media</Text>

      <View style={styles.mediaPair}>
        <Pressy onPress={() => addPhotosToLot(lot)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="plus" size={15} color={colors.primary} />
          <Text style={styles.altText}>Add photos ({lotListings[lot.listingId]?.photos?.length ?? 0})</Text>
        </Pressy>
        <Pressy onPress={() => setPhotoCameraFor(lot.id)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="camera" size={15} color={colors.primary} />
          <Text style={styles.altText}>Take photos</Text>
        </Pressy>
      </View>

      {/* 360 spins. Each set is its own row because a lot can carry more
          than one -- the watch and its movement, the car and its cabin. */}
      {(lotListings[lot.listingId]?.spinSets ?? []).map((set) => (
        <View key={set.id} style={styles.mediaRow}>
          <Icon name="rotate" size={15} color={colors.inkSoft} />
          <Text style={styles.mediaText} numberOfLines={1}>
            {set.label} · {set.frames.length} frame{set.frames.length === 1 ? '' : 's'}
          </Text>
          <Pressy
            onPress={() => confirmRemoveSpinSet(set.id, set.label, set.frames.length)}
            style={styles.iconAction}
            disabled={busy}
          >
            <Icon name="trash" size={14} color={colors.danger} />
          </Pressy>
        </View>
      ))}

      <View style={styles.mediaPair}>
        <Pressy onPress={() => pickSpinFrames(lot.id)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="plus" size={15} color={colors.primary} />
          <Text style={styles.altText}>Add 360</Text>
        </Pressy>
        <Pressy onPress={() => openSpinCamera(lot.id)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="camera" size={15} color={colors.primary} />
          <Text style={styles.altText}>Capture</Text>
        </Pressy>
      </View>
      <Text style={styles.hint}>
        Pick frames in order, or shoot them here — the guided camera counts you round the item.
        Up to {SPIN_MAX_FRAMES}; around {SPIN_MAX_FRAMES} evenly spaced shots reads as a rotation,
        fewer than about {SPIN_MIN_FRAMES} jumps. Either way you see the spin before it is saved.
      </Text>

      {/* Video. One per lot, and the status matters: buyers see it only
          once Bunny has finished encoding and the webhook says 'ready'. */}
      {videoUploadingFor === lot.id ? (
        <View style={styles.mediaRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.mediaText}>Uploading video · {Math.round(videoProgress * 100)}%</Text>
        </View>
      ) : lotListings[lot.listingId]?.video ? (
        <View style={styles.mediaRow}>
          {lotListings[lot.listingId]!.video!.status === 'ready' ? (
            <Image
              // headers, not just the url: Bunny's CDN checks the referer
              // and every request 403s without it (see VideoPlayer).
              source={{ uri: videoThumbnailUrl(lotListings[lot.listingId]!.video!.guid), headers: BUNNY_MEDIA_HEADERS }}
              style={styles.videoThumb}
            />
          ) : (
            <Icon name="camera" size={15} color={colors.inkSoft} />
          )}
          <Text style={styles.mediaText} numberOfLines={1}>
            {lotListings[lot.listingId]!.video!.status === 'ready'
              ? 'Video ready'
              : lotListings[lot.listingId]!.video!.status === 'failed'
                // Nothing is working on a failed encode -- the poll
                // deliberately does not cover it -- so waiting for "ready"
                // is waiting for something that will never come.
                ? 'Video encoding failed — remove it and upload again'
                : `Video ${lotListings[lot.listingId]!.video!.status} — buyers see it once it is ready`}
          </Text>
          <Pressy
            onPress={() => confirmRemoveLotVideo(lot, lotListings[lot.listingId]!.video!.guid)}
            style={styles.iconAction}
            disabled={busy}
          >
            <Icon name="trash" size={14} color={colors.danger} />
          </Pressy>
        </View>
      ) : null}

      <View style={styles.mediaPair}>
        <Pressy onPress={() => startLotVideo(lot, false)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy || !!videoUploadingFor}>
          <Icon name="plus" size={15} color={colors.primary} />
          <Text style={styles.altText}>
            {lotListings[lot.listingId]?.video ? 'Replace video' : 'Add video'}
          </Text>
        </Pressy>
        <Pressy onPress={() => startLotVideo(lot, true)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy || !!videoUploadingFor}>
          <Icon name="camera" size={15} color={colors.primary} />
          <Text style={styles.altText}>Record</Text>
        </Pressy>
      </View>
      <Text style={styles.hint}>
        {MAX_VIDEO_SECONDS} seconds at most. Replacing one deletes the old file from Bunny rather
        than leaving it stored and billed. Encoding takes a minute or two after the upload
        finishes — this checks for it while the lot is open.
      </Text>
      {!!videoError && <Text style={styles.errorText}>{videoError}</Text>}

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
          <>
            <Pressy onPress={pickPhotos} style={styles.thumbAdd}>
              <Icon name="plus" size={16} color={colors.inkSoft} />
            </Pressy>
            <Pressy onPress={() => setPhotoCameraFor('new')} style={styles.thumbAdd}>
              <Icon name="camera" size={16} color={colors.inkSoft} />
            </Pressy>
          </>
        )}
      </View>
      <Text style={styles.hint}>The first photo is the lot's cover.</Text>

      <Text style={styles.fieldLabel}>360 spin</Text>
      {scratch.spinFrames.length > 0 ? (
        <View style={styles.mediaRow}>
          <Icon name="rotate" size={15} color={colors.inkSoft} />
          <Text style={styles.mediaText} numberOfLines={1}>
            {scratch.spinLabel || '360'} · {scratch.spinFrames.length} frame
            {scratch.spinFrames.length === 1 ? '' : 's'} ready
            {scratch.spinFrames.length < SPIN_MIN_FRAMES ? ' — short, it will jump' : ''}
          </Text>
          <Pressy onPress={() => setScratch((f) => ({ ...f, spinFrames: [], spinLabel: '' }))} style={styles.iconAction} disabled={busy}>
            <Icon name="close" size={14} color={colors.danger} />
          </Pressy>
        </View>
      ) : null}
      <View style={styles.mediaPair}>
        {/* The held spin's name is carried into a re-pick or a re-shoot.
            These replace the same draft Retake does, and dropping the label
            there silently reverted a spin the admin had named. */}
        <Pressy onPress={() => pickSpinFrames('new', scratch.spinLabel)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="plus" size={15} color={colors.primary} />
          <Text style={styles.altText}>
            {scratch.spinFrames.length > 0 ? 'Pick again' : 'Pick frames'}
          </Text>
        </Pressy>
        <Pressy onPress={() => openSpinCamera('new', scratch.spinLabel)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="camera" size={15} color={colors.primary} />
          <Text style={styles.altText}>Capture</Text>
        </Pressy>
      </View>
      <Text style={styles.hint}>
        Pick frames in order, or shoot them here — the guided camera counts you round the item.
        Up to {SPIN_MAX_FRAMES}; around {SPIN_MAX_FRAMES} evenly spaced shots of the item on a
        turntable reads as a rotation. You see the spin turning before it is kept.
      </Text>

      <Text style={styles.fieldLabel}>Video</Text>
      {scratch.video ? (
        <View style={styles.mediaRow}>
          <Icon name="camera" size={15} color={colors.inkSoft} />
          <Text style={styles.mediaText} numberOfLines={1}>
            Ready to upload{scratch.video.seconds != null ? ` · ${Math.round(scratch.video.seconds)}s` : ''}
          </Text>
          <Pressy onPress={() => setScratch((f) => ({ ...f, video: null }))} style={styles.iconAction} disabled={busy}>
            <Icon name="close" size={14} color={colors.danger} />
          </Pressy>
        </View>
      ) : null}
      <View style={styles.mediaPair}>
        <Pressy onPress={() => pickScratchVideo(false)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="plus" size={15} color={colors.primary} />
          <Text style={styles.altText}>{scratch.video ? 'Pick another' : 'Pick a video'}</Text>
        </Pressy>
        <Pressy onPress={() => pickScratchVideo(true)} style={[styles.mediaBtn, styles.mediaBtnHalf]} disabled={busy}>
          <Icon name="camera" size={15} color={colors.primary} />
          <Text style={styles.altText}>Record</Text>
        </Pressy>
      </View>
      <Text style={styles.hint}>
        {MAX_VIDEO_SECONDS} seconds at most. Nothing is uploaded until you tap Create lot, and the
        video goes last — if it fails, the lot and everything else is still saved and you can add
        it from the lot editor.
      </Text>

      <Text style={styles.fieldLabel}>Start price (USD)</Text>
      <TextInput value={scratch.startPrice} onChangeText={(v) => setScratch((f) => ({ ...f, startPrice: v }))} keyboardType="numeric" style={styles.input} placeholder="500" placeholderTextColor={colors.inkSoft} />
      <Text style={styles.fieldLabel}>Reserve (optional, never shown to bidders)</Text>
      <TextInput value={scratch.reserve} onChangeText={(v) => setScratch((f) => ({ ...f, reserve: v }))} keyboardType="numeric" style={styles.input} placeholder="1200" placeholderTextColor={colors.inkSoft} />

      <View style={styles.formActions}>
        <Pressy onPress={closeForm} style={styles.cancelBtn} disabled={busy}><Text style={styles.cancelText}>Cancel</Text></Pressy>
        <Pressy
          onPress={createFromScratch}
          style={styles.saveBtn}
          disabled={busy || (!!scratch.video && !!videoUploadingFor && videoUploadingFor !== 'new')}
        >
          <Text style={styles.saveText}>
            {videoUploadingFor === 'new'
              ? `Video ${Math.round(videoProgress * 100)}%`
              : busy
                ? 'Saving…'
                : // A greyed-out button with no reason on screen is worse
                  // than the wait: an upload started from the lot editor
                  // survives that editor closing, and its progress row is
                  // not visible from here.
                  scratch.video && videoUploadingFor
                  ? 'Waiting for the other upload…'
                  : 'Create lot'}
          </Text>
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

      {/* The seller flow's camera, unchanged, mounted twice for this
          screen's two jobs. One instance each serves every lot AND the
          create form -- which is why both carry an owner rather than a
          boolean. */}
      <CameraCapture
        visible={photoCameraFor !== null}
        minFrames={1}
        // What the form can still KEEP, not the flat cap. The create form
        // appends then clamps, so a camera allowed to hand back eight when
        // seven are already held drops the seven it just took -- after
        // telling the admin it would use them. The seller flow passes its
        // own remaining count for exactly this reason.
        maxFrames={photoCameraRemaining}
        instructions="Photograph the lot from every angle a bidder would ask about."
        progressHint={(count) =>
          count === 0
            ? `Room for ${photoCameraRemaining} more`
            : `${count} taken · ${photoCameraRemaining - count} left`
        }
        finishLabel={(count) => (count === 1 ? 'Use 1 photo' : `Use ${count} photos`)}
        onFinish={(uris) => {
          const owner = photoCameraFor;
          if (owner) onPhotosCaptured(owner, uris);
          else setPhotoCameraFor(null);
        }}
        onCancel={() => setPhotoCameraFor(null)}
        onFallbackToLibrary={() => {
          const owner = photoCameraFor;
          setPhotoCameraFor(null);
          if (owner === 'new') pickPhotos();
          else {
            const lot = lots.find((l) => l.id === owner);
            if (lot) addPhotosToLot(lot);
          }
        }}
      />

      <CameraCapture
        visible={spinCameraOpen}
        minFrames={SPIN_MIN_FRAMES}
        maxFrames={SPIN_MAX_FRAMES}
        onFinish={(frames) => {
          setSpinCameraOpen(false);
          if (frames.length === 0) { closeSpin(); return; }
          setDraftSpin(frames);
          setSpinPreviewOpen(true);
        }}
        onCancel={closeSpin}
        onFallbackToLibrary={() => {
          const owner = spinFor;
          setSpinCameraOpen(false);
          // With the label, like every other route into the picker: the
          // camera was opened carrying it, and dropping it here reverted a
          // named spin to the default without saying so.
          if (owner) pickSpinFrames(owner, draftSpinLabel);
          else closeSpin();
        }}
      />

      {/* The same preview the seller gets: the assembled rotation, drag to
          turn, before anything is written. A spin is the one kind of media
          you cannot judge from thumbnails -- a frame out of order or one
          bad exposure only shows up in motion. */}
      <SpinPreviewModal
        visible={spinPreviewOpen}
        frames={draftSpin}
        label={draftSpinLabel}
        onChangeLabel={setDraftSpinLabel}
        labelSuggestions={SPIN_LABEL_SUGGESTIONS}
        onRetake={() => {
          setSpinPreviewOpen(false);
          if (spinFromCamera) {
            setDraftSpin([]);
            setSpinCameraOpen(true);
            return;
          }
          // Picked, not shot: back to the library, carrying the label they
          // typed. The frames stay in state, and if the picker is
          // cancelled -- on the web build, simply dismissing the file
          // dialog -- the preview comes back rather than leaving the
          // selection stranded behind a closed modal with no way to reach
          // it. Same shape the seller's spin step uses.
          const owner = spinFor;
          if (!owner) { closeSpin(); return; }
          pickSpinFrames(owner, draftSpinLabel)
            .catch(() => false)
            .then((got) => {
              if (!got && mountedRef.current) setSpinPreviewOpen(true);
            });
        }}
        onContinue={() => {
          const owner = spinFor;
          const frames = draftSpin;
          const label = draftSpinLabel;
          closeSpin();
          if (owner) commitSpin(owner, frames, label);
        }}
        onClose={closeSpin}
      />
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
  mediaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderRadius: radius.pill, height: 42, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.primaryTint, marginTop: 8,
  },
  mediaBtnHalf: { flex: 1 },
  mediaPair: { flexDirection: 'row', gap: 8 },
  mediaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 11, minHeight: 44, backgroundColor: colors.bg,
  },
  mediaText: { flex: 1, fontSize: 13, color: colors.ink },
  videoThumb: { width: 34, height: 22, borderRadius: 3, backgroundColor: colors.line },
  errorText: { ...type.tiny, color: colors.danger, marginTop: 8, lineHeight: 16 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, height: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  saveBtn: { flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontSize: 13.5, fontWeight: '800', color: colors.white },
});
