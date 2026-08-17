// Answers one question with a yes or a no: is the live website running the
// code in this folder?
//
// "It looks right" is not an answer -- a stale upload looks right too, and
// the difference only surfaces days later as a bug that exists on the site
// and nowhere else. So this compares fingerprints: a SHA-256 of the file
// you built against a SHA-256 of the file the server is actually serving.
// Same fingerprint means byte-for-byte identical. Nothing else does.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const URL = 'https://vevaty.com/index.html';
const LOCAL = 'dist/index.html';

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
  console.log('  IN SYNC -- the website is running exactly this code.\n');
  process.exit(0);
}

console.log('  OUT OF SYNC -- the website is NOT running this code.\n');
console.log('  Usually one of:');
console.log('    - the upload was never done, or went to public_html by mistake');
console.log('    - "Overwrite existing files" was not ticked, so the old file stayed');
console.log('    - an older copy of index.html got uploaded from Downloads');
console.log('    - the build ran after the upload, not before\n');
console.log('  Re-upload dist/index.html and run this again.\n');
process.exit(1);
