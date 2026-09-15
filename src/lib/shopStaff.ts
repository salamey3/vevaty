import { supabase } from './supabase';

// Who else works here.
//
// A shop is not one person. Until stage 4 it was: every stock function
// asked whether the listing's seller was you, so the only pair of hands
// that could touch a count belonged to whoever signed up. The counter is
// exactly where stock moves, and the person at it is usually not the
// owner.
//
// The whole thing hangs off a PHONE NUMBER rather than an account. An
// owner can write an invite for somebody who has never opened Vevaty, and
// it is waiting for them the moment they sign up.
//
// What makes that safe is WHICH number the server compares it against:
// auth.users.phone with phone_confirmed_at set, the one Supabase itself
// confirmed by SMS and nothing in the client can write. The first cut
// compared against myazar.profiles.phone, which the owner of that row can
// simply write -- so anybody, including one of the anonymous sessions
// every visitor gets, could type an invited number onto their own profile
// and walk into the shop. Holding an invite's id has never been enough and
// still is not; holding the number is, and only the network can give you
// that.
//
// One shop per person, owner or staff. Every shop screen resolves "my
// shop" without being told which, so somebody working two would need a
// picker on all of them; a shop assistant works at one.

export const MAX_STAFF = 10;

// A row on the owner's list: an invite that is still waiting, or somebody
// who accepted. The same shape either way -- `name` and `acceptedAt` are
// what tell them apart, because until somebody accepts there is nobody to
// name, only a number that was written down.
export interface StaffMember {
  id: string;
  phone: string;
  name: string | null;
  acceptedAt: number | null;
  invitedAt: number;
}

// An invite as the person invited sees it: whose shop, and who asked.
export interface StaffInvite {
  id: string;
  shopId: string;
  // Named to match WorkShop, so shopName() reads either without the call
  // site unpacking it first.
  nameEn: string;
  nameAr: string | null;
  logoUrl: string | null;
  invitedBy: string | null;
  invitedAt: number;
}

// The shop whose counter this app is standing at, however it got there.
// `isOwner` is the difference between running the place and working in it,
// and it is what every screen gates the owner-only parts on.
export interface WorkShop {
  id: string;
  slug: string;
  nameEn: string;
  nameAr: string | null;
  logoUrl: string | null;
  verifiedAt: number | null;
  isOwner: boolean;
}

const at = (v: any): number => Date.parse(String(v ?? '')) || 0;
const str = (v: any): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
};

export function parseStaff(raw: any): StaffMember[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any): StaffMember => ({
      id: String(r?.id ?? ''),
      phone: String(r?.phone ?? ''),
      name: str(r?.name),
      // Parsed rather than coerced to 0: "has not accepted yet" is the
      // whole difference between the two kinds of row on this list, and a
      // 0 would read as accepted-at-the-epoch.
      acceptedAt: r?.accepted_at ? at(r.accepted_at) : null,
      invitedAt: at(r?.invited_at),
    }))
    .filter((m) => m.id);
}

export function parseInvites(raw: any): StaffInvite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any): StaffInvite => ({
      id: String(r?.id ?? ''),
      shopId: String(r?.shop_id ?? ''),
      nameEn: String(r?.shop_name_en ?? ''),
      nameAr: str(r?.shop_name_ar),
      logoUrl: str(r?.logo_url),
      invitedBy: str(r?.invited_by),
      invitedAt: at(r?.invited_at),
    }))
    .filter((i) => i.id && i.shopId);
}

export function parseWorkShop(raw: any): WorkShop | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  return {
    id: String(raw.id),
    slug: String(raw.slug ?? ''),
    nameEn: String(raw.name_en ?? ''),
    nameAr: str(raw.name_ar),
    logoUrl: str(raw.logo_url),
    verifiedAt: raw.verified_at ? at(raw.verified_at) : null,
    isOwner: raw.is_owner === true,
  };
}

// What to call a row on the owner's list. Before anybody accepts there is
// no name to show, so the number they wrote down IS the name -- showing a
// blank would make a waiting invite look like a broken one.
export const staffLabel = (m: StaffMember): string => m.name ?? m.phone;

export const shopName = (s: { nameEn: string; nameAr: string | null }, language: 'en' | 'ar'): string =>
  (language === 'ar' ? s.nameAr || s.nameEn : s.nameEn || s.nameAr) || '';

export const isWaiting = (m: StaffMember): boolean => m.acceptedAt == null;

export async function fetchStaff(): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc('shop_staff_list');
  if (error) throw error;
  return parseStaff(data);
}

export async function inviteStaff(phone: string): Promise<{ phone: string; hasAccount: boolean }> {
  const { data, error } = await supabase.rpc('shop_invite_staff', { p_phone: phone });
  if (error) throw error;
  return {
    phone: String((data as any)?.phone ?? phone),
    // Decides the whole sentence the owner reads next: "they will see it
    // when they open Vevaty", or "ask them to sign up with this number".
    hasAccount: (data as any)?.has_account === true,
  };
}

export async function removeStaff(id: string): Promise<void> {
  const { error } = await supabase.rpc('shop_remove_staff', { p_id: id });
  if (error) throw error;
}

export async function fetchMyInvites(): Promise<StaffInvite[]> {
  const { data, error } = await supabase.rpc('my_staff_invites');
  if (error) throw error;
  return parseInvites(data);
}

export async function acceptInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('accept_staff_invite', { p_id: id });
  if (error) throw error;
}

export async function declineInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('decline_staff_invite', { p_id: id });
  if (error) throw error;
}

export async function leaveShop(): Promise<void> {
  const { error } = await supabase.rpc('leave_shop');
  if (error) throw error;
}

export async function fetchWorkShop(): Promise<WorkShop | null> {
  const { data, error } = await supabase.rpc('my_shop');
  if (error) throw error;
  return parseWorkShop(data);
}

export function staffErrorKey(e: any): string {
  const code = String(e?.message ?? '').trim();
  switch (code) {
    case 'bad_phone': return 'staff.errBadPhone';
    case 'that_is_you': return 'staff.errThatIsYou';
    case 'already_invited': return 'staff.errAlreadyInvited';
    case 'too_many_people': return 'staff.errTooMany';
    case 'not_a_trading_shop': return 'staff.errNotTrading';
    case 'no_such_person': return 'staff.errGone';
    case 'no_such_invite': return 'staff.errInviteGone';
    case 'you_own_a_shop': return 'staff.errYouOwnAShop';
    case 'already_in_a_shop': return 'staff.errAlreadyInAShop';
    case 'no_number_on_your_account': return 'staff.errNoNumber';
    case 'not_in_a_shop': return 'staff.errNotInAShop';
    default:
      console.warn('[staff]', code || e);
      return 'staff.errFailed';
  }
}
