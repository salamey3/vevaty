import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import PlaceSuggestInput from '../../components/PlaceSuggestInput';
import LocationMapPicker from '../../components/LocationMapPicker';
import { colors, radius, type } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { listingToInput } from '../../lib/batchListingInput';
import { LebanonPlace, findPlaceByFreeText, nearestPlace } from '../../data/lebanonPlaces';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchLocationContact'>;

// One shared district/place/coordinates/contact-method form for the whole
// batch (see the plan's "Cross-screen state" section) -- unlike Details,
// there is nothing per-item here, so this screen is a single form, not a
// stepped loop. Submitting loops one updateListing per non-parked item so
// it's persisted immediately, same as every other batch screen (see
// listingToInput's own doc comment).
export default function BatchLocationContactScreen({ navigation, route }: Props) {
  const { batchId } = route.params;
  const { listings, updateListing } = useAppStore();
  const { t } = useLanguage();

  const activeItems = listings.filter((l) => l.batchId === batchId && !l.batchParked);

  const [contactMethod, setContactMethod] = useState<'phone' | 'chat' | 'both'>('both');
  const [district, setDistrict] = useState('');
  const [resolvedPlace, setResolvedPlace] = useState<LebanonPlace | null>(null);
  const [preciseCoords, setPreciseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [coordsFromSeller, setCoordsFromSeller] = useState(false);
  const [locating, setLocating] = useState(false);
  const [posting, setPosting] = useState(false);

  const resolvePlace = (place: LebanonPlace | null, coords?: { lat: number; lng: number }, opts?: { keepTyped?: boolean }) => {
    setResolvedPlace(place);
    if (coords) {
      setPreciseCoords(coords);
      setCoordsFromSeller(true);
    } else if (place && !(opts?.keepTyped && preciseCoords)) {
      setPreciseCoords({ lat: place.lat, lng: place.lng });
    }
    if (place && !opts?.keepTyped) setDistrict(place.name);
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('createListing.locationPermTitle'), t('createListing.locationPermMessage'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      resolvePlace(nearestPlace(coords), coords);
    } catch {
      Alert.alert(t('createListing.locationErrorTitle'), t('createListing.locationErrorMessage'));
    } finally {
      setLocating(false);
    }
  };

  const hasLocation = !!district.trim() || coordsFromSeller;
  const canContinue = hasLocation && activeItems.length > 0;

  const submit = async () => {
    if (!canContinue || posting) return;
    setPosting(true);
    const trimmedDistrict = district.trim() || 'Lebanon';
    const derivedCoords = preciseCoords || (resolvedPlace ? { lat: resolvedPlace.lat, lng: resolvedPlace.lng } : null);
    try {
      await Promise.all(
        activeItems.map((listing) =>
          updateListing(
            listing.id,
            listingToInput(listing, {
              district: trimmedDistrict,
              governorate: resolvedPlace?.governorate ?? null,
              caza: resolvedPlace?.caza ?? null,
              geonameId: resolvedPlace?.id ?? null,
              lat: derivedCoords?.lat ?? null,
              lng: derivedCoords?.lng ?? null,
              contactMethod,
            })
          )
        )
      );
      navigation.replace('BatchFinalReview', { batchId });
    } finally {
      setPosting(false);
    }
  };

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('batchLocationContact.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={type.soft}>{t('batchLocationContact.intro')}</Text>

        <Text style={styles.fieldLabel}>{t('createListing.contactMethod')}</Text>
        <View style={styles.pillRow}>
          {(['both', 'chat', 'phone'] as const).map((m) => (
            <Pressy
              key={m}
              onPress={() => setContactMethod(m)}
              style={[styles.optPill, contactMethod === m && styles.optPillActive]}
            >
              <Text style={[styles.optPillText, contactMethod === m && styles.optPillTextActive]}>
                {t(`createListing.contactMethod.${m}`)}
              </Text>
            </Pressy>
          ))}
        </View>

        <Text style={styles.fieldLabel}>
          {t('createListing.location')}
          <Text style={styles.requiredMark}> *</Text>
        </Text>
        <PlaceSuggestInput
          style={hasLocation ? undefined : styles.inputRequired}
          value={district}
          onChangeText={(v) => {
            setDistrict(v);
            if (resolvedPlace && findPlaceByFreeText(v)?.id !== resolvedPlace.id) setResolvedPlace(null);
          }}
          onSelectPlace={(place) => resolvePlace(place)}
          onBlurResolve={(place) => {
            if (place) resolvePlace(place, undefined, { keepTyped: true });
          }}
          placeholder={t('createListing.locationPlaceholder')}
        />
        {resolvedPlace ? (
          <Text style={styles.hintText}>
            {t('createListing.locationResolvedFormat', { caza: resolvedPlace.caza, governorate: resolvedPlace.governorate })}
          </Text>
        ) : (
          !!district.trim() && <Text style={styles.hintText}>{t('createListing.locationUnresolvedHint')}</Text>
        )}

        <View style={styles.orDivider}>
          <View style={[styles.orDividerLine, !hasLocation && styles.orDividerLineRequired]} />
          <Text style={[styles.orDividerText, !hasLocation && styles.orDividerTextRequired]}>{t('common.or')}</Text>
          <View style={[styles.orDividerLine, !hasLocation && styles.orDividerLineRequired]} />
        </View>
        <Pressy onPress={useMyLocation} style={[styles.locationBtn, !hasLocation && styles.locationBtnRequired]} disabled={locating}>
          <Icon name="location" size={16} color={colors.ink} />
          <Text style={styles.locationBtnText}>
            {locating ? t('common.loading') : coordsFromSeller ? t('createListing.locationCaptured') : t('createListing.useMyLocation')}
          </Text>
        </Pressy>

        <View style={styles.mapWrap}>
          <LocationMapPicker
            value={preciseCoords}
            onChange={(coords) => resolvePlace(nearestPlace(coords), coords)}
            hint={t('createListing.mapHint')}
            pinLabel={coordsFromSeller ? t('createListing.mapPinLabel') : undefined}
          />
        </View>
        <Text style={styles.geonamesAttribution}>{t('createListing.geonamesAttribution')}</Text>

        <Button label={t('batchLocationContact.continueBtn')} onPress={submit} disabled={!canContinue} loading={posting} style={styles.continueBtn} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  requiredMark: { color: colors.danger },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optPill: {
    paddingHorizontal: 14, height: 38, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  optPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  optPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optPillTextActive: { color: colors.white },
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  hintText: { ...type.tiny, textTransform: 'none', letterSpacing: 0, marginTop: 6, color: colors.inkSoft },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  orDividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orDividerLineRequired: { backgroundColor: colors.danger },
  orDividerText: { fontSize: 12, color: colors.inkSoft },
  orDividerTextRequired: { color: colors.danger },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, marginTop: 16, backgroundColor: colors.card,
  },
  locationBtnRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  locationBtnText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  mapWrap: { marginTop: 16, borderRadius: radius.md, overflow: 'hidden' },
  geonamesAttribution: { ...type.tiny, textTransform: 'none', letterSpacing: 0, marginTop: 6, color: colors.inkSoft },
  continueBtn: { marginTop: 26 },
});
