import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { uploadPhoto } from '../../lib/photoUpload';
import { Category } from '../../types';
import { RootStackParamList } from '../../navigation/types';

type FormState = {
  id: string;
  nameEn: string;
  nameAr: string;
  iconUrl: string | null;
  supports3d: boolean;
  shotListEn: string;
  shotListAr: string;
  isService: boolean;
  usesOfferType: boolean;
  domainId: string | null;
  titleExampleEn: string;
  titleExampleAr: string;
  descriptionExampleEn: string;
  descriptionExampleAr: string;
  stockMode: 'unique' | 'multiple';
};

function blankForm(): FormState {
  return {
    id: '', nameEn: '', nameAr: '', iconUrl: null, supports3d: false, shotListEn: '', shotListAr: '',
    isService: false, usesOfferType: false, domainId: null, titleExampleEn: '', titleExampleAr: '', descriptionExampleEn: '', descriptionExampleAr: '',
    stockMode: 'unique',
  };
}

function formFor(c: Category): FormState {
  return {
    id: c.id,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    iconUrl: c.iconUrl,
    supports3d: c.supports3d,
    shotListEn: c.shotListEn.join('\n'),
    shotListAr: c.shotListAr.join('\n'),
    isService: c.isService,
    usesOfferType: c.usesOfferType,
    domainId: c.domainId,
    titleExampleEn: c.titleExampleEn || '',
    titleExampleAr: c.titleExampleAr || '',
    descriptionExampleEn: c.descriptionExampleEn || '',
    descriptionExampleAr: c.descriptionExampleAr || '',
    stockMode: c.stockMode,
  };
}

function slugify(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function autosaveLabel(state: 'idle' | 'pending' | 'saving' | 'saved' | 'error') {
  switch (state) {
    case 'pending':
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Could not save';
    default:
      return '';
  }
}

// `undefined` means "not creating anything right now"; `null` means
// "creating a new top-level category"; a category id means "creating a
// subcategory under that parent".
type CreatingUnder = string | null | undefined;

export default function AdminCategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { allDomains, allCategories, childrenOf, createCategory, updateCategory, reorderCategories, deleteCategory } = useSettings();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<CreatingUnder>(undefined);
  const [form, setForm] = useState<FormState>(blankForm());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which top-level category's subcategory list is currently expanded.
  // null = everything collapsed. Only one can be open at a time (accordion).
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  // Autosave status shown next to an existing category's form, since edits
  // to an existing category save themselves as you type -- there's no
  // explicit Save button to confirm against.
  const [autosaveState, setAutosaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');

  const topLevel = allCategories.filter((c) => !c.parentId);

  // Autosave plumbing: text-field edits are debounced (so we're not firing
  // a write per keystroke) but always flushed immediately before we switch
  // to editing something else, so nothing typed is ever silently dropped.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ id: string; form: FormState } | null>(null);

  const buildCategoryPatch = (f: FormState) => ({
    nameEn: f.nameEn.trim(),
    nameAr: f.nameAr.trim(),
    iconUrl: f.iconUrl,
    supports3d: f.supports3d,
    shotListEn: f.shotListEn.split('\n').map((s) => s.trim()).filter(Boolean),
    shotListAr: f.shotListAr.split('\n').map((s) => s.trim()).filter(Boolean),
    isService: f.isService,
    usesOfferType: f.usesOfferType,
    domainId: f.domainId,
    titleExampleEn: f.titleExampleEn.trim() || null,
    titleExampleAr: f.titleExampleAr.trim() || null,
    descriptionExampleEn: f.descriptionExampleEn.trim() || null,
    descriptionExampleAr: f.descriptionExampleAr.trim() || null,
    stockMode: f.stockMode,
  });

  const doAutosave = async (id: string, f: FormState) => {
    if (!f.nameEn.trim() || !f.nameAr.trim()) {
      // Don't autosave a half-typed name -- wait until both are filled in.
      setAutosaveState('idle');
      return;
    }
    setAutosaveState('saving');
    try {
      await updateCategory(id, buildCategoryPatch(f));
      setAutosaveState('saved');
    } catch (e: any) {
      setAutosaveState('error');
      Alert.alert('Could not save', e?.message || String(e));
    }
  };

  const flushAutosave = () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    void doAutosave(pending.id, pending.form);
  };

  useEffect(() => () => flushAutosave(), []); // flush on unmount

  const scheduleAutosave = (id: string, formSnapshot: FormState) => {
    pendingSaveRef.current = { id, form: formSnapshot };
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setAutosaveState('pending');
    autosaveTimer.current = setTimeout(flushAutosave, 700);
  };

  // Every field editor calls this instead of setForm directly, so a change
  // to an already-existing category is scheduled for autosave; a change
  // while creating a brand-new category just updates local state (that one
  // still needs the explicit Create button, since it isn't a real row yet).
  const updateForm = (patch: Partial<FormState>) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (editingId) scheduleAutosave(editingId, next);
      return next;
    });
  };

  const startCreate = (parentId: string | null) => {
    flushAutosave();
    setForm(blankForm());
    setCreatingUnder(parentId);
    setEditingId(null);
    setAutosaveState('idle');
  };

  const startEdit = (c: Category) => {
    flushAutosave();
    setForm(formFor(c));
    setEditingId(c.id);
    setCreatingUnder(undefined);
    setAutosaveState('idle');
  };

  const cancel = () => {
    flushAutosave();
    setEditingId(null);
    setCreatingUnder(undefined);
    setForm(blankForm());
    setAutosaveState('idle');
  };

  // Top-level categories are collapsed by default. Clicking one opens its
  // own edit form and reveals its subcategories underneath; clicking a
  // different one closes whichever was open, so only one is ever expanded.
  const toggleTopLevel = (c: Category) => {
    if (expandedParentId === c.id) {
      setExpandedParentId(null);
      cancel();
    } else {
      setExpandedParentId(c.id);
      startEdit(c);
    }
  };

  const pickIcon = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(result.assets[0].uri);
      updateForm({ iconUrl: url });
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload that image. Try again.');
    } finally {
      setUploading(false);
    }
  };

  // Only used for creating a brand-new category -- editing an existing one
  // autosaves via updateForm/scheduleAutosave above instead.
  const save = async (parentId: string | null) => {
    if (!form.nameEn.trim() || !form.nameAr.trim()) {
      Alert.alert('Missing name', 'Enter both an English and Arabic name.');
      return;
    }
    setSaving(true);
    try {
      const id = slugify(form.id || form.nameEn);
      if (!id) {
        Alert.alert('Missing ID', 'Enter an ID for this category (letters, numbers, hyphens).');
        setSaving(false);
        return;
      }
      await createCategory({ id, parentId, ...buildCategoryPatch(form) });
      cancel();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Category) => {
    try {
      await updateCategory(c.id, { active: !c.active });
    } catch (e: any) {
      Alert.alert('Could not update', e?.message || String(e));
    }
  };

  const move = async (siblings: Category[], index: number, dir: -1 | 1, parentId: string | null) => {
    const target = index + dir;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderCategories(parentId, ids);
    } catch (e: any) {
      Alert.alert('Could not reorder', e?.message || String(e));
    }
  };

  const remove = (c: Category) => {
    Alert.alert(
      `Delete "${c.nameEn}"?`,
      'This permanently removes the category. If listings or subcategories still use it, deletion is blocked -- deactivate it instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(c.id);
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message || String(e));
            }
          },
        },
      ]
    );
  };

  const renderForm = (parentId: string | null, isNew: boolean) => (
    <View style={styles.form}>
      {isNew && (
        <>
          <Text style={styles.fieldLabel}>ID (used internally, can't change later)</Text>
          <TextInput
            value={form.id}
            onChangeText={(v) => updateForm({ id: v })}
            placeholder={slugify(form.nameEn) || 'e.g. home-appliances'}
            autoCapitalize="none"
            style={styles.input}
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Name (English)</Text>
      <TextInput value={form.nameEn} onChangeText={(v) => updateForm({ nameEn: v })} style={styles.input} />
      <Text style={styles.fieldLabel}>Name (Arabic)</Text>
      <TextInput value={form.nameAr} onChangeText={(v) => updateForm({ nameAr: v })} style={[styles.input, styles.rtlInput]} />

      <Text style={styles.fieldLabel}>Icon</Text>
      <View style={styles.iconRow}>
        <View style={styles.iconPreview}>
          {uploading ? (
            <ActivityIndicator color={colors.ink} />
          ) : form.iconUrl ? (
            <Image source={{ uri: form.iconUrl }} style={styles.iconImg} resizeMode="contain" />
          ) : (
            <Icon name="sparkle" size={22} color={colors.inkSoft} />
          )}
        </View>
        <Pressy onPress={pickIcon} style={styles.uploadBtn}>
          <Text style={styles.uploadBtnText}>{form.iconUrl ? 'Change icon' : 'Upload icon'}</Text>
        </Pressy>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Supports 3D capture</Text>
        <Switch value={form.supports3d} onValueChange={(v) => updateForm({ supports3d: v })} />
      </View>

      <Text style={styles.fieldLabel}>Suggested photo shots (English, one per line)</Text>
      <TextInput
        value={form.shotListEn}
        onChangeText={(v) => updateForm({ shotListEn: v })}
        multiline
        style={[styles.input, styles.textarea]}
      />
      <Text style={styles.fieldLabel}>Suggested photo shots (Arabic, one per line)</Text>
      <TextInput
        value={form.shotListAr}
        onChangeText={(v) => updateForm({ shotListAr: v })}
        multiline
        style={[styles.input, styles.textarea, styles.rtlInput]}
      />

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Services category</Text>
          <Text style={styles.fieldHint}>Listings under this category get a "Contact to hire" button instead of buy/rent. Applies to all its subcategories too.</Text>
        </View>
        <Switch value={form.isService} onValueChange={(v) => updateForm({ isService: v })} />
      </View>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Sale / rent category</Text>
          <Text style={styles.fieldHint}>Sellers pick "For sale", "For rent" or "Both" instead of "New / Used", and rentals get rent terms (amount, period, advance payment). Used by Properties and Vehicles. Applies to all its subcategories too.</Text>
        </View>
        <Switch value={form.usesOfferType} onValueChange={(v) => updateForm({ usesOfferType: v })} />
      </View>

      {/* Only meaningful on a top-level category: domain_id is set there
          and inherited by everything beneath it, so a subcategory showing
          its own picker would invite setting it to something that then
          gets ignored. See DOMAINS.md. */}
      {!parentId && (
        <>
          <Text style={styles.fieldLabel}>Domain</Text>
          <Text style={styles.fieldHint}>
            Which card on the Sell and Home gate this category sits behind. Applies to all its subcategories too.
          </Text>
          <View style={styles.domainRow}>
            {allDomains.map((d) => (
              <Pressy
                key={d.id}
                onPress={() => updateForm({ domainId: form.domainId === d.id ? null : d.id })}
                style={[styles.domainPill, form.domainId === d.id && styles.domainPillActive]}
              >
                <Text style={[styles.domainPillText, form.domainId === d.id && styles.domainPillTextActive]}>
                  {d.nameEn}
                </Text>
              </Pressy>
            ))}
          </View>
        </>
      )}

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Shops carry stock (vs. one-of-a-kind)</Text>
          <Text style={styles.fieldHint}>
            On: posting a listing in this category (or its subcategories) shows a Stock step -- per-size quantities if
            the category has a "Stock variant" attribute (see its Attributes screen), otherwise a single quantity
            field. Off (default): every listing is one specific item, same as today.
          </Text>
        </View>
        <Switch
          value={form.stockMode === 'multiple'}
          onValueChange={(v) => updateForm({ stockMode: v ? 'multiple' : 'unique' })}
        />
      </View>

      <Text style={styles.fieldLabel}>Title placeholder (English)</Text>
      <Text style={styles.fieldHint}>Shown as an example when a seller posts in this category, e.g. "3BR Apartment in Achrafieh".</Text>
      <TextInput
        value={form.titleExampleEn}
        onChangeText={(v) => updateForm({ titleExampleEn: v })}
        placeholder="e.g. iPhone 13 Pro — 256GB"
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>Title placeholder (Arabic)</Text>
      <TextInput
        value={form.titleExampleAr}
        onChangeText={(v) => updateForm({ titleExampleAr: v })}
        placeholder="مثال: آيفون 13 برو — 256 جيجابايت"
        style={[styles.input, styles.rtlInput]}
      />
      <Text style={styles.fieldLabel}>Description placeholder (English)</Text>
      <TextInput
        value={form.descriptionExampleEn}
        onChangeText={(v) => updateForm({ descriptionExampleEn: v })}
        placeholder="Condition, why you're selling, anything a buyer should know"
        multiline
        style={[styles.input, styles.textarea]}
      />
      <Text style={styles.fieldLabel}>Description placeholder (Arabic)</Text>
      <TextInput
        value={form.descriptionExampleAr}
        onChangeText={(v) => updateForm({ descriptionExampleAr: v })}
        placeholder="الحالة، سبب البيع، وأي شيء يجب أن يعرفه المشتري"
        multiline
        style={[styles.input, styles.textarea, styles.rtlInput]}
      />

      <View style={styles.formActions}>
        {isNew ? (
          <>
            <Pressy onPress={cancel} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressy>
            <Button label="Create" onPress={() => save(parentId)} loading={saving} style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <Text style={styles.autosaveText}>{autosaveLabel(autosaveState)}</Text>
            <Pressy onPress={cancel} style={[styles.cancelBtn, styles.closeBtn]}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </Pressy>
          </>
        )}
      </View>
    </View>
  );

  const renderRow = (c: Category, siblings: Category[], index: number, parentId: string | null, indented: boolean) => (
    <View key={c.id} style={[styles.card, indented && styles.cardIndented]}>
      <Pressy
        onPress={() => (indented ? (editingId === c.id ? cancel() : startEdit(c)) : toggleTopLevel(c))}
        style={styles.row}
      >
        {!indented && (
          <View style={[styles.chevron, expandedParentId === c.id && styles.chevronExpanded]}>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </View>
        )}
        <View style={styles.rowIcon}>
          {c.iconUrl ? (
            <Image source={{ uri: c.iconUrl }} style={styles.iconImg} resizeMode="contain" />
          ) : (
            <Icon name={c.icon as any} size={20} color={colors.ink} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{c.nameEn}</Text>
          <Text style={styles.rowSub}>{c.nameAr} · {c.id}{!c.active ? ' · inactive' : ''}</Text>
        </View>
        <View style={styles.rowControls}>
          <Pressy
            onPress={() => navigation.navigate('AdminCategoryAttributes', { categoryId: c.id, focusFilters: true })}
            style={styles.smallBtn}
          >
            <Icon name="gear" size={14} color={colors.ink} />
          </Pressy>
          <Pressy onPress={() => move(siblings, index, -1, parentId)} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>↑</Text>
          </Pressy>
          <Pressy onPress={() => move(siblings, index, 1, parentId)} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>↓</Text>
          </Pressy>
          <Switch value={c.active} onValueChange={() => toggleActive(c)} />
        </View>
      </Pressy>

      {editingId === c.id && (
        <>
          {renderForm(parentId, false)}
          <Pressy
            onPress={() => navigation.navigate('AdminCategoryAttributes', { categoryId: c.id })}
            style={styles.attributesBtn}
          >
            <Icon name="sparkle" size={14} color={colors.ink} />
            <Text style={styles.attributesBtnText}>Manage spec fields (attributes)</Text>
          </Pressy>
          <Pressy onPress={() => remove(c)} style={styles.deleteBtn}>
            <Icon name="close" size={14} color={colors.danger} />
            <Text style={styles.deleteBtnText}>Delete category</Text>
          </Pressy>
        </>
      )}
    </View>
  );

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Categories</Text>
        <Pressy onPress={() => startCreate(null)} style={styles.iconBtn}>
          <Icon name="plus" size={18} />
        </Pressy>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>
          Tap a category to expand it, edit it, add subcategories underneath it (e.g. Apartments under Properties), or
          manage its spec fields. Spec fields defined on a top-level category are inherited by all of its
          subcategories. Changes to an existing category save automatically as you type.
        </Text>

        {creatingUnder === null && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New top-level category</Text>
            {renderForm(null, true)}
          </View>
        )}

        {topLevel.map((c, index) => {
          const expanded = expandedParentId === c.id;
          const children = expanded ? childrenOf(c.id, { includeInactive: true }) : [];
          return (
            <View key={c.id}>
              {renderRow(c, topLevel, index, null, false)}
              {expanded && (
                <>
                  {children.map((child, childIndex) => renderRow(child, children, childIndex, c.id, true))}
                  {creatingUnder === c.id && (
                    <View style={[styles.card, styles.cardIndented]}>
                      <Text style={styles.cardTitle}>New subcategory under {c.nameEn}</Text>
                      {renderForm(c.id, true)}
                    </View>
                  )}
                  <Pressy onPress={() => startCreate(c.id)} style={styles.addSubBtn}>
                    <Icon name="plus" size={13} color={colors.inkSoft} />
                    <Text style={styles.addSubBtnText}>Add subcategory under {c.nameEn}</Text>
                  </Pressy>
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 60 },
  hint: { ...type.soft, lineHeight: 18, marginBottom: 14 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 12, overflow: 'hidden',
  },
  cardIndented: { marginLeft: 20 },
  cardTitle: { ...type.h3, padding: 16, paddingBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  chevron: {
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  chevronExpanded: { transform: [{ rotate: '90deg' }] },
  rowIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  iconImg: { width: '100%', height: '100%' },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  addSubBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 20,
    height: 36, marginBottom: 16, paddingHorizontal: 4,
  },
  addSubBtnText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  form: { padding: 16, paddingTop: 4 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  domainRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  domainPill: {
    paddingHorizontal: 14, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  domainPillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  domainPillText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  domainPillTextActive: { color: colors.white },
  fieldHint: { ...type.tiny, textTransform: 'none', letterSpacing: 0, color: colors.inkSoft, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 44, fontSize: 14, color: colors.ink,
  },
  rtlInput: { textAlign: 'right' as const },
  textarea: { height: 96, paddingTop: 10, textAlignVertical: 'top' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconPreview: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  uploadBtn: {
    height: 38, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  cancelBtn: { height: 52, paddingHorizontal: 20, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { marginLeft: 'auto' },
  cancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
  autosaveText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  attributesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, marginHorizontal: 16, marginBottom: 10, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.warnBg,
  },
  attributesBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, marginHorizontal: 16, marginBottom: 16, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line,
  },
  deleteBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.danger },
});
