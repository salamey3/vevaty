// "today", "3 days ago", "2 months ago" -- how long ago something was
// posted, in the reader's language.
//
// On a browse grid this matters more than a date does. "17 Aug" makes a
// buyer work out what today is before they know whether a listing is
// stale; "3 days ago" answers the question they actually have, which is
// whether the thing is probably still available.
//
// Written by hand rather than on Intl.RelativeTimeFormat, which was the
// first attempt and shipped broken. Hermes -- the engine the Android app
// runs on -- ships a cut-down Intl without RelativeTimeFormat, so the
// try/catch fell through to a plain date on the phone while the website
// showed relative time correctly. Worse, it failed silently: two surfaces
// disagreed and nothing anywhere reported an error. Twelve strings in two
// languages is a smaller cost than a formatter that only works on half
// the platforms.
//
// Same reason DateTimeFormat isn't used for the absolute date below.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Lang = 'en' | 'ar';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// Arabic marks 1 and 2 of a unit with their own words rather than a
// number, and uses a different plural form from 3 upward -- "منذ يومين",
// not "منذ 2 أيام". Handled per unit rather than with a generic
// pluraliser, because the dual form differs for each one.
function ar(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return `منذ ${one}`;
  if (count === 2) return `منذ ${two}`;
  if (count <= 10) return `منذ ${count} ${few}`;
  return `منذ ${count} ${many}`;
}

export function relativeTimeFrom(ms: number, language: Lang, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - ms);

  if (elapsed < MINUTE) return language === 'ar' ? 'الآن' : 'just now';

  if (elapsed < HOUR) {
    const n = Math.max(1, Math.round(elapsed / MINUTE));
    return language === 'ar'
      ? ar(n, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')
      : n === 1 ? '1 minute ago' : `${n} minutes ago`;
  }

  if (elapsed < DAY) {
    const n = Math.max(1, Math.round(elapsed / HOUR));
    return language === 'ar'
      ? ar(n, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')
      : n === 1 ? '1 hour ago' : `${n} hours ago`;
  }

  const days = Math.round(elapsed / DAY);
  if (days === 1) return language === 'ar' ? 'أمس' : 'yesterday';
  if (days < 7) return language === 'ar' ? ar(days, 'يوم', 'يومين', 'أيام', 'يوم') : `${days} days ago`;

  if (days < 31) {
    const n = Math.max(1, Math.round(days / 7));
    return language === 'ar'
      ? ar(n, 'أسبوع', 'أسبوعين', 'أسابيع', 'أسبوع')
      : n === 1 ? '1 week ago' : `${n} weeks ago`;
  }

  if (days < 365) {
    const n = Math.max(1, Math.round(days / 30));
    return language === 'ar'
      ? ar(n, 'شهر', 'شهرين', 'أشهر', 'شهر')
      : n === 1 ? '1 month ago' : `${n} months ago`;
  }

  const n = Math.max(1, Math.round(days / 365));
  return language === 'ar'
    ? ar(n, 'سنة', 'سنتين', 'سنوات', 'سنة')
    : n === 1 ? '1 year ago' : `${n} years ago`;
}

// The exact date, for the listing page where "posted 3 weeks ago" is less
// useful than knowing when. Same no-Intl reasoning as above.
export function absoluteDate(ms: number, language: Lang): string {
  const d = new Date(ms);
  const months = language === 'ar' ? AR_MONTHS : EN_MONTHS;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
