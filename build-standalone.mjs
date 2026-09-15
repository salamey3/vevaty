// Turns Expo's `dist/` export into a website that can actually be cached:
// a small dist/index.html shell plus dist/app.<hash>.js holding the whole
// bundle, with every asset the bundle references and the favicon inlined
// as data: URIs. Also writes dist/vevaty-standalone.html, the older
// everything-in-one-file form, which is still the rollback.
//
// Ported from the original build_standalone.py. Node instead of Python
// purely so the project needs one runtime rather than two: Node is already
// required for Expo, whereas Python had to be installed separately on every
// machine, is absent by default on Termux, and is invoked as `python3` on
// macOS/Linux but `python` on Windows -- a per-OS difference in the build
// command that this removes entirely. Output is byte-for-byte identical to
// what the Python version produced; that was verified by diffing both
// against the same dist/ before the .py was deleted.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';

// Minimal extension -> MIME map, matching what Python's mimetypes.guess_type
// returned for the asset types this app actually ships (png/jpg/gif/svg/
// ttf/otf/woff). Anything unrecognised falls back the same way it did.
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/vnd.microsoft.icon', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const htmlPath = path.join(DIST, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// --- Bottom system bar (Android nav bar / iOS home indicator) on the web ---
//
// The app reserves space for the phone's bottom system bar everywhere (see
// Screen.tsx and SystemBottomStrip.tsx), and on native that works because
// react-native-safe-area-context reads the real insets from the OS. On the
// web it reads env(safe-area-inset-*) instead -- and a browser only reports
// a non-zero value for those when the page has opted into drawing edge to
// edge with viewport-fit=cover. Expo's generated index.html doesn't set it,
// so every inset was 0 and the mobile site had nothing reserved at all:
// content ran under Android's navigation bar exactly as it did in the app.
//
// Patching it here rather than shipping a custom HTML template keeps this
// next to the other index.html surgery, and means it can't be lost the next
// time Expo regenerates the file.
const VIEWPORT_RE = /(<meta name="viewport" content=")([^"]*)(")/;
const viewportMatch = html.match(VIEWPORT_RE);
if (!viewportMatch) {
  // Loud, not silent: without this the mobile site quietly regresses to
  // content sitting under the navigation bar, which looks like a CSS bug
  // rather than a missing meta tag.
  throw new Error('could not find the <meta name="viewport"> tag in dist/index.html');
}
if (!viewportMatch[2].includes('viewport-fit')) {
  html = html.replace(VIEWPORT_RE, `$1$2, viewport-fit=cover$3`);
  console.log('Added viewport-fit=cover to the viewport meta tag');
}

// Black behind everything, so the strip the app reserves at the bottom is
// black from the very first paint -- before the JS bundle has booted and
// measured the insets -- rather than flashing white and then filling in.
// Appended to the end of Expo's own reset block so its rules win on order
// without having to out-specify them.
// --- brand: theme colour + share card ---------------------------------
//
// The share card is the most-seen brand surface this app has
// (BRANDING.md part 7), so where it lives is decided below rather than
// assumed.
const BRAND_PRIMARY = '#0F3D2E';
// Same value as build-og.mjs's SITE_ORIGIN. Crawlers need an ABSOLUTE
// og:image URL -- a relative one is ignored by most of them.
const SITE_ORIGIN = 'https://vevaty.com';
const SHARE_IMAGE_NAME = 'share-image.png';

// Resolved differently by each of the two outputs this script writes, so
// the tag is built once with a placeholder rather than twice by hand.
//
// dist/index.html now points at a real uploaded file. That is 67 KB --
// two thirds of the shell -- that no longer has to arrive before the page
// can paint, on a connection where 67 KB is a second and a half. It was
// inlined because the site used to deploy as ONE file and an og:image
// pointing at something never uploaded leaves every WhatsApp and Facebook
// preview blank (BRANDING.md part 7); now that the bundle is uploaded
// alongside it, one more file costs nothing. It is also how link previews
// are supposed to work -- several crawlers ignore a data: URI outright,
// so this should make previews more reliable, not less.
//
// dist/vevaty-standalone.html keeps the data: URI, because that file's
// entire purpose is to work with nothing next to it.
const OG_IMAGE_TOKEN = '__VEVATY_OG_IMAGE__';
const shareImagePath = path.join('assets', 'brand', SHARE_IMAGE_NAME);
let shareMeta = '';
let shareDataUri = null;
if (fs.existsSync(shareImagePath)) {
  shareDataUri = `data:image/png;base64,${fs.readFileSync(shareImagePath).toString('base64')}`;
  shareMeta =
    `\n    <meta property="og:image" content="${OG_IMAGE_TOKEN}"/>` +
    `\n    <meta property="og:image:width" content="1200"/>` +
    `\n    <meta property="og:image:height" content="630"/>` +
    `\n    <meta name="twitter:card" content="summary_large_image"/>`;
  console.log(`Inlined the share image (${(fs.statSync(shareImagePath).size / 1024).toFixed(0)} KB)`);
} else {
  console.log('NOTE: assets/brand/share-image.png is missing -- link previews will have no image.');
  console.log('      Regenerate it with: node scripts/brand/render-wordmark.mjs');
}

html = html.replace(
  '<title>',
  `<meta name="theme-color" content="${BRAND_PRIMARY}"/>` +
  `\n    <meta property="og:title" content="vevaty — buy &amp; sell, verified"/>` +
  `\n    <meta property="og:description" content="The marketplace built on verification, not volume. Find what you need near you."/>` +
  `\n    <meta property="og:type" content="website"/>` +
  shareMeta +
  `\n    <title>`
);

// --- fonts -------------------------------------------------------------
//
// public/fonts/*.woff2, which Expo copies into dist/ verbatim. They used to
// be base64 strings inside src/theme/fonts.ts and therefore inside the JS
// bundle -- 162 KB COMPRESSED on every single first visit, 15% of the whole
// download, uncacheable because the bundle it lived in changes every
// release. As real files a browser fetches each weight only if the page
// uses it and keeps it for a month.
//
// The <link rel="preload"> is the part that matters for how this LOOKS.
// src/theme/fonts.ts only injects its @font-face rules once the bundle has
// run, so without a preload the font request would not even start until
// several megabytes of JavaScript had arrived, and the first text painted
// would be system-ui swapping to Inter a beat later. Preloaded from the
// shell, the fonts are fetched in parallel with the bundle and have landed
// long before React can paint.
//
// WHICH weights are preloaded is measured, not assumed. A preload forces
// the fetch whether or not the page uses that weight, so preloading all
// four Latin weights hands every visitor 97 KB when the first screen
// renders in two of them. Driving a real browser at the built site and
// reading document.fonts back says the landing screen loads 400 and 600
// and leaves 500 and 700 untouched -- so those two are preloaded and the
// other two arrive normally, on demand, while someone is already reading.
// 48 KB before anything can paint rather than 97 KB.
//
// The Arabic font is never preloaded: it carries a unicode-range, so a
// browser fetches it only when Arabic is actually on the page, and
// preloading it would hand every English visitor 65 KB they will never
// use. An Arabic visitor pays for it once and keeps it for a month.
//
// `crossorigin` is required on a font preload even same-origin -- without
// it the browser fetches the file a second time and the preload is worse
// than useless.
const PRELOAD_WEIGHTS = [400, 600];
const fontDir = path.join(DIST, 'fonts');
const fontFiles = fs.existsSync(fontDir)
  ? fs.readdirSync(fontDir).filter((f) => f.endsWith('.woff2')).sort()
  : [];
if (!fontFiles.length) {
  // Loud, not silent: the app would still work, in system-ui, and nobody
  // would notice until someone looked at the site on a phone.
  throw new Error(
    'dist/fonts/ has no .woff2 files. public/fonts/ should hold them and Expo copies public/ into dist/.\n' +
      'Without them every page renders in the system font.'
  );
}
const preloadLinks = fontFiles
  .filter((f) => PRELOAD_WEIGHTS.some((w) => f === `inter-${w}.woff2`))
  .map((f) => `\n    <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/${f}"/>`)
  .join('');
html = html.replace('<title>', `${preloadLinks}\n    <title>`);
console.log(`Found ${fontFiles.length} font file(s); preloaded ${preloadLinks ? preloadLinks.split('<link').length - 1 : 0} Latin weight(s)`);

const RESET_STYLE_END = '\n    </style>';
if (!html.includes(RESET_STYLE_END)) {
  throw new Error('could not find the end of the #expo-reset <style> block in dist/index.html');
}
html = html.replace(
  RESET_STYLE_END,
  '\n      /* The bottom system-bar strip is painted over this -- see' +
    '\n         SystemBottomStrip.tsx. Black here means the strip is already' +
    '\n         the right colour on first paint, before the bundle has booted' +
    '\n         and measured the insets. */' +
    '\n      html,\n      body {\n        background-color: #000;\n      }' +
    RESET_STYLE_END
);

// --- Boot screen -------------------------------------------------------
//
// The bundle is still ~4 MB, and on a first visit (or any visit whose
// cache has been cleared) it all has to arrive before a single pixel of
// the app can appear. The shell paints immediately now, so this fills
// that gap rather than an empty page. Previously the whole document was
// response is sent `no-store`, so every visit downloads all of it before a
// single pixel can be painted. Measured from Beirut on 15 Sep 2026: time to
// first byte 85ms (the server is fine), document download 24.7 SECONDS,
// first contentful paint 25.0 seconds. A second, cache-busting fetch took
// 19.2s -- this is not a first-visit cost, it is every visit.
//
// For all of that time the viewport was BLACK, because of the html/body
// rule added above: it exists so the bottom system strip is the right
// colour on first paint, and the side effect nobody had measured was that
// it makes the entire loading period look like a crash rather than a wait.
//
// This does not make the site faster. It makes the wait legible, which is
// the difference between a tester thinking "slow" and thinking "broken" --
// and it costs about 1.5 KB placed ahead of the bundle. It goes BEFORE
// <div id="root"> because the browser paints what it has parsed so far:
// these bytes arrive in the first few hundred milliseconds while the
// remaining megabytes are still in flight.
//
// It removes itself when React puts its first child into #root -- an
// actual signal that the app is up, not a timer guessing at one. The
// 40-second fallback exists only so a boot that never completes does not
// leave the screen covered forever.
//
// The "still loading" line appears at 6 seconds and only then: on a fast
// connection nobody ever sees it, and on a slow one it answers the
// question the person is already asking.
// The markup goes BEFORE #root and the script goes AFTER it, and that
// split is load-bearing rather than tidy: the script looks #root up by id
// at parse time, so placing it ahead of #root -- as the first version of
// this did -- found null, returned early, and left the boot screen
// covering the app forever. Anchored on the whole empty element so both
// halves land on either side of it.
const BOOT_ROOT_RE = /<div id="root">\s*<\/div>/;
const bootRootMatch = html.match(BOOT_ROOT_RE);
if (!bootRootMatch) {
  throw new Error('could not find an empty <div id="root"></div> in dist/index.html to place the boot screen around');
}
const BOOT_ROOT = bootRootMatch[0];
const bootMarkup =
  '<div id="vevaty-boot" role="status" aria-live="polite">' +
    '<div id="vevaty-boot-mark">vevaty</div>' +
    '<div id="vevaty-boot-bar"><i></i></div>' +
    '<p id="vevaty-boot-slow">Still loading — the first visit takes a moment on a slow connection.</p>' +
  '</div>' +
  '<style>' +
    '#vevaty-boot{position:fixed;inset:0;z-index:2147483000;background:#F4F3EE;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px;text-align:center}' +
    '#vevaty-boot-mark{font-size:30px;font-weight:600;letter-spacing:-.02em;color:' + BRAND_PRIMARY + '}' +
    '#vevaty-boot-bar{width:168px;max-width:60vw;height:3px;border-radius:2px;background:#E4E2DA;overflow:hidden}' +
    '#vevaty-boot-bar i{display:block;width:40%;height:100%;border-radius:2px;background:#D9A441;' +
      'animation:vevaty-boot-sweep 1.15s ease-in-out infinite}' +
    '@keyframes vevaty-boot-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}' +
    '#vevaty-boot-slow{margin:0;max-width:32ch;font-size:13px;line-height:1.5;color:#626A67;' +
      'opacity:0;transition:opacity .4s ease}' +
    '#vevaty-boot.is-slow #vevaty-boot-slow{opacity:1}' +
    '@media (prefers-reduced-motion:reduce){#vevaty-boot-bar i{animation:none;width:100%;opacity:.55}' +
      '#vevaty-boot-slow{transition:none}}' +
  '</style>';

const bootScript =
  '<script>(function(){' +
    'var b=document.getElementById("vevaty-boot"),r=document.getElementById("root");' +
    'if(!b||!r)return;' +
    'var slow=setTimeout(function(){b.classList.add("is-slow");},6000);' +
    'var done=false;' +
    'function clear(){if(done)return;done=true;clearTimeout(slow);' +
      'if(ob)ob.disconnect();' +
      'b.style.transition="opacity .25s ease";b.style.opacity="0";' +
      'setTimeout(function(){if(b.parentNode)b.parentNode.removeChild(b);},260);}' +
    'var ob=new MutationObserver(function(){if(r.firstElementChild)clear();});' +
    'ob.observe(r,{childList:true});' +
    'if(r.firstElementChild)clear();' +
    'setTimeout(clear,40000);' +
  '})();<\/script>';

html = html.split(BOOT_ROOT).join(bootMarkup + BOOT_ROOT + bootScript);
console.log(
  `Added the boot screen (${bootMarkup.length} bytes ahead of #root, ` +
  `${bootScript.length} bytes of wiring after it)`
);

// Expo emits SEVERAL files now, and the difference between them matters.
//
// EAGER: the <script src> tags in index.html -- since code splitting was
// turned on for the control room that is three of them (Metro's runtime, a
// shared common chunk, and the entry), where it used to be one. They are
// read in document order and concatenated into the single app.<hash>.js
// this build has always produced, because that is exactly what the browser
// would do with them anyway and it keeps the deploy's one-file gate intact.
// Joined with a `;` between them: a file whose last statement has no
// semicolon followed by one that opens with `(` would otherwise be parsed
// as a call.
//
// LAZY: everything else in that directory -- one chunk per admin screen,
// fetched only when someone actually opens it. These are NOT concatenated;
// the whole point is that they do not arrive up front. They are listed in
// the manifest so deploy-web.mjs uploads them, and they are referenced by
// ABSOLUTE paths baked into the entry ("/_expo/static/js/web/X.js",
// verified by reading them out of the built bundle), not derived from the
// script tag's own src -- which is the property that makes concatenating
// the eager files safe.
const eagerTags = [...html.matchAll(/<script src="(\/_expo\/static\/js\/web\/[^"]+)"[^>]*><\/script>/g)];
if (!eagerTags.length) throw new Error('could not find any entry <script src> in dist/index.html');

const jsDir = path.join(DIST, '_expo', 'static', 'js', 'web');
const eagerNames = new Set(eagerTags.map((m) => path.basename(m[1])));
const lazyChunks = fs.existsSync(jsDir)
  ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && !eagerNames.has(f)).sort()
  : [];

console.log(`Eager scripts (concatenated into one bundle): ${[...eagerNames].join(', ')}`);
if (lazyChunks.length) {
  const bytes = lazyChunks.reduce((n, f) => n + fs.statSync(path.join(jsDir, f)).size, 0);
  console.log(`Lazily-loaded chunks kept separate: ${lazyChunks.length} (${(bytes / 1024).toFixed(0)} KB total)`);
} else {
  console.log('No lazily-loaded chunks in this build.');
}

let js = eagerTags.map((m) => fs.readFileSync(path.join(DIST, m[1].replace(/^\//, '')), 'utf8')).join('\n;\n');

// A lazily-loaded chunk must not reference /assets/... .
//
// The inlining below only runs over the EAGER bundle, and nothing uploads
// dist/assets/, so such a reference would survive as a plain URL inside a
// chunk, 404 against the asset rule in .htaccess, and show up as a broken
// image on one admin screen -- the kind of thing found months later. No
// chunk does this today; this is here so the first one that tries says so
// at build time rather than in production.
for (const chunk of lazyChunks) {
  const body = fs.readFileSync(path.join(jsDir, chunk), 'utf8');
  const refs = [...new Set(body.match(/\/assets\/[^"'\\]+/g) || [])];
  if (refs.length) {
    throw new Error(
      `${chunk} references ${refs.length} asset(s) that would never be uploaded:\n` +
        refs.slice(0, 5).map((r) => `  ${r}`).join('\n') +
        '\nEither import it from an eagerly-loaded module, or teach this script and\n' +
        'deploy-web.mjs to carry dist/assets/ as well.'
    );
  }
}

// Inline every /assets/... reference found in the JS bundle as a data: URI.
const assetRefs = [...new Set(js.match(/\/assets\/[^"'\\]+/g) || [])].sort();
console.log(`Found ${assetRefs.length} unique asset refs`);
for (const ref of assetRefs) {
  const localPath = path.join(DIST, ref.replace(/^\//, ''));
  if (!fs.existsSync(localPath)) {
    console.log(`  MISSING: ${localPath}`);
    continue;
  }
  const dataUri = `data:${mimeFor(localPath)};base64,${fs.readFileSync(localPath).toString('base64')}`;
  // split/join rather than replace() so the replacement text is inserted
  // literally -- a data: URI can contain $ sequences that would otherwise be
  // interpreted as regex substitution patterns and silently corrupt it.
  js = js.split(ref).join(dataUri);
}

// Inline the favicon too.
const faviconPath = path.join(DIST, 'favicon.ico');
if (fs.existsSync(faviconPath)) {
  const faviconUri = `data:image/x-icon;base64,${fs.readFileSync(faviconPath).toString('base64')}`;
  html = html.split('href="/favicon.ico"').join(`href="${faviconUri}"`);
}

// Replace the external <script src="..."> with an inline <script> holding the bundle.
//
// split/join, NOT html.replace(). String.replace() interprets $$, $&, $` and
// $' inside the REPLACEMENT text as substitution patterns, and a 2.6MB JS
// bundle contains those sequences for real: the Expo runtime defines
// `$$require_external`, which replace() silently rewrites to
// `$require_external` (breaking the bundle), while any `$'` expands to "the
// entire remainder of the string" and bloated the output by ~41KB. Caught by
// diffing this against the Python implementation it replaced -- both outputs
// must be byte-identical.
// The first eager tag becomes the one bundle; the rest are removed, since
// their contents are now inside it.
const scriptTag = [eagerTags[0][0]];
const extraEagerTags = eagerTags.slice(1).map((m) => m[0]);

// --- Two outputs from here, and they are deliberately different --------
//
// dist/index.html used to BE the bundle: one 4.2 MB document, sent
// `no-store, no-cache, must-revalidate` with no etag, so every visit and
// every refresh downloaded all of it again. Measured on a real Lebanese
// mobile connection: 24.7 s to download, 25.0 s to first paint, and 19.2 s
// AGAIN on the very next fetch. Nothing was cached because nothing could
// be -- the only file was the one that has to stay fresh.
//
// Splitting them lets each have the cache policy it actually wants. The
// shell stays uncached and is now a few tens of KB, so every visitor still
// gets the newest HTML on every visit, in well under a second. The bundle
// is named by a hash of its own contents and cached for a year as
// immutable -- fetched once, then never again, and a release that changes
// one byte changes the name, so nobody is ever served a stale one. That
// keeps the "everyone gets the new build immediately" property the
// no-store was there to protect, which is why .htaccess can now cache
// aggressively without reopening the blank-page bug its comment describes.
//
// Honest about what this does NOT fix: a FIRST visit still has to fetch
// the whole bundle, so it is as slow as it was. What changes is every
// visit after it. Shrinking the bundle itself is a separate job -- and it
// is almost entirely CODE, not the assets inlined a few lines above, which
// come to 3 KB. An earlier version of this comment said the opposite; it
// was measured afterwards and was wrong. See NEXT.md for the breakdown.
//
// dist/vevaty-standalone.html is unchanged: still everything inline,
// still one file that works with nothing beside it. It is also the
// rollback. If a shell deploy ever goes wrong, uploading that file as
// index.html restores exactly the behaviour this replaced.
const bundleHash = createHash('sha256').update(js).digest('hex').slice(0, 16);
const bundleName = `app.${bundleHash}.js`;

// Previous builds' bundles are cleared out of dist/ so the folder holds
// exactly one, and deploy-web.mjs can never pick up an older neighbour.
// (On the SERVER the opposite is true -- old bundles are left in place, so
// a browser mid-navigation on the previous shell still finds what it
// asked for. See deploy-web.mjs.)
for (const f of fs.readdirSync(DIST)) {
  if (/^app\.[0-9a-f]+\.js$/.test(f) && f !== bundleName) {
    fs.unlinkSync(path.join(DIST, f));
    console.log(`Removed a previous build's ${f}`);
  }
}
fs.writeFileSync(path.join(DIST, bundleName), js, 'utf8');
console.log(`Wrote ${DIST}/${bundleName} (${fs.statSync(path.join(DIST, bundleName)).size} bytes)`);

// split/join, NOT html.replace(), for both of these. String.replace()
// interprets $$, $&, $` and $' inside the REPLACEMENT text as substitution
// patterns, and a 4 MB JS bundle contains those sequences for real: the
// Expo runtime defines `$$require_external`, which replace() silently
// rewrites to `$require_external` (breaking the bundle), while any $'
// expands to "the entire remainder of the string" and bloated the output
// by ~41 KB. Caught by diffing this against the Python implementation it
// replaced -- both outputs had to be byte-identical.
const stripExtraEager = (h) => extraEagerTags.reduce((acc, tag) => acc.split(tag).join(''), h);

const standaloneHtml = stripExtraEager(html)
  .split(scriptTag[0]).join(`<script>${js}</script>`)
  .split(OG_IMAGE_TOKEN).join(shareDataUri ?? '');
const outPath = process.env.STANDALONE_OUT || path.join(DIST, 'vevaty-standalone.html');
fs.writeFileSync(outPath, standaloneHtml, 'utf8');
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes) -- the single-file copy, and the rollback`);

const shellHtml = stripExtraEager(html)
  .split(scriptTag[0]).join(`<script src="/${bundleName}" defer></script>`)
  .split(OG_IMAGE_TOKEN).join(`${SITE_ORIGIN}/${SHARE_IMAGE_NAME}`);
fs.writeFileSync(htmlPath, shellHtml, 'utf8');
console.log(`Wrote ${htmlPath} (${fs.statSync(htmlPath).size} bytes) -- the shell that loads ${bundleName}`);

if (shareDataUri) {
  fs.copyFileSync(shareImagePath, path.join(DIST, SHARE_IMAGE_NAME));
  console.log(`Copied ${shareImagePath} -> ${DIST}/${SHARE_IMAGE_NAME} (og:image now points at the file)`);
}

// What deploy-web.mjs uploads instead of guessing. The bundle's name
// changes every build, and the one thing that must never happen is an
// index.html on the server naming a file that is not there -- so the name
// is written down by the build that made it rather than globbed for at
// upload time, and the hash is carried along so the upload can prove the
// file that landed is the file that was built.
const manifest = {
  bundle: bundleName,
  bundleSha256: createHash('sha256').update(fs.readFileSync(path.join(DIST, bundleName))).digest('hex'),
  bundleBytes: fs.statSync(path.join(DIST, bundleName)).size,
  shareImage: shareDataUri ? SHARE_IMAGE_NAME : null,
  fonts: fontFiles.map((f) => `fonts/${f}`),
  chunks: lazyChunks.map((f) => `_expo/static/js/web/${f}`),
  shellBytes: fs.statSync(htmlPath).size,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(DIST, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${DIST}/asset-manifest.json`);

// Carry the SPA-fallback .htaccess into dist/ on every build, so uploading
// dist/'s contents always includes it -- without it Apache 404s on any
// client-side route (/profile, /control-room/categories) on refresh.
if (fs.existsSync('.htaccess')) {
  fs.copyFileSync('.htaccess', path.join(DIST, '.htaccess'));
  console.log(`Copied .htaccess -> ${path.join(DIST, '.htaccess')}`);
} else {
  console.log('WARNING: .htaccess not found -- dist/ will be missing the SPA-fallback rewrite rule');
}

// Carry the static legal pages (About Us / Privacy Policy / Terms &
// Conditions) into dist/ too, same reasoning as .htaccess above. These are
// deliberately plain HTML, not React screens -- see AGENTS.md on how
// fragile the OTA/fingerprint setup is -- so they're maintained in legal/
// and just copied here rather than going through Expo's export at all.
// .htaccess's `RewriteCond %{REQUEST_FILENAME} -f` rule already lets any
// real file win over the SPA fallback, so no extra rewrite rule is needed
// for these to resolve at /about.html etc. See src/lib/legalLinks.ts for
// where these filenames are linked from in the app, and deploy-web.mjs for
// where they get uploaded.
const LEGAL_DIR = 'legal';
if (fs.existsSync(LEGAL_DIR)) {
  const legalFiles = fs.readdirSync(LEGAL_DIR).filter((f) => f.endsWith('.html'));
  for (const f of legalFiles) {
    fs.copyFileSync(path.join(LEGAL_DIR, f), path.join(DIST, f));
  }
  console.log(`Copied ${legalFiles.length} legal page(s) -> ${DIST}/ (${legalFiles.join(', ')})`);
} else {
  console.log('NOTE: legal/ not found -- About/Privacy/Terms pages will not be in dist/');
}
