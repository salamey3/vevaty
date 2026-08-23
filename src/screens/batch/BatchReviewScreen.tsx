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
  const { categoryById } = useSettings();
  const { t, language } = useLanguage();
  const classifyState = useBatchItemClassifyState(listing.id);
  const [fixOpen, setFixOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);

  const cat = categoryById(listing.cat);
  const categoryConfirmed = !!listing.cat;

  const setCategory = (id: CategoryId) => {
    updateListing(listing.id, listingToInput(listing, { cat: id })).catch(() => {});
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
              <Text style={[type.soft, styles.aiGuessLabel]}>
                {t('batchReview.rowAiGuessed', {
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

      <ConditionPicker
        value={listing.condition}
        onChange={(c) => updateListing(listing.id, listingToInput(listing, { condition: c })).catch(() => {})}
        label={t('createListing.conditionLabel')}
        newLabel={t('createListing.condition.new')}
        usedLabel={t('createListing.condition.used')}
      />

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
  const { batchId } = route.params;
  const { listings } = useAppStore();
  const { allCategories, childrenOf, categoryById } = useSettings();
  const { t, language } = useLanguage();

  const items = useMemo(
    () => listings.filter((l) => l.batchId === batchId).sort((a, b) => a.createdAt - b.createdAt),
    [listings, batchId]
  );

  const categoryOptions = useMemo(
    () =>
      allCategories
        .filter((c) => c.active && childrenOf(c.id).length === 0)
        .map((c) => {
          const parent = c.parentId ? categoryById(c.parentId) : undefined;
          return {
            id: c.id,
            name: language === 'ar' ? c.nameAr : c.nameEn,
            parent: parent ? (language === 'ar' ? parent.nameAr : parent.nameEn) : undefined,
          };
        }),
    [allCategories, childrenOf, categoryById, language]
  );

  const { classifyItem } = useBatchClassify(categoryOptions, language, t('createListing.classifyPhotoReadFailed'));
  const statesMap = useBatchClassifyStates();

  const analyzingCount = items.filter((l) => statesMap[l.id]?.status === 'analyzing').length;
  const allResolved = items.length > 0 && items.every((l) => !!l.cat && !!l.condition);

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
