import { supabase } from './supabase';

// The conditions people agree to, and the record that they did.
//
// The TEXT lives in the database rather than in this bundle, and that is
// the point rather than an accident. Both documents end with a clause
// saying the version in force when you agreed is the one that binds you --
// and that sentence is only true if the exact text of that version can
// still be produced afterwards. Text shipped inside a release is gone the
// moment the next release overwrites it, which would make the clause
// unprovable at exactly the moment somebody needed it proved.
//
// It also means the placeholders still in these drafts can be filled in
// without a release, and filling one mints a NEW version rather than
// editing the one people have already agreed to.

export type LegalSlug = 'auction_consignment' | 'auction_bidding';

// A run of text with **bold** spans. The renderer splits on the marker; it
// is the only inline formatting the documents use, and a real markdown
// parser for one marker would be a dependency to avoid.
export type Inline = string;

export type LegalBlock =
  | { t: 'p'; text: Inline }
  | { t: 'ul'; items: Inline[] }
  // A clause the reader must not skim past -- the binding-bid warning, the
  // promise never to publish a reserve.
  | { t: 'note'; text: Inline }
  | { t: 'table'; caption?: string; cols: { label: string; align?: 'left' | 'right' }[]; rows: string[][] }
  // A worked example: label/amount rows with a total. Rendered as rows
  // rather than a table because a two-column table of money on a phone
  // wraps its own labels.
  | { t: 'figures'; title: string; note?: string; rows: { label: string; value: string; kind?: 'minus' | 'total' }[] };

export type LegalClause = { n: number; heading: string; blocks: LegalBlock[] };
export type LegalKeyTerm = { label: string; value: string; note?: string };
export type LegalBody = { keyTerms?: LegalKeyTerm[]; clauses: LegalClause[] };

export type LegalDocument = {
  id: string;
  slug: LegalSlug;
  version: number;
  titleEn: string;
  titleAr: string;
  bodyEn: LegalBody;
  // Null until translated. The reader falls back to English and says so --
  // a machine translation of an indemnity clause is worse than an honest
  // gap, so this stays null until a person writes it.
  bodyAr: LegalBody | null;
  accepted: boolean;
  acceptedAt: string | null;
};

export type LegalErrorCode =
  | 'document_not_found' | 'version_superseded' | 'not_signed_in' | 'unknown';

export class LegalError extends Error {
  code: LegalErrorCode;
  constructor(code: LegalErrorCode) {
    super(code);
    this.name = 'LegalError';
    this.code = code;
  }
}

const CODES = ['document_not_found', 'version_superseded', 'not_signed_in'];

function toError(error: { message?: string } | null): LegalError {
  const raw = String(error?.message || '').trim();
  const code = CODES.includes(raw) ? (raw as LegalErrorCode) : 'unknown';
  if (code === 'unknown') console.warn('[legal] unmapped error:', error?.message);
  return new LegalError(code);
}

// Null on failure rather than a throw, because every caller of this wants
// to degrade rather than crash: a form whose terms row cannot load should
// say so and refuse to submit, not blow up the screen.
export async function fetchLegalDocument(slug: LegalSlug): Promise<LegalDocument | null> {
  const { data, error } = await supabase.rpc('current_legal_document', { p_slug: slug });
  if (error) {
    console.warn('[legal] could not load', slug, error.message);
    return null;
  }
  const d = data as any;
  // `data || {}` used to stand here, which turned a null payload into a
  // document with version NaN and no body -- reported as SUCCESS, so the
  // reader rendered it and died on `body.keyTerms`, and the tick offered a
  // link with no text. A document we did not actually receive is a
  // failure, and this is the only place that can still say so.
  if (!d || !d.id || !d.body_en || !Array.isArray(d.body_en.clauses)) {
    console.warn('[legal] malformed document for', slug);
    return null;
  }
  return {
    id: d.id,
    slug: d.slug,
    version: Number(d.version),
    titleEn: d.title_en,
    titleAr: d.title_ar,
    bodyEn: d.body_en as LegalBody,
    bodyAr: (d.body_ar ?? null) as LegalBody | null,
    accepted: !!d.accepted,
    acceptedAt: d.accepted_at ?? null,
  };
}

// Agreeing. The VERSION goes up with it on purpose: it is the client
// asserting which text it actually put in front of the person. If that is
// no longer the live one -- the document was republished while the form sat
// open -- the server refuses with 'version_superseded' rather than
// recording an agreement to words nobody was shown.
export async function acceptLegalDocument(
  slug: LegalSlug,
  version: number,
  context: string
): Promise<{ acceptedAt: string | null }> {
  const { data, error } = await supabase.rpc('accept_legal_document', {
    p_slug: slug, p_version: version, p_context: context,
  });
  if (error) throw toError(error);
  // The SERVER's timestamp, not the device's. Both call sites used to
  // substitute Date.now(), so a phone with a wrong clock displayed a wrong
  // agreement date against a server record that said something else -- in
  // the one place in the app where the date is the legally interesting
  // part. Null rather than a guess when it is absent.
  return { acceptedAt: (data as any)?.accepted_at ?? null };
}

// Which body to render. Falls back to English when there is no translation
// yet, and the SCREEN says so -- silently showing English inside an
// otherwise Arabic app looks like a bug rather than a stated gap.
export function bodyFor(doc: LegalDocument, isArabic: boolean): {
  body: LegalBody; title: string; isFallback: boolean;
} {
  if (isArabic && doc.bodyAr && Array.isArray(doc.bodyAr.clauses)) {
    return { body: doc.bodyAr, title: doc.titleAr, isFallback: false };
  }
  return {
    body: doc.bodyEn,
    title: isArabic ? doc.titleAr : doc.titleEn,
    isFallback: isArabic,
  };
}
