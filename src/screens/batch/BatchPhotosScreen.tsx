import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
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
export default function BatchPhotosScreen({ navigation, route }: Props) {
  const { batchId, shopChoice, domain: domainId } = route.params;
  const { addListing, updateListing, myShop } = useAppStore();
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

  const [committedCount, setCommittedCount] = useState(0);
  const [currentPhotos, setCurrentPhotos] = useState<string[]>([]);
  const [currentListingId, setCurrentListingId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
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
  const draftPayload = (photos: string[]) => ({
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
    batchId,
    status: 'draft' as const,
  });

  const setPhotosAndSync = (updater: (prev: string[]) => string[]) => {
    setCurrentPhotos((prev) => {
      const next = updater(prev);
      if (currentListingId) {
        // Already a real row -- keep it in sync with whatever's on screen
        // right now, whichever direction the count moved (add or remove).
        updateListing(currentListingId, draftPayload(next)).catch(() => {});
      } else if (!committing && next.length >= ITEM_PHOTOS_MIN_FOR_AI) {
        setCommitting(true);
        addListing(draftPayload(next))
          .then((listing) => {
            setCurrentListingId(listing.id);
            classifyItem(listing.id, next);
          })
          .catch(() => {
            Alert.alert(t('batchPhotos.commitErrorTitle'), t('batchPhotos.commitErrorBody'));
          })
          .finally(() => setCommitting(false));
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

  const goToReview = () =>
    navigation.replace('BatchReview', { batchId, domain: route.params.domain, shopChoice });

  const advanceToNextItem = () => {
    if (!currentListingId || advancing) return;
    const nextCount = committedCount + 1;
    if (nextCount >= BATCH_MAX_ITEMS) {
      goToReview();
      return;
    }
    setAdvancing(true);
    setCommittedCount(nextCount);
    setCurrentPhotos([]);
    setCurrentListingId(null);
    setAdvancing(false);
  };

  const finishEarly = () => {
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
          disabled={!currentListingId || committing}
          loading={committing}
          style={styles.nextBtn}
        />

        {canShowFinishEarly && (
          <Pressy onPress={finishEarly} style={styles.finishEarlyLink}>
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
  nextBtn: { marginTop: 24 },
  finishEarlyLink: { alignItems: 'center', marginTop: 16, padding: 8 },
  finishEarlyLinkText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
