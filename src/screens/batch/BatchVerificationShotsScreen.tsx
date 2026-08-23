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
              </View>
              {captured ? <Image source={{ uri: verificationPhotos[i] }} style={styles.verifyThumb} /> : null}
              <Pressy onPress={() => setCameraIndex(i)} style={styles.takeBtn}>
                <Icon name={captured ? 'rotate' : 'camera'} size={14} color={colors.ink} />
                <Text style={styles.takeBtnText}>
                  {captured ? t('createListing.verifyRetake') : t('batchVerification.takePhoto')}
                </Text>
              </Pressy>
            </View>
          );
        })}

        <Button label={t('batchVerification.continueBtn')} onPress={goNext} style={styles.nextBtn} />
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
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  verifyRowText: { flex: 1 },
  verifyThumb: { width: 40, height: 40, borderRadius: radius.sm },
  takeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 14, height: 36,
  },
  takeBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  nextBtn: { marginTop: 24 },
});
