import React from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { mirrorRow } from '../lib/mirrorRow';
import { MAX_CHOICES, MAX_GROUPS, MAX_QTY, OptionChoice, OptionGroup, money } from '../lib/listingOptions';

// The seller's side: building the groups a buyer will pick from.
//
// Rows carry a LOCAL id (`draft-…`) until the server assigns a real one on
// save. React needs a stable key while the seller is still typing, and the
// id a row eventually gets belongs to the database, not to this form.
let seq = 0;
const draftId = () => `draft-${++seq}`;

export function emptyChoice(): OptionChoice {
  return { id: draftId(), label: '', extra: 0, per: 'item', ask: null, askRequired: false };
}

export function emptyGroup(): OptionGroup {
  return { id: draftId(), title: '', pick: 'one', required: false, options: [emptyChoice()] };
}

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

  const patchGroup = (gi: number, patch: Partial<OptionGroup>) =>
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const patchChoice = (gi: number, oi: number, patch: Partial<OptionChoice>) =>
    onChange(groups.map((g, i) =>
      i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : g));

  return (
    <View style={styles.wrap}>
      <Text style={[styles.intro, textDir]}>{t('options.builder.intro')}</Text>

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
  groupTop: { alignItems: 'center', gap: 8 },
  groupName: {
    ...type.h3, flex: 1, borderBottomWidth: 1, borderBottomColor: colors.line,
    paddingVertical: 8,
  },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pickRow: { gap: 8 },
  pill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
  },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  pillText: { ...type.tiny },
  pillTextOn: { color: colors.primary, fontWeight: '700' },
  switchRow: { alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switchLabel: { ...type.body, flexShrink: 1 },
  choice: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    padding: 10, gap: 8, backgroundColor: colors.bg,
  },
  choiceTop: { alignItems: 'center', gap: 8 },
  choiceLabel: {
    ...type.body, flex: 1, backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9,
  },
  priceWrap: {
    alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8,
  },
  priceSign: { ...type.soft, fontWeight: '600' },
  priceInput: { ...type.body, minWidth: 54, paddingVertical: 9, textAlign: 'center' },
  perRow: { alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  perPill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  perPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  perText: { ...type.tiny },
  perTextOn: { color: colors.primary, fontWeight: '700' },
  perHint: { ...type.tiny, flex: 1, minWidth: 120 },
  askRow: { alignItems: 'center', gap: 6 },
  askInput: {
    ...type.soft, flex: 1, backgroundColor: colors.card, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 8,
  },
  addBtn: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  addText: { ...type.soft, color: colors.primary, fontWeight: '600' },
  addGroup: {
    alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14,
    borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  addGroupText: { ...type.body, color: colors.primary, fontWeight: '700' },
  capNote: { ...type.tiny },
  minInput: {
    ...type.body, backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 110,
  },
});
