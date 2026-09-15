// Proves the website deploy refuses the uploads that would take the site
// down, without touching the real host.
//
//   node scripts/test/deploy-guards.test.mjs
//
// Run directly, NOT via an npm script. @expo/fingerprint hashes
// package.json's "scripts" block into the runtime version, so adding a
// script here silently orphans every over-the-air update -- they publish
// fine and no installed app ever asks for that runtime. That has already
// cost this project six ships once.
//
// It exists because the split into a shell plus app.<hash>.js introduced a
// way for a deploy to half-work: index.html NAMES a file now, and a page
// whose script is missing, unreadable or truncated is a blank screen with
// nothing in any log. deploy-web.mjs is built so that cannot ship -- the
// bundle goes up first and is fetched back and hashed before index.html is
// allowed to name it -- and this is what checks that the refusal actually
// happens rather than being a comment somebody wrote once.
//
// Needs a finished `npm run build:web` in dist/. Nothing here goes near the
// network beyond 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { __verifyUploaded } from '../../deploy-web.mjs';

const DIST = 'dist';
const MANIFEST = path.join(DIST, 'asset-manifest.json');

if (!fs.existsSync(MANIFEST)) {
  console.error(`\nNo ${MANIFEST}. Run \`npm run build:web\` first.\n`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const bundlePath = path.join(DIST, manifest.bundle);
if (!fs.existsSync(bundlePath)) {
  console.error(`\n${bundlePath} is missing. Run \`npm run build:web\` first.\n`);
  process.exit(1);
}
const bundle = fs.readFileSync(bundlePath);
const shell = fs.readFileSync(path.join(DIST, 'index.html'));

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

console.log('\nWhat the build produced\n');
{
  const named = shell.toString('utf8').match(/<script src="([^"]+)"[^>]*><\/script>/)?.[1]?.replace(/^\//, '');
  check('index.html names the bundle this build made', named === manifest.bundle, `${named}`);
  const real = createHash('sha256').update(bundle).digest('hex');
  check('the manifest hash is the real hash of the file', real === manifest.bundleSha256);
  check('the shell is small enough to send uncached every time', shell.length < 200_000, `${(shell.length / 1024).toFixed(1)} KB`);
}

console.log('\nWhat the upload refuses\n');

async function serving(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
async function attempt(handler) {
  const s = await serving(handler);
  try {
    await __verifyUploaded(s.origin, manifest.bundle, manifest.bundleSha256);
    return null;
  } catch (e) {
    return e?.message || String(e);
  } finally {
    s.close();
  }
}

check('accepts the file it actually built',
  (await attempt((_q, res) => { res.writeHead(200); res.end(bundle); })) === null);

// The oldest failure in this project: the SPA fallback answering a missing
// script with index.html's HTML and a 200.
{
  const msg = await attempt((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(shell); });
  check('refuses HTML served in place of the bundle', !!msg && /HTML/.test(msg));
}
// 2026-08-21: a brand-new filename landing with permissions the web server
// cannot read. Every bundle has a brand-new filename.
{
  const msg = await attempt((_q, res) => { res.writeHead(403); res.end('Forbidden'); });
  check('refuses a 403 from wrong permissions', !!msg && /answered 403/.test(msg));
}
{
  const msg = await attempt((_q, res) => { res.writeHead(404); res.end('Not Found'); });
  check('refuses a 404', !!msg && /answered 404/.test(msg));
}
{
  const msg = await attempt((_q, res) => { res.writeHead(200); res.end(bundle.subarray(0, bundle.length - 64)); });
  check('refuses a truncated transfer', !!msg && /does not match/.test(msg));
}

console.log('\nThat the gate is still in front of index.html\n');

// The checks above prove the GUARD works. They say nothing about whether
// anything is still standing behind it -- and the single edit that would
// undo this entire change is moving the pages upload above the verify, which
// would leave every check above green. So the order is asserted directly
// against the source. A structural check, not a behavioural one: running the
// real deployWeb() would need an ssh host, and a test that needs one is a
// test nobody runs.
{
  const src = fs.readFileSync(new URL('../../deploy-web.mjs', import.meta.url), 'utf8');
  const verifyAt = src.indexOf("await verifyUploaded(origin, manifest.bundle");
  const pagesAt = src.indexOf("uploadAtomically(cfg, port, PAGES");
  const shellCheckAt = src.indexOf("await verifyUploaded(origin, 'index.html'");
  check('the bundle is verified before the pages are uploaded',
    verifyAt > 0 && pagesAt > 0 && verifyAt < pagesAt);
  check('index.html is verified after it is uploaded',
    shellCheckAt > 0 && shellCheckAt > pagesAt);
  check('files are moved into place, not written over',
    /mv -f/.test(src) && !/execFileSync\('scp'[^)]*remoteDir\}\/`/.test(src));
  check('index.html is moved last', /f !== 'index\.html'\), \.\.\.present\.filter/.test(src));
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length
  ? `\n${failed.length} check(s) FAILED. Do not deploy until this passes.\n`
  : '\nAll checks passed: a bad bundle cannot get past the gate, and the gate is\n' +
    'still in front of index.html.\n');
process.exit(failed.length ? 1 : 0);
