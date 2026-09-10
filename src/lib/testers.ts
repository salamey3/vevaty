import { Platform } from 'react-native';
import { supabase } from './supabase';

// The closed tester round: everything the app says to the database about
// invites, tester roles, the sign-up waitlist and problem reports. The rules
// themselves live in the database (see TESTERS.md) -- nothing in this file is
// a gate, because the app is the one piece anyone can skip.

// Kept as plain strings rather than a union everywhere they are READ: a role
// added to the database later must still count as "is a tester" on a build
// that has never heard of it, not silently drop out of the list.
export const TESTER_ROLES = ['seller', 'storefront', 'buyer', 'consignor'] as const;
export type TesterRole = (typeof TESTER_ROLES)[number];

// Same alphabet the database draws from, and the same normalisation
// check_tester_invite applies, so a code survives being typed with spaces,
// a dash, or in lower case from a WhatsApp message.
export function normalizeInviteCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// "K7Q2MX" -> "K7Q 2MX". Only ever for display: the space is not part of the
// code, and normalizeInviteCode strips it again on the way back in.
export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

// Same literal share.ts and legalLinks.ts use: on native there is no
// window.location to take an origin from.
const SITE_ORIGIN = 'https://vevaty.com';

// The website opens the sign-up screen with the code already filled in.
// There is no app equivalent on purpose: a link that opens the installed app
// needs new native configuration, which changes the update fingerprint and
// orphans every installed copy (@AGENTS.md). App testers type the code.
export function inviteLink(code: string): string {
  return `${SITE_ORIGIN}/login?invite=${encodeURIComponent(normalizeInviteCode(code))}`;
}

// Both languages in one message: the admin sends it from WhatsApp and has no
// way of knowing which language the tester will read Vevaty in.
export function inviteMessage(name: string, code: string): string {
  const first = name.trim().split(/\s+/)[0] || name.trim();
  const shown = formatInviteCode(code);
  const link = inviteLink(code);
  return [
    `Hi ${first}, here is your Vevaty invite.`,
    `On the website, sign up here: ${link}`,
    `In the app, enter this code when you are asked for one: ${shown}`,
    '',
    `مرحبا ${first}، هذه دعوتك إلى ڤيڤاتي.`,
    `على الموقع، سجّل من هنا: ${link}`,
    `في التطبيق، أدخل هذا الرمز عندما يُطلب منك: ${shown}`,
  ].join('\n');
}

// Is sign-up open to everyone right now? Read fresh at the moment it matters
// rather than from what was loaded at launch: an admin can close sign-up
// while a visitor is on the phone step, and guessing "open" wrongly spends a
// $0.36 text message on a code the server will then refuse to honour.
// Throws when it cannot tell -- a failed read is not an answer either way.
export async function fetchRegistrationOpen(): Promise<boolean> {
  const { data, error } = await supabase
    .from('site_settings')
    .select('registration_open')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  // The settings row always exists, so no row means this session could not
  // see it -- which is not the same as "open", and guessing open here is the
  // expensive direction.
  if (!data) throw new Error('site settings not readable');
  return (data as { registration_open?: boolean }).registration_open !== false;
}

export async function checkTesterInvite(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_tester_invite', { p_code: code });
  if (error) throw error;
  return data === true;
}

// Claims the code for the signed-in account and hands back its roles. On the
// sign-up path this must run BEFORE the profile write: that write is where
// the server checks for a claimed invite while sign-up is invite-only.
// null = it did not claim (cancelled, used by someone else, no session).
export async function redeemTesterInvite(code: string): Promise<string[] | null> {
  const { data, error } = await supabase.rpc('redeem_tester_invite', { p_code: code });
  if (error) throw error;
  return Array.isArray(data) ? (data as string[]) : null;
}

// 'no_session': the visitor has no session at all (the anonymous sign-in at
// launch failed, usually offline) -- a connection problem, not a bad number.
export type WaitlistOutcome = 'ok' | 'open' | 'already_member' | 'invalid_phone' | 'too_many' | 'no_session';
const WAITLIST_OUTCOMES: WaitlistOutcome[] = ['ok', 'open', 'already_member', 'invalid_phone', 'too_many', 'no_session'];

export async function joinSignupWaitlist(phone: string, language: string): Promise<WaitlistOutcome> {
  const { data, error } = await supabase.rpc('join_signup_waitlist', {
    p_phone: phone,
    p_language: language,
    p_platform: Platform.OS,
  });
  if (error) throw error;
  // An answer this build does not know is a failure, not an 'ok' -- a mapper
  // that collapses unknown values into a default is how a refusal gets
  // reported to a stranger as "you're on the list" (@AGENTS.md).
  if (typeof data === 'string' && (WAITLIST_OUTCOMES as string[]).includes(data)) return data as WaitlistOutcome;
  throw new Error(`join_signup_waitlist answered ${String(data)}`);
}

export type TesterStatus = { roles: string[]; isAdmin: boolean };
export const NO_TESTER_STATUS: TesterStatus = { roles: [], isAdmin: false };

// The caller's own tester roles. An RPC because tester_roles has no SELECT
// grant and must never get one: profiles is readable by everyone on every
// row, so a grant would publish who is in the round.
export async function fetchMyTesterStatus(): Promise<TesterStatus> {
  const { data, error } = await supabase.rpc('my_tester_status');
  if (error) throw error;
  const row = (data ?? {}) as { roles?: unknown; is_admin?: unknown };
  return {
    roles: Array.isArray(row.roles) ? row.roles.filter((r): r is string => typeof r === 'string') : [],
    isAdmin: row.is_admin === true,
  };
}

export type ProblemSeverity = 'blocked' | 'annoyed' | 'idea';
export const PROBLEM_SEVERITIES: ProblemSeverity[] = ['blocked', 'annoyed', 'idea'];

export type ProblemReportInput = {
  message: string;
  severity: ProblemSeverity;
  screen: string | null;
  listingId: string | null;
  platform: string;
  osVersion: string | null;
  device: string | null;
  appLanguage: string;
  runtimeVersion: string | null;
  updateId: string | null;
  updateCreatedAt: string | null;
  screenshotUrl: string | null;
};

export async function submitProblemReport(input: ProblemReportInput): Promise<string> {
  const { data, error } = await supabase.rpc('submit_problem_report', {
    p_message: input.message,
    p_severity: input.severity,
    p_screen: input.screen,
    p_listing_id: input.listingId,
    p_platform: input.platform,
    p_os_version: input.osVersion,
    p_device: input.device,
    p_app_language: input.appLanguage,
    p_runtime_version: input.runtimeVersion,
    p_update_id: input.updateId,
    p_update_created_at: input.updateCreatedAt,
    p_screenshot_url: input.screenshotUrl,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('submit_problem_report returned no id');
  return data;
}

// ---- Admin: the Tester centre -------------------------------------------

// The admin's own typing, turned into the digits an account's number is
// stored as: "70 529 123", "03 123 456", "+961 3 123 456" and "00961…" all
// name the same member. A number typed with no country code is taken as
// Lebanese, because the admin tool is used there -- the app itself assumes
// no country. One typed WITH a country code (a leading + or 00) is taken as
// written, so a short foreign number is never turned into a Lebanese one.
export function adminPhoneDigits(input: string): string {
  const trimmed = input.trim();
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  let d = trimmed.replace(/[^0-9]/g, '');
  if (trimmed.startsWith('00')) d = d.slice(2);
  // Lebanese numbers are written with a trunk 0 at home ("03 …") that is
  // dropped after the country code.
  if (d.startsWith('961')) return '961' + d.slice(3).replace(/^0+/, '');
  if (!international && d.length >= 7 && d.length <= 9) return '961' + d.replace(/^0+/, '');
  return d;
}

export type TesterInvite = {
  id: string;
  code: string;
  testerName: string;
  roles: string[];
  note: string | null;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  joinedName: string | null;
};

export type TesterMember = {
  userId: string;
  fullName: string | null;
  phone: string | null;
  roles: string[];
  testListings: number;
  reports: number;
};

export type WaitlistEntry = {
  id: string;
  phone: string;
  language: string | null;
  platform: string | null;
  createdAt: string;
};

export type TesterCentre = {
  registrationOpen: boolean;
  invites: TesterInvite[];
  testers: TesterMember[];
  waitlist: WaitlistEntry[];
  waitlistCount: number;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export async function fetchTesterCentre(): Promise<TesterCentre> {
  const { data, error } = await supabase.rpc('admin_tester_centre');
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  return {
    registrationOpen: row.registration_open !== false,
    invites: list(row.invites).map((i) => ({
      id: String(i.id),
      code: String(i.code),
      testerName: String(i.tester_name ?? ''),
      roles: strings(i.roles),
      note: str(i.note),
      createdAt: String(i.created_at),
      usedBy: str(i.used_by),
      usedAt: str(i.used_at),
      revokedAt: str(i.revoked_at),
      joinedName: str(i.joined_name),
    })),
    testers: list(row.testers).map((m) => ({
      userId: String(m.user_id),
      fullName: str(m.full_name),
      phone: str(m.phone),
      roles: strings(m.roles),
      testListings: Number(m.test_listings) || 0,
      reports: Number(m.reports) || 0,
    })),
    waitlist: list(row.waitlist).map((w) => ({
      id: String(w.id),
      phone: String(w.phone),
      language: str(w.language),
      platform: str(w.platform),
      createdAt: String(w.created_at),
    })),
    waitlistCount: Number(row.waitlist_count) || 0,
  };
}

export async function setRegistrationOpen(open: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_registration_open', { p_open: open });
  if (error) throw error;
}

export async function createTesterInvite(name: string, roles: string[], note: string): Promise<{ id: string; code: string }> {
  const { data, error } = await supabase.rpc('admin_create_tester_invite', {
    p_tester_name: name,
    p_roles: roles,
    p_note: note || null,
  });
  if (error) throw error;
  const row = (data ?? {}) as { id?: unknown; code?: unknown };
  if (typeof row.id !== 'string' || typeof row.code !== 'string') throw new Error('No invite came back');
  return { id: row.id, code: row.code };
}

export async function revokeTesterInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_tester_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

// An empty array takes the tag off.
export async function setTesterRoles(userId: string, roles: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('admin_set_tester_roles', { p_user_id: userId, p_roles: roles });
  if (error) throw error;
  return strings(data);
}

// `admitted`: the number had been confirmed by text message but its sign-up
// was refused for want of an invite, so tagging it has also let them in
// (see the tag_by_phone_admits_a_confirmed_number migration).
export async function tagMemberByPhone(
  phone: string,
  roles: string[]
): Promise<{ userId: string; fullName: string | null; admitted: boolean }> {
  const { data, error } = await supabase.rpc('admin_tag_member_by_phone', { p_phone: phone, p_roles: roles });
  if (error) throw error;
  const row = (data ?? {}) as { user_id?: unknown; full_name?: unknown; admitted?: unknown };
  if (typeof row.user_id !== 'string') throw new Error('No member came back');
  return { userId: row.user_id, fullName: str(row.full_name), admitted: row.admitted === true };
}

// Every number on the waitlist, oldest first. The Tester centre shows the
// latest 500; this is what "Copy all" copies, so launch day reaches everyone.
export async function fetchWaitlistExport(): Promise<string[]> {
  const { data, error } = await supabase.rpc('admin_waitlist_export');
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('waitlist export came back empty-handed');
  return (data as Record<string, unknown>[])
    .map((w) => (typeof w.phone === 'string' ? w.phone : null))
    .filter((p): p is string => !!p);
}

// `.select('id')` and the length check because a delete that matches no row
// is not an error (@AGENTS.md) -- and "removed" over a row that is still
// there is the one thing this must not say.
export async function removeWaitlistEntry(id: string): Promise<void> {
  const { data, error } = await supabase.from('signup_waitlist').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('waitlist_entry_not_removed');
}

// The server's own error words, for the few places that answer differently
// to each. PostgREST carries a RAISE's message on `message` and a custom
// SQLSTATE on `code`.
export function testerErrorWord(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  if (err?.code === 'VV002') return 'invite_required';
  return (err?.message || '').trim();
}
