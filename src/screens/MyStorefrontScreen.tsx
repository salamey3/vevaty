import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../lib/alertShim';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import PlaceSuggestInput from '../components/PlaceSuggestInput';
import FacetChipGroup, { ChipOption } from '../components/FacetChipGroup';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useLanguage } from '../i18n/LanguageContext';
import { uploadPhoto } from '../lib/photoUpload';
import { pickText } from '../lib/listingText';
import { supabase } from '../lib/supabase';
import { LebanonPlace, findPlaceByFreeText } from '../data/lebanonPlaces';
import { RootStackParamList } from '../navigation/types';
import { CategoryAttribute, Shop, ShopInput } from '../types';
import { useGoBack } from '../hooks/useGoBack';
import HomeMarkButton from '../components/HomeMarkButton';

type Props = NativeStackScreenProps<RootStackParamList, 'MyStorefront'>;

// A merchant-authored saved filter -- mirrors StorefrontScreen's own
// CollectionRow/`filter` shape exactly (facetValues + price only, no
// number-range facets -- a saved preset is meant to be a small, stable
// bookmark, not a snapshot of every control on that page). This is the
// authoring side of the same myazar.shop_collections row StorefrontScreen
// already reads and applies; until now nothing ever wrote one, so the
// collections row on every real shop's storefront page silently never
// rendered at all.
type CollectionFilter = { facetValues?: Record<string, string[]>; priceMin?: number; priceMax?: number };
type CollectionRow = { id: string; labelEn: string; labelAr: string; sortOrder: number; filter: CollectionFilter };

function emptyForm(): ShopInput {
  return {
    nameEn: '', nameAr: '', taglineEn: '', taglineAr: '',
    logoUrl: null, coverUrl: null,
    governorate: null, caza: null, addressLine: '',
    whatsapp: '', phone: '',
    primaryCategoryId: null,
  };
}

function formFromShop(shop: Shop): ShopInput {
  return {
    nameEn: shop.nameEn, nameAr: shop.nameAr || '',
    taglineEn: shop.taglineEn || '', taglineAr: shop.taglineAr || '',
    logoUrl: shop.logoUrl, coverUrl: shop.coverUrl,
    governorate: shop.governorate, caza: shop.caza, addressLine: shop.addressLine || '',
    whatsapp: shop.whatsapp || '', phone: shop.phone || '',
    primaryCategoryId: shop.primaryCategoryId,
  };
}

// The merchant-facing "create my storefront" / "manage my storefront"
// screen -- one seller's private view of their own shop row, reached from
// ProfileScreen. Same shape as CreateListingScreen: gated on isVerified
// (phone-verified, not a storefront-specific check -- see the follow-up
// migration's comment on why shops_insert no longer requires
// is_id_verified), fills in a form, and shows a status banner afterward
// rather than the shop going instantly public -- creating one is instant,
// but AdminShopsScreen's manual verification is what actually makes it
// visible on the Storefront route (mirrors how a new listing publishes
// itself but a storefront doesn't, since there's no AI-first-pass
// equivalent for a shop).
export default function MyStorefrontScreen({ navigation, route }: Props) {
  const goBack = useGoBack();
  const { isVerified, authChecked, myShop, listings, createShop, updateShop } = useAppStore();
  const { childrenOf, resolveAttributesForCategory } = useSettings();
  const { t, language, isRTL } = useLanguage();

  // Gated on authChecked too -- isVerified STARTS false on every fresh page
  // load (its default state, before AppStore's initial ensureSession()
  // round-trip resolves), so without this a verified merchant deep-linking
  // or reloading straight into /storefront/manage was incorrectly bounced
  // to the login screen every single time. See authChecked's doc comment
  // in AppStore.tsx.
  useEffect(() => {
    if (authChecked && !isVerified) navigation.replace('Auth', { returnTo: 'MyStorefront', returnToParams: route.params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isVerified]);

  const isEditMode = !!myShop;
  const [form, setForm] = useState<ShopInput>(() => (myShop ? formFromShop(myShop) : emptyForm()));
  const [locationQuery, setLocationQuery] = useState(() =>
    myShop && myShop.caza ? [myShop.caza, myShop.governorate].filter(Boolean).join(', ') : ''
  );
  // Reseed the form whenever myShop itself changes identity (e.g. the
  // first successful createShop() call below, or a fresh sign-in) -- not
  // on every myShop field change, since that would clobber in-progress
  // edits the moment updateShop's own optimistic setMyShop resolves.
  useEffect(() => {
    if (myShop) {
      setForm(formFromShop(myShop));
      setLocationQuery(myShop.caza ? [myShop.caza, myShop.governorate].filter(Boolean).join(', ') : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myShop?.id]);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const topCategories = useMemo(() => childrenOf(null), [childrenOf]);

  // --- Saved filters (shop_collections) -----------------------------------
  // Authoring UI for the saved-filter chips StorefrontScreen's collections
  // row displays (e.g. "Under $50", "New arrivals") -- see that screen's
  // own CollectionRow doc comment. Only meaningful once the shop itself
  // exists (create mode has no shop_id to attach a collection to yet).
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);

  const loadCollections = React.useCallback(async () => {
    if (!myShop) {
      setCollections([]);
      return;
    }
    setCollectionsLoading(true);
    try {
      const { data } = await supabase
        .from('shop_collections')
        .select('id, label_en, label_ar, filter, sort_order')
        .eq('shop_id', myShop.id)
        .order('sort_order');
      setCollections(
        (data || []).map((r: any) => ({
          id: r.id,
          labelEn: r.label_en,
          labelAr: r.label_ar || '',
          sortOrder: r.sort_order ?? 0,
          filter: r.filter || {},
        }))
      );
    } finally {
      setCollectionsLoading(false);
    }
  }, [myShop?.id]);

  useEffect(() => {
    loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myShop?.id]);

  // This shop's own active listings + filterable attributes -- the same
  // "what could this shop's storefront actually filter on" computation
  // StorefrontScreen does for display, reused here so the merchant is only
  // ever offered facets/options that exist on real stock right now.
  const shopListings = useMemo(
    () => (myShop ? listings.filter((l) => l.shopId === myShop.id && l.status === 'active') : []),
    [listings, myShop]
  );
  const filterableAttrs = useMemo(
    () =>
      myShop?.primaryCategoryId
        ? resolveAttributesForCategory(myShop.primaryCategoryId)
            .filter((a) => a.filterPriority != null)
            .sort((a, b) => (a.filterPriority as number) - (b.filterPriority as number))
        : [],
    [myShop, resolveAttributesForCategory]
  );
  const optionsForAttr = (attr: CategoryAttribute): ChipOption[] => {
    const labelFor = (v: string) => {
      const opt = attr.options.find((o) => o.value === v);
      return opt ? pickText(opt.labelEn, opt.labelAr, language) : v;
    };
    const counts = new Map<string, number>();
    for (const l of shopListings) {
      const v = l.attributes[attr.slug];
      if (attr.type === 'multiselect') {
        const arr = Array.isArray(v) ? v.map(String) : [];
        for (const val of arr) counts.set(val, (counts.get(val) || 0) + 1);
      } else if (attr.type === 'boolean') {
        if (v === undefined) continue;
        const key = String(!!v);
        counts.set(key, (counts.get(key) || 0) + 1);
      } else if (v !== undefined && v !== null && v !== '') {
        counts.set(String(v), (counts.get(String(v)) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, label: attr.type === 'boolean' ? (key === 'true' ? t('common.yes') : t('common.no')) : labelFor(key), count }))
      .sort((a, b) => b.count - a.count);
  };
  // Only chip-style facets are offered here (mirrors CollectionFilter's own
  // shape, no number-range) -- a saved filter is meant to stay a small,
  // stable bookmark, and only attributes with a real option to pick from
  // among this shop's current stock are worth offering at all.
  const authorableFacets = useMemo(
    () =>
      filterableAttrs
        .filter((a) => a.type !== 'number')
        .map((a) => ({ attr: a, options: optionsForAttr(a) }))
        .filter((f) => f.options.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterableAttrs, shopListings, language]
  );

  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [collectionLabelEn, setCollectionLabelEn] = useState('');
  const [collectionLabelAr, setCollectionLabelAr] = useState('');
  const [collectionFacetValues, setCollectionFacetValues] = useState<Record<string, string[]>>({});
  const [collectionPriceMin, setCollectionPriceMin] = useState('');
  const [collectionPriceMax, setCollectionPriceMax] = useState('');
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  const resetCollectionForm = () => {
    setEditingCollectionId(null);
    setCollectionLabelEn('');
    setCollectionLabelAr('');
    setCollectionFacetValues({});
    setCollectionPriceMin('');
    setCollectionPriceMax('');
    setCollectionError(null);
  };

  const openNewCollection = () => {
    resetCollectionForm();
    setCollectionModalOpen(true);
  };

  const openEditCollection = (c: CollectionRow) => {
    setEditingCollectionId(c.id);
    setCollectionLabelEn(c.labelEn);
    setCollectionLabelAr(c.labelAr);
    setCollectionFacetValues(c.filter.facetValues || {});
    setCollectionPriceMin(c.filter.priceMin != null ? String(c.filter.priceMin) : '');
    setCollectionPriceMax(c.filter.priceMax != null ? String(c.filter.priceMax) : '');
    setCollectionError(null);
    setCollectionModalOpen(true);
  };

  const toggleCollectionFacetValue = (slug: string, value: string) => {
    setCollectionFacetValues((prev) => {
      const cur = prev[slug] || [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [slug]: next };
    });
  };

  const saveCollection = async () => {
    if (!myShop || collectionSaving) return;
    const labelEn = collectionLabelEn.trim();
    if (!labelEn) {
      setCollectionError(t('myStorefront.collectionLabelRequired'));
      return;
    }
    setCollectionSaving(true);
    setCollectionError(null);
    try {
      const facetValues = Object.fromEntries(Object.entries(collectionFacetValues).filter(([, v]) => v.length > 0));
      const priceMin = collectionPriceMin.trim() ? Number(collectionPriceMin) : undefined;
      const priceMax = collectionPriceMax.trim() ? Number(collectionPriceMax) : undefined;
      const filter: CollectionFilter = {
        ...(Object.keys(facetValues).length > 0 ? { facetValues } : {}),
        ...(priceMin != null && Number.isFinite(priceMin) ? { priceMin } : {}),
        ...(priceMax != null && Number.isFinite(priceMax) ? { priceMax } : {}),
      };
      const payload = { shop_id: myShop.id, label_en: labelEn, label_ar: collectionLabelAr.trim() || null, filter };
      if (editingCollectionId) {
        const { error: updErr } = await supabase.from('shop_collections').update(payload).eq('id', editingCollectionId);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase
          .from('shop_collections')
          .insert({ ...payload, sort_order: collections.length });
        if (insErr) throw insErr;
      }
      setCollectionModalOpen(false);
      resetCollectionForm();
      await loadCollections();
    } catch (e: any) {
      setCollectionError(e?.message || t('myStorefront.collectionSaveFailed'));
    } finally {
      setCollectionSaving(false);
    }
  };

  const deleteCollection = (c: CollectionRow) => {
    Alert.alert(
      t('myStorefront.collectionDeleteConfirmTitle'),
      t('myStorefront.collectionDeleteConfirmBody', { label: c.labelEn }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('myStorefront.collectionDelete'),
          style: 'destructive',
          onPress: async () => {
            await supabase.from('shop_collections').delete().eq('id', c.id);
            await loadCollections();
          },
        },
      ]
    );
  };

  const collectionSummary = (c: CollectionRow): string => {
    const parts: string[] = [];
    for (const [slug, values] of Object.entries(c.filter.facetValues || {})) {
      if (values.length === 0) continue;
      const attr = filterableAttrs.find((a) => a.slug === slug);
      const label = attr ? pickText(attr.labelEn, attr.labelAr, language) : slug;
      parts.push(`${label}: ${values.join(', ')}`);
    }
    if (c.filter.priceMin != null || c.filter.priceMax != null) {
      parts.push(`$${c.filter.priceMin ?? 0}–${c.filter.priceMax ?? '∞'}`);
    }
    return parts.join(' · ');
  };

  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploadingLogo(true);
    try {
      const hosted = await uploadPhoto(result.assets[0].uri);
      setForm((f) => ({ ...f, logoUrl: hosted }));
    } catch {
      Alert.alert(t('myStorefront.uploadFailedTitle'), t('myStorefront.uploadFailedMessage'));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSelectPlace = (place: LebanonPlace) => {
    setForm((f) => ({ ...f, governorate: place.governorate, caza: place.caza }));
    setLocationQuery(`${place.caza}, ${place.governorate}`);
  };

  const handleBlurResolve = (place: LebanonPlace | null) => {
    if (place) handleSelectPlace(place);
  };

  const canSubmit = form.nameEn.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const resolved = findPlaceByFreeText(locationQuery);
      const payload: ShopInput = {
        ...form,
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr?.trim() || null,
        taglineEn: form.taglineEn?.trim() || null,
        taglineAr: form.taglineAr?.trim() || null,
        addressLine: form.addressLine?.trim() || null,
        whatsapp: form.whatsapp?.trim() || null,
        phone: form.phone?.trim() || null,
        governorate: form.governorate ?? resolved?.governorate ?? null,
        caza: form.caza ?? resolved?.caza ?? null,
      };
      if (isEditMode) {
        await updateShop(payload);
      } else {
        await createShop(payload);
      }
    } catch (e: any) {
      setError(e?.message || t('myStorefront.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressy onPress={goBack} style={styles.backBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <HomeMarkButton />
      <Text style={type.title}>{t(isEditMode ? 'myStorefront.manageTitle' : 'myStorefront.createTitle')}</Text>
    </View>
  );

  if (!isVerified) {
    // Redirect effect above is already firing -- this just avoids a flash
    // of the form for the instant before navigation.replace takes effect.
    return (
      <Screen maxWidth={640}>
        {header}
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      </Screen>
    );
  }

  const statusBanner = isEditMode && myShop && (
    myShop.verifiedAt != null ? (
      <View style={[styles.banner, styles.bannerLive]}>
        <Icon name="checkCircle" size={15} color={colors.success} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{t('myStorefront.statusLiveTitle')}</Text>
          <Text style={styles.bannerBody}>{t('myStorefront.statusLiveBody')}</Text>
        </View>
        <Pressy onPress={() => navigation.push('Storefront', { shopSlug: myShop.slug })} style={styles.bannerAction}>
          <Text style={styles.bannerActionText}>{t('myStorefront.viewStorefront')}</Text>
        </Pressy>
      </View>
    ) : myShop.verificationNote ? (
      <View style={[styles.banner, styles.bannerDeclined]}>
        <Icon name="close" size={15} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{t('myStorefront.statusChangesNeededTitle')}</Text>
          <Text style={styles.bannerBody}>{myShop.verificationNote}</Text>
        </View>
      </View>
    ) : (
      <View style={[styles.banner, styles.bannerPending]}>
        <Icon name="building" size={15} color={colors.ink} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{t('myStorefront.statusPendingTitle')}</Text>
          <Text style={styles.bannerBody}>{t('myStorefront.statusPendingBody')}</Text>
        </View>
      </View>
    )
  );

  return (
    <Screen maxWidth={640}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!isEditMode && <Text style={styles.intro}>{t('myStorefront.createIntro')}</Text>}
        {statusBanner}

        {isEditMode && myShop && (
          <View style={styles.collectionsSection}>
            <View style={styles.collectionsHeaderRow}>
              <Text style={styles.sectionTitle}>{t('myStorefront.collectionsTitle')}</Text>
              <Pressy onPress={openNewCollection} style={styles.addCollectionBtn}>
                <Icon name="plus" size={13} color={colors.primary} />
                <Text style={styles.addCollectionBtnText}>{t('myStorefront.addCollection')}</Text>
              </Pressy>
            </View>
            <Text style={styles.collectionsBody}>{t('myStorefront.collectionsBody')}</Text>
            {collectionsLoading ? (
              <ActivityIndicator color={colors.ink} style={{ marginTop: 10 }} />
            ) : collections.length === 0 ? (
              <Text style={styles.collectionsEmpty}>{t('myStorefront.collectionsEmpty')}</Text>
            ) : (
              collections.map((c) => (
                <View key={c.id} style={styles.collectionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collectionRowLabel} numberOfLines={1}>{c.labelEn}</Text>
                    {!!collectionSummary(c) && (
                      <Text style={styles.collectionRowSummary} numberOfLines={1}>{collectionSummary(c)}</Text>
                    )}
                  </View>
                  <Pressy
                    onPress={() => openEditCollection(c)}
                    style={styles.collectionRowBtn}
                    accessibilityLabel={t('myStorefront.editCollectionTitle')}
                  >
                    <Icon name="edit" size={14} color={colors.inkSoft} />
                  </Pressy>
                  <Pressy
                    onPress={() => deleteCollection(c)}
                    style={styles.collectionRowBtn}
                    accessibilityLabel={t('myStorefront.collectionDelete')}
                  >
                    <Icon name="trash" size={14} color={colors.danger} />
                  </Pressy>
                </View>
              ))
            )}
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('myStorefront.logoLabel')}</Text>
        <View style={styles.logoRow}>
          <View style={styles.logoPreview}>
            {uploadingLogo ? (
              <ActivityIndicator color={colors.ink} />
            ) : form.logoUrl ? (
              <Image source={{ uri: form.logoUrl }} style={styles.logoPreviewImg} resizeMode="cover" />
            ) : (
              <Icon name="building" size={22} color={colors.inkSoft} />
            )}
          </View>
          <Pressy onPress={pickLogo} style={styles.uploadBtn}>
            <Text style={styles.uploadBtnText}>{t(form.logoUrl ? 'myStorefront.replaceLogo' : 'myStorefront.uploadLogo')}</Text>
          </Pressy>
          {!!form.logoUrl && (
            <Pressy onPress={() => setForm((f) => ({ ...f, logoUrl: null }))} style={styles.removeBtn}>
              <Text style={styles.removeBtnText}>{t('common.remove')}</Text>
            </Pressy>
          )}
        </View>

        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.nameLabel')}</Text>
        <TextInput
          value={form.nameEn}
          onChangeText={(v) => setForm((f) => ({ ...f, nameEn: v }))}
          placeholder={t('myStorefront.nameEnPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        <TextInput
          value={form.nameAr || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, nameAr: v }))}
          placeholder={t('myStorefront.nameArPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputSpaced, styles.rtlInput]}
        />

        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.taglineLabel')}</Text>
        <TextInput
          value={form.taglineEn || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, taglineEn: v }))}
          placeholder={t('myStorefront.taglineEnPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        <TextInput
          value={form.taglineAr || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, taglineAr: v }))}
          placeholder={t('myStorefront.taglineArPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputSpaced, styles.rtlInput]}
        />

        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.categoryLabel')}</Text>
        <View style={styles.chipRow}>
          <Pressy
            onPress={() => setForm((f) => ({ ...f, primaryCategoryId: null }))}
            style={[styles.chip, form.primaryCategoryId === null && styles.chipActive]}
          >
            <Text style={[styles.chipText, form.primaryCategoryId === null && styles.chipTextActive]}>{t('myStorefront.categoryNone')}</Text>
          </Pressy>
          {topCategories.map((c) => (
            <Pressy
              key={c.id}
              onPress={() => setForm((f) => ({ ...f, primaryCategoryId: c.id }))}
              style={[styles.chip, form.primaryCategoryId === c.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, form.primaryCategoryId === c.id && styles.chipTextActive]}>
                {language === 'ar' ? c.nameAr : c.nameEn}
              </Text>
            </Pressy>
          ))}
        </View>

        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.locationLabel')}</Text>
        <PlaceSuggestInput
          value={locationQuery}
          onChangeText={setLocationQuery}
          onSelectPlace={handleSelectPlace}
          onBlurResolve={handleBlurResolve}
          placeholder={t('myStorefront.locationPlaceholder')}
          style={styles.input}
        />
        <TextInput
          value={form.addressLine || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, addressLine: v }))}
          placeholder={t('myStorefront.addressPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputSpaced]}
        />

        <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.contactLabel')}</Text>
        <TextInput
          value={form.whatsapp || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, whatsapp: v }))}
          placeholder={t('myStorefront.whatsappPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          keyboardType="phone-pad"
          style={styles.input}
        />
        <TextInput
          value={form.phone || ''}
          onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
          placeholder={t('myStorefront.phonePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          keyboardType="phone-pad"
          style={[styles.input, styles.inputSpaced]}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Button
          label={t(isEditMode ? 'myStorefront.saveChanges' : 'myStorefront.createStorefront')}
          onPress={handleSubmit}
          loading={saving}
          disabled={!canSubmit}
          style={{ marginTop: 22 }}
        />
      </ScrollView>

      <Modal
        visible={collectionModalOpen}
        animationType="slide"
        onRequestClose={() => setCollectionModalOpen(false)}
      >
        <Screen maxWidth={640}>
          <View style={styles.modalTopBar}>
            <Text style={type.h3}>
              {t(editingCollectionId ? 'myStorefront.editCollectionTitle' : 'myStorefront.newCollectionTitle')}
            </Text>
            <Pressy onPress={() => setCollectionModalOpen(false)} style={styles.iconBtn}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.collectionLabelEnField')}</Text>
            <TextInput
              value={collectionLabelEn}
              onChangeText={setCollectionLabelEn}
              placeholder={t('myStorefront.collectionLabelEnPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={styles.input}
            />
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.collectionLabelArField')}</Text>
            <TextInput
              value={collectionLabelAr}
              onChangeText={setCollectionLabelAr}
              placeholder={t('myStorefront.collectionLabelArPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={[styles.input, styles.rtlInput]}
            />

            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t('myStorefront.collectionPriceRange')}</Text>
            <View style={styles.priceRow}>
              <TextInput
                value={collectionPriceMin}
                onChangeText={setCollectionPriceMin}
                placeholder={t('myStorefront.collectionPriceMinPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="numeric"
                style={[styles.input, styles.priceInput]}
              />
              <TextInput
                value={collectionPriceMax}
                onChangeText={setCollectionPriceMax}
                placeholder={t('myStorefront.collectionPriceMaxPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                keyboardType="numeric"
                style={[styles.input, styles.priceInput]}
              />
            </View>

            {authorableFacets.length === 0 ? (
              <Text style={styles.collectionsEmpty}>{t('myStorefront.collectionNoFacets')}</Text>
            ) : (
              <View style={{ marginTop: 18 }}>
                {authorableFacets.map(({ attr, options }) => (
                  <FacetChipGroup
                    key={attr.slug}
                    title={pickText(attr.labelEn, attr.labelAr, language)}
                    options={options}
                    selected={collectionFacetValues[attr.slug] || []}
                    onToggle={(v) => toggleCollectionFacetValue(attr.slug, v)}
                    mode={attr.type === 'select' ? 'single' : 'multi'}
                  />
                ))}
              </View>
            )}

            {!!collectionError && <Text style={styles.error}>{collectionError}</Text>}
          </ScrollView>
          <View style={styles.modalFooter}>
            <Button
              label={t('myStorefront.collectionSave')}
              onPress={saveCollection}
              loading={collectionSaving}
              disabled={!collectionLabelEn.trim()}
              style={{ flex: 1 }}
            />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 80 },
  intro: { ...type.soft, lineHeight: 19, marginBottom: 16 },
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: radius.md, padding: 14, marginBottom: 20, borderWidth: 1,
  },
  bannerPending: { backgroundColor: colors.warnBg, borderColor: colors.accentRing },
  bannerLive: { backgroundColor: '#e3efe8', borderColor: colors.success },
  bannerDeclined: { backgroundColor: '#f5e4e2', borderColor: colors.danger },
  bannerTitle: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  bannerBody: { fontSize: 12.5, color: colors.inkSoft, lineHeight: 17 },
  bannerAction: { alignSelf: 'center' },
  bannerActionText: { fontSize: 12.5, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  sectionTitle: { ...type.h3, marginTop: 6, marginBottom: 10 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoPreview: {
    width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
  },
  logoPreviewImg: { width: '100%', height: '100%' },
  uploadBtn: {
    height: 38, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  removeBtn: { height: 38, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  inputSpaced: { marginTop: 10 },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 34, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.white },
  error: { color: colors.danger, fontSize: 13, marginTop: 16 },

  collectionsSection: {
    marginTop: 6, marginBottom: 22, padding: 14, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  collectionsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addCollectionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addCollectionBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  collectionsBody: { ...type.soft, fontSize: 12.5, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  collectionsEmpty: { ...type.soft, fontSize: 12.5, marginTop: 4 },
  collectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line,
  },
  collectionRowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  collectionRowSummary: { fontSize: 11.5, color: colors.inkSoft, marginTop: 2 },
  collectionRowBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },

  modalTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, height: 52 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 30 },
  modalFooter: { flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.line },
  priceRow: { flexDirection: 'row', gap: 10 },
  priceInput: { flex: 1 },
});
