import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import DraggableList from '../../components/DraggableList';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { AttributeOption, AttributeType, CategoryAttribute } from '../../types';
import { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminCategoryAttributes'>;

const TYPE_OPTIONS: { value: AttributeType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select (one)' },
  { value: 'multiselect', label: 'Select (many)' },
  { value: 'boolean', label: 'Yes/No' },
];

type FormState = {
  slug: string;
  labelEn: string;
  labelAr: string;
  type: AttributeType;
  optionsText: string;
  unitEn: string;
  unitAr: string;
  required: boolean;
  isVariant: boolean;
};

function blankForm(): FormState {
  return { slug: '', labelEn: '', labelAr: '', type: 'text', optionsText: '', unitEn: '', unitAr: '', required: false, isVariant: false };
}

function optionsToText(options: AttributeOption[]): string {
  return options.map((o) => `${o.value}|${o.labelEn}|${o.labelAr}`).join('\n');
}

function textToOptions(text: string): AttributeOption[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, labelEn, labelAr] = line.split('|').map((p) => p.trim());
      return { value: value || '', labelEn: labelEn || value || '', labelAr: labelAr || labelEn || value || '' };
    })
    .filter((o) => !!o.value);
}

function formFor(a: CategoryAttribute): FormState {
  return {
    slug: a.slug,
    labelEn: a.labelEn,
    labelAr: a.labelAr,
    type: a.type,
    optionsText: optionsToText(a.options),
    unitEn: a.unitEn || '',
    unitAr: a.unitAr || '',
    required: a.required,
    isVariant: a.isVariant,
  };
}

function slugify(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '');
}

export default function AdminCategoryAttributesScreen({ navigation, route }: Props) {
  const { categoryId, focusFilters } = route.params;
  const {
    categoryById,
    ancestorsOf,
    childrenOf,
    categoryAttributes,
    resolveAttributesForCategory,
    createAttribute,
    updateAttribute,
    deleteAttribute,
    reorderAttributes,
    setFilterPriorities,
  } = useSettings();

  const category = categoryById(categoryId);
  const ancestors = ancestorsOf(categoryId);
  const ownAttributes = useMemo(
    () => categoryAttributes.filter((a) => a.categoryId === categoryId).sort((a, b) => a.sortOrder - b.sortOrder),
    [categoryAttributes, categoryId]
  );
  const inheritedAttributes = useMemo(
    () => resolveAttributesForCategory(categoryId).filter((a) => a.categoryId !== categoryId),
    [resolveAttributesForCategory, categoryId]
  );

  // Search-filter drill-down configuration for THIS category's own facets
  // (a "pick a subcategory" step if it has children, "Area", and each of
  // its own non-text attributes) -- separate from the attribute editor
  // above, which governs specs/create-form order, not filter order.
  const hasChildren = childrenOf(categoryId).length > 0;
  type FacetRow = { key: string; label: string; subLabel: string; priority: number | null; filterable: boolean };
  const facetRows: FacetRow[] = useMemo(() => {
    const rows: FacetRow[] = [];
    if (hasChildren) {
      rows.push({
        key: 'subcategory',
        label: 'Pick a subcategory',
        subLabel: 'Shoppers choose a subcategory before anything else',
        priority: category?.subcategoryFilterPriority ?? null,
        filterable: true,
      });
    }
    rows.push({
      key: 'area',
      label: 'Area',
      subLabel: 'Shoppers pick from the districts already used on real listings',
      priority: category?.areaFilterPriority ?? null,
      filterable: true,
    });
    ownAttributes.forEach((a) => {
      rows.push({
        key: a.slug,
        label: a.labelEn,
        subLabel: a.type === 'text' ? "Text fields can't be used as a search filter" : TYPE_OPTIONS.find((t) => t.value === a.type)?.label || a.type,
        priority: a.filterPriority,
        filterable: a.type !== 'text',
      });
    });
    return rows;
  }, [hasChildren, category, ownAttributes]);

  const activeFacetRows = facetRows.filter((r) => r.filterable && r.priority != null).sort((a, b) => (a.priority as number) - (b.priority as number));
  const availableFacetRows = facetRows.filter((r) => r.filterable && r.priority == null);
  const unfilterableFacetRows = facetRows.filter((r) => !r.filterable);

  const [filterSaving, setFilterSaving] = useState(false);
  const applyFilterOrder = async (orderedKeys: string[]) => {
    setFilterSaving(true);
    try {
      await setFilterPriorities(categoryId, orderedKeys);
    } catch (e: any) {
      Alert.alert('Could not update search filters', e?.message || String(e));
    } finally {
      setFilterSaving(false);
    }
  };
  const enableFacet = (key: string) => applyFilterOrder([...activeFacetRows.map((r) => r.key), key]);
  const disableFacet = (key: string) => applyFilterOrder(activeFacetRows.map((r) => r.key).filter((k) => k !== key));

  // Deep-link shortcut from the categories list (a gear icon per row) lands
  // here with focusFilters so the admin doesn't have to know this section
  // exists three taps deep -- scroll it into view once layout settles.
  const scrollRef = useRef<ScrollView>(null);
  const filtersSectionY = useRef(0);
  useEffect(() => {
    if (!focusFilters) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(filtersSectionY.current - 12, 0), animated: true });
    }, 350);
    return () => clearTimeout(t);
  }, [focusFilters]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);

  // At most one is_variant attribute per category (DB-enforced, see the
  // one_variant_per_category index) -- this is what the "is variant"
  // switch below disables against when a DIFFERENT attribute already has
  // it on, rather than letting the save fail and surfacing a DB error.
  const otherVariantAttr = useMemo(
    () => ownAttributes.find((a) => a.isVariant && a.id !== editingId) || null,
    [ownAttributes, editingId]
  );

  const startCreate = () => {
    setForm(blankForm());
    setCreating(true);
    setEditingId(null);
  };
  const startEdit = (a: CategoryAttribute) => {
    setForm(formFor(a));
    setEditingId(a.id);
    setCreating(false);
  };
  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setForm(blankForm());
  };

  const save = async () => {
    if (!form.labelEn.trim() || !form.labelAr.trim()) {
      Alert.alert('Missing label', 'Enter both an English and Arabic label.');
      return;
    }
    const needsOptions = form.type === 'select' || form.type === 'multiselect';
    const options = needsOptions ? textToOptions(form.optionsText) : [];
    if (needsOptions && options.length === 0) {
      Alert.alert('Missing options', 'Add at least one option (one per line: value|Label EN|Label AR).');
      return;
    }
    setSaving(true);
    try {
      if (creating) {
        const slug = slugify(form.slug || form.labelEn);
        if (!slug) {
          Alert.alert('Missing ID', 'Enter an ID for this attribute (letters, numbers, underscores).');
          setSaving(false);
          return;
        }
        await createAttribute({
          categoryId,
          slug,
          labelEn: form.labelEn.trim(),
          labelAr: form.labelAr.trim(),
          type: form.type,
          options,
          unitEn: form.unitEn.trim() || null,
          unitAr: form.unitAr.trim() || null,
          required: form.required,
          isVariant: form.type === 'multiselect' && form.isVariant,
        });
      } else if (editingId) {
        await updateAttribute(editingId, {
          labelEn: form.labelEn.trim(),
          labelAr: form.labelAr.trim(),
          type: form.type,
          options,
          unitEn: form.unitEn.trim() || null,
          unitAr: form.unitAr.trim() || null,
          required: form.required,
          isVariant: form.type === 'multiselect' && form.isVariant,
        });
      }
      cancel();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= ownAttributes.length) return;
    const ids = ownAttributes.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderAttributes(categoryId, ids);
    } catch (e: any) {
      Alert.alert('Could not reorder', e?.message || String(e));
    }
  };

  const remove = (a: CategoryAttribute) => {
    Alert.alert(`Delete "${a.labelEn}"?`, 'Existing listings keep whatever value they already saved for this field, but it stops showing on new or edited listings.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAttribute(a.id);
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message || String(e));
          }
        },
      },
    ]);
  };

  const renderForm = () => (
    <View style={styles.form}>
      {creating && (
        <>
          <Text style={styles.fieldLabel}>ID (used internally, can't change later)</Text>
          <TextInput
            value={form.slug}
            onChangeText={(v) => setForm((f) => ({ ...f, slug: v }))}
            placeholder={slugify(form.labelEn) || 'e.g. bedrooms'}
            autoCapitalize="none"
            style={styles.input}
          />
        </>
      )}

      <Text style={styles.fieldLabel}>Label (English)</Text>
      <TextInput value={form.labelEn} onChangeText={(v) => setForm((f) => ({ ...f, labelEn: v }))} style={styles.input} />
      <Text style={styles.fieldLabel}>Label (Arabic)</Text>
      <TextInput value={form.labelAr} onChangeText={(v) => setForm((f) => ({ ...f, labelAr: v }))} style={[styles.input, styles.rtlInput]} />

      <Text style={styles.fieldLabel}>Field type</Text>
      <View style={styles.typeRow}>
        {TYPE_OPTIONS.map((opt) => (
          <Pressy
            key={opt.value}
            onPress={() => setForm((f) => ({ ...f, type: opt.value, isVariant: opt.value === 'multiselect' ? f.isVariant : false }))}
            style={[styles.typePill, form.type === opt.value && styles.typePillActive]}
          >
            <Text style={[styles.typePillText, form.type === opt.value && styles.typePillTextActive]}>{opt.label}</Text>
          </Pressy>
        ))}
      </View>

      {(form.type === 'select' || form.type === 'multiselect') && (
        <>
          <Text style={styles.fieldLabel}>Options (one per line: value|Label EN|Label AR)</Text>
          <TextInput
            value={form.optionsText}
            onChangeText={(v) => setForm((f) => ({ ...f, optionsText: v }))}
            multiline
            placeholder={'rent|For Rent|للإيجار\nsale|For Sale|للبيع'}
            style={[styles.input, styles.textarea]}
          />
        </>
      )}

      {form.type === 'number' && (
        <View style={styles.unitRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Unit (English)</Text>
            <TextInput value={form.unitEn} onChangeText={(v) => setForm((f) => ({ ...f, unitEn: v }))} placeholder="e.g. sqm" style={styles.input} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Unit (Arabic)</Text>
            <TextInput value={form.unitAr} onChangeText={(v) => setForm((f) => ({ ...f, unitAr: v }))} placeholder="e.g. م²" style={[styles.input, styles.rtlInput]} />
          </View>
        </View>
      )}

      <View style={styles.switchRow}>
        <Text style={styles.fieldLabel}>Required</Text>
        <Switch value={form.required} onValueChange={(v) => setForm((f) => ({ ...f, required: v }))} />
      </View>

      {form.type === 'multiselect' && (
        <>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.fieldLabel}>Stock variant (e.g. "Size")</Text>
              <Text style={styles.rowSub}>
                {otherVariantAttr
                  ? `"${otherVariantAttr.labelEn}" is already this category's variant attribute -- turn that one off first.`
                  : 'Lets a "multiple" stock-mode listing track separate stock per option (e.g. per size) instead of one total quantity. Only one attribute per category can be the variant.'}
              </Text>
            </View>
            <Switch
              value={form.isVariant}
              onValueChange={(v) => setForm((f) => ({ ...f, isVariant: v }))}
              disabled={!!otherVariantAttr}
            />
          </View>
        </>
      )}

      <View style={styles.formActions}>
        <Pressy onPress={cancel} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressy>
        <Button label="Save" onPress={save} loading={saving} style={{ flex: 1 }} />
      </View>
    </View>
  );

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3} numberOfLines={1}>{category ? category.nameEn : 'Attributes'}</Text>
        <Pressy onPress={startCreate} style={styles.iconBtn}>
          <Icon name="plus" size={18} />
        </Pressy>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>
          These are the spec fields sellers fill in when posting a listing in {category?.nameEn || 'this category'}.
          {ancestors.length > 0 ? ' Fields defined here apply only to this subcategory; fields inherited from its parent are shown below and can only be changed there.' : ' Adding a field here also applies it to every subcategory underneath this one.'}
        </Text>

        <View onLayout={(e) => { filtersSectionY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.sectionLabel}>Sidebar filters</Text>
          <Text style={styles.hint}>
            Choose which of {category?.nameEn || 'this category'}'s own fields shoppers see as filter sections in the sidebar, and in what
            order top to bottom -- drag the grip to reorder. All enabled filters show at once and shoppers can combine any of them.
          </Text>

          {activeFacetRows.length > 0 ? (
            <View style={[styles.card, styles.draggableCard]}>
              <DraggableList
                data={activeFacetRows}
                keyExtractor={(r) => r.key}
                rowHeight={60}
                disabled={filterSaving}
                onReorder={applyFilterOrder}
                renderItem={(r) => (
                  <View style={styles.filterRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{r.label}</Text>
                      <Text style={styles.rowSub}>{r.subLabel}</Text>
                    </View>
                    <Switch value={true} onValueChange={() => disableFacet(r.key)} disabled={filterSaving} />
                  </View>
                )}
              />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={type.soft}>No sidebar filters enabled yet -- turn one on below.</Text>
            </View>
          )}

          {availableFacetRows.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Available</Text>
              {availableFacetRows.map((r) => (
                <View key={r.key} style={[styles.card, styles.filterRow]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{r.label}</Text>
                    <Text style={styles.rowSub}>{r.subLabel}</Text>
                  </View>
                  <Switch value={false} onValueChange={() => enableFacet(r.key)} disabled={filterSaving} />
                </View>
              ))}
            </>
          )}

          {unfilterableFacetRows.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Can't be used as a filter</Text>
              {unfilterableFacetRows.map((r) => (
                <View key={r.key} style={[styles.card, styles.filterRow, styles.inheritedCard]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{r.label}</Text>
                    <Text style={styles.rowSub}>{r.subLabel}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>Spec fields</Text>

        {creating && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New attribute</Text>
            {renderForm()}
          </View>
        )}

        {inheritedAttributes.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Inherited</Text>
            {inheritedAttributes.map((a) => {
              const owner = ancestors.find((c) => c.id === a.categoryId);
              return (
                <View key={a.id} style={[styles.card, styles.inheritedCard]}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{a.labelEn}{a.required ? ' *' : ''}</Text>
                      <Text style={styles.rowSub}>
                        {a.labelAr} · {TYPE_OPTIONS.find((t) => t.value === a.type)?.label}
                        {owner ? ` · from ${owner.nameEn}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {ownAttributes.length > 0 && <Text style={styles.sectionLabel}>{category?.nameEn || 'This category'}</Text>}
        {ownAttributes.map((a, index) => (
          <View key={a.id} style={styles.card}>
            <Pressy onPress={() => (editingId === a.id ? cancel() : startEdit(a))} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{a.labelEn}{a.required ? ' *' : ''}</Text>
                <Text style={styles.rowSub}>
                  {a.labelAr} · {TYPE_OPTIONS.find((t) => t.value === a.type)?.label}
                  {a.unitEn ? ` · ${a.unitEn}` : ''}
                  {a.isVariant ? ' · Stock variant' : ''}
                </Text>
              </View>
              <View style={styles.rowControls}>
                <Pressy onPress={() => move(index, -1)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>↑</Text>
                </Pressy>
                <Pressy onPress={() => move(index, 1)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>↓</Text>
                </Pressy>
              </View>
            </Pressy>

            {editingId === a.id && (
              <>
                {renderForm()}
                <Pressy onPress={() => remove(a)} style={styles.deleteBtn}>
                  <Icon name="close" size={14} color={colors.danger} />
                  <Text style={styles.deleteBtnText}>Delete attribute</Text>
                </Pressy>
              </>
            )}
          </View>
        ))}

        {ownAttributes.length === 0 && !creating && (
          <View style={styles.empty}>
            <Text style={type.soft}>No fields defined directly on this category yet. Tap + to add one.</Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 60 },
  hint: { ...type.soft, lineHeight: 18, marginBottom: 16 },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 12, overflow: 'hidden',
  },
  inheritedCard: { opacity: 0.65 },
  draggableCard: { paddingVertical: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, height: 60 },
  cardTitle: { ...type.h3, padding: 16, paddingBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  smallBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  form: { padding: 16, paddingTop: 4 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 44, fontSize: 14, color: colors.ink,
  },
  rtlInput: { textAlign: 'right' as const },
  textarea: { height: 84, paddingTop: 10, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typePill: {
    paddingHorizontal: 14, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  typePillActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  typePillText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  typePillTextActive: { color: colors.white },
  unitRow: { flexDirection: 'row', gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { height: 52, paddingHorizontal: 20, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, marginHorizontal: 16, marginBottom: 16, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line,
  },
  deleteBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.danger },
  empty: { alignItems: 'center', paddingTop: 20, paddingHorizontal: 20 },
});
