import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { mirrorRow } from '../lib/mirrorRow';
import {
  ListingOptions, Picks, extraLabel, money, setAnswer, togglePick, totalsFor, MAX_QTY,
} from '../lib/listingOptions';

// The buyer's side of choices-with-prices: pick a size, tick the add-ons,
// say how many, watch a total build at the bottom.
//
// It is deliberately NOT a checkout. Vevaty takes no money, so the figure
// is labelled an estimate everywhere it appears and the button says
// "Send to seller", not "Buy". A running total that looks like a cart is
// a promise the app cannot keep -- and the seller, who may charge more for
// an awkward job, is the one who would have to break it.

// A radio or a tick box, drawn rather than imported: a native checkbox is
// three different shapes across web, iOS and Android, and this one has to
// sit inside a full-width tappable row either way.
function Mark({ on, round }: { on: boolean; round: boolean }) {
  return (
    <View style={[styles.mark, round && styles.markRound, on && styles.markOn]}>
      {on ? (
        round ? <View style={styles.dot} /> : <Icon name="checkCircle" size={13} color={colors.white} />
      ) : null}
    </View>
  );
}

// The box holds the TEXT, so it can be empty. Snapping an empty field
// straight back to the minimum -- which is what a plain controlled number
// does -- means a buyer facing "20" cannot clear it to type "60"; they can
// only backspace into a number the seller does not accept and then correct
// it. Empty is a real state while typing, and it settles on blur.
function QtyInput({
  qty, minQty, onQty, label,
}: { qty: number; minQty: number; onQty: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(qty));
  const typing = useRef(false);
  useEffect(() => { if (!typing.current) setText(String(qty)); }, [qty]);
  return (
    <TextInput
      value={text}
      onFocus={() => { typing.current = true; }}
      onBlur={() => { typing.current = false; setText(String(qty)); }}
      onChangeText={(v) => {
        const digits = v.replace(/[^0-9]/g, '');
        setText(digits);
        if (digits) onQty(Math.min(MAX_QTY, Number(digits)));
      }}
      keyboardType="number-pad"
      style={styles.qtyInput}
      maxLength={3}
      accessibilityLabel={label}
    />
  );
}

export default function OptionsChooser({
  options,
  picks,
  onPicks,
  qty,
  onQty,
  basePrice,
  blockedGroupId,
}: {
  options: ListingOptions;
  picks: Picks;
  onPicks: (next: Picks) => void;
  qty: number;
  onQty: (next: number) => void;
  basePrice: number;
  // The group the Send button is waiting on, so the chooser can point at
  // it rather than leaving the buyer to hunt for what is missing.
  blockedGroupId?: string | null;
}) {
  const { t, isRTL } = useLanguage();
  const textDir = isRTL ? styles.rtl : null;
  const totals = useMemo(
    () => totalsFor(basePrice, options, picks, qty),
    [basePrice, options, picks, qty]
  );

  if (options.groups.length === 0) return null;

  const stepQty = (by: number) => {
    const next = Math.min(MAX_QTY, Math.max(options.minQty, Math.round(qty) + by));
    onQty(next);
  };

  return (
    <View style={styles.wrap}>
      {options.groups.map((group) => {
        const waiting = blockedGroupId === group.id;
        return (
          <View key={group.id} style={[styles.group, waiting && styles.groupWaiting]}>
            <View style={[styles.groupHead, mirrorRow(isRTL)]}>
              <Text style={[styles.groupTitle, textDir]} numberOfLines={2}>{group.title}</Text>
              <Text style={[styles.groupHint, textDir]}>
                {group.pick === 'one' ? t('options.pickOne') : t('options.tickAny')}
                {group.required ? ` · ${t('options.needed')}` : ''}
              </Text>
            </View>

            {group.options.map((choice) => {
              const on = choice.id in picks;
              const extra = extraLabel(choice, t);
              return (
                <View key={choice.id}>
                  <Pressy
                    onPress={() => onPicks(togglePick(options, picks, choice.id))}
                    style={[styles.row, mirrorRow(isRTL), on && styles.rowOn]}
                    accessibilityRole={group.pick === 'one' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on }}
                  >
                    <Mark on={on} round={group.pick === 'one'} />
                    <Text style={[styles.rowLabel, textDir]} numberOfLines={2}>{choice.label}</Text>
                    {!!extra && <Text style={[styles.rowExtra, textDir]}>{extra}</Text>}
                  </Pressy>

                  {/* The short question a choice can ask. It appears only
                      once the choice is ticked, because a box asking for a
                      name under an option nobody chose is a question the
                      buyer has to work out they can ignore. */}
                  {on && !!choice.ask && (
                    <View style={styles.askWrap}>
                      <Text style={[styles.askLabel, textDir]}>
                        {choice.ask}
                        {choice.askRequired ? <Text style={styles.star}> *</Text> : null}
                      </Text>
                      <TextInput
                        value={picks[choice.id]}
                        onChangeText={(v) => onPicks(setAnswer(picks, choice.id, v))}
                        style={[styles.askInput, textDir]}
                        placeholder={choice.ask}
                        placeholderTextColor={colors.inkSoft}
                        maxLength={120}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      {/* How many. Shown always, not only when the seller sets a minimum:
          favours are the common case in this category and a buyer who has
          to ask "can I have sixty?" in a message has already been slowed
          down by the app. */}
      <View style={styles.group}>
        <View style={[styles.groupHead, mirrorRow(isRTL)]}>
          <Text style={[styles.groupTitle, textDir]}>{t('options.howMany')}</Text>
          {options.minQty > 1 && (
            <Text style={[styles.groupHint, textDir]}>
              {t('options.minQty', { n: options.minQty })}
            </Text>
          )}
        </View>
        <View style={[styles.qtyRow, mirrorRow(isRTL)]}>
          <Pressy
            onPress={() => stepQty(-1)}
            disabled={qty <= options.minQty}
            style={[styles.qtyBtn, qty <= options.minQty && styles.qtyBtnOff]}
            accessibilityLabel={t('options.fewer')}
          >
            <Text style={styles.qtyBtnText}>−</Text>
          </Pressy>
          <QtyInput qty={qty} minQty={options.minQty} onQty={onQty} label={t('options.howMany')} />
          <Pressy
            onPress={() => stepQty(1)}
            disabled={qty >= MAX_QTY}
            style={[styles.qtyBtn, qty >= MAX_QTY && styles.qtyBtnOff]}
            accessibilityLabel={t('options.more')}
          >
            <Text style={styles.qtyBtnText}>+</Text>
          </Pressy>
        </View>
      </View>

      {/* The total. "Estimate" is not a hedge here, it is the truth: no
          money changes hands on Vevaty, the seller may charge more for an
          awkward job, and a number presented as final would be the app
          making a promise on their behalf. */}
      <View style={styles.totalCard}>
        <View style={[styles.totalRow, mirrorRow(isRTL)]}>
          <Text style={[styles.totalLabel, textDir]}>{t('options.estimate')}</Text>
          <Text style={[styles.totalAmount, textDir]}>{money(totals.total)}</Text>
        </View>
        <Text style={[styles.totalBreakdown, textDir]}>
          {totals.qty > 1
            ? t('options.breakdownMany', { n: totals.qty, each: money(totals.perItem) })
            : t('options.breakdownOne', { each: money(totals.perItem) })}
          {totals.perOrder > 0 ? ` · ${t('options.plusOnce', { amount: money(totals.perOrder) })}` : ''}
        </Text>
        <Text style={[styles.totalNote, textDir]}>{t('options.estimateNote')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
  },
  // The one group Send is waiting on. A ring rather than a red field: the
  // buyer has not made a mistake, they have simply not finished.
  groupWaiting: { borderColor: colors.accentRing, borderWidth: 2 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  groupTitle: { ...type.h3, flexShrink: 1 },
  groupHint: { ...type.tiny },
  row: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  rowOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  rowLabel: { ...type.body, flex: 1 },
  rowExtra: { ...type.body, fontWeight: '600', color: colors.primary },
  mark: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.6,
    borderColor: colors.inkSoft, alignItems: 'center', justifyContent: 'center',
  },
  markRound: { borderRadius: 10 },
  markOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  askWrap: { paddingHorizontal: 10, paddingTop: 8, gap: 5 },
  askLabel: { ...type.tiny },
  star: { color: colors.danger },
  askInput: {
    ...type.body,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bg,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: {
    width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  qtyBtnOff: { opacity: 0.4 },
  qtyBtnText: { ...type.h2, lineHeight: 24 },
  qtyInput: {
    ...type.h3, textAlign: 'center', minWidth: 70, height: 44,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  totalCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    padding: 14,
    gap: 4,
  },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  totalLabel: { ...type.h3 },
  totalAmount: { ...type.title, fontSize: 24, color: colors.primary },
  totalBreakdown: { ...type.soft },
  totalNote: { ...type.tiny, marginTop: 2 },
});
