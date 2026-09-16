// Exercises the two server-rendered pages against a stand-in that answers
// exactly like PostgREST, using a real row taken out of the live database.
//
//   node scripts/test/seo-pages.test.mjs
//
// Run directly, NOT via an npm script -- @expo/fingerprint hashes
// package.json's "scripts" block into the runtime version, and adding one
// silently orphans every over-the-air update. That has cost this project
// six ships once already.
//
// Needs `npm run build:web` to have produced dist/, and php on PATH.
// Without php it says so and exits 0 rather than failing a machine that
// simply cannot run the check.
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

try {
  execFileSync('php', ['--version'], { stdio: 'ignore' });
} catch {
  console.log('\n  php is not on PATH, so the server-rendered pages cannot be checked here.');
  console.log('  They are checked against the live host by deploy-web.mjs either way.\n');
  process.exit(0);
}
for (const f of ['index.html', 'listing.php', 'sitemap.php', '_vevaty.php']) {
  if (!fs.existsSync(path.join(DIST, f))) {
    console.error(`\n  ${DIST}/${f} is missing. Run \`npm run build:web\` first.\n`);
    process.exit(1);
  }
}

// A real listing, copied out of the live database, kept here so the test
// does not need a network or a key to run.
const ROW = {
  id: '292f0eb7-4a34-47ca-ac12-156e052ab391',
  title_en: 'Black Ring Flower/Butterfly LED Pendant Ceiling Light',
  title_ar: 'مصباح سقف معلق LED بتصميم زهرة/فراشة بحلقات سوداء',
  description_en:
    'Modern decorative ceiling pendant light with a sculptural design of overlapping black rings forming a flower or butterfly shape, suspended from a round black ceiling canopy by thin cables.',
  price: 25,
  currency: 'USD',
  condition: 'new',
  district: 'Beit ech Chaar',
  governorate: 'Mount Lebanon',
  caza: 'Matn',
  created_at: '2026-09-15T13:37:03.833224+00:00',
  updated_at: '2026-09-15T13:37:03.833224+00:00',
  status: 'active',
  photos: [
    { url: 'https://vevaty-media.b-cdn.net/listings/6b9e2c3d.jpg', kind: 'gallery', sort_order: 2 },
    { url: 'https://vevaty-media.b-cdn.net/listings/eae0f9db.jpg', kind: 'gallery', sort_order: 0 },
    { url: 'https://vevaty-media.b-cdn.net/listings/569819a5.jpg', kind: 'gallery', sort_order: 1 },
  ],
};

// --- the stand-in -------------------------------------------------------
let dbUp = true;
const fake = http.createServer((req, res) => {
  if (!dbUp) { res.destroy(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url.includes('/rest/v1/categories')) {
    res.end(JSON.stringify([
      { id: 'vehicles', parent_id: null, active: true },
      { id: 'cars', parent_id: 'vehicles', active: true },
      { id: 'orphan', parent_id: 'switched-off', active: true },
    ]));
    return;
  }
  if (req.url.includes('id=eq.')) {
    const want = decodeURIComponent(req.url.split('id=eq.')[1].split('&')[0]);
    res.end(JSON.stringify(want === ROW.id ? [ROW] : []));
    return;
  }
  res.end(JSON.stringify([{ id: ROW.id, updated_at: ROW.updated_at, created_at: ROW.created_at }]));
});
await new Promise((r) => fake.listen(0, r));
const fakeUrl = `http://127.0.0.1:${fake.address().port}`;

// --- the site, served the way .htaccess serves it ------------------------
fs.writeFileSync(path.join(DIST, '_router.test.php'), `<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $uri;
if ($uri !== '/' && file_exists($file) && !is_dir($file)) return false;
if (preg_match('#^/sitemap\\\\.xml$#', $uri)) { require __DIR__ . '/sitemap.php'; return true; }
if (preg_match('#^/listing/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?$#', $uri, $m)) {
  $_GET['id'] = $m[1]; require __DIR__ . '/listing.php'; return true;
}
require __DIR__ . '/index.html';
return true;
`);
const php = spawn('php', ['-S', '127.0.0.1:8791', '_router.test.php'], {
  cwd: DIST,
  env: { ...process.env, VEVATY_SUPABASE_URL: fakeUrl },
  stdio: 'ignore',
});
const site = 'http://127.0.0.1:8791';
await new Promise((r) => setTimeout(r, 900));
const get = async (p) => {
  const res = await fetch(site + p, { redirect: 'manual' });
  return { status: res.status, body: await res.text(), type: res.headers.get('content-type') || '' };
};

try {
  console.log('\nThe listing page\n');
  const page = await get(`/listing/${ROW.id}`);
  const shell = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

  check('answers 200', page.status === 200, `HTTP ${page.status}`);
  check('the <title> names the item and the place',
    /<title>Black Ring Flower\/Butterfly LED Pendant Ceiling Light — Beit ech Chaar, Mount Lebanon \| Vevaty<\/title>/.test(page.body),
    (page.body.match(/<title>(.*?)<\/title>/) || [])[1]);
  check('carries a meta description', /<meta name="description" content="Modern decorative ceiling/.test(page.body));
  check('carries a canonical URL',
    page.body.includes(`<link rel="canonical" href="https://vevaty.com/listing/${ROW.id}"/>`));
  check('og:title is the item, not the site default',
    /og:title" content="Black Ring Flower\/Butterfly/.test(page.body));
  check('og:type became product', /og:type" content="product"/.test(page.body));
  check('og:image is the listing photo, lowest sort_order first',
    /og:image" content="https:\/\/vevaty-media\.b-cdn\.net\/listings\/eae0f9db\.jpg"/.test(page.body));

  const ld = (page.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s) || [])[1];
  let parsed = null;
  try { parsed = JSON.parse(ld); } catch {}
  check('emits valid Product JSON-LD', !!parsed && parsed['@type'] === 'Product');
  check('with the price and currency', parsed?.offers?.price === '25' && parsed?.offers?.priceCurrency === 'USD',
    parsed?.offers ? `${parsed.offers.priceCurrency} ${parsed.offers.price}` : 'no offers');
  check('with the condition mapped to a schema.org value',
    parsed?.itemCondition === 'https://schema.org/NewCondition', parsed?.itemCondition);
  check('and a canonical url inside it', parsed?.url === `https://vevaty.com/listing/${ROW.id}`);

  check('the title is readable in the body, not only in the head',
    /<h1>Black Ring Flower\/Butterfly LED Pendant Ceiling Light<\/h1>/.test(page.body));
  check('the app still boots from the same document',
    /<script src="\/app\.[0-9a-f]+\.js" defer><\/script>/.test(page.body));
  check('the boot screen is still there to cover the readable copy',
    page.body.includes('id="vevaty-boot"'));
  // Present is not the same as staying up. The loader's own script decides
  // when to dismiss itself, and its first version read "#root has a child"
  // as "React has mounted" -- which the copy injected above satisfies at
  // parse time, so the loader vanished a third of a second into a twenty
  // second download and left the visitor looking at unstyled clipped
  // markup. The seed comparison is what stops that, so it is asserted here
  // rather than trusted.
  check('...and will not mistake the injected copy for React having mounted',
    /var seed=r\.firstElementChild/.test(shell) && !/if\(r\.firstElementChild\)clear\(\)/.test(shell));
  check('nothing was lost from the shell',
    page.body.length > shell.length, `${page.body.length} vs shell ${shell.length}`);

  console.log('\nWhen it should NOT render a listing\n');
  const missing = await get('/listing/00000000-0000-4000-8000-000000000000');
  check('a listing that is not active answers 404', missing.status === 404, `HTTP ${missing.status}`);
  check('...and still serves the app so a person sees Vevaty',
    /<script src="\/app\.[0-9a-f]+\.js"/.test(missing.body));
  check('...and does not invent a title for it', !/<h1>/.test(missing.body));

  const junk = await get('/listing/not-a-uuid-at-all-really-nope-000000');
  check('a non-UUID id is never sent to the database',
    junk.status === 200 && !/<h1>/.test(junk.body), `HTTP ${junk.status}`);

  dbUp = false;
  const offline = await get(`/listing/${ROW.id}`);
  dbUp = true;
  check('an unreachable database falls through to the app, not an error page',
    offline.status === 200 && /<script src="\/app\.[0-9a-f]+\.js"/.test(offline.body) && !/<h1>/.test(offline.body),
    `HTTP ${offline.status}`);

  console.log('\nWhat a seller can type into it\n');

  // Sellers control the title and the description, and these three were
  // all real corruption before preg_replace_callback replaced
  // preg_replace: a backslash-digit spliced raw shell markup into an
  // attribute, a trailing backslash ate the closing quote and the tag
  // after it, and "$0" spliced a whole <title> element into the head. The
  // backslash one is the worst, because it produced invalid JSON-LD --
  // which Google discards silently, taking the price and condition with
  // it.
  const nasty = [
    ['a backslash before a digit', 'Cable 1\\2 inch drive'],
    ['a trailing backslash', 'Ends with a backslash \\'],
    ['a dollar-zero', 'Gold $0 ring'],
    ['a dollar-one', 'Lot $1 of 3'],
    ['a quote and an angle bracket', 'Rim 17" <b>alloy</b>'],
    ['a script tag', '</script><script>alert(1)</script>'],
  ];
  for (const [label, evil] of nasty) {
    ROW.title_en = evil;
    const p2 = await get(`/listing/${ROW.id}`);
    const block = (p2.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s) || [])[1];
    let ok = false;
    let why = '';
    try {
      const j = JSON.parse(block);
      ok = j.name === evil;
      why = ok ? '' : `name came back as ${JSON.stringify(j.name)}`;
    } catch (e) {
      why = 'JSON-LD did not parse';
    }
    const titleTags = (p2.body.match(/<title>/g) || []).length;
    const headClosed = p2.body.indexOf('</head>') > p2.body.indexOf('<title>');
    const passed = ok && titleTags === 1 && headClosed;
    check(`survives ${label}`, passed,
      passed ? '' : (why || (titleTags !== 1 ? `${titleTags} <title> tags` : 'head structure broken')));
    check(`...without letting ${label} open a tag`,
      !/<script>alert\(1\)<\/script>/.test(p2.body) && !/<b>alloy<\/b>/.test(p2.body));
  }
  ROW.title_en = 'Black Ring Flower/Butterfly LED Pendant Ceiling Light';

  console.log('\nThe sitemap\n');
  const sm = await get('/sitemap.xml');
  check('is served as XML', sm.status === 200 && sm.type.includes('xml'), sm.type);
  check('declares the sitemap namespace', sm.body.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
  check('includes the home page', sm.body.includes('<loc>https://vevaty.com/</loc>'));
  check('includes the listing', sm.body.includes(`<loc>https://vevaty.com/listing/${ROW.id}</loc>`));
  check('includes an active category', sm.body.includes('<loc>https://vevaty.com/category/cars</loc>'));
  check('EXCLUDES a leaf whose branch is switched off', !sm.body.includes('/category/orphan'));

  console.log('\nThe door\n');
  const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  check('robots.txt blocks everything for now', /^Disallow: \/$/m.test(robots));
  check('and points at the sitemap for when it opens', /^Sitemap: https:\/\/vevaty\.com\/sitemap\.xml$/m.test(robots));
  check('the no-PHP .htaccess really has the rules stripped', (() => {
    const full = fs.readFileSync(path.join(DIST, '.htaccess'), 'utf8');
    const nophp = fs.readFileSync(path.join(DIST, '.htaccess-nophp'), 'utf8');
    return /RewriteRule \^listing\//.test(full) && !/RewriteRule \^listing\//.test(nophp) && !/RewriteRule \^sitemap/.test(nophp);
  })());
} finally {
  php.kill();
  fake.close();
  fs.rmSync(path.join(DIST, '_router.test.php'), { force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} check(s) FAILED.\n` : '\nAll checks passed.\n');
process.exit(failed.length ? 1 : 0);
