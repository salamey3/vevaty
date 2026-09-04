import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Vevaty's own standalone Supabase project -- previously this app shared a
// project with two unrelated apps (a household finance tracker and a task
// tracker), each in their own schema. Now that Vevaty has its own paid
// subscription, it has been split onto a dedicated project with nothing
// else on it: no shared auth.users table, no risk of another app's admin
// action ever touching Vevaty's data or vice versa. The key below is the
// public "publishable" key, safe to ship inside the app; every table it
// can reach is protected by Row Level Security policies, not by keeping
// this key secret.
// Exported because photoUpload.ts posts raw image bytes to an edge
// function by hand: on native the file is streamed from a file:// URI by
// expo-file-system's uploader, which supabase-js has no way to drive.
export const SUPABASE_URL = 'https://ajrrmropskvutjizulkb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_DK_WRVSv9ymAGCgL9o8k9g_9Lg2wB1l';

// Every request this client makes gets a deadline.
//
// Neither browser fetch nor React Native's OkHttp times out on its own, and
// supabase-js does not add one -- so a connection that goes quiet mid-body
// leaves the promise pending for ever. That was survivable while every
// write in the app was fire-and-forget; it is not any more. Three screens
// now WAIT on a media save before they will let the seller move on
// (CreateListingScreen's Post in edit mode, BatchFinalReviewScreen's Post,
// and BatchPhotosScreen's Next), so one stalled PostgREST call meant a
// spinner and a dead button for the rest of the session, with a reload --
// losing the form -- the only way out.
//
// Doing it HERE rather than racing individual calls is the point: it is
// one place instead of the dozen awaits that would each need remembering,
// and it covers the reads and RPCs as well as the writes.
//
// Generous, because it is a backstop and not a policy: anything that is
// working at all answers in well under this, and a real slow request
// should finish rather than be cut off. The failure it exists to bound is
// a socket that has stopped answering entirely.
const REQUEST_TIMEOUT_MS = 45_000;

// An edge function gets much longer. moderate-listing carries up to six
// base64 photos up a Lebanese mobile link and then waits on a vision
// model; 45 seconds is a normal duration for it, not a stall. Nothing in
// the app awaits it either, so a long bound costs nobody anything -- and
// cutting it off part-way is a listing parked at pending_review with
// nothing said, which is the outcome the whole change exists to avoid.
const FUNCTION_TIMEOUT_MS = 180_000;

// AbortController, NOT AbortSignal.timeout, and the difference is not
// cosmetic. `AbortSignal.timeout()` aborts with a **TimeoutError**;
// postgrest-js treats only `AbortError` (or code ABORT_ERR) as final and
// RETRIES anything else on a GET/HEAD/OPTIONS, three times, with 1s/2s/4s
// backoff. So the timeout meant to bound a read at 45 seconds bounded it
// at four attempts plus backoff -- about 187 -- on the web build, where
// AbortSignal.timeout exists. (React Native polyfills AbortSignal from
// abort-controller, which has no .timeout, so native quietly took the
// controller path and behaved correctly; the bug was web-only, which is
// exactly the sort that ships.) A bare controller.abort() produces a real
// AbortError and stops on the first attempt.
//
// The timer is deliberately NOT cleared when the fetch promise settles.
// On the web, `fetch` resolves as soon as the RESPONSE HEADERS arrive --
// the body is read afterwards, by postgrest-js's own `res.json()`. So
// disarming on settle covered only the half of the request that was never
// the problem: a connection that delivers headers and then goes quiet
// stayed unbounded, which is the exact stall this whole helper exists for.
// (Measured: with the timer cleared on settle, a header-then-stall was
// still hanging after four seconds against a 1.5s deadline; left armed,
// it aborted at 1.5s.) Leaving it armed costs one timer per request for
// the length of the deadline, and aborting an already-finished request is
// a no-op.
function deadline(ms: number, inherited?: AbortSignal | null): AbortSignal | undefined {
  if (typeof AbortController !== 'function') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  // COMPOSED with the caller's own signal rather than deferring to it.
  // Deferring meant any call that passed one -- .abortSignal() is used by
  // SellerProfileScreen and StorefrontScreen -- silently opted out of the
  // global bound, which is an exemption nobody would have known they had.
  if (inherited) {
    if (inherited.aborted) c.abort();
    else inherited.addEventListener('abort', () => c.abort(), { once: true });
  }
  return c.signal;
}

const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request)?.url ?? String(input);
  const ms = url.includes('/functions/v1/') ? FUNCTION_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const signal = deadline(ms, init?.signal);
  return fetch(input as any, signal ? { ...init, signal } : init);
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: 'myazar' },
  global: { fetch: fetchWithTimeout },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// The app signs people in anonymously the first time it launches, so every
// listing/points/profile write has a real auth.uid() to attach to and Row
// Level Security has something to check — without ever showing a login
// screen. Anyone can later upgrade this anonymous account to a real one
// (email/phone) without losing their listings or points.
export async function ensureSession() {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}

// Real login/signup (AuthScreen), gating posting a listing and viewing a
// seller's contact info -- see AppStore's `isVerified`. Deliberately NOT
// an "upgrade the anonymous session" flow: Supabase's `channel` (SMS vs
// WhatsApp) option only exists on signInWithOtp, not on the anonymous-
// linking updateUser({phone}) call, and since nothing gated can happen
// while anonymous there's nothing on that session worth preserving.
// signInWithOtp creates the auth.users row on first verified OTP, exactly
// like a signup, so this same pair covers both new and returning users.
export async function sendPhoneOtp(phone: string, channel: 'sms' | 'whatsapp') {
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { channel } });
  if (error) throw error;
}

export async function verifyPhoneOtp(phone: string, token: string) {
  // `type: 'sms'` is Supabase's own constant name for "phone OTP" --
  // it applies regardless of which channel (SMS or WhatsApp) actually
  // delivered the code, not a mismatch bug.
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw error;
  return data.session;
}

// Loose E.164-ish check -- a leading "+" and 8-15 digits after it. Good
// enough to catch obviously-broken input before spending an OTP send;
// Twilio/Supabase are the real validators. Shared between AuthScreen
// (first-time verification) and ChangePhoneScreen (swapping an already-
// verified account to a new number) rather than duplicated -- it's
// validation logic, not just formatting, so the two copies drifting would
// be a real bug risk, not just a style inconsistency.
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.replace(/[\s-]/g, '');
  return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
}

// Changing the phone number on an ALREADY-authenticated account -- a
// different Supabase primitive from sendPhoneOtp/verifyPhoneOtp above.
// Those call signInWithOtp, which signs in as whichever auth.users row
// that phone belongs to (creating one if it's new) -- exactly what you
// want for "log in", and exactly wrong here, since it could swap the
// caller onto a DIFFERENT existing account rather than updating this one.
// updateUser({phone}) instead sends an OTP to confirm a *change* on the
// CURRENT session's own user -- same uid throughout, so every listing,
// favorite, and chat thread already tied to it just keeps working.
export async function sendPhoneChangeOtp(newPhone: string) {
  const { error } = await supabase.auth.updateUser({ phone: newPhone });
  if (error) throw error;
}

export async function verifyPhoneChangeOtp(newPhone: string, token: string) {
  // `type: 'phone_change'` (not 'sms') is Supabase's distinct constant for
  // confirming a pending phone-change OTP, as opposed to a fresh sign-in.
  const { data, error } = await supabase.auth.verifyOtp({ phone: newPhone, token, type: 'phone_change' });
  if (error) throw error;
  return data.session;
}

// Phone + password sign-in (AuthScreen) -- added so a returning user isn't
// spending a fresh OTP send just to get back in. "Does an account already
// exist for this number?" can't be answered from a plain table query --
// the client has no read access to auth.users, and it shouldn't (letting
// anyone probe arbitrary numbers to learn who's registered is its own
// privacy leak) -- so this goes through a narrow SECURITY DEFINER function
// (see the is_phone_registered migration) that answers only true/false,
// nothing else about the account.
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_phone_registered', { p_phone: phone });
  if (error) throw error;
  return !!data;
}

export async function signInWithPhonePassword(phone: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ phone, password });
  if (error) throw error;
  return data.session;
}

// Attaches/replaces a password on the CURRENT session's own account.
// Reused for two different moments in AuthScreen: right after a brand-new
// signup's phone OTP verifies (setting a password for the first time), and
// after a "forgot password" recovery OTP verifies (setting a new one).
// Supabase doesn't distinguish those cases -- there's no separate "set
// initial password" call -- which also means this same path quietly
// handles every account that verified its phone before this feature
// existed and has never had a password at all: their first "forgot
// password" attempt sets one, no separate migration needed.
export async function setAccountPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

// Creates-or-updates the CALLER's own profiles row in one call -- a
// first-time signup has no row yet, a returning user's password-reset
// flow does, and AuthScreen needs both cases handled the same way. A
// plain `.upsert(..., {onConflict:'id'})` from the client can't do this
// on myazar.profiles: Postgres requires table-level SELECT privilege to
// evaluate INSERT ... ON CONFLICT DO UPDATE, but `authenticated` only has
// column-level SELECT grants here (phone is deliberately excluded -- see
// ensureSession's comment above), never a table-level grant, so the
// upsert's ON CONFLICT clause was always rejected outright with
// "permission denied for table profiles" -- silently, since nothing
// checked the error, which is why full_name/is_phone_verified never
// actually persisted no matter how many times signup or recovery ran.
// This RPC (SECURITY DEFINER, myazar.upsert_own_profile) runs as its
// owner instead of the caller, sidestepping that grant, while always
// writing to auth.uid() -- never a caller-supplied id -- so it can only
// ever touch the signed-in user's own row. Omit a field (leave it
// undefined) to leave that column exactly as it is rather than clearing
// it -- e.g. verifyCode's call only ever touches phone/is_phone_verified,
// never full_name.
export async function upsertOwnProfile(fields: {
  phone?: string;
  fullName?: string;
  isPhoneVerified?: boolean;
  email?: string | null;
  whatsapp?: string | null;
  whatsappOptIn?: boolean;
}) {
  const { error } = await supabase.rpc('upsert_own_profile', {
    p_phone: fields.phone ?? null,
    p_full_name: fields.fullName ?? null,
    p_is_phone_verified: fields.isPhoneVerified ?? null,
    p_email: fields.email ?? null,
    p_whatsapp: fields.whatsapp ?? null,
    p_whatsapp_opt_in: fields.whatsappOptIn ?? null,
  });
  if (error) throw error;
}

// The caller's own email / WhatsApp number / WhatsApp consent flag.
//
// This needs an RPC for a reason that is easy to get wrong: profiles carries
// the policy "profiles are publicly readable" with a `true` qualifier, so
// column-level SELECT on this table is not "the owner can read it" -- it is
// "every signed-in user can read it, on every row". That is precisely why
// `phone` has never been SELECT-granted, and both new contact columns follow
// it. So there is no client-side query that returns your own email without
// also handing everyone else's to anyone who asks; a SECURITY DEFINER
// function pinned to auth.uid() is the only way to read them back.
export async function getOwnContactDetails(): Promise<{
  loaded: boolean;
  email: string | null;
  whatsapp: string | null;
  whatsappOptIn: boolean;
}> {
  const { data, error } = await supabase.rpc('get_own_contact_details');
  if (error) throw error;
  // `loaded` exists because the function returns SQL null for "no session"
  // and "no profiles row", which is NOT the same answer as a row whose three
  // columns happen to be empty -- and collapsing the two would show a user a
  // blank form claiming their account holds no contact details when in fact
  // we never managed to read it.
  if (data == null) return { loaded: false, email: null, whatsapp: null, whatsappOptIn: false };
  const row = data as Record<string, unknown>;
  return {
    loaded: true,
    email: (row.email as string) || null,
    whatsapp: (row.whatsapp as string) || null,
    whatsappOptIn: !!row.whatsapp_opt_in,
  };
}

// Saves those same three, and unlike upsertOwnProfile above this one CAN
// clear a field -- a plain UPDATE writes a real null where the RPC's
// coalesce-every-argument shape would read null as "leave it alone". That
// asymmetry is deliberate and is why editing goes through here while
// registration goes through the RPC: registration only ever adds, editing has
// to be able to remove.
//
// `.select('id')` and the row check are not decoration. An UPDATE that matches
// no row -- a signed-out session, a profiles row that was never created --
// returns success with an empty result set from PostgREST, which is one of the
// documented ways a write on this project reports success and changes nothing
// (see AGENTS.md). Without the check, "Saved" would appear over a database
// that never heard about it.
export async function saveOwnContactDetails(fields: {
  email: string | null;
  whatsapp: string | null;
  whatsappOptIn: boolean;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('profiles')
    .update({
      email: fields.email,
      whatsapp: fields.whatsapp,
      whatsapp_opt_in: fields.whatsappOptIn,
    })
    .eq('id', uid)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Contact details update matched no row');
}

// The seller's contact numbers for a listing, for the buyer-facing reveal.
//
// Deliberately a SECOND function rather than a widened get_seller_phone: that
// one returns a bare text and is called by every build already installed on
// somebody's phone. Changing its return type would break those the moment the
// migration landed -- hours or days before an OTA update reaches them -- so it
// stays exactly as it is and new builds call this instead.
//
// `whatsapp` is null for the many sellers who have not given one; the caller
// falls back to the phone number, which is what the app assumed for everybody
// before this field existed.
export async function getSellerContact(listingId: string): Promise<{
  phone: string | null;
  whatsapp: string | null;
}> {
  const { data, error } = await supabase.rpc('get_seller_contact', { p_listing_id: listingId });
  if (error) throw error;
  const row = (data || {}) as Record<string, unknown>;
  return {
    phone: (row.phone as string) || null,
    whatsapp: (row.whatsapp as string) || null,
  };
}
