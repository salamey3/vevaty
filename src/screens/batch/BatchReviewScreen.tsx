import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import ConditionPicker from '../../components/ConditionPicker';
import CategorySuggestInput from '../../components/CategorySuggestInput';
import CategoryPickerModal from '../../components/CategoryPickerModal';
import { colors, radius, type } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useSettings } from '../../store/SettingsStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { useBatchClassify, useBatchClassifyStates, useBatchItemClassifyState } from '../../store/BatchClassifyContext';
import { listingToInput } from '../../lib/batchListingInput';
import { RootStackParamList } from '../../navigation/types';
import { CategoryId, Listing } from '../../types';
import { buildDomainCandidates } from '../../lib/domainCandidates';
import { useShopFallbackCategory } from '../../hooks/useShopFallbackCategory';
import { domainIdFromSentinel } from '../../lib/classifyPhotos';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchReview'>;

function ReviewRow({
  listing,
  categoryOptions,
  onRetry,
}: {
  listing: Listing;
  categoryOptions: { id: string; name: string; parent?: string }[];
  onRetry: (listingId: string, photos: string[]) => void;
}) {
  const { updateListing } = useAppStore();
  const { categoryById, usesOfferTypeCategory, conditionModeForCategory, isServiceCategory } = useSettings();
  const { t, language } = useLanguage();
  const classifyState = useBatchItemClassifyState(listing.id);
  const [fixOpen, setFixOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  const cat = categoryById(listing.cat);
  const categoryConfirmed = !!listing.cat;
  // Same option set as CreateListingScreen's Classify step, mirrored here
  // per row -- see its conditionOptions for the reasoning.
  const usesOfferType = listing.cat ? usesOfferTypeCategory(listing.cat) : false;
  const conditionMode = listing.cat ? conditionModeForCategory(listing.cat) : 'new_used';
  const asksCondition = listing.cat ? !isServiceCategory(listing.cat) : true;
  const conditionOptions = useMemo(() => {
    if (conditionMode === 'offer_type') {
      return [
        { value: 'sale', label: t('createListing.condition.sale') },
        { value: 'rent', label: t('createListing.condition.rent') },
        { value: 'both', label: t('createListing.condition.both') },
      ];
    }
    if (conditionMode === 'rehome') {
      return [
        { value: 'sale', label: t('createListing.condition.sale') },
        { value: 'free', label: t('createListing.condition.free') },
      ];
    }
    return [
      { value: 'new', label: t('createListing.condition.new') },
      { value: 'used', label: t('createListing.condition.used') },
    ];
  }, [conditionMode, t]);

  const setCategory = (id: CategoryId) => {
    // Same cross-boundary clear as CreateListingScreen's own effect: a
    // condition value picked under the old category's option set (e.g.
    // 'used') doesn't belong to the new one once the category crosses the
    // Properties boundary, so it's cleared rather than left stranded,
    // matching none of the now-shown pills.
    // Checked against the option set the new category actually shows,
    // rather than by re-listing the values: 'sale' belongs to two of the
    // three modes, so a hand-written list would clear a pick that was
    // still perfectly valid.
    const nextMode = conditionModeForCategory(id);
    const nextValues =
      nextMode === 'offer_type'
        ? ['sale', 'rent', 'both']
        : nextMode === 'rehome'
          ? ['sale', 'free']
          : ['new', 'used'];
    const conditionStillValid = !!listing.condition && nextValues.includes(listing.condition);
    updateListing(
      listing.id,
      listingToInput(listing, { cat: id, condition: conditionStillValid ? listing.condition : null })
    ).catch(() => {});
    setFixOpen(false);
    setCategoryQuery('');
  };

  const confirmGuess = () => {
    if (!classifyState.result) return;
    setCategory(classifyState.result.categoryId as CategoryId);
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Image source={{ uri: listing.photos[0] }} style={styles.thumb} />
        <View style={styles.rowBody}>
          {classifyState.status === 'analyzing' && (
            <View style={styles.statusLine}>
              <ActivityIndicator size="small" color={colors.inkSoft} />
              <Text style={[type.soft, styles.statusText]}>{t('batchReview.rowAnalyzing')}</Text>
            </View>
          )}

          {classifyState.status === 'error' && (
            <View>
              <Text style={styles.errorText}>{classifyState.error}</Text>
              <Pressy onPress={() => onRetry(listing.id, listing.photos)}>
                <Text style={styles.retryLink}>{t('batchReview.rowErrorRetry')}</Text>
              </Pressy>
            </View>
          )}

          {classifyState.status === 'idle' && categoryConfirmed && !fixOpen && (
            <View style={styles.statusLine}>
              <Icon name="checkCircle" size={15} color={colors.success} />
              <Text style={[type.body, styles.confirmedCatText]} numberOfLines={1}>
                {cat ? (language === 'ar' ? cat.nameAr : cat.nameEn) : listing.cat}
              </Text>
              <Pressy onPress={() => setFixOpen(true)}>
                <Text style={styles.changeLink}>{t('common.edit')}</Text>
              </Pressy>
            </View>
          )}

          {classifyState.status === 'idle' && !categoryConfirmed && classifyState.result && !fixOpen && (
            <View>
              {/* Which of the two it is matters: "AI guessed" over a
                  category the classifier never returned is a claim the
                  seller can catch being false. */}
              <Text style={[type.soft, styles.aiGuessLabel]}>
                {t(classifyState.source === 'shop' ? 'batchReview.rowShopGuessed' : 'batchReview.rowAiGuessed', {
                  category:
                    categoryOptions.find((o) => o.id === classifyState.result!.categoryId)?.name ||
                    classifyState.result.categoryId,
                })}
              </Text>
              <View style={styles.confirmRow}>
                <Pressy onPress={confirmGuess} style={styles.confirmPill}>
                  <Icon name="checkCircle" size={13} color={colors.ink} />
                  <Text style={styles.confirmPillText}>{t('batchReview.rowConfirmPill')}</Text>
                </Pressy>
                <Pressy onPress={() => setFixOpen(true)}>
                  <Text style={styles.changeLink}>{t('batchReview.rowErrorManualPick')}</Text>
                </Pressy>
              </View>
            </View>
          )}

          {classifyState.status === 'idle' && !categoryConfirmed && !classifyState.result && !fixOpen && (
            <View>
              <Text style={styles.errorText}>{t('createListing.classifyNoGuessHint')}</Text>
            </View>
          )}

          {(fixOpen || (classifyState.status === 'idle' && !categoryConfirmed && !classifyState.result)) && (
            <View style={styles.fixBlock}>
              <CategorySuggestInput
                query={categoryQuery}
                onChangeQuery={setCategoryQuery}
                options={categoryOptions.map((o) => ({ id: o.id, label: o.name, parent: o.parent }))}
                onSelect={(id) => setCategory(id as CategoryId)}
                placeholder={t('createListing.classifySearchPlaceholder')}
              />
              <Pressy onPress={() => setBrowseOpen(true)} style={styles.browseBtn}>
                <Icon name="grip" size={13} color={colors.ink} />
                <Text style={styles.browseBtnText}>{t('createListing.classifyBrowseButton')}</Text>
              </Pressy>
            </View>
          )}
        </View>
      </View>

      {asksCondition && (
      <ConditionPicker
        value={listing.condition}
        onChange={(c) =>
          updateListing(listing.id, listingToInput(listing, { condition: c as Listing['condition'] })).catch(() => {})
        }
        label={
          conditionMode === 'offer_type'
            ? t('createListing.saleRentLabel')
            : conditionMode === 'rehome'
              ? t('createListing.rehomeLabel')
              : t('createListing.conditionLabel')
        }
        options={conditionOptions}
      />
      )}

      <CategoryPickerModal
        visible={browseOpen}
        value={(listing.cat || null) as CategoryId | null}
        onSelect={(id) => setCategory(id)}
        onClose={() => setBrowseOpen(false)}
      />
    </View>
  );
}

export default function BatchReviewScreen({ navigation, route }: Props) {
  const { batchId, domain: domainId, shopChoice } = route.params;
  const { listings } = useAppStore();
  const { allCategories, childrenOf, categoryById, allDomains, domainOfCategory, isServiceCategory } = useSettings();
  const { t, language } = useLanguage();

  const items = useMemo(
    () => listings.filter((l) => l.batchId === batchId).sort((a, b) => a.createdAt - b.createdAt),
    [listings, batchId]
  );

  const leafCategories = useMemo(
    () => allCategories.filter((c) => c.active && childrenOf(c.id).length === 0),
    [allCategories, childrenOf]
  );

  // Narrowed to the batch's domain, same helper the single-item wizard
  // uses -- and, like there, two lists out of one. What a retry may ANSWER
  // with keeps the sentinels, so the model can still say "this belongs to
  // another section" rather than being forced into the least-bad answer
  // from inside this one (see BatchPhotosScreen and BatchClassifyContext).
  const classifyOptions = useMemo(
    () => buildDomainCandidates(domainId ?? null, leafCategories, allDomains, categoryById, domainOfCategory, language),
    [domainId, leafCategories, allDomains, categoryById, domainOfCategory, language]
  );
  // What a seller may PICK never includes one: a sentinel is a message to
  // the classifier, not a category anything can be filed under.
  const categoryOptions = useMemo(
    () => classifyOptions.filter((o) => !domainIdFromSentinel(o.id)),
    [classifyOptions]
  );

  // The retry on a row has to answer exactly as the capture screen did,
  // so it resolves the same storefront fallback from the same input: the
  // shop answer itself, threaded through from the capture screen. An
  // earlier version read it off the items' own shopId instead, which is a
  // different predicate -- that one also carries "and the shop was
  // verified at the moment each item was created" -- so a verification
  // revoked mid-batch made a retry answer differently from the classify
  // it was repeating.
  const shopFallbackCategory = useShopFallbackCategory(!!shopChoice?.attachToShop, domainId ?? null);

  const { classifyItem } = useBatchClassify(
    classifyOptions,
    language,
    t('createListing.classifyPhotoReadFailed'),
    shopFallbackCategory?.id ?? null
  );
  const statesMap = useBatchClassifyStates();

  const analyzingCount = items.filter((l) => statesMap[l.id]?.status === 'analyzing').length;
  // A service item has no condition to give (see CreateListingScreen's
  // asksCondition), so requiring one would strand a whole batch on a
  // question its rows were never asked.
  const allResolved =
    items.length > 0 && items.every((l) => !!l.cat && (isServiceCategory(l.cat) || !!l.condition));

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('batchReview.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.list}>
        {analyzingCount > 0 && (
          <View style={styles.analyzingBanner}>
            <ActivityIndicator size="small" color={colors.inkSoft} />
            <Text style={[type.tiny, styles.analyzingBannerText]}>
              {t('batchReview.analyzingBanner', { count: analyzingCount })}
            </Text>
          </View>
        )}

        {items.map((listing) => (
          <ReviewRow key={listing.id} listing={listing} categoryOptions={categoryOptions} onRetry={classifyItem} />
        ))}

        <Button
          label={t('batchReview.continueBtn')}
          onPress={() => navigation.replace('BatchVerificationShots', { batchId })}
          disabled={!allResolved || analyzingCount > 0}
          style={styles.continueBtn}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 18, paddingBottom: 24 },
  analyzingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.warnBg, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14,
  },
  analyzingBannerText: { textTransform: 'none', letterSpacing: 0, flex: 1, color: colors.inkSoft },
  row: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: 14, marginBottom: 12,
  },
  rowTop: { flexDirection: 'row', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  rowBody: { flex: 1, justifyContent: 'center' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { flex: 1 },
  errorText: { fontSize: 13, color: colors.danger, marginBottom: 4 },
  retryLink: { fontSize: 13, fontWeight: '600', color: colors.ink, textDecorationLine: 'underline' },
  confirmedCatText: { flex: 1, fontWeight: '600' },
  changeLink: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
  aiGuessLabel: { marginBottom: 8 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  confirmPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 12, height: 32,
  },
  confirmPillText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  fixBlock: { marginTop: 10, gap: 8 },
  browseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignSelf: 'flex-start', paddingHorizontal: 12,
  },
  browseBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  continueBtn: { marginTop: 8 },
});
