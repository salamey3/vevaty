import React, { useEffect, useMemo, useState } from 'react';
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
import { useVerificationPhotosFor, setVerificationPhotosFor } from '../../store/BatchClassifyContext';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchVerificationShots'>;

// Second screen of the batch flow, between BatchReview and BatchDetails:
// for whichever active items resolved to a category with verification
// shots (see CreateListingScreen's own 'verify' step for the single-item
// version of this same idea), asks for that one targeted, information-
// dense photo before the seller reaches Details -- so BatchDetailsScreen's
// AI auto-suggest (its own companion effect) reads exact specs off a
// settings screen / VIN plate / rating label instead of guessing them from
// the item's general photos. Steps through activeItems the same one-
// screen-many-items way BatchPhotosScreen/BatchDetailsScreen do, silently
// skipping any item whose category has no verification shots at all --
// most batches (a couch, a jacket, a lamp) never show this screen's UI,
// and a batch with none of its items needing shots redirects straight to
// BatchDetails with nothing shown at all.
export default function BatchVerificationShotsScreen({ navigation, route }: Props) {
  const { batchId } = route.params;
  const { listings } = useAppStore();
  const { categoryById } = useSettings();
  const { t, language } = useLanguage();

  const activeItems = useMemo(
    () =>
      listings
        .filter((l) => l.batchId === batchId && !l.batchParked)
        .sort((a, b) => a.createdAt - b.createdAt),
    [listings, batchId]
  );

  const [index, setIndex] = useState(0);
  const listing = activeItems[index] ?? null;
  const cat = listing ? categoryById(listing.cat) : undefined;
  const shotListEn = cat?.verificationShotListEn ?? [];
  const shotListAr = cat?.verificationShotListAr ?? [];
  const needsShots = shotListEn.length > 0;

  // Only counts items that actually show this screen's UI -- "item 1 of 3"
  // would be a confusing progress readout if it silently included the
  // couches and jackets being skipped in between.
  const itemsNeedingShots = useMemo(
    () => activeItems.filter((l) => (categoryById(l.cat)?.verificationShotListEn.length ?? 0) > 0),
    [activeItems, categoryById]
  );
  const progressIndex = listing ? itemsNeedingShots.findIndex((l) => l.id === listing.id) : -1;

  // Once every active item has been stepped through (or skipped, right
  // below), move on -- same guard shape as BatchDetailsScreen's own
  // redirect effect, including the activeItems.length > 0 guard so this
  // never fires against a not-yet-loaded empty list.
  useEffect(() => {
    if (activeItems.length > 0 && index >= activeItems.length) {
      navigation.replace('BatchDetails', { batchId });
      return;
    }
    if (listing && !needsShots) {
      setIndex((i) => i + 1);
    }
  }, [index, activeItems.length, listing, needsShots, batchId, navigation]);

  const verificationPhotos = useVerificationPhotosFor(listing?.id ?? '');
  const [cameraIndex, setCameraIndex] = useState<number | null>(null);

  const pickFromLibrary = async (promptIndex: number) => {
    if (!listing) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('createListing.photoPermTitle'), t('createListing.photoPermMessage'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.7,
      selectionLimit: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const next = [...verificationPhotos];
      next[promptIndex] = result.assets[0].uri;
      setVerificationPhotosFor(listing.id, next);
    }
  };

  // Mandatory, matching CreateListingScreen's single-item 'verify' step:
  // every prompt in the current item's shot list must have a captured (or
  // library-picked) photo before Continue is even tappable. Previously this
  // button had no `disabled` at all -- a seller could blow straight past
  // every shot in the batch flow the same way the single-item wizard used
  // to allow, which is exactly what this whole request is about fixing.
  const allShotsCaptured = shotListEn.every((_, i) => !!verificationPhotos[i]);
  const goNext = () => setIndex((i) => i + 1);

  if (!listing || !needsShots) {
    // Either waiting for the redirect-to-BatchDetails effect (no active
    // items left) or the skip-this-item effect (current item's category
    // has no verification shots) to fire -- both above. No UI is the
    // point: most items never need this screen at all.
    return (
      <Screen maxWidth={640}>
        <View />
      </Screen>
    );
  }

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>
          {t('batchVerification.itemProgress', { n: progressIndex + 1, max: itemsNeedingShots.length })}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.body}>
        <Text style={type.soft}>{t('batchVerification.intro')}</Text>

        {(language === 'ar' ? shotListAr : shotListEn).map((prompt, i) => {
          const captured = !!verificationPhotos[i];
          return (
            <View key={i} style={styles.verifyRow}>
              <View style={styles.verifyRowText}>
                <Text style={type.body}>{prompt}</Text>
                {!captured && <Text style={styles.requiredTag}>{t('batchVerification.required')}</Text>}
              </View>
              {captured ? <Image source={{ uri: verificationPhotos[i] }} style={styles.verifyThumb} /> : null}
              <View style={styles.takeBtnRow}>
                {/* Deliberately larger and bolder than an ordinary secondary
                    action -- filled with the brand primary color while unmet,
                    same visual weight Button.tsx gives its own primary CTA, so
                    this is the thing a seller's eye lands on rather than
                    something they can scan past. Drops to a quieter outline
                    once captured, so attention keeps moving to whatever prompt
                    is still unmet. */}
                <Pressy
                  onPress={() => setCameraIndex(i)}
                  style={[styles.takeBtn, captured && styles.takeBtnDone]}
                  accessibilityLabel={captured ? t('createListing.verifyRetake') : t('batchVerification.takePhoto')}
                >
                  <Icon name={captured ? 'rotate' : 'camera'} size={22} color={captured ? colors.ink : colors.white} />
                  <Text style={[styles.takeBtnText, captured && styles.takeBtnTextDone]}>
                    {captured ? t('createListing.verifyRetake') : t('batchVerification.takePhoto')}
                  </Text>
                </Pressy>
                {/* Same pickFromLibrary already used as CameraCapture's
                    permission-denied fallback (see below) -- surfaced here as
                    a first-class, always-visible choice, matching the same
                    change on the single-item wizard's own 'verify' step
                    (CreateListingScreen.tsx). A seller re-doing a shot they
                    already have (a merchant re-uploading a saved VIN photo
                    across a whole batch) shouldn't have to re-take it through
                    the camera every time just to move on. */}
                <Pressy
                  onPress={() => pickFromLibrary(i)}
                  style={styles.galleryBtn}
                  accessibilityLabel={t('createListing.addFromGallery')}
                >
                  <Icon name="image" size={20} color={colors.inkSoft} />
                  <Text style={styles.galleryBtnText}>{t('createListing.addFromGallery')}</Text>
                </Pressy>
              </View>
            </View>
          );
        })}

        <Button
          label={t('batchVerification.continueBtn')}
          onPress={goNext}
          disabled={!allShotsCaptured}
          style={styles.nextBtn}
        />
        {!allShotsCaptured && <Text style={styles.blockedHint}>{t('batchVerification.allRequiredHint')}</Text>}
      </View>

      <CameraCapture
        visible={cameraIndex !== null}
        // Exactly one shot per prompt -- a retake replaces it, it never
        // accumulates (see pickFromLibrary/onFinish below).
        minFrames={1}
        maxFrames={1}
        instructions={cameraIndex !== null ? (language === 'ar' ? shotListAr : shotListEn)[cameraIndex] : undefined}
        onFinish={(uris) => {
          const i = cameraIndex;
          setCameraIndex(null);
          if (i === null || uris.length === 0 || !listing) return;
          const next = [...verificationPhotos];
          next[i] = uris[0];
          setVerificationPhotosFor(listing.id, next);
        }}
        onCancel={() => setCameraIndex(null)}
        onFallbackToLibrary={() => {
          const i = cameraIndex;
          setCameraIndex(null);
          if (i !== null) pickFromLibrary(i);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingTop: 6 },
  verifyRow: {
    marginTop: 18, gap: 10, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  verifyRowText: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  requiredTag: {
    fontSize: 11, fontWeight: '700', color: colors.danger, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  verifyThumb: { width: 52, height: 52, borderRadius: radius.sm },
  takeBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Deliberately much larger than the old 36px-tall pill (this is the
  // control the seller reported nearly missing entirely) and filled with
  // the same brand-primary color Button.tsx's own primary CTA uses, so it
  // reads as a first-class action rather than a minor row accessory.
  takeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 18, height: 56,
  },
  takeBtnDone: {
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line,
  },
  takeBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },
  takeBtnTextDone: { color: colors.ink },
  // Secondary, always-available alternative to takeBtn -- outlined rather
  // than filled so the camera stays the visually primary path, matching the
  // same treatment on CreateListingScreen's single-item 'verify' step.
  galleryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line,
    borderRadius: radius.pill, paddingHorizontal: 16, height: 56,
  },
  galleryBtnText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  nextBtn: { marginTop: 24 },
  blockedHint: { ...type.tiny, color: colors.danger, textAlign: 'center', marginTop: 8 },
});
