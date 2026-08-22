import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Button from '../../components/Button';
import Icon from '../../icons/Icon';
import ActionSheet from '../../components/ActionSheet';
import CategorySpecsForm from '../../components/CategorySpecsForm';
import StockIntakeForm from '../../components/StockIntakeForm';
import { colors, radius, type } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useSettings } from '../../store/SettingsStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { listingToInput } from '../../lib/batchListingInput';
import { attrHasValue } from '../../lib/attributeFormat';
import { RootStackParamList } from '../../navigation/types';
import { AttributeValue, ListingVariant } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'BatchDetails'>;

// One item's title/specs/stock/price -- NOT location/contact (shared
// across the whole batch, see BatchLocationContactScreen) and NOT the
// AI-suggest/translate machinery the single-item wizard's own Details
// step has (out of scope for batch per the plan -- a seller moving
// through up to 10 items benefits far more from speed than from AI
// research on each one). Steps through the batch's own active (non-
// parked) items internally, the same one-screen-many-items shape
// BatchPhotosScreen uses, rather than navigating to a fresh route per
// item -- there is no per-item route param to navigate with anyway (see
// RootStackParamList.BatchDetails, keyed only by batchId).
export default function BatchDetailsScreen({ navigation, route }: Props) {
  const { batchId } = route.params;
  const { listings, updateListing, deleteListing } = useAppStore();
  const { categoryById, resolveAttributesForCategory, categoryMatches } = useSettings();
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

  // Once every active item has been stepped through, move on. Guarded on
  // activeItems.length too (not just index) so parking the very last item
  // -- which shrinks the array without touching index -- still advances,
  // since index === activeItems.length becomes true immediately.
  useEffect(() => {
    if (activeItems.length > 0 && index >= activeItems.length) {
      navigation.replace('BatchLocationContact', { batchId });
    }
  }, [index, activeItems.length, batchId, navigation]);

  const cat = listing ? categoryById(listing.cat) : undefined;
  const resolvedAttrs = useMemo(
    () => (listing?.cat ? resolveAttributesForCategory(listing.cat) : []),
    [listing?.cat, resolveAttributesForCategory]
  );
  const variantAttr = useMemo(() => resolvedAttrs.find((a) => a.isVariant) || null, [resolvedAttrs]);
  const specAttrs = useMemo(() => resolvedAttrs.filter((a) => !a.isVariant), [resolvedAttrs]);
  const hasSpecs = specAttrs.length > 0;
  const hasStockStep = cat?.stockMode === 'multiple';
  const isVehicleCategory = listing?.cat ? categoryMatches(listing.cat, 'vehicles') : false;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [attrValues, setAttrValues] = useState<Record<string, AttributeValue>>({});
  const [variantStock, setVariantStock] = useState<Record<string, string>>({});
  const [plainStockQty, setPlainStockQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  // Re-seed local form state every time the active item changes (new
  // index, or the same index now pointing at a different listing because
  // the previous one was parked/discarded out from under it) -- same
  // "seed once per resumed listing" idea as CreateListingScreen's own
  // editingListing-derived initial state, just re-run on item change
  // instead of once on mount, since this screen outlives many items.
  useEffect(() => {
    if (!listing) return;
    setTitle(language === 'ar' ? listing.titleAr : listing.titleEn);
    setDescription(language === 'ar' ? listing.descriptionAr : listing.descriptionEn);
    setPrice(listing.price ? String(listing.price) : '');
    setAttrValues(listing.attributes || {});
    const vs: Record<string, string> = {};
    (listing.variants || []).forEach((v) => {
      const val = Object.values(v.attributes)[0];
      if (typeof val === 'string') vs[val] = String(v.stockQty);
    });
    setVariantStock(vs);
    setPlainStockQty(listing.variants ? '' : listing.stockQty ? String(listing.stockQty) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id]);

  if (!listing) {
    // Reached only for the one render between activeItems shrinking to 0
    // (last item saved/parked/discarded) and the redirect effect above
    // firing -- an empty screen for a single frame beats crashing on a
    // null listing.
    return <Screen maxWidth={640}><View /></Screen>;
  }

  const setAttrValue = (slug: string, value: AttributeValue) => setAttrValues((prev) => ({ ...prev, [slug]: value }));
  const toggleMultiselectValue = (slug: string, optionValue: string) => {
    setAttrValues((prev) => {
      const current = Array.isArray(prev[slug]) ? (prev[slug] as string[]) : [];
      const next = current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
      return { ...prev, [slug]: next };
    });
  };

  const buildStock = (): { stockQty: number; variants: ListingVariant[] | null } => {
    if (!hasStockStep) return { stockQty: 1, variants: null };
    if (variantAttr) {
      // Only options with actual stock become a variant row -- matches
      // CreateListingScreen's own buildStock exactly (see its comment on
      // why: attributes[variantAttr.slug] below has to be exactly the
      // in-stock option values for every multiselect-based filter/spec
      // display (HomeScreen, StorefrontScreen, ListingCard) to keep
      // working with zero special-casing).
      const variants: ListingVariant[] = variantAttr.options
        .map((o) => ({ id: `v-${o.value}`, attributes: { [variantAttr.slug]: o.value }, stockQty: Number(variantStock[o.value]) || 0 }))
        .filter((v) => v.stockQty > 0);
      return { stockQty: variants.reduce((s, v) => s + v.stockQty, 0), variants };
    }
    return { stockQty: Number(plainStockQty) || 0, variants: null };
  };

  const specsValid = !hasSpecs || specAttrs.every((a) => !a.required || attrHasValue(attrValues[a.slug]));
  const canContinue = title.trim().length > 0 && Number(price) > 0 && specsValid;

  const saveAndAdvance = async () => {
    if (!canContinue || saving) return;
    setSaving(true);
    const attributes: Record<string, AttributeValue> = {};
    specAttrs.forEach((a) => {
      const v = attrValues[a.slug];
      if (attrHasValue(v)) attributes[a.slug] = v as AttributeValue;
    });
    const stock = buildStock();
    if (variantAttr && stock.variants && stock.variants.length > 0) {
      attributes[variantAttr.slug] = stock.variants.map((v) => v.attributes[variantAttr.slug]);
    }
    try {
      await updateListing(
        listing.id,
        listingToInput(listing, {
          titleEn: language === 'en' ? title.trim() : listing.titleEn,
          titleAr: language === 'ar' ? title.trim() : listing.titleAr,
          descriptionEn: language === 'en' ? description.trim() : listing.descriptionEn,
          descriptionAr: language === 'ar' ? description.trim() : listing.descriptionAr,
          price: Number(price) || 0,
          attributes,
          stockQty: stock.stockQty,
          variants: stock.variants,
        })
      );
      setIndex((i) => i + 1);
    } finally {
      setSaving(false);
    }
  };

  const parkAsDraft = async () => {
    setActionSheetOpen(false);
    await updateListing(listing.id, listingToInput(listing, { batchParked: true })).catch(() => {});
    // No index bump needed -- activeItems shrinks by one and the item
    // that was next slides into this same index automatically.
  };

  const discardItem = async () => {
    setActionSheetOpen(false);
    await deleteListing(listing.id).catch(() => {});
  };

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('batchDetails.itemProgress', { n: index + 1, max: activeItems.length })}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {hasSpecs && (
          <>
            <Text style={styles.sectionLabel}>{t('createListing.stepSpecs')}</Text>
            <CategorySpecsForm
              specAttrs={specAttrs}
              attrValues={attrValues}
              onSetValue={setAttrValue}
              onToggleMultiselect={toggleMultiselectValue}
              isVehicleCategory={isVehicleCategory}
              language={language}
              vehicleBrandModelPlaceholder={t('createListing.vehicleBrandModelPlaceholder')}
            />
          </>
        )}

        {hasStockStep && (
          <>
            <Text style={styles.sectionLabel}>{t('createListing.stepStock')}</Text>
            <StockIntakeForm
              variantAttr={variantAttr}
              variantStock={variantStock}
              onChangeVariantStock={(optionValue, qty) => setVariantStock((prev) => ({ ...prev, [optionValue]: qty }))}
              plainStockQty={plainStockQty}
              onChangePlainStockQty={setPlainStockQty}
              language={language}
              variantIntro={
                variantAttr
                  ? t('createListing.stockVariantIntro', { label: language === 'ar' ? variantAttr.labelAr : variantAttr.labelEn })
                  : ''
              }
              plainIntro={t('createListing.stockPlainIntro')}
              stockQtyLabel={t('createListing.stockQtyLabel')}
            />
          </>
        )}

        <Text style={styles.fieldLabel}>
          {t('createListing.title')}
          <Text style={styles.requiredMark}> *</Text>
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('createListing.titlePlaceholder')}
          style={[styles.input, !title.trim() && styles.inputRequired]}
        />

        <Text style={styles.fieldLabel}>{t('createListing.description')}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t('createListing.descriptionPlaceholder')}
          multiline
          style={[styles.input, styles.textarea]}
        />

        <Text style={styles.fieldLabel}>
          {t('createListing.price')}
          <Text style={styles.requiredMark}> *</Text>
        </Text>
        <TextInput
          value={price}
          onChangeText={setPrice}
          placeholder="0"
          keyboardType="numeric"
          style={[styles.input, !(Number(price) > 0) && styles.inputRequired]}
        />

        <Button label={t('common.continue')} onPress={saveAndAdvance} disabled={!canContinue} loading={saving} style={styles.continueBtn} />

        <Pressy onPress={() => setActionSheetOpen(true)} style={styles.saveDraftLink}>
          <Text style={styles.saveDraftLinkText}>{t('batchDetails.saveAsDraftLink')}</Text>
        </Pressy>
      </ScrollView>

      <ActionSheet
        visible={actionSheetOpen}
        title={t('batchDetails.saveAsDraftSheetTitle')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setActionSheetOpen(false)}
        options={[
          { label: t('batchDetails.saveAsDraftSheetSave'), onPress: parkAsDraft },
          { label: t('batchDetails.saveAsDraftSheetDiscard'), icon: 'trash', destructive: true, onPress: discardItem },
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 4 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  requiredMark: { color: colors.danger },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  inputRequired: { borderColor: colors.danger, borderWidth: 1.5, backgroundColor: '#f5e4e2' },
  textarea: { height: 100, paddingTop: 12, textAlignVertical: 'top' },
  continueBtn: { marginTop: 26 },
  saveDraftLink: { alignItems: 'center', marginTop: 16, padding: 8 },
  saveDraftLinkText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
