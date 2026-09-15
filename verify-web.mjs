// Answers one question with a yes or a no: is the live website running the
// code in this folder?
//
// "It looks right" is not an answer -- a stale upload looks right too, and
// the difference only surfaces days later as a bug that exists on the site
// and nowhere else. So this compares fingerprints: a SHA-256 of the file
// you built against a SHA-256 of the file the server is actually serving.
// Same fingerprint means byte-for-byte identical. Nothing else does.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';

const ORIGIN = 'https://vevaty.com';
const URL = `${ORIGIN}/index.html`;
const LOCAL = 'dist/index.html';
const MANIFEST = 'dist/asset-manifest.json';
const STANDALONE = 'dist/vevaty-standalone.html';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (!existsSync(LOCAL)) {
  console.error(`\nThere's no ${LOCAL} to compare against.`);
  console.error('Build it first:\n  npm run build:web\n');
  process.exit(1);
}

const local = readFileSync(LOCAL);

let live;
try {
  // no-store, or a cached copy could report a match that the public isn't
  // actually being served.
  const res = await fetch(URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) {
    console.error(`\nThe server answered ${res.status} for ${URL}.`);
    console.error('If that\'s 404, index.html isn\'t where it should be in the vevaty.com folder.\n');
    process.exit(1);
  }
  live = Buffer.from(await res.arrayBuffer());
} catch (e) {
  console.error(`\nCouldn't reach ${URL}\n${e?.message || String(e)}\n`);
  process.exit(1);
}

const localHash = sha256(local);
const liveHash = sha256(live);

console.log(`\n  your build   ${localHash}  (${local.length.toLocaleString()} bytes)`);
console.log(`  vevaty.com   ${liveHash}  (${live.length.toLocaleString()} bytes)\n`);

if (localHash === liveHash) {
  // index.html matching is no longer the whole answer. It is a shell that
  // NAMES app.<hash>.js, and the app itself lives in that file -- a
  // matching shell pointing at a bundle that is missing, unreadable, or
  // answered by the SPA fallback is a blank site that passes the check
  // above. So the file the page actually depends on gets checked too.
  if (existsSync(MANIFEST)) {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const bundleUrl = `${ORIGIN}/${manifest.bundle}`;
    try {
      const res = await fetch(bundleUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) {
        console.log(`  BUT the bundle it loads is not being served: ${bundleUrl} answered ${res.status}.`);
        console.log('  The page will be blank. Re-run the upload.\n');
        process.exit(1);
      }
      const body = Buffer.from(await res.arrayBuffer());
      const bundleHash = sha256(body);
      if (bundleHash !== manifest.bundleSha256) {
        const looksLikeHtml = body.slice(0, 200).toString('utf8').trim().startsWith('<');
        console.log(`  BUT ${bundleUrl} is not the file that was built.`);
        console.log(looksLikeHtml
          ? '  It answered with HTML -- the SPA fallback caught it, so the bundle is not there.'
          : `  ${body.length.toLocaleString()} bytes, hash ${bundleHash.slice(0, 16)}... (expected ${manifest.bundleSha256.slice(0, 16)}...).`);
        console.log('  The page will be blank. Re-run the upload.\n');
        process.exit(1);
      }
      const cache = res.headers.get('cache-control') || '(none)';
      console.log(`  bundle       ${manifest.bundle}  (${body.length.toLocaleString()} bytes, hash matches)`);
      console.log(`  cache-control ${cache}`);
      if (!/max-age=\d{5,}/.test(cache)) {
        console.log('  NOTE: that bundle is not being cached for long. Check .htaccess reached the server --');
        console.log('        without it every visitor re-downloads the whole thing on every visit.');
      }
      console.log('');
    } catch (e) {
      console.log(`  BUT ${bundleUrl} could not be fetched: ${e?.message || String(e)}\n`);
      process.exit(1);
    }
  }
  console.log('  IN SYNC -- the website is running exactly this code.\n');
  process.exit(0);
}

// The documented rollback is to put dist/vevaty-standalone.html up as
// index.html. That is a DIFFERENT file from dist/index.html, so the hash
// comparison above fails -- and telling someone mid-incident that their
// recovery did not work, over advice about ticking Overwrite in cPanel,
// is worse than saying nothing. Recognise it and say what it is.
if (existsSync(STANDALONE) && sha256(readFileSync(STANDALONE)) === liveHash) {
  console.log('  The site is serving the SINGLE-FILE rollback build of this same commit.');
  console.log('  That is the public site in one document -- correct, just slower for');
  console.log('  visitors (no caching, the whole bundle on every visit). The control');
  console.log('  room still loads its screens from /_expo/, which is already there.\n');
  console.log('  To go back to the fast split version: npm run deploy:web\n');
  process.exit(1);
}

console.log('  OUT OF SYNC -- the website is NOT running this code.\n');
console.log('  Usually one of:');
console.log('    - the upload was never done, or went to public_html by mistake');
console.log('    - "Overwrite existing files" was not ticked, so the old file stayed');
console.log('    - an older copy of index.html got uploaded from Downloads');
console.log('    - the build ran after the upload, not before\n');
console.log('  Re-upload dist/index.html and run this again.\n');
process.exit(1);
