// Turns Expo's `dist/` export into ONE self-contained index.html: the JS
// bundle, every asset it references, and the favicon are all inlined as
// data: URIs, so deploying the website is a single-file upload.
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
// The site deploys as ONE index.html, so the share image has to be inlined
// as a data: URI like everything else -- an <meta og:image> pointing at a
// file that is never uploaded would leave every WhatsApp and Facebook
// preview blank, which is the most-seen brand surface this app has
// (BRANDING.md part 7).
const BRAND_PRIMARY = '#0F3D2E';
const shareImagePath = path.join('assets', 'brand', 'share-image.png');
let shareMeta = '';
if (fs.existsSync(shareImagePath)) {
  const shareUri = `data:image/png;base64,${fs.readFileSync(shareImagePath).toString('base64')}`;
  shareMeta =
    `\n    <meta property="og:image" content="${shareUri}"/>` +
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
// The site is ONE 4 MB document with the whole bundle inlined, and the
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

// Expo doesn't always emit exactly one web bundle. Alongside the entry
// bundle it code-splits dynamically-imported modules into their own chunks --
// right now that's expo-camera's ZXing barcode scanner, which nothing in
// src/ ever invokes (the camera is used for photo capture only). An earlier
// version asserted there was exactly one .js file here, so the mere
// appearance of such a chunk broke the website build outright.
//
// Pick the *entry* bundle the way the browser does -- by reading the
// <script src> out of index.html -- rather than assuming the directory holds
// a single file, and report any remaining chunks instead of dying on them.
const entryMatch = html.match(/<script src="(\/_expo\/static\/js\/web\/[^"]+)"[^>]*><\/script>/);
if (!entryMatch) throw new Error('could not find the entry <script src> in dist/index.html');
const jsPath = path.join(DIST, entryMatch[1].replace(/^\//, ''));

const jsDir = path.join(DIST, '_expo', 'static', 'js', 'web');
const extraChunks = fs.existsSync(jsDir)
  ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => path.join(jsDir, f)).sort()
      .filter((p) => path.resolve(p) !== path.resolve(jsPath))
  : [];
if (extraChunks.length) {
  console.log(`NOTE: ${extraChunks.length} lazily-loaded chunk(s) are not inlined into the single-file build:`);
  for (const p of extraChunks) console.log(`  - ${path.basename(p)} (${fs.statSync(p).size} bytes)`);
  console.log('  They are only fetched if the app dynamically imports them at runtime.');
  console.log('  Nothing in src/ does today. If that ever changes, upload dist/_expo/ next to index.html.');
}

let js = fs.readFileSync(jsPath, 'utf8');

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
const scriptTag = html.match(/<script src="\/_expo\/static\/js\/web\/[^"]+" defer><\/script>/);
if (!scriptTag) throw new Error('could not find script tag to inline');
html = html.split(scriptTag[0]).join(`<script>${js}</script>`);

// Repo-relative, not /tmp: Termux has no writable /tmp, which made an
// earlier hardcoded /tmp path kill this script on the phone. dist/ is
// gitignored, so nothing here is ever committed. Override with
// STANDALONE_OUT=/some/path to put the copy elsewhere.
const outPath = process.env.STANDALONE_OUT || path.join(DIST, 'vevaty-standalone.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);

// IMPORTANT: also overwrite dist/index.html with this same fully self-contained
// bundle. The raw dist/index.html that `expo export` produces references an
// external script (/_expo/static/js/web/index-*.js) that is NOT part of our
// single-file cPanel deploy. If that raw shell ever gets uploaded as
// index.html, every request -- including plain "/" -- serves a page whose
// script 404s, the SPA-fallback .htaccess rewrites that 404 to index.html's
// *HTML*, and the resulting "Unexpected token '<'" leaves a blank white page.
// Making dist/index.html identical to the standalone build means whichever of
// the two is uploaded as index.html, it just works.
fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`Overwrote ${htmlPath} with the self-contained bundle (${fs.statSync(htmlPath).size} bytes)`);

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
