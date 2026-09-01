// Email validation for the optional address registration collects alongside
// the phone number. The WhatsApp number beside it on the same form is
// validated by normalizePhone in lib/supabase.ts, which every phone field in
// the app already shares -- there is nothing WhatsApp-specific to add.
//
// The address is OPTIONAL by decision and never verified -- phone
// stays the sole account identity, nobody signs in with an email, and no
// account is blocked on one. That makes validation here a courtesy to the
// user (catching the typo while they can still see the field) rather than a
// gate, so every check below is deliberately permissive: it rejects only
// what cannot possibly be right, never what merely looks unusual.

// Deliberately loose. The full RFC 5322 grammar admits things no marketplace
// seller will ever type and rejects nothing a typo actually produces, so the
// only useful test is "one @, something either side, a dot in the domain".
// Anything stricter starts refusing real addresses -- plus-addressing, long
// new TLDs, non-ASCII local parts -- for a field that is unverified anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Stored lowercase and trimmed so the same address typed two different ways
// is one value. Note this does NOT make it unique -- the column has no unique
// constraint on purpose (see its comment in the migration): an unverified
// field can't be trusted to identify anybody, and enforcing uniqueness on one
// would only hand a stranger a way to lock a real address out of signup.
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

// Whether an email field is acceptable to submit: empty is fine (it's
// optional), anything present has to look like an address.
export function emailFieldOk(raw: string): boolean {
  return !raw.trim() || isValidEmail(raw);
}
