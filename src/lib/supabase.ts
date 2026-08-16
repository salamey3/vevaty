import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// This project's tables live in their own "myazar" schema inside a shared
// Supabase project (see project notes) — kept fully separate from that
// project's other data. The key below is the public "publishable" key,
// safe to ship inside the app; every table it can reach is protected by
// Row Level Security policies, not by keeping this key secret.
const SUPABASE_URL = 'https://ueqfkxvvfrhppdsnsfpx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J3b1Uyp4ZvV5ItcAYBhPRg_EX3On8Ez';

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
