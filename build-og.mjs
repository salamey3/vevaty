// Static per-collection OG-meta-tag snippets, generated at BUILD TIME.
//
// There's no server runtime behind vevaty.com (see DEPLOY.md /
// deploy-web.mjs -- it's a single self-contained index.html on plain
// cPanel/Apache static hosting), so there's nowhere to render real
// og:image/og:title per-collection on request the way a normal site would.
// Instead this script queries the live DB once, at build time, and writes
// one small static HTML file per collection to dist/share/collection/<slug>/
// index.html -- a real file on disk that Apache's existing SPA-fallback
// rule (.htaccess's `RewriteCond %{REQUEST_FILENAME} -f` -> [L]) already
// serves as-is instead of falling through to the app shell, exactly the
// mechanism the static legal/*.html pages already rely on.
//
// This lives at a SEPARATE path from the real in-app route
// (/collection/:slug, see CollectionScreen) on purpose: if the snippet
// lived exactly at the SPA's own route, that same "real file wins" rule
// would make the static snippet win for HUMAN visitors too, breaking
// in-app navigation into a dead page that never hydrates. Share buttons
// point at /share/collection/<slug>; the snippet's own meta-refresh sends
// a human straight on to the real /collection/<slug> app route, while a
// crawler (WhatsApp/Facebook/Twitter link preview bots) reads the meta
// tags without following the redirect.
//
// KNOWN LIMITATION: this only re-runs on `npm run ship`. Hot Deals and
// Just Listed can drift between ships (a listing's price moves, a new
// item posts) without the snippet catching up -- acceptable for v1 given
// the static-hosting constraint, but worth knowing rather than assuming
// these are always live.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Same public, RLS-protected constants src/lib/supabase.ts uses -- safe to
// embed, not secrets. Duplicated here (rather than imported) because this
// script runs under plain Node, outside Metro/Expo's bundler.
const SUPABASE_URL = 'https://ueqfkxvvfrhppdsnsfpx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_J3b1Uyp4ZvV5ItcAYBhPRg_EX3On8Ez';
const SITE_ORIGIN = 'https://vevaty.com';
const DIST = 'dist';

// Mirrors CollectionsStore.tsx's own constants -- kept in sync by hand,
// since that file is a React store (can't be imported from a plain Node
// build script) and this is the one other place "what counts as a hot
// deal" needs to be decided. If one changes, change the other.
const MIN_PRICE_DROP_PERCENT = 5;
const PRICE_DROP_LOOKBACK_DAYS = 14;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function snippetHtml({ title, description, imageUrl, shareUrl, targetUrl }) {
  const desc = description || 'Browse this collection on Vevaty.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(targetUrl)}">
${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">\n` : ''}<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
${imageUrl ? `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">\n` : ''}<link rel="canonical" href="${escapeHtml(targetUrl)}">
<meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}">
<script>location.replace(${JSON.stringify(targetUrl)});</script>
</head>
<body>
<p>Redirecting to <a href="${escapeHtml(targetUrl)}">${escapeHtml(title)}</a>…</p>
</body>
</html>
`;
}

// -- Per-kind "what's the lead item" resolution, matching CollectionsStore's
// resolveCollection ordering exactly (curated: position; recent: newest;
// price_drop: biggest qualifying drop) -- just narrowed to "give me the
// single top item's photo" rather than the full list, since the snippet
// only ever needs one og:image.

async function topPhotoForCurated(collectionId) {
  const { data: itemRows, error: itemErr } = await supabase
    .from('collection_items')
    .select('listing_id, position')
    .eq('collection_id', collectionId)
    .order('position', { ascending: true })
    .limit(1);
  if (itemErr || !itemRows?.length) return null;
  const { data: listing } = await supabase
    .from('listings')
    .select('photos')
    .eq('id', itemRows[0].listing_id)
    .eq('status', 'active')
    .maybeSingle();
  return listing?.photos?.[0] ?? null;
}

async function topPhotoForRecent() {
  const { data } = await supabase
    .from('listings')
    .select('photos')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.photos?.[0] ?? null;
}

async function topPhotoForPriceDrop() {
  const lookbackFrom = new Date(Date.now() - PRICE_DROP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: changes, error: changeErr } = await supabase
    .from('listing_price_changes')
    .select('listing_id, old_price, changed_at')
    .gte('changed_at', lookbackFrom)
    .order('changed_at', { ascending: true });
  if (changeErr || !changes?.length) return null;

  // Earliest old_price per listing within the window, same as
  // CollectionsStore's earliestPriceByListing.
  const earliestByListing = new Map();
  for (const row of changes) {
    if (!earliestByListing.has(row.listing_id)) earliestByListing.set(row.listing_id, row.old_price);
  }

  const listingIds = [...earliestByListing.keys()];
  const { data: listings, error: listingErr } = await supabase
    .from('listings')
    .select('id, price, photos')
    .in('id', listingIds)
    .eq('status', 'active');
  if (listingErr || !listings?.length) return null;

  let best = null;
  for (const l of listings) {
    const oldPrice = earliestByListing.get(l.id);
    if (!oldPrice || oldPrice <= 0) continue;
    const dropPercent = ((oldPrice - l.price) / oldPrice) * 100;
    if (dropPercent < MIN_PRICE_DROP_PERCENT) continue;
    if (!best || dropPercent > best.dropPercent) best = { dropPercent, photo: l.photos?.[0] ?? null };
  }
  return best?.photo ?? null;
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.log(`NOTE: ${DIST}/ not found -- run this after expo export, skipping OG snippets.`);
    return;
  }

  const { data: collections, error } = await supabase.from('collections').select('*').eq('active', true);
  if (error) {
    console.log(`WARNING: could not fetch collections for OG snippets (${error.message}) -- skipping.`);
    return;
  }

  let written = 0;
  for (const c of collections ?? []) {
    let photo = null;
    if (c.kind === 'curated') photo = await topPhotoForCurated(c.id);
    else if (c.kind === 'recent') photo = await topPhotoForRecent();
    else if (c.kind === 'price_drop') photo = await topPhotoForPriceDrop();

    if (!photo) {
      // Nothing currently qualifies (an unpopulated Editor's Picks, or a
      // moment with no active price drops) -- same "don't show an empty
      // thing" rule the app itself follows; no snippet, no dead share link
      // pointing at an empty page.
      console.log(`Skipped ${c.slug} -- no resolvable item right now.`);
      continue;
    }

    const targetUrl = `${SITE_ORIGIN}/collection/${c.slug}`;
    const html = snippetHtml({
      title: c.title_en,
      description: c.description_en,
      imageUrl: photo,
      shareUrl: `${SITE_ORIGIN}/share/collection/${c.slug}`,
      targetUrl,
    });
    const outDir = path.join(DIST, 'share', 'collection', c.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    written++;
    console.log(`Wrote ${outDir}/index.html`);
  }

  console.log(`OG snippets: ${written} written, ${(collections?.length ?? 0) - written} skipped.`);
}

main().catch((e) => {
  // Best-effort, same spirit as CollectionsStore's own refresh() catch --
  // a network blip generating OG snippets shouldn't fail the whole
  // deploy; the app itself works fine without them, link previews just
  // fall back to whatever generic default the platform shows.
  console.log(`WARNING: build-og.mjs failed (${e?.message || e}) -- continuing without OG snippets.`);
});
