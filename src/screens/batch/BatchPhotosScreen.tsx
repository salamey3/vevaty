import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
import { listingActionMessage } from '../../lib/listingActionMessage';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import CameraCapture from '../../components/CameraCapture';
import { colors, radius, type } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useSettings } from '../../store/SettingsStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { useBatchClassify } from '../../store/BatchClassifyContext';
import { RootStackParamList } from '../../navigation/types';
import { buildDomainCandidates } from '../../lib/domainCandidates';
import { useShopFallbackCategory } from '../../hooks/useShopFallbackCategory';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchPhotos'>;

// Same cap as the single-item wizard's own Photos step (PHOTOS_MIN_FOR_AI/
// PHOTOS_MAX in CreateListingScreen.tsx) -- kept as separate local
// constants rather than importing them, since those two are module-private
// to that file and this screen otherwise shares nothing else with it (see
// the batch-listings plan's extraction table for what actually is shared).
const ITEM_PHOTOS_MIN_FOR_AI = 3;
const ITEM_PHOTOS_MAX = 6;
const BATCH_MAX_ITEMS = 10;

// "Item N of 10" photo-capture loop -- the first screen of the batch
// flow. Each item becomes a real draft listing row (tagged with this
// batch's id) the moment its photo count crosses the AI threshold, and
// that item's background category classification starts right then, so
// the seller can move straight on to the next item without waiting (see
// the plan's "Why batch items don't need a new backend path" section).
//
// The batch row itself is created HERE too, on that same first crossing,
// and not before -- see ensureBatch.
export default function BatchPhotosScreen({ navigation, route }: Props) {
  const { shopChoice, domain: domainId } = route.params;
  const { addListing, updateListing, createBatch, myShop } = useAppStore();
  const { allCategories, childrenOf, categoryById, allDomains, domainOfCategory } = useSettings();
  const { t, language } = useLanguage();
  // Classification starts HERE, the moment an item crosses the photo
  // threshold -- not on the review screen -- so this is the list that has
  // to be domain-constrained for the batch flow to honour the gate at all.
  //
  // Sentinels are KEPT, though a batch is one domain by construction and
  // there is no per-row switch to offer. They are not here to offer one:
  // without them the model has no way to say "this belongs somewhere
  // else", so a stray item in an otherwise uniform batch comes back as
  // the least-bad answer from inside the domain, or as a bare "cannot
  // tell" indistinguishable from a blurry photo of exactly the right
  // thing. That distinction is what keeps the storefront fallback off the
  // one row it would be confidently wrong about -- see
  // BatchClassifyContext.
  // Resolved before the runner below is built, since it is one of its
  // inputs. Same hook the single-item wizard uses: a merchant who
  // photographs the same item through either flow must not be given two
  // different answers.
  const shopFallbackCategory = useShopFallbackCategory(!!shopChoice?.attachToShop, domainId ?? null);

  const { classifyItem } = useBatchClassify(
    useMemo(
      () =>
        buildDomainCandidates(
          domainId ?? null,
          allCategories.filter((c) => c.active && childrenOf(c.id).length === 0),
          allDomains,
          categoryById,
          domainOfCategory,
          language
        ),
      [domainId, allCategories, childrenOf, allDomains, categoryById, domainOfCategory, language]
    ),
    language,
    t('createListing.classifyPhotoReadFailed'),
    shopFallbackCategory?.id ?? null
  );

  const shopId = shopChoice?.attachToShop && myShop?.verifiedAt ? myShop.id : null;

  // The batch row, created on demand rather than on the way in. It used
  // to be made the moment "Sell a bunch of items" was tapped, which left
  // an empty in_progress row behind for every seller who opened the flow
  // and changed their mind, pressed back, or closed the app -- and no
  // amount of cleanup on the way out could catch the last of those.
  // Nothing exists now until there is a first item to put in it.
  //
  // Held in a ref as well as state: the ref is what the photo-sync path
  // reads (it must see the id the instant it is known, not on the next
  // render), the state is what the render reads, and the in-flight promise
  // is shared so two photos landing together cannot create two batches.
  const batchIdRef = useRef<string | null>(null);
  const creatingBatchRef = useRef<Promise<string> | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const ensureBatch = useCallback((): Promise<string> => {
    if (batchIdRef.current) return Promise.resolve(batchIdRef.current);
    if (!creatingBatchRef.current) {
      creatingBatchRef.current = createBatch(domainId ?? null)
        .then((batch) => {
          batchIdRef.current = batch.id;
          setBatchId(batch.id);
          return batch.id;
        })
        .catch((e) => {
          // Cleared so a later photo tries again rather than being stuck
          // behind one failed request for the rest of the session.
          creatingBatchRef.current = null;
          throw e;
        });
    }
    return creatingBatchRef.current;
  }, [createBatch, domainId]);

  const [committedCount, setCommittedCount] = useState(0);
  const [currentPhotos, setCurrentPhotos] = useState<string[]>([]);
  const photosRef = useRef<string[]>([]);
  // Set when committing this item failed -- either the batch could not be
  // created or the item's own row was refused. Both leave the screen with
  // photos on it and nothing behind them, and every control that moves the
  // flow forward is gated on having a row, so without this there is
  // nothing on screen that offers to try again.
  const [commitError, setCommitError] = useState<string | null>(null);
  const [currentListingId, setCurrentListingId] = useState<string | null>(null);
  // The same value as a ref, because the photo sync below settles after a
  // network round trip and has to know whether the item it belongs to is
  // still the one on screen. State read in a closure would be whatever it
  // was when the sync started, which is exactly the wrong answer.
  const currentListingIdRef = useRef<string | null>(null);
  const [committing, setCommitting] = useState(false);
  // How many photo syncs are in flight for the item on screen. Leaving
  // the item while one is running is what let a failure land on the next
  // item's blank screen, so Next item and Finish early both wait for it
  // -- it is one small write, not a build. The back arrow does not wait;
  // it disowns the item instead (see the unmount cleanup below).
  const [syncing, setSyncing] = useState(0);
  const [photoCameraVisible, setPhotoCameraVisible] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const itemNumber = committedCount + 1;
  const hasEnoughForAi = currentPhotos.length >= ITEM_PHOTOS_MIN_FOR_AI;
  const photosRemaining = Math.max(0, ITEM_PHOTOS_MAX - currentPhotos.length);

  // Everything ListingInput requires beyond photos/batchId, held at the
  // same "blank until a later step fills it in" placeholders the draft
  // lifecycle already treats as normal (see ListingInput's own doc
  // comments in AppStore.tsx) -- cat/condition are still unknown at this
  // point (classification hasn't resolved yet, and won't for a few
  // seconds), so this intentionally posts an empty-category draft row.
  // That's a new case for this codebase (the single-item wizard's own
  // draft-save never lets a category-less row reach the database -- see
  // saveAsDraftAndExit's `if (!category) return true` guard), but every
  // read site that renders a listing card already treats an unresolved
  // category defensively (categoryById returning undefined, `cat?.icon`
  // optional-chained) -- see ListingCard.tsx -- so this is safe, and the
  // window is short: BatchReviewScreen fills in the real category within
  // moments of this row's own classify call resolving.
  const draftPayload = (photos: string[], batch: string | null) => ({
    cat: '',
    condition: null,
    titleEn: '',
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    price: 0,
    // Rent terms are a Properties-only concern filled in later, on
    // BatchDetailsScreen, once this row actually has a category and a
    // sale/rent pick -- same "placeholder until the real screen fills it"
    // story as cat/price above.
    rentPrice: null,
    rentPeriod: null,
    rentPaymentFrequency: null,
    district: 'Lebanon',
    governorate: null,
    caza: null,
    geonameId: null,
    lat: null,
    lng: null,
    photos,
    spinSets: [],
    video: null,
    aiGenerated: false,
    attributes: {},
    contactMethod: 'both' as const,
    shopId,
    stockQty: 1,
    variants: null,
    batchId: batch,
    status: 'draft' as const,
  });

  // Committing this item: create the batch if it does not exist yet, then
  // the item's own draft row. The batch is created here and only here, so
  // the first photo of the first item is what brings a batch into
  // existence at all.
  //
  // Not folded into setPhotosAndSync below, because it also has to be
  // callable on its own: if this fails there is no row, and every control
  // that could try again is disabled by the absence of one.
  // Both failures say the same thing in two places: an alert, which is
  // seen once, and a line that stays on screen with the way back.
  const fail = (title: string, message: string) => {
    setCommitError(message);
    Alert.alert(title, message);
  };

  // Keeping an already-created row's photo list level with what is on
  // screen. Both callers used to end in `.catch(() => {})`, which was
  // survivable only because updateListing never rejected -- it warned and
  // returned as though it had saved. Now that it throws, silence here
  // would be the expensive kind: the row keeps the photo list it was
  // created with, the seller sees the one they actually took, and the
  // difference only surfaces after the whole batch is posted.
  //
  // quietMedia: this fires once per photo tap on the same item, and this
  // screen already has a better place to say so than an alert -- the
  // shared commitError box, with a Try again beside it. A media failure
  // no longer rejects (the listings row saved; only the photos did not),
  // so it is read off the result instead.
  const syncPhotos = (listingId: string, photos: string[]) => {
    setSyncing((n) => n + 1);
    // The uploads outlive the save, so the busy counter has to as well.
    //
    // updateListing resolves as soon as the listings row is written; the
    // photos are still going up behind it. Dropping `syncing` there let
    // the seller tap Next within a second of their last shot, at which
    // point currentListingIdRef moves on and the late result is thrown
    // away by the guard below -- so a failed upload on the last photo of
    // an item was reported to nobody and the item went to Final Review
    // short a picture. Counting the deferred work keeps Next disabled
    // until there is an answer to give.
    // Swapping the local file:// URIs for the hosted URLs they became.
    //
    // This screen used to hold every photo as a local URI for ever, so
    // each tap re-sent the WHOLE item: a six-photo item cost 3+4+5+6 = 18
    // uploads, doubled again by thumbnails, against a server-side cap of
    // 150 a day. A seller doing seven items in one sitting ran out --
    // and a 429 is not worth retrying, so the batch reported "tap Post
    // again to retry" about a refusal that would be identical for
    // twenty-four hours. Adopting what landed makes the next tap upload
    // only what is actually new.
    //
    // Only while this item is still the one on screen, and only when the
    // count matches what we have -- a stale answer for an item the seller
    // has moved past, or one that raced a photo they added in between,
    // must not overwrite the list they are looking at.
    const adoptHosted = (hosted: string[]) => {
      if (currentListingIdRef.current !== listingId) return;
      if (hosted.length === 0 || hosted.length !== photosRef.current.length) return;
      photosRef.current = hosted;
      setCurrentPhotos(hosted);
    };

    let lateSettled = false;
    // Whether the deferred upload has already put something in the error
    // box. Without it, the `.then` below cleared the box unconditionally
    // on the deferred path -- and nothing orders the two: a fast failure
    // (an expired session, a 4xx that isWorthRetrying declines to retry)
    // rejects in milliseconds, while updateListing still has the video
    // read to finish. So the box the seller needed, with its Try again,
    // was wiped a moment after it appeared.
    let lateReported = false;
    const settleLate = () => {
      if (lateSettled) return;
      lateSettled = true;
      setSyncing((n) => n - 1);
    };
    setSyncing((n) => n + 1);
    return updateListing(listingId, draftPayload(photos, batchIdRef.current), {
      quietMedia: true,
      // NOT waitMedia. This fires once per photo tap and re-sends every
      // photo of the item each time, so waiting inside the store would
      // hold the save itself open through a full sequential re-upload.
      // The outcome arrives here instead.
      onLateMedia: (r) => {
        settleLate();
        if (currentListingIdRef.current !== listingId) {
          if (r.mediaFailed || r.photosMissing > 0) {
            console.warn('[BatchPhotos] photos did not land for an item already left behind:', listingId);
          }
          return;
        }
        if (r.mediaFailed) {
          lateReported = true;
          fail(t('batchPhotos.syncErrorTitle'), t('batchPhotos.syncErrorBody'));
        } else if (r.photosMissing > 0) {
          lateReported = true;
          // Suppressed inside the store by quietMedia, and this screen
          // would otherwise say nothing at all: the seller sees five
          // thumbnails (their own local files), three of which no buyer
          // will ever see, and carries the item to Final Review.
          fail(
            t('media.somePhotosMissingTitle'),
            t('media.somePhotosMissingBody', { count: r.photosMissing })
          );
        } else {
          adoptHosted(r.photos);
        }
      },
    })
      // Both arms check they still own the screen first. commitError is a
      // single box shared by every item, so a sync that settles after the
      // seller has moved on would otherwise either put an error on an
      // item it has nothing to do with -- pointing at a Try again that
      // can do nothing about it -- or, resolving late, wipe a live error
      // belonging to the item now in front of them and leave that item
      // with photos, no row, and no way forward.
      .then((result) => {
        // Nothing was deferred, so onLateMedia will never fire and
        // nothing else would ever release the second count.
        if (!result?.mediaDeferred) {
          settleLate();
          if (!result?.mediaFailed) adoptHosted(result?.photos ?? []);
          // And nothing else would report it either. This branch is
          // reachable when the seller removes their LAST photo -- every
          // other state on this screen leaves local URIs in the list, so
          // the work defers and onLateMedia carries the answer. A refused
          // delete there means the photo they removed is still on the
          // item, silently.
          if (result?.mediaFailed && currentListingIdRef.current === listingId) {
            fail(t('batchPhotos.syncErrorTitle'), t('batchPhotos.syncErrorBody'));
            return;
          }
        }
        // Clearing on success matters as much as setting on failure: the
        // box tells the seller to tap Try again before moving on, so one
        // left standing after the next photo already went through sends
        // them to press a button that has nothing to retry. When the
        // uploads WERE deferred the media outcome is not known yet -- it
        // arrives through onLateMedia above, which sets the box if there
        // is something to put in it.
        if (currentListingIdRef.current === listingId && !lateReported) setCommitError(null);
      })
      .catch((e: any) => {
        // The save itself was refused, so there is no deferred upload to
        // wait for.
        settleLate();
        if (currentListingIdRef.current !== listingId) {
          console.warn('[BatchPhotos] photo sync failed for an item already left behind:', listingId, e?.message);
          return;
        }
        fail(t('batchPhotos.syncErrorTitle'), listingActionMessage(e, t, 'batchPhotos.syncErrorBody'));
      })
      .finally(() => setSyncing((n) => n - 1));
  };

  const commitItem = (photos: string[]) => {
    if (committing || photos.length < ITEM_PHOTOS_MIN_FOR_AI) return;
    setCommitting(true);
    setCommitError(null);
    (async () => {
      let batch: string;
      try {
        batch = await ensureBatch();
      } catch (e: any) {
        // The reason, not just the shape of the failure: createBatch says
        // "you need to be logged in" for a session that has quietly gone
        // anonymous, and a seller told only "something went wrong" will
        // retry that forever.
        fail(t('sellHub.startBatchErrorTitle'), e?.message || t('sellHub.startBatchErrorBody'));
        return;
      }
      const listing = await addListing(draftPayload(photos, batch));
      setCurrentListingId(listing.id);
      currentListingIdRef.current = listing.id;
      // Photos taken WHILE this was in flight are on screen but were not
      // in the row this just created -- and now that there is a row, the
      // sync path below can only pick up the next change, not the ones
      // already missed. Two round trips run before that row exists on the
      // first item of a batch, which is long enough to take another
      // picture in, so the row is reconciled against what is on screen
      // now rather than against what was on screen when it started.
      const latest = photosRef.current;
      if (latest.length !== photos.length) {
        syncPhotos(listing.id, latest);
      }
      classifyItem(listing.id, latest.length >= ITEM_PHOTOS_MIN_FOR_AI ? latest : photos);
    })()
      .catch((e: any) => {
        // addListing throws now where it used to hand back a row that
        // existed nowhere. Reaching here leaves no listing, so the same
        // "try again" line the batch-creation failure puts on screen is
        // needed: Next item and Finish are both gated on having a row, so
        // otherwise the only way out is to add or delete a photo and hope.
        fail(t('batchPhotos.commitErrorTitle'), listingActionMessage(e, t, 'batchPhotos.commitErrorBody'));
      })
      .finally(() => setCommitting(false));
  };

  const setPhotosAndSync = (updater: (prev: string[]) => string[]) => {
    setCurrentPhotos((prev) => {
      const next = updater(prev);
      // Read by commitItem above while its own writes are in flight, so it
      // has to be the live value rather than the one this render closed
      // over.
      photosRef.current = next;
      if (currentListingId) {
        // Already a real row -- keep it in sync with whatever's on screen
        // right now, whichever direction the count moved (add or remove).
        syncPhotos(currentListingId, next);
      } else {
        commitItem(next);
      }
      return next;
    });
  };

  const removePhoto = (uri: string) => setPhotosAndSync((prev) => prev.filter((p) => p !== uri));

  const pickFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.7,
      selectionLimit: photosRemaining,
    });
    if (!result.canceled) {
      setPhotosAndSync((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, ITEM_PHOTOS_MAX));
    }
  };

  const openCamera = () => {
    if (photosRemaining <= 0) {
      Alert.alert(t('createListing.photoLimitTitle'), t('createListing.photoLimitMessage', { max: ITEM_PHOTOS_MAX }));
      return;
    }
    setPhotoCameraVisible(true);
  };

  const goToReview = () => {
    // Unreachable without a batch: every path here requires at least one
    // captured item, and an item cannot exist before the row that holds
    // it. Guarded anyway rather than asserted -- this navigates.
    if (!batchId) return;
    // Disown the item before leaving. This replaces the screen, so a
    // photo sync still in flight would otherwise settle with the ref
    // still naming an item nobody is looking at, pass the ownership
    // check, and put "tap Try again before moving on" on top of the
    // review screen -- which has no Try again, and no way back to the
    // item, since replace() dropped this screen from the stack.
    currentListingIdRef.current = null;
    navigation.replace('BatchReview', { batchId, domain: route.params.domain, shopChoice });
  };

  // The back arrow, and any other teardown: whatever is in flight stops
  // speaking for a screen that is gone. Its failure is still recorded in
  // the console, which is the only place it can usefully go once there is
  // nothing on screen to attach it to.
  useEffect(
    () => () => {
      currentListingIdRef.current = null;
    },
    []
  );

  const advanceToNextItem = () => {
    if (!currentListingId || advancing || syncing > 0) return;
    const nextCount = committedCount + 1;
    if (nextCount >= BATCH_MAX_ITEMS) {
      goToReview();
      return;
    }
    setAdvancing(true);
    setCommittedCount(nextCount);
    setCurrentPhotos([]);
    // Both of these belong to the item being left behind. photosRef is
    // what the error box's Try again hands to commitItem, and
    // currentListingId is what decides which branch that takes -- so a
    // box left standing here would have offered to "retry" the previous
    // item's photos as a BRAND NEW listing under the next item.
    photosRef.current = [];
    setCommitError(null);
    setCurrentListingId(null);
    currentListingIdRef.current = null;
    setAdvancing(false);
  };

  const finishEarly = () => {
    // Same wait as Next item: leaving mid-sync is how a photo goes
    // missing quietly, and this exit is the one that cannot be walked
    // back.
    if (syncing > 0) return;
    const totalSoFar = currentListingId ? committedCount + 1 : committedCount;
    if (totalSoFar === 0) return;
    Alert.alert(t('batchPhotos.finishEarlyConfirmTitle'), t('batchPhotos.finishEarlyConfirmBody', { count: totalSoFar }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('batchPhotos.finishEarlyConfirmBtn'), onPress: goToReview },
    ]);
  };

  const canShowFinishEarly = committedCount > 0 || !!currentListingId;

  // Which domain this whole batch is being posted into, and the way out.
  // Shown only while there is nothing at all to lose -- no committed items
  // AND no photos taken for the current one. The domain is written on the
  // batch row and constrains every item's classification, so it stops
  // being a changeable answer the moment there is an item to be
  // inconsistent with; and unlike the single-item wizard this screen has
  // no unsaved-changes guard, so an "are you sure?" is not there to catch
  // photos this would throw away. It matters most for a storefront, which
  // skipped the gate entirely and would otherwise never see what it had
  // been given.
  const batchDomain = domainId ? allDomains.find((d) => d.id === domainId) : undefined;

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('batchPhotos.itemProgress', { n: itemNumber, max: BATCH_MAX_ITEMS })}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.body}>
        {!!batchDomain && !canShowFinishEarly && currentPhotos.length === 0 && (
          <View style={styles.domainNotice}>
            <Text style={styles.domainNoticeText} numberOfLines={1}>
              {t('createListing.postingInDomain', {
                domain: language === 'ar' ? batchDomain.nameAr : batchDomain.nameEn,
              })}
            </Text>
            {/* popTo -- see CreateListingScreen's copy of this line. */}
            <Pressy onPress={() => navigation.popTo('SellHub', { chooseDomain: true })}>
              <Text style={styles.domainNoticeAction}>{t('createListing.postingInDomainChange')}</Text>
            </Pressy>
          </View>
        )}

        <Text style={type.soft}>{t('batchPhotos.intro')}</Text>

        <View style={styles.photoGrid}>
          {currentPhotos.map((uri) => (
            <View key={uri} style={styles.photoThumbWrap}>
              <Image source={{ uri }} style={styles.photoThumb} />
              <Pressy onPress={() => removePhoto(uri)} style={styles.photoRemoveBadge} accessibilityLabel={t('createListing.removePhoto')}>
                <Icon name="close" size={12} color={colors.white} />
              </Pressy>
            </View>
          ))}
          <Pressy onPress={openCamera} style={styles.addPhoto}>
            <Icon name="camera" size={20} color={colors.inkSoft} />
            <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.takePhoto')}</Text>
          </Pressy>
          <Pressy onPress={pickFromGallery} style={styles.addPhoto}>
            <Icon name="image" size={20} color={colors.inkSoft} />
            <Text style={[type.tiny, styles.addPhotoLabel]}>{t('createListing.addFromGallery')}</Text>
          </Pressy>
        </View>

        {/* Nothing was saved, so these photos have no row behind them and
            nothing that moves the flow on is enabled. Without this line the
            only way back in is to add or remove a photo and hope -- which
            is a recovery by accident, not an offer. */}
        {!!commitError && (
          <View style={styles.commitErrorBox}>
            <Text style={styles.commitErrorText}>{commitError}</Text>
            {/* Which failure this is deciding what "try again" means. If a
                row already exists, the thing that failed was keeping its
                photos level with the screen, and commitItem would insert
                a SECOND listing for the same item rather than retry --
                reachable today too, since fail() also runs on anything
                that throws after addListing has already returned. */}
            <Pressy
              onPress={() =>
                currentListingId ? syncPhotos(currentListingId, photosRef.current) : commitItem(photosRef.current)
              }
              disabled={committing}
            >
              <Text style={styles.commitErrorRetry}>{t('batchPhotos.startRetry')}</Text>
            </Pressy>
          </View>
        )}

        {!hasEnoughForAi && (
          <View style={styles.aiNotice}>
            <Icon name="sparkle" size={13} color={colors.inkSoft} />
            <Text style={[type.tiny, styles.aiNoticeText]}>
              {t('createListing.photosMinRequiredHint', {
                remaining: ITEM_PHOTOS_MIN_FOR_AI - currentPhotos.length,
                min: ITEM_PHOTOS_MIN_FOR_AI,
              })}
            </Text>
          </View>
        )}
        {hasEnoughForAi && (
          <View style={styles.aiNotice}>
            <Icon name="sparkle" size={13} color={colors.inkSoft} />
            <Text style={[type.tiny, styles.aiNoticeText]}>{t('batchPhotos.analyzingInBackground')}</Text>
          </View>
        )}

        <Button
          label={
            committedCount + 1 >= BATCH_MAX_ITEMS
              ? t('batchPhotos.reviewBtn')
              : t('batchPhotos.nextItemBtn')
          }
          onPress={advanceToNextItem}
          disabled={!currentListingId || committing || syncing > 0}
          loading={committing || syncing > 0}
          style={styles.nextBtn}
        />

        {canShowFinishEarly && (
          <Pressy onPress={finishEarly} disabled={syncing > 0} style={styles.finishEarlyLink}>
            <Text style={styles.finishEarlyLinkText}>{t('batchPhotos.finishEarlyLink')}</Text>
          </Pressy>
        )}
      </View>

      <CameraCapture
        visible={photoCameraVisible}
        minFrames={1}
        maxFrames={Math.max(1, photosRemaining)}
        instructions={t('createListing.photoCameraInstructions')}
        progressHint={(count) =>
          count === 0
            ? t('createListing.photoCameraStart', { max: photosRemaining })
            : t('createListing.photoCameraTaken', { count })
        }
        finishLabel={(count) => t('createListing.photoCameraDone', { count })}
        onFinish={(uris) => {
          setPhotoCameraVisible(false);
          if (uris.length === 0) return;
          setPhotosAndSync((prev) => [...prev, ...uris].slice(0, ITEM_PHOTOS_MAX));
        }}
        onCancel={() => setPhotoCameraVisible(false)}
        onFallbackToLibrary={() => {
          setPhotoCameraVisible(false);
          pickFromGallery();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingTop: 6 },
  // Same treatment as the single-item wizard's own domain line -- see
  // CreateListingScreen's styles of the same name.
  domainNotice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: colors.primaryTint, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12,
  },
  domainNoticeText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink },
  domainNoticeAction: { fontSize: 13, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  photoThumbWrap: { width: 84, height: 84 },
  photoThumb: { width: 84, height: 84, borderRadius: radius.sm },
  photoRemoveBadge: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,20,22,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addPhoto: {
    width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4,
  },
  addPhotoLabel: { textAlign: 'center' },
  aiNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warnBg, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, marginTop: 16,
  },
  aiNoticeText: { ...type.tiny, textTransform: 'none', letterSpacing: 0, flex: 1, color: colors.inkSoft },
  commitErrorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.warnBg, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 16,
  },
  commitErrorText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.ink },
  commitErrorRetry: { fontSize: 13, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  nextBtn: { marginTop: 24 },
  finishEarlyLink: { alignItems: 'center', marginTop: 16, padding: 8 },
  finishEarlyLinkText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
