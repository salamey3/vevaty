import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';

// A date and time field that can be picked rather than typed.
//
// Built out of plain Views on purpose, with no new dependency. Every
// off-the-shelf option here is either a native module or drags one in, and
// a native module means a changed package.json -- which changes the OTA
// runtime fingerprint and orphans every installed copy of the app until
// somebody makes a native build (@AGENTS.md). A calendar is a month grid
// and two rows of numbers; that is not worth a rebuild, and it is also the
// only way to get an identical widget on iOS, Android and the website,
// which is the exact objection that kept this a text box until now.
//
// The VALUE stays the same 'YYYY-MM-DD HH:MM' local string the form
// already used, so nothing downstream changes: the same toIso() parses it
// and the same validation catches a bad one. The picker writes that
// string; the box still accepts one typed by hand. Somebody who knows the
// sale is Friday at eight keeps typing it, and everybody else stops
// counting days on their fingers.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Deliberately the same shape the screen's own toIso() accepts, and just
// as strict: a half-typed string must read as "no date yet" rather than as
// some date the parser guessed at.
export function parseLocal(text: string): Date | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Monday-first, which is the working week here and what a Lebanese wall
// calendar shows. getDay() is Sunday-first, hence the shift.
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

type Props = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  // When set, the panel offers "+1 day / +2 / +3 / +7" measured from THIS
  // date rather than from today. It is how "lot 1 closes two days after
  // the sale opens" stops being arithmetic. Passing the opening time here
  // is the whole reason the field takes it.
  relativeTo?: string;
  relativeLabel?: string;
  // Whether emptying the field is something the SAVE PATH can actually
  // carry out. Off by default: a Clear button on a form whose save
  // coalesces a blank back to the stored value is a button that reports
  // success and changes nothing, which is worse than no button.
  canClear?: boolean;
};

export default function DateTimeField({
  label,
  value,
  onChange,
  placeholder,
  relativeTo,
  relativeLabel,
  canClear = false,
}: Props) {
  const [open, setOpen] = useState(false);

  const parsed = parseLocal(value);

  // The month on display. Kept as its own state so paging through months
  // does not require -- or disturb -- a chosen date, and so opening the
  // panel on an empty field lands on this month rather than on 1970.
  const [cursor, setCursor] = useState<Date>(() => {
    const base = parsed ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // Re-anchor the visible month when the field is opened, so a value typed
  // by hand (or set by a quick button) is the month you are looking at.
  const openPanel = () => {
    const base = parseLocal(value) ?? new Date();
    setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
    // Opening already anchors the cursor, so the effect above must not
    // treat this same value as a change and re-anchor a month the admin
    // may page away from immediately.
    lastSynced.current = value;
    setOpen(true);
  };

  // A value TYPED while the panel is open has to move the calendar with
  // it, or the two halves of the widget show different months and the next
  // day-tap silently overwrites what was typed.
  //
  // Keyed off a CHANGE of value, via this ref, and not off "cursor and
  // value disagree". The first version watched for disagreement with
  // `cursor` in its own dependency array, which meant every tap on the
  // month arrows re-ran it and snapped the calendar straight back to the
  // month the value was already in -- so an auction set for September
  // could never be paged to October, and the picker was inert for exactly
  // the edit it was built for.
  const lastSynced = useRef(value);
  useEffect(() => {
    if (!open) return;
    if (value === lastSynced.current) return;
    lastSynced.current = value;
    const p = parseLocal(value);
    if (!p) return;
    setCursor(new Date(p.getFullYear(), p.getMonth(), 1));
  }, [value, open]);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    // Leading blanks so the 1st lands under its real weekday.
    const cells: (Date | null)[] = Array(mondayIndex(first)).fill(null);
    for (let i = 1; i <= count; i++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), i));
    return cells;
  }, [cursor]);

  // Picking a day keeps whatever time is already set, and picking a time
  // keeps the day. An auction is scheduled by choosing an evening and then
  // a date, or the other way round, and either order has to work.
  //
  // 20:00 is the default for a field with no value yet, because a sale
  // that opens at midnight is never what anybody meant.
  const withDay = (d: Date) => {
    const t = parseLocal(value);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), t ? t.getHours() : 20, t ? t.getMinutes() : 0);
    onChange(formatLocal(next));
  };

  // Only ever moves the clock on a date that has been CHOSEN. The first
  // version fell back to `new Date()`, which meant tapping an hour on an
  // empty field silently set the date to today -- and since a new auction
  // is only checked for parseability, not for being in the future, that
  // produced a sale opening today that the minute job would take live at
  // once. The hour and minute rows are inert until a day is picked, and
  // say so, rather than guessing which day was meant.
  const withTime = (hours: number, minutes: number) => {
    const base = parseLocal(value);
    if (!base) return;
    const next = formatLocal(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes));
    // Claimed as already-synced BEFORE the change goes out. The resync
    // effect exists to follow text TYPED into the box; this write comes
    // from the panel and keeps the old month, so without this the effect
    // would drag the calendar back to that month. Paging to October,
    // tapping an hour, then tapping a day would have saved a September
    // date -- in the future, parseable, and a month early.
    // withDay and addDays need no such claim: they re-anchor to the month
    // already on screen, so the effect is a no-op for them.
    lastSynced.current = next;
    onChange(next);
  };

  const addDays = (n: number) => {
    const base = parseLocal(relativeTo || '') ?? parseLocal(value) ?? new Date();
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, base.getHours(), base.getMinutes());
    onChange(formatLocal(next));
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const today = new Date();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  // Five-minute steps. A finer grid is a longer row nobody scrolls to the
  // end of, and the box underneath still takes an exact minute if a sale
  // ever needs to open at 20:07.
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  const relativeBase = parseLocal(relativeTo || '');

  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          style={[styles.input, styles.inputGrow]}
          placeholder={placeholder}
          placeholderTextColor={colors.inkSoft}
        />
        <Pressy
          onPress={() => (open ? setOpen(false) : openPanel())}
          style={[styles.pickBtn, open && styles.pickBtnOn]}
        >
          <Icon name="calendar" size={17} color={open ? colors.white : colors.ink} />
        </Pressy>
      </View>

      {/* What the string actually means, in words. The format is
          unambiguous but not readable at a glance, and picking the wrong
          Friday is the mistake this whole field exists to prevent. */}
      {parsed ? (
        <Text style={styles.echo}>
          {WEEKDAYS[mondayIndex(parsed)]} {parsed.getDate()} {MONTHS[parsed.getMonth()]} {parsed.getFullYear()}
          {' at '}{pad(parsed.getHours())}:{pad(parsed.getMinutes())}
        </Text>
      ) : value !== '' ? (
        // `!== ''`, not `.trim()`: a box holding only spaces is refused by
        // the save (a stray space must not read as "clear the schedule"),
        // so it has to LOOK wrong here too rather than looking empty and
        // failing with an unattributed alert on Save.
        <Text style={styles.echoBad}>Not a valid date yet — use YYYY-MM-DD HH:MM, or pick one.</Text>
      ) : null}

      {open && (
        <View style={styles.panel}>
          <View style={styles.monthBar}>
            <Pressy
              onPress={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
              style={styles.monthBtn}
            >
              <Icon name="back" size={15} />
            </Pressy>
            <Text style={styles.monthLabel}>
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </Text>
            <Pressy
              onPress={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
              style={styles.monthBtn}
            >
              <Icon name="chevronRight" size={15} />
            </Pressy>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekCell}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {days.map((d, i) => {
              if (!d) return <View key={`blank-${i}`} style={styles.dayCell} />;
              const chosen = parsed != null && sameDay(d, parsed);
              const isToday = sameDay(d, today);
              return (
                <Pressy key={d.toISOString()} onPress={() => withDay(d)} style={styles.dayCell}>
                  <View style={[styles.day, isToday && styles.dayToday, chosen && styles.dayOn]}>
                    <Text style={[styles.dayText, chosen && styles.dayTextOn]}>{d.getDate()}</Text>
                  </View>
                </Pressy>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>
            {parsed ? 'Hour' : 'Hour — pick a day first'}
          </Text>
          {/* keyboardShouldPersistTaps is per-ScrollView and is NOT
              inherited from the screen's, so without it here the first tap
              on a chip after the text box has focus only dismisses the
              keyboard and the hour never changes. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}
          >
            {hours.map((h) => {
              const on = parsed?.getHours() === h;
              return (
                <Pressy
                  key={h}
                  onPress={() => withTime(h, parsed?.getMinutes() ?? 0)}
                  disabled={!parsed}
                  style={[styles.chip, on && styles.chipOn, !parsed && styles.chipOff]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn, !parsed && styles.chipTextOff]}>{pad(h)}</Text>
                </Pressy>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionLabel}>
            {parsed ? 'Minute' : 'Minute — pick a day first'}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}
          >
            {minutes.map((m) => {
              const on = parsed?.getMinutes() === m;
              return (
                <Pressy
                  key={m}
                  onPress={() => withTime(parsed?.getHours() ?? 20, m)}
                  disabled={!parsed}
                  style={[styles.chip, on && styles.chipOn, !parsed && styles.chipOff]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn, !parsed && styles.chipTextOff]}>{pad(m)}</Text>
                </Pressy>
              );
            })}
          </ScrollView>

          {relativeBase && (
            <>
              <Text style={styles.sectionLabel}>
                {relativeLabel || 'From the opening time'}
              </Text>
              <View style={styles.chipRow}>
                {[1, 2, 3, 7].map((n) => (
                  <Pressy key={n} onPress={() => addDays(n)} style={styles.chip}>
                    <Text style={styles.chipText}>+{n}d</Text>
                  </Pressy>
                ))}
              </View>
            </>
          )}

          <View style={styles.panelActions}>
            {canClear && (
              <Pressy onPress={() => onChange('')} style={styles.clearBtn}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressy>
            )}
            <Pressy onPress={() => setOpen(false)} style={styles.doneBtn}>
              <Text style={styles.doneText}>Done</Text>
            </Pressy>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Copied from AdminAuctionsScreen's own fieldLabel/input rather than
  // invented: this field sits between two plain text boxes on the same
  // form, and a 2px height difference or a different corner radius reads
  // as a bug even when nothing is wrong.
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, marginTop: 10 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 14.5, color: colors.ink,
  },
  inputGrow: { flex: 1 },
  pickBtn: {
    width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg,
  },
  pickBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },

  echo: { ...type.tiny, color: colors.primary, marginTop: 5 },
  echoBad: { ...type.tiny, color: colors.danger, marginTop: 5 },

  panel: {
    marginTop: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    backgroundColor: colors.card, padding: 11,
  },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 14, fontWeight: '800', color: colors.ink },

  weekRow: { flexDirection: 'row', marginTop: 6 },
  weekCell: {
    ...type.tiny, flex: 1, textAlign: 'center', color: colors.inkSoft, fontWeight: '700',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  // Seven per row, by width rather than by a fixed pixel size, so the grid
  // fits a phone and the admin's browser window equally.
  dayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1, borderColor: colors.accentRing },
  dayOn: { backgroundColor: colors.primary },
  dayText: { fontSize: 13.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  dayTextOn: { color: colors.white, fontWeight: '800' },

  sectionLabel: { ...type.tiny, color: colors.inkSoft, marginTop: 10, marginBottom: 5 },
  chipRow: { flexDirection: 'row', gap: 6, paddingRight: 6 },
  chip: {
    minWidth: 36, height: 30, paddingHorizontal: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipOff: { opacity: 0.45 },
  chipTextOff: { color: colors.inkSoft },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: colors.white },

  panelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  clearBtn: { height: 34, paddingHorizontal: 13, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  doneBtn: {
    height: 34, paddingHorizontal: 16, borderRadius: radius.sm,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  doneText: { fontSize: 13, fontWeight: '800', color: colors.white },
});
