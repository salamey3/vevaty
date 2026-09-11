import { Platform } from 'react-native';
import { supabase } from './supabase';
import { XlsxSheet, sheetTime } from './xlsx';

// The tester round's two forms (@TESTERS.md, "The two forms"):
//
// - Vevaty Tester Onboarding -- a public page, opened from a link the admin
//   sends on WhatsApp, for people who have agreed to test and have no
//   account yet. vevaty.com/testers/join?k=KEY
// - Testers Reports -- one report per mission, for members only.
//   vevaty.com/testers/report, and Profile / the Report a problem sheet.
//
// The rules live in the database (the tester_forms migration). Nothing here
// is a gate: the page checks what it can so a tester is told at once, and
// the server checks everything again.

const SITE_ORIGIN = 'https://vevaty.com';

// ---- Lebanese mobile numbers ---------------------------------------------

// Arabic-Indic digits (U+0660..0669) and the Persian ones (U+06F0..06F9),
// as an Arabic keyboard types them.
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const c = ch.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

// Mirrors myazar.lebanese_mobile, which is the rule: a Lebanese MOBILE
// number however it was typed -- "70 123 456", "03 123 456", "+961 3 123
// 456", "00961 71 123456" -- as +961..., or null. A landline cannot receive
// the text message sign-up sends, so it is not accepted.
export function lebaneseMobile(raw: string): string | null {
  const v = westernDigits(raw || '');
  // Letters mean it is not a number; everything else that is not a digit or
  // a + (spaces, dashes, dots, brackets, invisible direction marks) is noise.
  if (/[A-Za-zء-ي]/.test(v)) return null;
  const t = v.replace(/[^0-9+]/g, '');
  if (!/^\+?[0-9]+$/.test(t)) return null;
  let d = t.replace(/[^0-9]/g, '');
  if (t.startsWith('+')) {
    if (!d.startsWith('961')) return null;
    d = d.slice(3);
  } else if (d.startsWith('00')) {
    if (d.slice(2, 5) !== '961') return null;
    d = d.slice(5);
  } else if (d.startsWith('961') && d.length >= 10) {
    d = d.slice(3);
  }
  d = d.replace(/^0+/, '');
  return /^(3\d{6}|(70|71|76|78|79|81)\d{6})$/.test(d) ? `+961${d}` : null;
}

// "+96170123456" -> "+961 70 123 456", "+9613123456" -> "+961 3 123 456".
export function formatLebanese(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+961(3|\d\d)(\d{3})(\d{3})$/.exec(phone);
  return m ? `+961 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

// The invisible characters text picks up when it is copied out of an
// Arabic message -- direction marks and isolates, zero-width joiners, the
// byte-order mark, the no-break space. None of them is ever part of an
// email address, and one left in makes the address fail when it is copied
// back out of the table. Listed by number rather than written into a
// pattern, where an invisible character cannot be read.
const INVISIBLE = new Set([
  0x00a0, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);
function withoutInvisible(s: string): string {
  let out = '';
  for (const ch of s) if (!INVISIBLE.has(ch.codePointAt(0) ?? 0)) out += ch;
  return out;
}

// Mirrors the server's own check (submit_tester_onboarding).
export function cleanEmail(raw: string): string | null {
  const e = withoutInvisible(raw || '').trim().toLowerCase();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(e) ? e : null;
}

// ---- Form 1: Vevaty Tester Onboarding --------------------------------------

export type Sells = 'often' | 'sometimes' | 'shopper';
export type SellerType = 'business' | 'personal';
export type Category = 'cars' | 'properties' | 'computers_phones' | 'cameras' | 'other';
export type DevicePreference = 'computer' | 'mobile';
export type PhoneType = 'iphone' | 'android';
export type MobilePreference = 'app' | 'website';

export const SELLS: Sells[] = ['often', 'sometimes', 'shopper'];
export const SELLER_TYPES: SellerType[] = ['business', 'personal'];
export const CATEGORIES: Category[] = ['cars', 'properties', 'computers_phones', 'cameras', 'other'];
export const DEVICE_PREFERENCES: DevicePreference[] = ['computer', 'mobile'];
export const PHONE_TYPES: PhoneType[] = ['iphone', 'android'];
export const MOBILE_PREFERENCES: MobilePreference[] = ['app', 'website'];

export type OnboardingAnswers = {
  fullName: string;
  // Already cleaned by lebaneseMobile.
  phone: string;
  email: string;
  sells: Sells;
  // null for a shopper, who is not asked.
  sellerType: SellerType | null;
  // What they mostly sell, or -- for a shopper -- mostly buy.
  categories: Category[];
  categoriesOther: string | null;
  devicePreference: DevicePreference;
  phoneType: PhoneType;
  mobilePreference: MobilePreference;
};

export type OnboardingOutcome =
  | 'ok'
  | 'no_session'
  | 'bad_link'
  | 'invalid_name'
  | 'invalid_phone'
  | 'invalid_email'
  | 'invalid_answers'
  | 'already_sent'
  | 'too_many';
const ONBOARDING_OUTCOMES: OnboardingOutcome[] = [
  'ok',
  'no_session',
  'bad_link',
  'invalid_name',
  'invalid_phone',
  'invalid_email',
  'invalid_answers',
  'already_sent',
  'too_many',
];

// Is this the current link? Throws when it cannot tell: a failed check is
// not "this link is dead", and saying so would send a tester away.
export async function checkOnboardingLink(key: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('tester_onboarding_link_ok', { p_key: key });
  if (error) throw error;
  return data === true;
}

export async function submitOnboarding(key: string, a: OnboardingAnswers, language: string): Promise<OnboardingOutcome> {
  const { data, error } = await supabase.rpc('submit_tester_onboarding', {
    p_key: key,
    p_full_name: a.fullName,
    p_phone: a.phone,
    p_email: a.email,
    p_sells: a.sells,
    p_seller_type: a.sellerType,
    p_categories: a.categories,
    p_categories_other: a.categoriesOther,
    p_device_preference: a.devicePreference,
    p_phone_type: a.phoneType,
    p_mobile_preference: a.mobilePreference,
    p_language: language,
    p_platform: Platform.OS,
  });
  if (error) throw error;
  // An answer this build does not know is a failure, never an 'ok'
  // (@AGENTS.md).
  if (typeof data === 'string' && (ONBOARDING_OUTCOMES as string[]).includes(data)) return data as OnboardingOutcome;
  throw new Error(`submit_tester_onboarding answered ${String(data)}`);
}

// The Tester Field Kit's reading of the answers: a shop or business is a
// Storefront, personal selling a Seller, a shopper a Buyer. Only ever a
// suggestion -- the admin picks the roles when making the invite.
export function suggestedRole(sells: string, sellerType: string | null): 'storefront' | 'seller' | 'buyer' | null {
  if (sells === 'shopper') return 'buyer';
  if (sellerType === 'business') return 'storefront';
  if (sellerType === 'personal') return 'seller';
  return null;
}

// ---- Form 2: Testers Reports ---------------------------------------------

// The tester's own roles first, in the role sheets' order.
export const MISSION_ROLES = ['seller', 'storefront', 'buyer', 'consignor', 'everyone'] as const;

export type Mission = {
  id: string;
  role: string;
  position: number;
  titleEn: string;
  titleAr: string | null;
};

export type MissionAccess = {
  member: boolean;
  roles: string[];
  fullName: string | null;
  missions: Mission[];
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

function toMission(m: Record<string, unknown>): Mission {
  return {
    id: String(m.id),
    role: String(m.role ?? ''),
    position: Number(m.position) || 0,
    titleEn: String(m.title_en ?? ''),
    titleAr: str(m.title_ar),
  };
}

export async function fetchMyMissions(): Promise<MissionAccess> {
  const { data, error } = await supabase.rpc('my_tester_missions');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.member !== true) return { member: false, roles: [], fullName: null, missions: [] };
  return {
    member: true,
    roles: strings(row.roles),
    fullName: str(row.full_name),
    missions: list(row.missions).map(toMission),
  };
}

// "1. Sign up and post one real item", in the reader's language when the
// mission has an Arabic name.
export function missionLabel(m: Pick<Mission, 'position' | 'titleEn' | 'titleAr'>, language: string): string {
  const title = language === 'ar' && m.titleAr ? m.titleAr : m.titleEn;
  return `${m.position}. ${title}`;
}

export type Finished = 'yes' | 'hard' | 'gave_up';
export type Surface = 'app' | 'website' | 'both';
export type Severity = 'blocked' | 'annoyed' | 'idea';
export const FINISHED: Finished[] = ['yes', 'hard', 'gave_up'];
export const SURFACES: Surface[] = ['app', 'website', 'both'];
export const SEVERITIES: Severity[] = ['blocked', 'annoyed', 'idea'];

// "Where did you get stuck?" may be left empty only by someone who finished
// without trouble; "How bad was it?" is asked whenever there is something
// there to rate. The same rule the database enforces.
export function stuckRequired(finished: Finished | null): boolean {
  return finished === 'hard' || finished === 'gave_up';
}
export function severityAsked(finished: Finished | null, stuck: string): boolean {
  return stuckRequired(finished) || stuck.trim().length > 0;
}

export type TesterReportInput = {
  name: string;
  // null: "something else -- not one of my missions".
  missionId: string | null;
  finished: Finished;
  stuck: string;
  severity: Severity | null;
  surface: Surface;
  deviceType: string;
  screenshotUrl: string | null;
  platform: string;
  osVersion: string | null;
  device: string | null;
  appLanguage: string;
  runtimeVersion: string | null;
  updateId: string | null;
  updateCreatedAt: string | null;
};

export async function submitTesterReport(r: TesterReportInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_tester_report', {
    p_name: r.name,
    p_mission_id: r.missionId,
    p_finished: r.finished,
    p_stuck: r.stuck,
    p_severity: r.severity,
    p_surface: r.surface,
    p_device_type: r.deviceType,
    p_screenshot_url: r.screenshotUrl,
    p_platform: r.platform,
    p_os_version: r.osVersion,
    p_device: r.device,
    p_app_language: r.appLanguage,
    p_runtime_version: r.runtimeVersion,
    p_update_id: r.updateId,
    p_update_created_at: r.updateCreatedAt,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('submit_tester_report returned no id');
  return data;
}

// A guess at "Your device type" to start the field with; the tester can
// change it. Android names its maker and model, iOS only the kind of
// device, and the website reads it off the browser's description of itself.
export function guessDeviceType(): string {
  try {
    if (Platform.OS === 'android') {
      const c = Platform.constants as unknown as { Brand?: string; Model?: string };
      const model = [c.Brand, c.Model].filter(Boolean).join(' ');
      return model ? `Android (${model})` : 'Android';
    }
    if (Platform.OS === 'ios') {
      const c = Platform.constants as unknown as { interfaceIdiom?: string };
      return c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone';
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPhone|iPod/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    return ua ? 'Computer' : '';
  } catch {
    return '';
  }
}

// ---- Admin: the Tester centre's half ---------------------------------------

export function onboardingLink(key: string): string {
  return `${SITE_ORIGIN}/testers/join?k=${encodeURIComponent(key)}`;
}

// Both languages in one message, as the invite message does.
export function onboardingMessage(key: string): string {
  const link = onboardingLink(key);
  return [
    `Thanks for helping test Vevaty! Please fill in this short form — it takes about two minutes: ${link}`,
    '',
    `شكراً لمساعدتك في اختبار ڤيڤاتي! يرجى تعبئة هذه الاستمارة القصيرة — تستغرق نحو دقيقتين: ${link}`,
  ].join('\n');
}

export type OnboardingRow = {
  id: string;
  createdAt: string;
  fullName: string;
  phone: string;
  email: string;
  sells: string;
  sellerType: string | null;
  categories: string[];
  categoriesOther: string | null;
  devicePreference: string;
  phoneType: string;
  mobilePreference: string;
  language: string | null;
  platform: string | null;
};

export type OnboardingAdmin = { linkKey: string | null; linkRotatedAt: string | null; rows: OnboardingRow[] };

export async function fetchOnboardingAdmin(): Promise<OnboardingAdmin> {
  const { data, error } = await supabase.rpc('admin_tester_onboarding');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    linkKey: str(row.link_key),
    linkRotatedAt: str(row.link_rotated_at),
    rows: list(row.rows).map((o) => ({
      id: String(o.id),
      createdAt: String(o.created_at),
      fullName: String(o.full_name ?? ''),
      phone: String(o.phone ?? ''),
      email: String(o.email ?? ''),
      sells: String(o.sells ?? ''),
      sellerType: str(o.seller_type),
      categories: strings(o.categories),
      categoriesOther: str(o.categories_other),
      devicePreference: String(o.device_preference ?? ''),
      phoneType: String(o.phone_type ?? ''),
      mobilePreference: String(o.mobile_preference ?? ''),
      language: str(o.language),
      platform: str(o.platform),
    })),
  };
}

export async function rotateOnboardingLink(): Promise<string> {
  const { data, error } = await supabase.rpc('admin_rotate_tester_onboarding_link');
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('No new link came back');
  return data;
}

export async function deleteOnboardingRow(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_tester_onboarding', { p_id: id });
  if (error) throw error;
}

export type AdminMission = Mission & { active: boolean; reports: number };

export type TesterReportRow = {
  id: string;
  createdAt: string;
  reporterId: string | null;
  reporterName: string;
  accountName: string | null;
  accountRoles: string[];
  missionId: string | null;
  missionRole: string | null;
  missionPosition: number | null;
  missionTitle: string | null;
  finished: string;
  stuck: string | null;
  severity: string | null;
  surface: string;
  deviceType: string;
  screenshotUrl: string | null;
  platform: string | null;
  osVersion: string | null;
  device: string | null;
  appLanguage: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  updateCreatedAt: string | null;
};

export type TesterReportsAdmin = { rows: TesterReportRow[]; missions: AdminMission[] };

export async function fetchTesterReportsAdmin(): Promise<TesterReportsAdmin> {
  const { data, error } = await supabase.rpc('admin_tester_reports');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    rows: list(row.rows).map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at),
      reporterId: str(r.reporter_id),
      reporterName: String(r.reporter_name ?? ''),
      accountName: str(r.account_name),
      accountRoles: strings(r.account_roles),
      missionId: str(r.mission_id),
      missionRole: str(r.mission_role),
      missionPosition: typeof r.mission_position === 'number' ? r.mission_position : null,
      missionTitle: str(r.mission_title),
      finished: String(r.finished ?? ''),
      stuck: str(r.stuck),
      severity: str(r.severity),
      surface: String(r.surface ?? ''),
      deviceType: String(r.device_type ?? ''),
      screenshotUrl: str(r.screenshot_url),
      platform: str(r.platform),
      osVersion: str(r.os_version),
      device: str(r.device),
      appLanguage: str(r.app_language),
      runtimeVersion: str(r.runtime_version),
      updateId: str(r.update_id),
      updateCreatedAt: str(r.update_created_at),
    })),
    missions: list(row.missions).map((m) => ({
      ...toMission(m),
      active: m.active !== false,
      reports: Number(m.reports) || 0,
    })),
  };
}

export async function deleteTesterReport(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_tester_report', { p_id: id });
  if (error) throw error;
}

export async function saveMission(m: {
  id: string | null;
  role: string;
  position: number;
  titleEn: string;
  titleAr: string;
  active: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_save_tester_mission', {
    p_id: m.id,
    p_role: m.role,
    p_position: m.position,
    p_title_en: m.titleEn,
    p_title_ar: m.titleAr,
    p_active: m.active,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('No mission came back');
  return data;
}

export type FormsSummary = { onboarding: number; reports: number; reportsWeek: number };

export async function fetchFormsSummary(): Promise<FormsSummary> {
  const { data, error } = await supabase.rpc('admin_tester_forms_summary');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    onboarding: Number(row.onboarding) || 0,
    reports: Number(row.reports) || 0,
    reportsWeek: Number(row.reports_week) || 0,
  };
}

// ---- Labels the admin screens and the Excel files share (English) --------

export const ROLE_LABEL: Record<string, string> = {
  seller: 'Seller',
  storefront: 'Storefront',
  buyer: 'Buyer',
  consignor: 'Consignor',
  everyone: 'Everyone',
};
const SELLS_LABEL: Record<string, string> = {
  often: 'Yes, very frequently',
  sometimes: 'Yes, from time to time',
  shopper: 'No, more of a shopper',
};
const SELLER_TYPE_LABEL: Record<string, string> = {
  business: 'Owns a shop/business',
  personal: 'Mostly personal selling',
};
const CATEGORY_LABEL: Record<string, string> = {
  cars: 'Cars',
  properties: 'Properties',
  computers_phones: 'Computers/Phones',
  cameras: 'Cameras & Accessories',
  other: 'Other',
};
const DEVICE_PREFERENCE_LABEL: Record<string, string> = { computer: 'Laptop/Desktop', mobile: 'Mobile' };
const PHONE_TYPE_LABEL: Record<string, string> = { iphone: 'iPhone', android: 'Android' };
const MOBILE_PREFERENCE_LABEL: Record<string, string> = { app: 'App', website: 'Website (phone browser)' };
const FINISHED_LABEL: Record<string, string> = { yes: 'Yes', hard: 'Yes, but it was hard', gave_up: 'No, gave up' };
const SEVERITY_LABEL: Record<string, string> = { blocked: 'Blocked me', annoyed: 'Annoyed me', idea: 'Just an idea' };
// The severity factor of the scoring formula in the Tester Programme
// (severity x where it sits x testers affected).
const SEVERITY_POINTS: Record<string, number> = { blocked: 5, annoyed: 3, idea: 1 };
const SURFACE_LABEL: Record<string, string> = { app: 'App', website: 'Website', both: 'Both' };
const LANGUAGE_LABEL: Record<string, string> = { en: 'English', ar: 'Arabic' };

// An answer this build has no label for is shown as itself, never as one
// of the known ones.
const label = (map: Record<string, string>, v: string | null | undefined) => (v ? map[v] ?? v : '');

export const onboardingLabels = {
  sells: (v: string) => label(SELLS_LABEL, v),
  sellerType: (v: string | null) => label(SELLER_TYPE_LABEL, v),
  categories: (list: string[], other: string | null) =>
    list.map((c) => (c === 'other' && other ? `Other: ${other}` : label(CATEGORY_LABEL, c))).join(', '),
  devicePreference: (v: string) => label(DEVICE_PREFERENCE_LABEL, v),
  phoneType: (v: string) => label(PHONE_TYPE_LABEL, v),
  mobilePreference: (v: string) => label(MOBILE_PREFERENCE_LABEL, v),
  language: (v: string | null) => label(LANGUAGE_LABEL, v),
  role: (v: string | null) => label(ROLE_LABEL, v),
};

export const reportLabels = {
  finished: (v: string) => label(FINISHED_LABEL, v),
  severity: (v: string | null) => label(SEVERITY_LABEL, v),
  surface: (v: string) => label(SURFACE_LABEL, v),
  language: (v: string | null) => label(LANGUAGE_LABEL, v),
  // "Buyer · 1. Save three items"
  mission: (r: Pick<TesterReportRow, 'missionRole' | 'missionPosition' | 'missionTitle'>) =>
    r.missionTitle
      ? [label(ROLE_LABEL, r.missionRole), `${r.missionPosition != null ? `${r.missionPosition}. ` : ''}${r.missionTitle}`]
          .filter(Boolean)
          .join(' · ')
      : 'Something else',
  build: (r: Pick<TesterReportRow, 'runtimeVersion' | 'updateId'>) =>
    r.runtimeVersion === 'web'
      ? 'website'
      : r.updateId === 'built-in'
        ? 'built-in bundle'
        : r.updateId
          ? `update ${r.updateId.slice(0, 8)}`
          : '',
};

// ---- The two Excel files -------------------------------------------------

export function onboardingSheet(rows: OnboardingRow[]): XlsxSheet {
  return {
    name: 'Tester Onboarding',
    columns: [
      { title: 'Sent', width: 17 },
      { title: 'Full name', width: 22 },
      { title: 'Phone', width: 16 },
      { title: 'Email', width: 28 },
      { title: 'Sells regularly?', width: 22 },
      { title: 'Shop or personal', width: 24 },
      { title: 'Mostly sells', width: 32, wrap: true },
      { title: 'Mostly buys', width: 32, wrap: true },
      { title: 'Buys/sells on', width: 15 },
      { title: 'Phone type', width: 11 },
      { title: 'On mobile prefers', width: 22 },
      { title: 'Suggested role', width: 15 },
      { title: 'Form language', width: 13 },
      { title: 'Sent from', width: 10 },
    ],
    rows: rows.map((o) => {
      const cats = onboardingLabels.categories(o.categories, o.categoriesOther);
      const shopper = o.sells === 'shopper';
      return [
        sheetTime(o.createdAt),
        o.fullName,
        o.phone,
        o.email,
        onboardingLabels.sells(o.sells),
        onboardingLabels.sellerType(o.sellerType),
        shopper ? '' : cats,
        shopper ? cats : '',
        onboardingLabels.devicePreference(o.devicePreference),
        onboardingLabels.phoneType(o.phoneType),
        onboardingLabels.mobilePreference(o.mobilePreference),
        onboardingLabels.role(suggestedRole(o.sells, o.sellerType)),
        onboardingLabels.language(o.language),
        o.platform ?? '',
      ];
    }),
  };
}

export function reportsSheet(rows: TesterReportRow[]): XlsxSheet {
  return {
    name: 'Testers Reports',
    columns: [
      { title: 'Sent', width: 17 },
      { title: 'Your name', width: 18 },
      { title: 'Role', width: 11 },
      { title: 'Mission #', width: 10 },
      { title: 'Which mission', width: 40, wrap: true },
      { title: 'Did you finish it?', width: 20 },
      { title: 'Where did you get stuck?', width: 60, wrap: true },
      { title: 'How bad was it?', width: 15 },
      { title: 'Severity points', width: 9 },
      { title: 'Phone app or website?', width: 12 },
      { title: 'Device type', width: 18 },
      { title: 'Screenshot', width: 40 },
      { title: 'Sent from', width: 10 },
      { title: 'Phone / browser (recorded)', width: 30 },
      { title: 'OS (recorded)', width: 18 },
      { title: 'App language', width: 12 },
      { title: 'Build', width: 18 },
      { title: 'Runtime', width: 16 },
      { title: 'Update published', width: 17 },
      { title: 'Account name', width: 18 },
      { title: 'Tester roles', width: 18 },
      // Filled in by hand during triage, as in the Tester Field Kit.
      { title: 'Score', width: 8 },
      { title: 'Fixed in build', width: 16 },
      { title: 'Report id', width: 38 },
    ],
    rows: rows.map((r) => [
      sheetTime(r.createdAt),
      r.reporterName,
      r.missionRole ? label(ROLE_LABEL, r.missionRole) : '',
      r.missionPosition ?? '',
      r.missionTitle ?? 'Something else',
      reportLabels.finished(r.finished),
      r.stuck ?? '',
      reportLabels.severity(r.severity),
      r.severity ? SEVERITY_POINTS[r.severity] ?? '' : '',
      reportLabels.surface(r.surface),
      r.deviceType,
      r.screenshotUrl ?? '',
      r.platform ?? '',
      r.device ?? '',
      r.osVersion ?? '',
      reportLabels.language(r.appLanguage),
      reportLabels.build(r),
      r.runtimeVersion ?? '',
      sheetTime(r.updateCreatedAt),
      r.accountName ?? '',
      r.accountRoles.map((x) => label(ROLE_LABEL, x)).join(', '),
      '',
      '',
      r.id,
    ]),
  };
}
