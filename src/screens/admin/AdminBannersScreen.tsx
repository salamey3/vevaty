import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import CategoryPickerModal from '../../components/CategoryPickerModal';
import { colors, type, radius } from '../../theme/theme';
import { useAppStore } from '../../store/AppStore';
import { useCollections } from '../../store/CollectionsStore';
import { useSettings } from '../../store/SettingsStore';
import { useBanners } from '../../store/BannerStore';
import { uploadPhoto } from '../../lib/photoUpload';
import { Banner, BannerLinkType, BannerSlot, Listing } from '../../types';
import { RootStackParamList } from '../../navigation/types';

// Managed banners across the three placements -- see myazar.banners and the
// "Vevaty — Managed Banner Placements" design spec for the full behavior
// this screen configures. Unlike the rest of the app, this admin screen (like
// AdminCollectionsScreen and AdminBrandingScreen beside it) isn't run through
// t() -- the admin panel is an internal EN-only tool, not visitor-facing.

const SLOT_LABEL: Record<BannerSlot, string> = {
  sidebar_nav: 'Sidebar',
  listing_detail_desktop_rail: 'Listing (Desktop)',
  listing_detail_mobile: 'Listing (Mobile)',
  home_after_editors_picks: "Home: Editor's Picks → Hot Deals",
  home_after_just_listed: 'Home: Just Listed → Vehicles',
};

const SLOT_DIMENSIONS: Record<BannerSlot, string> = {
  // No longer a fixed cap -- TabBar.tsx now measures the real gap between
  // the nav list and the footer and passes it to BannerSlotView as an
  // exact height budget (see that component's own comment on the
  // difference), so the box stretches to fill it rather than stopping at
  // the creative's natural aspect-ratio height. That budget varies by
  // window height (roughly 500-700px+ tall on a typical desktop, taller on
  // a bigger monitor), so there's no one fixed number to give here --
  // hence "varies by screen" rather than a hard cap like the other slots.
  // resizeMode="cover" fills whatever height it's given, cropping the
  // creative if its own aspect ratio falls short, so a tall image (not
  // one authored for the old 320px cap) is what avoids visible cropping.
  sidebar_nav: '200px wide · height fills the sidebar down to the footer (varies by screen, often 500-700px+ tall) -- design tall, since it crops via cover',
  listing_detail_desktop_rail: '440px wide · up to 800px tall',
  listing_detail_mobile: 'Full page width · height follows the creative',
  home_after_editors_picks: 'Full page width · height follows the creative -- mobile site and app only, never shown on desktop',
  home_after_just_listed: 'Full page width · height follows the creative -- mobile site and app only, never shown on desktop',
};

const LINK_TYPE_LABEL: Record<BannerLinkType, string> = {
  external: 'Web URL',
  collection: 'Collection',
  category: 'Category',
  listing: 'Listing',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus30DaysStr(fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

type BannerStatus = 'active' | 'scheduled' | 'expired' | 'paused';

function bannerStatus(b: Banner): BannerStatus {
  if (!b.isActive) return 'paused';
  const today = todayStr();
  if (today < b.startDate) return 'scheduled';
  if (today > b.endDate) return 'expired';
  return 'active';
}

const STATUS_LABEL: Record<BannerStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  paused: 'Paused',
};

const STATUS_COLOR: Record<BannerStatus, { bg: string; fg: string }> = {
  active: { bg: colors.primaryTint, fg: colors.success },
  scheduled: { bg: colors.accentTint, fg: colors.accentDeep },
  expired: { bg: colors.surface, fg: colors.inkSoft },
  paused: { bg: colors.surface, fg: colors.inkSoft },
};

interface FormState {
  imageUrlEn: string | null;
  imageUrlAr: string | null;
  linkType: BannerLinkType;
  linkTarget: string;
  openNewTab: boolean;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

function blankForm(): FormState {
  const start = todayStr();
  return {
    imageUrlEn: null,
    imageUrlAr: null,
    linkType: 'external',
    linkTarget: '',
    openNewTab: false,
    startDate: start,
    endDate: plus30DaysStr(start),
    isActive: true,
  };
}

function formFromBanner(b: Banner): FormState {
  return {
    imageUrlEn: b.imageUrlEn,
    imageUrlAr: b.imageUrlAr,
    linkType: b.linkType,
    linkTarget: b.linkTarget,
    openNewTab: b.openNewTab,
    startDate: b.startDate,
    endDate: b.endDate,
    isActive: b.isActive,
  };
}

// Same "pick from the device, upload, show a preview" shape as
// AdminBrandingScreen's ImagePickerField -- kept as its own local copy
// (not extracted into a shared component) since that's the existing
// precedent in this codebase: each admin screen owns its picker field
// rather than the two coupling to a shared one.
function BannerImageField({
  label,
  hint,
  url,
  onPicked,
  onRemove,
  rtlPreviewText,
}: {
  label: string;
  hint?: string;
  url: string | null;
  onPicked: (url: string) => void;
  onRemove: () => void;
  rtlPreviewText?: boolean;
}) {
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const hosted = await uploadPhoto(result.assets[0].uri);
      onPicked(hosted);
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload that image. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
      <View style={styles.imgRow}>
        <View style={[styles.imgPreview, rtlPreviewText && styles.imgPreviewRTL]}>
          {uploading ? (
            <ActivityIndicator color={colors.ink} />
          ) : url ? (
            <Image source={{ uri: url }} style={styles.imgPreviewImg} resizeMode="cover" />
          ) : (
            <Icon name="image" size={20} color={colors.inkSoft} />
          )}
        </View>
        <Pressy onPress={pick} style={styles.uploadBtn}>
          <Text style={styles.uploadBtnText}>{url ? 'Replace' : 'Upload'}</Text>
        </Pressy>
        {!!url && (
          <Pressy onPress={onRemove} style={styles.removeBtn}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </Pressy>
        )}
      </View>
    </View>
  );
}

export default function AdminBannersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { banners, loaded, addBanner, updateBanner, deleteBanner, eventCounts } = useBanners();
  const { collections } = useCollections();
  const { listings: allListings } = useAppStore();
  const { categoryById } = useSettings();

  const [selectedSlot, setSelectedSlot] = useState<BannerSlot>('sidebar_nav');
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [listingQuery, setListingQuery] = useState('');

  const updateForm = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const slotBanners = useMemo(
    () => banners.filter((b) => b.slot === selectedSlot).slice().sort((a, b) => b.createdAt - a.createdAt),
    [banners, selectedSlot]
  );

  const openNew = () => {
    setForm(blankForm());
    setListingQuery('');
    setEditing('new');
  };

  const openEdit = (b: Banner) => {
    setForm(formFromBanner(b));
    setListingQuery('');
    setEditing(b.id);
  };

  const closeForm = () => {
    setEditing(null);
    setListingQuery('');
  };

  const setLinkType = (linkType: BannerLinkType) => {
    // Whatever was picked under the old type (a URL string, a listing id,
    // ...) isn't a valid target for the new one -- clear it rather than
    // silently carrying over a value that would fail to resolve.
    updateForm({ linkType, linkTarget: '' });
  };

  const save = async () => {
    if (!form.imageUrlEn || !form.imageUrlAr) {
      Alert.alert('Both creatives required', 'Upload an English AND an Arabic image for this banner -- there is no fallback for this placement.');
      return;
    }
    if (!form.linkTarget.trim()) {
      Alert.alert('Missing link', 'Choose where this banner should send visitors.');
      return;
    }
    if (!DATE_RE.test(form.startDate) || !DATE_RE.test(form.endDate)) {
      Alert.alert('Invalid dates', 'Use the YYYY-MM-DD format for both the start and end date.');
      return;
    }
    if (form.endDate < form.startDate) {
      Alert.alert('Invalid date range', 'The end date must be on or after the start date.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        slot: selectedSlot,
        imageUrlEn: form.imageUrlEn,
        imageUrlAr: form.imageUrlAr,
        linkType: form.linkType,
        linkTarget: form.linkTarget.trim(),
        openNewTab: form.openNewTab,
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: form.isActive,
      };
      if (editing === 'new') {
        await addBanner(payload);
      } else if (editing) {
        await updateBanner(editing, payload);
      }
      closeForm();
    } catch (e: any) {
      Alert.alert('Could not save banner', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: Banner) => {
    setBusyId(b.id);
    try {
      await deleteBanner(b.id);
    } catch (e: any) {
      Alert.alert('Could not delete banner', e?.message || String(e));
    } finally {
      setBusyId(null);
    }
  };

  const listingResults = useMemo(() => {
    const q = listingQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return allListings
      .filter((l) => l.titleEn.toLowerCase().includes(q) || l.titleAr.toLowerCase().includes(q))
      .slice(0, 20);
  }, [listingQuery, allListings]);

  const selectedListing: Listing | undefined =
    form.linkType === 'listing' && form.linkTarget ? allListings.find((l) => l.id === form.linkTarget) : undefined;
  const selectedCategory = form.linkType === 'category' && form.linkTarget ? categoryById(form.linkTarget) : undefined;

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => (editing ? closeForm() : navigation.goBack())} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{editing ? (editing === 'new' ? 'New banner' : 'Edit banner') : 'Manage banners'}</Text>
        <View style={styles.iconBtn} />
      </View>

      {!editing && (
        <View style={styles.tabRow}>
          {(Object.keys(SLOT_LABEL) as BannerSlot[]).map((slot) => (
            <Pressy
              key={slot}
              onPress={() => setSelectedSlot(slot)}
              style={[styles.tab, selectedSlot === slot && styles.tabActive]}
            >
              <Text style={[styles.tabText, selectedSlot === slot && styles.tabTextActive]}>{SLOT_LABEL[slot]}</Text>
            </Pressy>
          ))}
        </View>
      )}

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : editing ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldHint}>{SLOT_LABEL[selectedSlot]} · {SLOT_DIMENSIONS[selectedSlot]}</Text>

          <BannerImageField label="English creative" url={form.imageUrlEn} onPicked={(u) => updateForm({ imageUrlEn: u })} onRemove={() => updateForm({ imageUrlEn: null })} />
          <BannerImageField label="Arabic creative" url={form.imageUrlAr} onPicked={(u) => updateForm({ imageUrlAr: u })} onRemove={() => updateForm({ imageUrlAr: null })} rtlPreviewText />

          <Text style={styles.fieldLabel}>Links to</Text>
          <View style={styles.chipRow}>
            {(Object.keys(LINK_TYPE_LABEL) as BannerLinkType[]).map((lt) => (
              <Pressy key={lt} onPress={() => setLinkType(lt)} style={[styles.chip, form.linkType === lt && styles.chipActive]}>
                <Text style={[styles.chipText, form.linkType === lt && styles.chipTextActive]}>{LINK_TYPE_LABEL[lt]}</Text>
              </Pressy>
            ))}
          </View>

          {form.linkType === 'external' && (
            <TextInput
              value={form.linkTarget}
              onChangeText={(v) => updateForm({ linkTarget: v })}
              placeholder="https://…"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              keyboardType="url"
              style={styles.input}
            />
          )}

          {form.linkType === 'collection' && (
            <View style={styles.chipRow}>
              {collections.map((c) => (
                <Pressy
                  key={c.id}
                  onPress={() => updateForm({ linkTarget: c.slug })}
                  style={[styles.chip, form.linkTarget === c.slug && styles.chipActive]}
                >
                  <Text style={[styles.chipText, form.linkTarget === c.slug && styles.chipTextActive]}>{c.titleEn}</Text>
                </Pressy>
              ))}
            </View>
          )}

          {form.linkType === 'category' && (
            <Pressy onPress={() => setCategoryPickerOpen(true)} style={styles.pickerRow}>
              <Text style={selectedCategory ? styles.pickerRowValue : styles.pickerRowPlaceholder}>
                {selectedCategory ? selectedCategory.nameEn : 'Choose a category…'}
              </Text>
              <Icon name="chevronRight" size={15} color={colors.inkSoft} />
            </Pressy>
          )}

          {form.linkType === 'listing' && (
            <>
              {selectedListing ? (
                <View style={styles.rowCard}>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{selectedListing.titleEn}</Text>
                    <Text style={styles.rowSub}>${selectedListing.price.toLocaleString()} · {selectedListing.district}</Text>
                  </View>
                  <Pressy onPress={() => updateForm({ linkTarget: '' })} style={styles.removeBtn}>
                    <Text style={styles.removeBtnText}>Change</Text>
                  </Pressy>
                </View>
              ) : (
                <>
                  <View style={styles.searchWrap}>
                    <Icon name="search" size={15} color={colors.inkSoft} />
                    <TextInput
                      value={listingQuery}
                      onChangeText={setListingQuery}
                      placeholder="Search by title…"
                      placeholderTextColor={colors.inkSoft}
                      style={styles.searchInput}
                    />
                  </View>
                  <View style={styles.list}>
                    {listingResults.map((l) => (
                      <Pressy key={l.id} onPress={() => { updateForm({ linkTarget: l.id }); setListingQuery(''); }} style={styles.rowCard}>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{l.titleEn}</Text>
                          <Text style={styles.rowSub}>${l.price.toLocaleString()} · {l.district}</Text>
                        </View>
                        <Text style={styles.addBtnText}>Select</Text>
                      </Pressy>
                    ))}
                    {listingQuery.trim().length >= 2 && listingResults.length === 0 && (
                      <Text style={[type.soft, styles.emptyNote]}>No listings match "{listingQuery.trim()}".</Text>
                    )}
                  </View>
                </>
              )}
            </>
          )}

          {form.linkType === 'external' && (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Open in a new tab</Text>
                <Text style={styles.fieldHint}>Web only -- on the native app this always hands off to the visitor's browser either way.</Text>
              </View>
              <Switch value={form.openNewTab} onValueChange={(v) => updateForm({ openNewTab: v })} />
            </View>
          )}

          <Text style={styles.fieldLabel}>Runs</Text>
          <View style={styles.dateRow}>
            <TextInput
              value={form.startDate}
              onChangeText={(v) => updateForm({ startDate: v })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              style={[styles.input, { flex: 1 }]}
            />
            <Text style={styles.dateTo}>to</Text>
            <TextInput
              value={form.endDate}
              onChangeText={(v) => updateForm({ endDate: v })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              style={[styles.input, { flex: 1 }]}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Active</Text>
              <Text style={styles.fieldHint}>Off pauses this banner immediately, even inside its date window.</Text>
            </View>
            <Switch value={form.isActive} onValueChange={(v) => updateForm({ isActive: v })} />
          </View>

          <View style={styles.formActions}>
            <Button label="Cancel" variant="secondary" onPress={closeForm} style={{ flex: 1 }} />
            <Button label={editing === 'new' ? 'Create banner' : 'Save changes'} onPress={save} loading={saving} style={{ flex: 1 }} />
          </View>

          <CategoryPickerModal
            visible={categoryPickerOpen}
            value={(form.linkTarget || null) as any}
            onSelect={(id) => updateForm({ linkTarget: id })}
            onClose={() => setCategoryPickerOpen(false)}
          />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.fieldHint}>{SLOT_DIMENSIONS[selectedSlot]}</Text>

          <Pressy onPress={openNew} style={styles.newBtn}>
            <Icon name="plus" size={15} color={colors.white} />
            <Text style={styles.newBtnText}>New banner</Text>
          </Pressy>

          {slotBanners.length === 0 ? (
            <Text style={[type.soft, styles.emptyNote]}>No banners in this placement yet.</Text>
          ) : (
            <View style={styles.list}>
              {slotBanners.map((b) => {
                const status = bannerStatus(b);
                const statusColor = STATUS_COLOR[status];
                const counts = eventCounts(b.id);
                return (
                  <View key={b.id} style={styles.rowCard}>
                    <View style={styles.thumb}>
                      <Image source={{ uri: b.imageUrlEn }} style={styles.thumbImg} resizeMode="cover" />
                    </View>
                    <View style={styles.rowInfo}>
                      <View style={styles.rowTitleLine}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{LINK_TYPE_LABEL[b.linkType]}: {b.linkTarget}</Text>
                        <View style={[styles.tag, { backgroundColor: statusColor.bg }]}>
                          <Text style={[styles.tagText, { color: statusColor.fg }]}>{STATUS_LABEL[status]}</Text>
                        </View>
                      </View>
                      <Text style={styles.rowSub} numberOfLines={1}>{b.startDate} → {b.endDate}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{counts.impressions} impressions · {counts.clicks} clicks</Text>
                    </View>
                    <View style={styles.rowControls}>
                      <Pressy onPress={() => openEdit(b)} style={styles.smallBtn} disabled={busyId === b.id}>
                        <Icon name="edit" size={13} color={colors.ink} />
                      </Pressy>
                      <Pressy onPress={() => remove(b)} style={styles.removeBtnRound} disabled={busyId === b.id}>
                        <Icon name="trash" size={13} color={colors.danger} />
                      </Pressy>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 56 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginBottom: 4 },
  tab: {
    flex: 1, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 11.5, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  tabTextActive: { color: colors.white },
  scroll: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 60 },
  emptyNote: { marginTop: 8, marginBottom: 8 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: radius.pill, backgroundColor: colors.primary, marginTop: 12, marginBottom: 16,
  },
  newBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },
  list: { gap: 8 },
  rowCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  thumb: {
    width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  rowSub: { ...type.tiny, marginTop: 1 },
  tag: { borderRadius: radius.pill, paddingHorizontal: 7, height: 17, alignItems: 'center', justifyContent: 'center' },
  tagText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  removeBtnRound: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5E4E2' },
  addBtnText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40, marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, height: '100%' },

  field: { marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  fieldHint: { ...type.soft, marginTop: 2, marginBottom: 4, lineHeight: 17 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  imgRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  imgPreview: {
    width: 72, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
  },
  imgPreviewRTL: {},
  imgPreviewImg: { width: '100%', height: '100%' },
  uploadBtn: {
    height: 38, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  removeBtn: { height: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    height: 34, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.white },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46,
  },
  pickerRowValue: { fontSize: 14.5, color: colors.ink },
  pickerRowPlaceholder: { fontSize: 14.5, color: colors.inkSoft },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateTo: { fontSize: 13, color: colors.inkSoft },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 30 },
});
