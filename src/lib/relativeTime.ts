// "today", "3 days ago", "2 months ago" -- how long ago something was
// posted, in the reader's language.
//
// On a browse grid this matters more than a date does. "17 Aug" makes a
// buyer work out what today is before they know whether a listing is
// stale; "3 days ago" answers the question they actually have, which is
// whether the thing is probably still available.
//
// Built on Intl.RelativeTimeFormat rather than a date library: it's in
// Hermes and in every browser this ships to, it knows Arabic, and it
// costs nothing to bundle.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTimeFrom(ms: number, language: 'en' | 'ar', now: number = Date.now()): string {
  const locale = language === 'ar' ? 'ar' : 'en';
  const elapsed = now - ms;

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    // 'auto' is what turns -1 day into "yesterday" and 0 days into
    // "today" rather than "1 day ago" / "0 days ago".
    if (elapsed < HOUR) {
      const mins = Math.round(elapsed / MINUTE);
      // Under a minute reads oddly as "in 0 minutes"; anything that fresh
      // is just "now".
      return mins <= 0 ? rtf.format(0, 'minute') : rtf.format(-mins, 'minute');
    }
    if (elapsed < DAY) return rtf.format(-Math.round(elapsed / HOUR), 'hour');

    const days = Math.round(elapsed / DAY);
    if (days < 7) return rtf.format(-days, 'day');
    if (days < 31) return rtf.format(-Math.round(days / 7), 'week');
    if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
    return rtf.format(-Math.round(days / 365), 'year');
  } catch {
    // Intl.RelativeTimeFormat missing (very old runtime) -- a plain date
    // is worse than a relative one but far better than nothing.
    return new Date(ms).toLocaleDateString();
  }
}
