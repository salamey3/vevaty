import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// This project's tables live in their own "myazar" schema inside a shared
// Supabase project (see project notes) — kept fully separate from that
// project's other data. The key below is the public "publishable" key,
// safe to ship inside the app; every table it can reach is protected by
// Row Level Security policies, not by keeping this key secret.
// Exported because photoUpload.ts posts raw image bytes to an edge
// function by hand: on native the file is streamed from a file:// URI by
// expo-file-system's uploader, which supabase-js has no way to drive.
export const SUPABASE_URL = 'https://ueqfkxvvfrhppdsnsfpx.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J3b1Uyp4ZvV5ItcAYBhPRg_EX3On8Ez';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: 'myazar' },
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
