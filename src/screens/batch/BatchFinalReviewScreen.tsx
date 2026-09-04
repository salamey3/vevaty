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
import { listingPriceLines, priceLineText } from '../../lib/priceDisplay';
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
      // allSettled, not all: these are one write per item, and Promise.all
      // reports only the first rejection while the rest carry on posting
      // anyway. A seller told "could not post" about a batch where nine of
      // ten items went live has been told something worse than nothing.
      // Now that a refused write actually throws, that distinction is the
      // difference between a usable message and a misleading one.
      const results = await Promise.allSettled(
        activeItems.map((listing) =>
          // status: undefined (not 'draft') is what turns this into a real
          // submit -- see listingToInput's own doc comment on why the
          // default has to be overridden here specifically.
          //
          // quietMedia: twenty items firing their own alerts means the
          // seller reads one at random and the other nineteen are
          // destroyed -- AlertHost holds exactly one (@AGENTS.md). Worse,
          // the "Posted 20 items" alert below used to destroy whichever
          // one survived. The results are collected and said once here.
          // waitMedia: this is the moment the item is meant to go on the
          // site, so the answer to "did it" has to be known before the
          // batch is completed on the strength of it.
          updateListing(listing.id, listingToInput(listing, { status: undefined }), {
            quietMedia: true,
            waitMedia: true,
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      // Saved, but NOT on the site. A resolved promise used to be read as
      // "posted", so the batch was completed -- items marked submitted and
      // gone from this screen -- while some of them sat invisible at
      // pending_review with the seller told all twenty went live.
      //
      // `blockedFromSite` is what this call withheld, which is exactly the
      // right question on a retry: an item that posted on the first pass
      // comes back 'active' and this pass moderates nothing, so it is not
      // blocked and does not hold the batch open.
      // Computed before the early returns below, not after them. Both of
      // those branches used to `return` without ever mentioning the items
      // that DID go out -- so a batch with one hard failure and three
      // items missing photos reported the failure and said nothing about
      // the photos, in a flow where quietMedia means this screen is the
      // only place it can be said at all.
      const photosMissing = results.reduce(
        (n, r) => n + (r.status === 'fulfilled' && r.value ? r.value.photosMissing : 0),
        0
      );
      // A refused photo DELETE or REORDER on an item is deliberately not
      // blocking -- every picture is there, only the order or one extra
      // is wrong -- so it does not show up in `blocked` below.
      const mediaTrouble = results.some(
        (r) => r.status === 'fulfilled' && r.value && (r.value.mediaFailed || r.value.videoFailed)
      );
      // Deliberately apart from mediaTrouble: "a problem with their photos
      // or video" is wrong about a 360 that is on the listing and simply
      // came out short.
      const spinShort = results.some(
        (r) => r.status === 'fulfilled' && r.value && (r.value.spinFailed || r.value.spinShort)
      );
      const mediaNotes: string[] = [];
      if (photosMissing > 0) mediaNotes.push(t('media.somePhotosMissingBody', { count: photosMissing }));
      else if (mediaTrouble) mediaNotes.push(t('batchFinalReview.mediaTroubleBody'));
      else if (spinShort) mediaNotes.push(t('media.spinTooShortBody'));

      const blocked = results.filter(
        (r) => r.status === 'fulfilled' && r.value && r.value.blockedFromSite
      );
      const photoless = blocked.filter(
        (r) => r.status === 'fulfilled' && r.value.blockedReason === 'no_photos'
      ).length;
      const unpublished = blocked.length;
      if (failed === 0 && unpublished > 0) {
        // Same treatment as a hard failure: the batch is NOT completed and
        // the screen is not left. Pressing Post again is only the fix for
        // ONE of the two reasons, though -- an item with no photos will be
        // refused identically however many times it is posted, so telling
        // the seller to retry it is telling them to do something that
        // cannot work. That item needs opening and photos adding.
        //
        // A second Post is safe either way: posting points are claimed
        // against listings.posting_points_awarded, so an item that did go
        // out cannot be credited twice.
        // Both reasons when both are present. Reporting only the
        // photoless ones left the retryable ones unmentioned, so a seller
        // with one empty item and three failed uploads was told about the
        // one and never learned the three were worth another Post.
        const retryable = unpublished - photoless;
        const lines: string[] = [];
        if (photoless > 0) {
          lines.push(t('batchFinalReview.noPhotosBody', { failed: photoless, total: activeItems.length }));
        }
        if (retryable > 0) {
          lines.push(t('batchFinalReview.notPublishedBody', { failed: retryable, total: activeItems.length }));
        }
        Alert.alert(t('batchFinalReview.notPublishedTitle'), [...lines, ...mediaNotes].join('\n\n'));
        return;
      }
      if (failed > 0) {
        // The batch is deliberately NOT completed and the screen is not
        // left: pressing Post again is the fix, and it is safe to press.
        // Posting points are claimed against
        // listings.posting_points_awarded, so an item that already went
        // out cannot be credited a second time. It IS re-moderated,
        // though -- an item still sitting at pending_review/pending is
        // exactly what wasPendingReview matches, which is the same thing
        // that lets a failed item recover, so the AI check runs again for
        // items that already passed it. Retries are rare enough that the
        // cost is not worth a mechanism to avoid.
        // The photoless split still has to be said here. Reporting the
        // whole lot as "tap Post again to retry the ones that failed"
        // when some of them have no photos is the retry-for-ever trap the
        // branch above goes out of its way to avoid.
        const hardLines: string[] = [
          failed + unpublished === activeItems.length
            ? t('batchFinalReview.postErrorBody')
            : t('batchFinalReview.postPartialBody', { failed: failed + unpublished, total: activeItems.length }),
        ];
        if (photoless > 0) {
          hardLines.push(t('batchFinalReview.noPhotosBody', { failed: photoless, total: activeItems.length }));
        }
        Alert.alert(t('batchFinalReview.postErrorTitle'), [...hardLines, ...mediaNotes].join('\n\n'));
        return;
      }
      await completeBatch(batchId).catch(() => {});
      resetBatchClassifyState();
      const notes: string[] = [
        t('batchFinalReview.postSuccessBody', { count: activeItems.length }),
        ...mediaNotes,
      ];
      Alert.alert(t('batchFinalReview.postSuccessTitle'), notes.join('\n\n'), [
        { text: t('common.ok'), onPress: () => navigation.popToTop() },
      ]);
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
              {/* The last thing a seller sees before posting the batch, so
                  it has to read the way the posted card will -- a bare
                  "$1,500" on a rental would look like an asking price.
                  Same formatter the card and detail hero use. */}
              <Text style={styles.cardPrice} numberOfLines={1}>
                {priceLineText(listingPriceLines(listing, t, { variant: 'card' }).primary)}
              </Text>
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
