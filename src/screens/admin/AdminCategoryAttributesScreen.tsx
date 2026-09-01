import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../../lib/alertShim';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon, { SPEC_ICON_NAMES, type IconName } from '../../icons/Icon';
import Button from '../../components/Button';
import DraggableList from '../../components/DraggableList';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { AttributeOption, AttributeType, CategoryAttribute } from '../../types';
import { MAX_CARD_SPECS } from '../../lib/cardSpecs';
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
  // '' = not on the card. Kept as text rather than a number so the field can
  // be emptied while typing without snapping back to 0.
  cardPriority: string;
  icon: IconName | null;
  // What cardPriority held when this form was opened. The clash check runs
  // only when the admin has actually changed the number, and "changed" has to
  // mean "differs from what I was shown" -- comparing against the live store
  // instead would re-block a label-only edit the moment a background refresh
  // landed, which is the lockout that check was added to avoid.
  loadedCardPriority: string;
};

function blankForm(): FormState {
  return {
    slug: '', labelEn: '', labelAr: '', type: 'text', optionsText: '', unitEn: '', unitAr: '',
    required: false, isVariant: false, cardPriority: '', icon: null, loadedCardPriority: '',
  };
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
    cardPriority: a.cardPriority === null ? '' : String(a.cardPriority),
    icon: a.icon,
    loadedCardPriority: a.cardPriority === null ? '' : String(a.cardPriority),
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
    updateCategory,
  } = useSettings();

  const category = categoryById(categoryId);
  // Memoised because attributesSharingLine depends on it: ancestorsOf
  // builds a fresh array each call, so a bare call here made that memo
  // recompute on every keystroke in the form.
  const ancestors = useMemo(() => ancestorsOf(categoryId), [ancestorsOf, categoryId]);
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

  // The slug of the attribute currently open for editing, read off the saved
  // row so it cannot drift from what is actually stored. Null while creating,
  // which is deliberate: the card-label toggle writes to the category the
  // moment it is tapped, and there is nothing to point it at until the
  // attribute exists.
  const editingSlug = useMemo(
    () => (editingId ? ownAttributes.find((a) => a.id === editingId)?.slug || null : null),
    [editingId, ownAttributes]
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

  // The card's label lives on the CATEGORY (one attribute supplies it, or
  // none does), not on the attribute row -- so this toggle writes through
  // updateCategory rather than through the form's own save. It is applied
  // immediately on tap rather than on Save for exactly that reason: batching
  // it into a save that writes a different table would mean one button
  // half-succeeding, which is the kind of thing nobody notices until a card
  // is labelled wrong.
  const cardKindSlug = category?.cardKindSlug || null;
  const isCardKind = !!cardKindSlug && !!editingSlug && cardKindSlug === editingSlug;
  const otherCardKindAttr = useMemo(
    () => (cardKindSlug && cardKindSlug !== editingSlug
      ? ownAttributes.find((a) => a.slug === cardKindSlug) || null
      : null),
    [cardKindSlug, editingSlug, ownAttributes]
  );
  // Every attribute that could ever end up in the same resolved set as one
  // defined here: this category's own, its ancestors' (which resolve INTO
  // here), and its descendants' (which this one resolves INTO). Anything
  // outside that line can share a card position freely -- Vehicles and Pets
  // both using position 1 is not a clash, it is the normal case.
  const attributesSharingLine = useMemo(() => {
    const line = new Set<string>([categoryId, ...ancestors.map((c) => c.id)]);
    const queue = [categoryId];
    while (queue.length) {
      const next = queue.shift()!;
      // includeInactive: a switched-off category still has attributes, and
      // switching it back on must not surface a clash created while it was
      // invisible.
      childrenOf(next, { includeInactive: true }).forEach((child) => {
        if (line.has(child.id)) return;
        line.add(child.id);
        queue.push(child.id);
      });
    }
    return categoryAttributes.filter((a) => line.has(a.categoryId));
  }, [categoryId, ancestors, childrenOf, categoryAttributes]);

  const [savingCardKind, setSavingCardKind] = useState(false);
  const toggleCardKind = async (next: boolean) => {
    if (!editingSlug) return;
    setSavingCardKind(true);
    try {
      await updateCategory(categoryId, { cardKindSlug: next ? editingSlug : null });
    } catch (e: any) {
      // No local cleanup needed: updateCategory snapshots and restores its
      // own optimistic write when the database refuses, so the switch springs
      // back on its own rather than sitting there claiming a change that
      // never landed.
      Alert.alert('Could not save', e?.message || String(e));
    } finally {
      setSavingCardKind(false);
    }
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
    // '' means "not on the card". Anything else has to be a positive whole
    // number: 0 would sort ahead of the first slot and read as "no priority"
    // to anyone scanning the list, and a negative one is meaningless.
    const trimmedPriority = form.cardPriority.trim();
    const parsedCardPriority = trimmedPriority === '' ? null : Number(trimmedPriority);
    if (parsedCardPriority !== null && (!Number.isInteger(parsedCardPriority) || parsedCardPriority < 1)) {
      Alert.alert('Card position', 'Card position must be a whole number from 1 upwards, or empty to keep this field off the card.');
      return;
    }
    // Two attributes resolving to the same card position is an accident, not
    // a choice: which one prints is settled by inheritance depth. Jewelry had
    // its own "Material" at position 1 alongside "Brand" inherited from
    // Fashion & Beauty, which is what card_specs_corrections had to repair.
    //
    // Checked BOTH ways along the inheritance line, not just upwards. A
    // resolved set contains a category's ancestors, never its descendants --
    // so checking only this category would have caught the clash when editing
    // Jewelry and waved it straight through when editing Fashion & Beauty,
    // which is the end that creates it for four leaves at once.
    //
    // Only when the number actually CHANGED, so an existing clash cannot lock
    // an attribute out of every other edit: with an unconditional check,
    // fixing a typo in the Arabic label of a clashing field was refused
    // because of the number the admin had not touched.
    const priorityChanged = trimmedPriority !== form.loadedCardPriority.trim();
    if (parsedCardPriority !== null && priorityChanged) {
      const clash = attributesSharingLine.find(
        (a) =>
          a.cardPriority === parsedCardPriority &&
          a.id !== editingId &&
          // A descendant defining the same slug OVERRIDES this attribute
          // rather than sitting beside it, so the two can never both appear.
          a.slug !== (editingSlug || slugify(form.slug || form.labelEn))
      );
      if (clash) {
        const where =
          clash.categoryId === categoryId
            ? ''
            : ` (on ${categoryById(clash.categoryId)?.nameEn || 'another category'} in this branch)`;
        Alert.alert(
          'Position already used',
          `"${clash.labelEn}" is already at card position ${parsedCardPriority}${where}. Give this field a different number, or move that one first.`
        );
        return;
      }
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
          cardPriority: parsedCardPriority,
          // An icon with no card slot behind it would never render, and
          // leaving one set is how a stale glyph reappears the day someone
          // gives this attribute a slot for an unrelated reason.
          icon: parsedCardPriority === null ? null : form.icon,
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
          cardPriority: parsedCardPriority,
          icon: parsedCardPriority === null ? null : form.icon,
        });
        // AFTER the attribute write, never before: a non-select can no longer
        // be the card's label (the pill has to hold one short word, not
        // "240 sqm" or whatever a seller typed), but clearing it first meant
        // a failed attribute write left the admin reading "Could not save"
        // over a card-label role that had already been silently discarded.
        if (isCardKind && form.type !== 'select') {
          await updateCategory(categoryId, { cardKindSlug: null });
        }
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
            // Clear the card label first if this is the attribute supplying
            // it. Nothing else in the app can clear card_kind_slug, so
            // deleting the attribute out from under it would leave the
            // category pointing at a slug that no longer exists -- harmless
            // to render (cardKindLabel falls back to the category name) and
            // impossible to correct without a migration.
            if (category?.cardKindSlug === a.slug) {
              await updateCategory(categoryId, { cardKindSlug: null });
            }
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

      {/* ---- What this field does on a listing card ---------------------
          Separate section, because it answers a different question from
          everything above it. The fields above ask "what does a seller have
          to tell us?"; this asks "what would make a buyer stop scrolling?".
          The card used to guess by reusing Required as a stand-in for the
          second question, which is how a Jounieh apartment ended up showing
          its floor number instead of its bedrooms. */}
      <Text style={styles.sectionLabel}>On the listing card</Text>
      <Text style={styles.rowSub}>
        Cards show at most {MAX_CARD_SPECS} of a category's fields under the price. Number them in the order
        you want them read; leave the box empty to keep a field off the card. A field with no icon shows its
        label beside the value instead ("Still sealed  No, opened"), which is clearer than a glyph whenever
        the value already reads as an answer.
      </Text>
      <Text style={styles.rowSub}>
        Numbering past {MAX_CARD_SPECS} is useful, not wasted: a higher number only appears when a lower one
        does not apply to that listing. Properties is numbered Bedrooms 1, Bathrooms 2, Area 3, Land area 4,
        View 5 -- an apartment shows the first three, and a plot of land, which has no bedrooms or bathrooms,
        falls through to Area and View.
      </Text>

      <Text style={styles.fieldLabel}>Card position</Text>
      <TextInput
        value={form.cardPriority}
        onChangeText={(v) => setForm((f) => ({ ...f, cardPriority: v.replace(/[^0-9]/g, '') }))}
        keyboardType="number-pad"
        placeholder="empty = not on the card"
        style={styles.input}
      />

      {/* Only offered once the field is actually on a card -- an icon picker
          above an empty position box invites choosing a glyph that can never
          appear. */}
      {form.cardPriority.trim() !== '' && (
        <>
          <Text style={styles.fieldLabel}>Icon</Text>
          <View style={styles.iconGrid}>
            <Pressy
              onPress={() => setForm((f) => ({ ...f, icon: null }))}
              style={[styles.iconChoice, form.icon === null && styles.iconChoiceActive]}
            >
              <Text style={[styles.iconChoiceNone, form.icon === null && styles.iconChoiceNoneActive]}>Label</Text>
            </Pressy>
            {SPEC_ICON_NAMES.map((name) => (
              <Pressy
                key={name}
                onPress={() => setForm((f) => ({ ...f, icon: name }))}
                style={[styles.iconChoice, form.icon === name && styles.iconChoiceActive]}
              >
                <Icon name={name} size={17} color={form.icon === name ? colors.white : colors.ink} />
              </Pressy>
            ))}
          </View>
        </>
      )}

      {/* The card's own label, which is normally the category name. Offered
          only on select fields, because it has to resolve to one short word:
          a number or a free-text field would put "240 sqm" or a seller's
          typing inside a pill that is meant to say what kind of thing this
          is. See Category.cardKindSlug. */}
      {form.type === 'select' && !creating && (
        <View style={styles.switchRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.fieldLabel}>Use as the card's label</Text>
            <Text style={styles.rowSub}>
              {isCardKind
                ? `Cards in ${category?.nameEn || 'this category'} are labelled with this field's value instead of the category name.`
                : otherCardKindAttr
                ? `"${otherCardKindAttr.labelEn}" is already the card label here -- turning this on replaces it.`
                : `Cards show "${category?.nameEn || 'the category name'}" today. Turn this on for a category whose real kind lives in a field, the way Properties holds Apartment/Villa/Land.`}
            </Text>
            {/* Said out loud because it is the one control on this form that
                does not wait for Save, and Cancel will not put it back. */}
            <Text style={styles.rowSub}>Applies immediately -- this one is not part of Save.</Text>
          </View>
          <Switch value={isCardKind} onValueChange={toggleCardKind} disabled={savingCardKind} />
        </View>
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
                        {/* Worth showing here too: most leaf categories have
                            no attributes of their own, so an inherited field
                            is what their cards are actually made of. */}
                        {a.cardPriority !== null ? ` · Card ${a.cardPriority}` : ''}
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
                  {/* Visible without opening each field in turn, because
                      curating a card is a comparison across the whole list
                      -- "which three of these" -- not a decision about one
                      field at a time. */}
                  {a.cardPriority !== null ? ` · Card ${a.cardPriority}` : ''}
                  {cardKindSlug === a.slug ? ' · Card label' : ''}
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
  // A wrapping grid rather than a horizontal scroller: an admin picking a
  // glyph wants to compare all of them at once, and a row that scrolls hides
  // exactly the option they were looking for.
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  iconChoice: {
    width: 40, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
  },
  iconChoiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  // The "no glyph" choice sits in the grid with the glyphs rather than as a
  // separate control, because it is a real choice among peers -- for a
  // self-describing value it is usually the right one.
  iconChoiceNone: { fontSize: 10.5, fontWeight: '700', color: colors.inkSoft },
  iconChoiceNoneActive: { color: colors.white },
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
