import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { mirrorRow } from '../lib/mirrorRow';
import {
  MAX_CHOICES, MAX_GROUPS, MAX_QTY, MAX_SAVED_SETS, OptionChoice, OptionGroup, SavedSet,
  deleteOptionSet, draftId, emptyChoice, emptyGroup, fetchMyOptionSets, money, saveOptionSet,
} from '../lib/listingOptions';
import { Alert } from '../lib/alertShim';

// The seller's side: building the groups a buyer will pick from, and the
// small library of named sets they can drop into the next listing.
//
// The row helpers (draftId, emptyChoice, emptyGroup) live in the library
// rather than here, because copying a saved set into the form needs them
// and a library must not import a component to get them.

// A group is worth saving once it has a name and at least one named
// choice. Half-finished rows are dropped rather than rejected: a seller
// who tapped "Add a choice" and then changed their mind should not be
// stopped at the end of the form by a blank line they have forgotten
// about. The same rule runs at Continue and at save, so what they are
// told is what is stored.
export function tidyGroups(groups: OptionGroup[]): OptionGroup[] {
  return groups
    .map((g) => ({
      ...g,
      title: g.title.trim(),
      options: g.options
        .map((o) => ({
          ...o,
          label: o.label.trim(),
          ask: o.ask?.trim() ? o.ask.trim() : null,
          extra: Number.isFinite(o.extra) && o.extra > 0 ? o.extra : 0,
        }))
        .filter((o) => o.label.length > 0)
        .slice(0, MAX_CHOICES),
    }))
    .filter((g) => g.title.length > 0 && g.options.length > 0)
    .slice(0, MAX_GROUPS);
}

// What is still wrong, in the seller's words, or null. Only the two things
// that would produce a broken listing rather than an unfinished one: a
// named group with no named choice, and a choice that asks a question
// nobody has to answer and nobody has named.
export function groupsProblem(groups: OptionGroup[], t: (k: string, v?: any) => string): string | null {
  for (const g of groups) {
    const named = g.options.filter((o) => o.label.trim().length > 0);
    if (g.title.trim().length > 0 && named.length === 0) {
      return t('options.builder.errNoChoices', { group: g.title.trim() });
    }
    if (g.title.trim().length === 0 && named.length > 0) {
      return t('options.builder.errNoTitle');
    }
  }
  return null;
}

function PriceInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { isRTL } = useLanguage();
  // The field holds the TEXT, not the number. A controlled input fed
  // String(value) cannot be typed a decimal into: after "12" the next
  // keystroke makes "12.", Number("12.") is still 12, the value prop does
  // not change, and the re-render puts "12" back -- so "12.5" is
  // unreachable and an $8.50 engraving fee cannot be entered at all.
  const [text, setText] = React.useState(value > 0 ? String(value) : '');
  const typing = React.useRef(false);
  // Re-sync when the number changes from outside (a different listing
  // loaded into the same form), but never over the seller mid-word.
  React.useEffect(() => {
    if (!typing.current) setText(value > 0 ? String(value) : '');
  }, [value]);
  return (
    <View style={[styles.priceWrap, mirrorRow(isRTL)]}>
      <Text style={styles.priceSign}>+$</Text>
      <TextInput
        value={text}
        onFocus={() => { typing.current = true; }}
        onBlur={() => { typing.current = false; setText(value > 0 ? String(value) : ''); }}
        onChangeText={(v) => {
          // Digits and at most one dot. A second dot is dropped rather
          // than blanking the field, which is what Number('1.2.3') = NaN
          // used to do.
          const cleaned = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
          setText(cleaned);
          const n = Number(cleaned);
          onChange(Number.isFinite(n) && n > 0 ? Math.min(1000000, n) : 0);
        }}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.inkSoft}
        style={styles.priceInput}
        maxLength={9}
      />
    </View>
  );
}

export default function OptionsBuilder({
  groups,
  onChange,
  minQty,
  onMinQty,
}: {
  groups: OptionGroup[];
  onChange: (next: OptionGroup[]) => void;
  minQty: number;
  onMinQty: (n: number) => void;
}) {
  const { t, isRTL } = useLanguage();
  const textDir = isRTL ? styles.rtl : null;

  // The seller's library. Loaded once when the step first renders; a seller
  // with none never sees the row at all, which is nearly all of them until
  // they have posted twice.
  const [sets, setSets] = useState<SavedSet[]>([]);
  const [setsOpen, setSetsOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [setsError, setSetsError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMyOptionSets()
      .then((s) => { if (alive) setSets(s); })
      .catch((e) => { console.warn('[optionSets] load', e?.message ?? e); });
    return () => { alive = false; };
  }, []);

  const tidy = tidyGroups(groups);
  const canSave = tidy.length > 0 && saveName.trim().length > 0 && !busy;
  // Anything the seller has actually typed, whether or not it would
  // survive tidyGroups. The two differ in exactly the case the confirm
  // exists for: three choice labels typed under a group not yet named
  // tidies away to nothing, and replacing it without asking is the ten
  // minutes of work the dialog is supposed to protect.
  const hasTyped = groups.some(
    (g) => g.title.trim().length > 0 ||
      g.options.some((o) => o.label.trim().length > 0 || (o.ask?.trim().length ?? 0) > 0 || o.extra > 0)
  );

  const runSetAction = async (fn: () => Promise<SavedSet[]>) => {
    setBusy(true);
    setSetsError(null);
    try {
      setSets(await fn());
      return true;
    } catch (e: any) {
      const code = String(e?.message ?? '').trim();
      if (code === 'too_many_sets') {
        setSetsError(t('options.sets.errTooMany', { n: MAX_SAVED_SETS }));
      } else {
        // Every other code the server can raise here is unreachable through
        // this UI (the name is capped at 40, tidyGroups enforces the group
        // and choice limits and drops the untitled). One arriving anyway is
        // worth a line, the way reviews.ts and legal.ts do it.
        console.warn('[optionSets]', code || e);
        setSetsError(t('options.sets.errFailed'));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Using a set REPLACES what is on the step. Asked about first whenever
  // there is anything to lose -- the whole value of a library is tapping it
  // without thinking, and something that quietly ate ten minutes of typing
  // the one time it mattered is something a seller stops tapping.
  const useSet = (set: SavedSet) => {
    const apply = () => {
      // Fresh ids on every use. The same set tapped twice must not hand
      // React the same keys, and nothing copied out of a template is
      // allowed to look like a live choice id.
      const copy = set.groups.map((g) => ({
        ...g,
        id: draftId(),
        options: g.options.map((o) => ({ ...o, id: draftId() })),
      }));
      onChange(copy);
      onMinQty(set.minQty);
      setSetsOpen(false);
    };
    if (!hasTyped) { apply(); return; }
    Alert.alert(
      t('options.sets.replaceTitle'),
      // #4: the minimum order rides along with the groups, so the dialog
      // says so whenever it is actually about to change.
      set.minQty !== minQty
        ? t('options.sets.replaceMessageMin', { name: set.name, n: set.minQty })
        : t('options.sets.replaceMessage', { name: set.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('options.sets.replaceConfirm'), style: 'destructive', onPress: apply },
      ]
    );
  };

  const patchGroup = (gi: number, patch: Partial<OptionGroup>) =>
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const patchChoice = (gi: number, oi: number, patch: Partial<OptionChoice>) =>
    onChange(groups.map((g, i) =>
      i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : g));

  return (
    <View style={styles.wrap}>
      <Text style={[styles.intro, textDir]}>{t('options.builder.intro')}</Text>

      {sets.length > 0 && (
        <View style={styles.setsCard}>
          <Pressy onPress={() => setSetsOpen((v) => !v)} style={[styles.setsHead, mirrorRow(isRTL)]}>
            <Icon name="copy" size={16} color={colors.primary} />
            <Text style={[styles.setsHeadText, textDir]}>
              {t('options.sets.use', { n: sets.length })}
            </Text>
            {/* One chevron, turned. There is no chevronDown in the icon
                set, and swapping to a different glyph when open makes the
                control change metaphor as it toggles. */}
            <View style={setsOpen ? styles.chevronOpen : undefined}>
              <Icon name="chevronRight" size={15} color={colors.inkSoft} />
            </View>
          </Pressy>
          {setsOpen && !!setsError && <Text style={[styles.setsError, textDir]}>{setsError}</Text>}
          {setsOpen && sets.map((set) => (
            <View key={set.id} style={[styles.setRow, mirrorRow(isRTL)]}>
              <Text style={[styles.setName, textDir]} numberOfLines={1}>{set.name}</Text>
              <Text style={[styles.setCount, textDir]}>
                {set.groups.length === 1
                  ? t('options.sets.groupCountOne')
                  : t('options.sets.groupCount', { n: set.groups.length })}
              </Text>
              <Pressy onPress={() => useSet(set)} disabled={busy} style={styles.setUseBtn}>
                <Text style={styles.setUseBtnText}>{t('options.sets.useOne')}</Text>
              </Pressy>
              <Pressy
                onPress={() => Alert.alert(
                  t('options.sets.removeTitle'),
                  t('options.sets.removeMessage', { name: set.name }),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('options.sets.removeConfirm'),
                      style: 'destructive',
                      onPress: () => { void runSetAction(() => deleteOptionSet(set.id)); },
                    },
                  ]
                )}
                disabled={busy}
                style={styles.iconBtn}
                accessibilityLabel={t('options.sets.remove')}
              >
                <Icon name="trash" size={15} color={colors.danger} />
              </Pressy>
            </View>
          ))}
        </View>
      )}

      {groups.map((group, gi) => (
        <View key={group.id} style={styles.group}>
          <View style={[styles.groupTop, mirrorRow(isRTL)]}>
            <TextInput
              value={group.title}
              onChangeText={(v) => patchGroup(gi, { title: v })}
              placeholder={t('options.builder.groupNamePlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={[styles.groupName, textDir]}
              maxLength={60}
            />
            <Pressy
              onPress={() => onChange(groups.filter((_, i) => i !== gi))}
              style={styles.iconBtn}
              accessibilityLabel={t('options.builder.removeGroup')}
            >
              <Icon name="trash" size={17} color={colors.danger} />
            </Pressy>
          </View>

          <View style={[styles.pickRow, mirrorRow(isRTL)]}>
            {(['one', 'any'] as const).map((p) => (
              <Pressy
                key={p}
                onPress={() => patchGroup(gi, { pick: p })}
                style={[styles.pill, group.pick === p && styles.pillOn]}
              >
                <Text style={[styles.pillText, group.pick === p && styles.pillTextOn]}>
                  {p === 'one' ? t('options.pickOne') : t('options.tickAny')}
                </Text>
              </Pressy>
            ))}
          </View>

          <View style={[styles.switchRow, mirrorRow(isRTL)]}>
            <Text style={[styles.switchLabel, textDir]}>{t('options.builder.mustAnswer')}</Text>
            <Switch value={group.required} onValueChange={(v) => patchGroup(gi, { required: v })} />
          </View>

          {group.options.map((choice, oi) => (
            <View key={choice.id} style={styles.choice}>
              <View style={[styles.choiceTop, mirrorRow(isRTL)]}>
                <TextInput
                  value={choice.label}
                  onChangeText={(v) => patchChoice(gi, oi, { label: v })}
                  placeholder={t('options.builder.choicePlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.choiceLabel, textDir]}
                  maxLength={60}
                />
                <PriceInput value={choice.extra} onChange={(n) => patchChoice(gi, oi, { extra: n })} />
                <Pressy
                  onPress={() => patchGroup(gi, { options: group.options.filter((_, j) => j !== oi) })}
                  style={styles.iconBtn}
                  accessibilityLabel={t('options.builder.removeChoice')}
                >
                  <Icon name="close" size={16} color={colors.inkSoft} />
                </Pressy>
              </View>

              {/* Per item or per order. Shown only once a choice actually
                  costs something -- the distinction is meaningless at $0
                  and would be one more decision on every free option. */}
              {choice.extra > 0 && (
                <View style={[styles.perRow, mirrorRow(isRTL)]}>
                  {(['item', 'order'] as const).map((p) => (
                    <Pressy
                      key={p}
                      onPress={() => patchChoice(gi, oi, { per: p })}
                      style={[styles.perPill, choice.per === p && styles.perPillOn]}
                    >
                      <Text style={[styles.perText, choice.per === p && styles.perTextOn]}>
                        {p === 'item' ? t('options.builder.perItem') : t('options.builder.perOrder')}
                      </Text>
                    </Pressy>
                  ))}
                  <Text style={[styles.perHint, textDir]} numberOfLines={2}>
                    {choice.per === 'item'
                      ? t('options.builder.perItemHint', { amount: money(choice.extra * 12) })
                      : t('options.builder.perOrderHint', { amount: money(choice.extra) })}
                  </Text>
                </View>
              )}

              <View style={[styles.askRow, mirrorRow(isRTL)]}>
                <TextInput
                  value={choice.ask ?? ''}
                  onChangeText={(v) => patchChoice(gi, oi, { ask: v, askRequired: v.trim() ? choice.askRequired : false })}
                  placeholder={t('options.builder.askPlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.askInput, textDir]}
                  maxLength={40}
                />
                {!!choice.ask?.trim() && (
                  <Pressy
                    onPress={() => patchChoice(gi, oi, { askRequired: !choice.askRequired })}
                    style={[styles.perPill, choice.askRequired && styles.perPillOn]}
                  >
                    <Text style={[styles.perText, choice.askRequired && styles.perTextOn]}>
                      {t('options.builder.askRequired')}
                    </Text>
                  </Pressy>
                )}
              </View>
            </View>
          ))}

          {group.options.length < MAX_CHOICES && (
            <Pressy
              onPress={() => patchGroup(gi, { options: [...group.options, emptyChoice()] })}
              style={[styles.addBtn, mirrorRow(isRTL)]}
            >
              <Icon name="edit" size={15} color={colors.primary} />
              <Text style={styles.addText}>{t('options.builder.addChoice')}</Text>
            </Pressy>
          )}
        </View>
      ))}

      {groups.length < MAX_GROUPS ? (
        <Pressy onPress={() => onChange([...groups, emptyGroup()])} style={[styles.addGroup, mirrorRow(isRTL)]}>
          <Icon name="edit" size={16} color={colors.primary} />
          <Text style={styles.addGroupText}>{t('options.builder.addGroup')}</Text>
        </Pressy>
      ) : (
        <Text style={[styles.capNote, textDir]}>{t('options.builder.groupCap', { n: MAX_GROUPS })}</Text>
      )}

      {/* Saving the set. Offered only once there is a finished group to
          save -- an empty library entry helps nobody, and the server
          refuses one anyway. */}
      {tidy.length > 0 && (
        <View style={styles.group}>
          <Text style={[styles.switchLabel, textDir]}>{t('options.sets.saveTitle')}</Text>
          <Text style={[styles.capNote, textDir]}>{t('options.sets.saveHint')}</Text>
          <View style={[styles.saveRow, mirrorRow(isRTL)]}>
            <TextInput
              value={saveName}
              onChangeText={setSaveName}
              placeholder={t('options.sets.namePlaceholder')}
              placeholderTextColor={colors.inkSoft}
              style={[styles.saveInput, textDir]}
              maxLength={40}
            />
            <Pressy
              onPress={() => {
                const run = async () => {
                  if (await runSetAction(() => saveOptionSet(saveName, tidy, minQty))) {
                    setSaveName('');
                    // #16: the library card is at the top of a long step
                    // and starts collapsed, so a first save otherwise
                    // looks like nothing happened. Open it.
                    setSetsOpen(true);
                  }
                };
                // A name already in the library REPLACES it, server-side.
                // That is the right behaviour -- it is how a seller
                // corrects a set -- but it is destructive, and it is the
                // one action here that had no dialog.
                const clash = sets.find(
                  (s) => s.name.trim().toLowerCase() === saveName.trim().toLowerCase()
                );
                if (!clash) { void run(); return; }
                Alert.alert(
                  t('options.sets.overwriteTitle'),
                  t('options.sets.overwriteMessage', { name: clash.name }),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('options.sets.overwriteConfirm'), style: 'destructive', onPress: () => { void run(); } },
                  ]
                );
              }}
              disabled={!canSave}
              style={[styles.saveBtn, !canSave && styles.saveBtnOff]}
            >
              <Text style={styles.saveBtnText}>{t('options.sets.save')}</Text>
            </Pressy>
          </View>
          {!!setsError && <Text style={[styles.setsError, textDir]}>{setsError}</Text>}
        </View>
      )}

      <View style={styles.group}>
        <Text style={[styles.switchLabel, textDir]}>{t('options.builder.minQty')}</Text>
        <Text style={[styles.capNote, textDir]}>{t('options.builder.minQtyHint')}</Text>
        <TextInput
          value={minQty > 1 ? String(minQty) : ''}
          onChangeText={(v) => {
            const digits = v.replace(/[^0-9]/g, '');
            onMinQty(digits ? Math.min(MAX_QTY, Math.max(1, Number(digits))) : 1);
          }}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={colors.inkSoft}
          style={[styles.minInput, textDir]}
          maxLength={3}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  intro: { ...type.soft },
  group: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.line, padding: 14, gap: 10,
  },
  groupTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: {
    ...type.h3, flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line,
    paddingVertical: 8,
  },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
  },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pillText: { ...type.tiny },
  pillTextOn: { color: colors.primary, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switchLabel: { ...type.body, flexShrink: 1 },
  choice: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    padding: 10, gap: 8, backgroundColor: colors.bg,
  },
  choiceTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceLabel: {
    ...type.body, flex: 1, backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9,
  },
  priceWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8,
  },
  priceSign: { ...type.soft, fontWeight: '600' },
  priceInput: { ...type.body, minWidth: 54, paddingVertical: 9, textAlign: 'center' },
  perRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  perPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  perPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  perText: { ...type.tiny },
  perTextOn: { color: colors.primary, fontWeight: '700' },
  perHint: { ...type.tiny, flex: 1, minWidth: 120 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  askInput: {
    ...type.soft, flex: 1, backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 8,
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addText: { ...type.soft, color: colors.primary, fontWeight: '600' },
  addGroup: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  addGroupText: { ...type.body, color: colors.primary, fontWeight: '700' },
  capNote: { ...type.tiny },
  setsCard: {
    backgroundColor: colors.primaryTint, borderRadius: radius.md, padding: 4,
  },
  setsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  setsHeadText: { ...type.body, flex: 1, color: colors.primary, fontWeight: '600' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: colors.card, borderRadius: radius.sm, marginHorizontal: 4, marginBottom: 4,
  },
  setName: { ...type.body, flex: 1 },
  setCount: { ...type.tiny },
  setUseBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  setUseBtnText: { ...type.tiny, color: colors.white, fontWeight: '700' },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveInput: {
    ...type.body, flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10,
  },
  saveBtn: {
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  saveBtnOff: { opacity: 0.4 },
  saveBtnText: { ...type.soft, color: colors.white, fontWeight: '700' },
  setsError: { ...type.tiny, color: colors.danger, paddingHorizontal: 10, paddingBottom: 6 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  minInput: {
    ...type.body, backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 110,
  },
});
