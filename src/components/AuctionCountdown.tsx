import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { colors } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

// A ticking "time left" label.
//
// It exists as its own component so that ONE thing in the tree re-renders
// every second. An auction page holds fifteen lots, each with its own
// deadline; putting the clock in the screen's state would re-render every
// card, every photo and every price once a second for the length of the
// event.
//
// Deliberately NOT counting down to a value the screen was handed once:
// anti-snipe moves a lot's close while somebody is watching it, so the
// deadline is a prop that can change underneath, and this recomputes from
// it on every tick rather than decrementing its own counter.

// How often to tick. Every second inside the last ninety, where every
// second is information, and every thirty above it -- a card that says
// "2 days" does not need 86,400 re-renders to get there.
//
// Ninety and not sixty, which was a real bug: at 61s left the next tick
// was 30s away, so the label sat on "1m 01s", jumped to "31s", and entered
// its red urgent state up to half a minute late -- on the only minute of a
// 48-hour auction where the clock is the thing being watched.
function tickMsFor(msLeft: number): number {
  return msLeft <= 90_000 ? 1000 : 30_000;
}

export function formatTimeLeft(
  msLeft: number,
  t: (k: string, v?: Record<string, string | number>) => string
): string {
  if (msLeft <= 0) return t('auctions.ended');
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  // One unit of precision below the largest, which is how a person reads a
  // deadline: "2d 4h" and "3m 12s" are both immediately legible, "2d 4h
  // 31m 08s" is a number to be decoded.
  if (d > 0) return t('auctions.leftDh', { d, h });
  if (h > 0) return t('auctions.leftHm', { h, m });
  if (m > 0) return t('auctions.leftMs', { m, s: String(sec).padStart(2, '0') });
  return t('auctions.leftS', { s: sec });
}

export default function AuctionCountdown({
  closesAt,
  style,
  // Under a minute the label turns red and the tick is per-second: the
  // last minute of a lot is the only part of a 48-hour auction where the
  // clock is the thing you are watching.
  urgentStyle,
  prefix,
}: {
  closesAt: string | null;
  style?: TextStyle | TextStyle[];
  urgentStyle?: TextStyle;
  prefix?: string;
}) {
  const { t } = useLanguage();
  const target = useMemo(() => (closesAt ? new Date(closesAt).getTime() : 0), [closesAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    let timer: any;
    const schedule = () => {
      const left = target - Date.now();
      if (left <= 0) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        setNow(Date.now());
        schedule();
      }, tickMsFor(left));
    };
    // setTimeout that reschedules itself, not setInterval: the cadence
    // changes as the deadline approaches, and an interval set at 30s when
    // the screen mounted would still be 30s through the final minute.
    setNow(Date.now());
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target]);

  if (!target) return null;
  const left = target - now;
  const label = formatTimeLeft(left, t);
  return (
    <Text style={[style, left > 0 && left <= 60_000 && (urgentStyle || styles.urgent)]}>
      {/* The prefix is dropped once the deadline passes: "Opens in" plus
          "Ended" is a sentence that says nothing, and it is on screen for
          up to a minute while the closer catches up. */}
      {prefix && left > 0 ? `${prefix} ${label}` : label}
    </Text>
  );
}

const styles = StyleSheet.create({
  urgent: { color: colors.danger },
});
