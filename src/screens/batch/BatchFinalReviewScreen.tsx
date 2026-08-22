import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import { colors, radius, type } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { listingToInput } from '../../lib/batchListingInput';
import { resetBatchClassifyState } from '../../store/BatchClassifyContext';
import { pickText } from '../../lib/listingText';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchFinalReview'>;

// Last stop: a compact grid of every item in the batch (parked ones
// included, clearly marked, since they're still worth a glance before the
// seller walks away), tap-to-drill into the ordinary single-item edit
// form for anything that needs a fix, and a sticky "Post N items" bar
// that submits every non-parked item for real -- the exact same
// draft->pending_review transition a single-item post already goes
// through (see updateListing's wasDraft/submittingDraft logic), just
// looped once per item instead of firing from one wizard's own Post
// button.
export default function BatchFinalReviewScreen({ navigation, route }: Props) {
  const { batchId } = route.params;
  const { listings, updateListing, completeBatch } = useAppStore();
  const { t, language } = useLanguage();
  const [posting, setPosting] = useState(false);

  const items = useMemo(
    () => listings.filter((l) => l.batchId === batchId).sort((a, b) => a.createdAt - b.createdAt),
    [listings, batchId]
  );
  const activeItems = items.filter((l) => !l.batchParked);

  const editItem = (listingId: string) => navigation.navigate('CreateListing', { editListingId: listingId });

  const postAll = async () => {
    if (activeItems.length === 0 || posting) return;
    setPosting(true);
    try {
      await Promise.all(
        activeItems.map((listing) =>
          // status: undefined (not 'draft') is what turns this into a real
          // submit -- see listingToInput's own doc comment on why the
          // default has to be overridden here specifically.
          updateListing(listing.id, listingToInput(listing, { status: undefined }))
        )
      );
      await completeBatch(batchId).catch(() => {});
      resetBatchClassifyState();
      Alert.alert(
        t('batchFinalReview.postSuccessTitle'),
        t('batchFinalReview.postSuccessBody', { count: activeItems.length }),
        [{ text: t('common.ok'), onPress: () => navigation.popToTop() }]
      );
    } catch {
      Alert.alert(t('batchFinalReview.postErrorTitle'), t('batchFinalReview.postErrorBody'));
    } finally {
      setPosting(false);
    }
  };

  const finishWithNoneToPost = () => navigation.popToTop();

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('batchFinalReview.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.grid}>
          {items.map((listing) => (
            <Pressy key={listing.id} onPress={() => editItem(listing.id)} style={styles.card}>
              {listing.photos[0] ? (
                <Image source={{ uri: listing.photos[0] }} style={styles.cardThumb} />
              ) : (
                <View style={[styles.cardThumb, styles.cardThumbEmpty]} />
              )}
              {listing.batchParked && (
                <View style={styles.draftBadge}>
                  <Text style={styles.draftBadgeText}>{t('batchFinalReview.draftedNote')}</Text>
                </View>
              )}
              <Text style={styles.cardTitle} numberOfLines={1}>
                {pickText(listing.titleEn, listing.titleAr, language) || t('createListing.untitled')}
              </Text>
              <Text style={styles.cardPrice}>${listing.price.toLocaleString()}</Text>
            </Pressy>
          ))}
        </View>
      </ScrollView>

      <View style={styles.stickyBar}>
        {activeItems.length > 0 ? (
          <Button label={t('batchFinalReview.postBtn', { count: activeItems.length })} onPress={postAll} loading={posting} />
        ) : (
          <View>
            <Text style={[type.soft, styles.noneToPostText]}>{t('batchFinalReview.noneToPostHint')}</Text>
            <Button label={t('common.close')} onPress={finishWithNoneToPost} variant="secondary" />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { width: '48%', marginBottom: 16 },
  cardThumb: { width: '100%', aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface },
  cardThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  draftBadge: {
    position: 'absolute', top: 6, left: 6, backgroundColor: colors.warnBg,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  draftBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.accentDeep },
  cardTitle: { fontSize: 13.5, fontWeight: '600', color: colors.ink, marginTop: 6 },
  cardPrice: { fontSize: 13.5, fontWeight: '700', color: colors.primary, marginTop: 1 },
  stickyBar: {
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card,
  },
  noneToPostText: { textAlign: 'center', marginBottom: 10 },
});
