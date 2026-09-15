// Uploads the built website to the hosting account over SSH.
//
// This replaces the drag-and-drop into cPanel's File Manager, which was the
// last manual step in shipping and by far the easiest one to get wrong: the
// wrong folder, "Overwrite existing files" left unticked, or an older copy
// of index.html picked out of Downloads. Each of those leaves the site
// running yesterday's code while looking perfectly fine.
//
// It uses scp, which authenticates with an SSH key -- so no password is
// stored anywhere, and nothing secret goes near this repo (which is public).
// See WORKFLOW.md for the one-time key setup.
//
// The host, username and remote folder live in deploy.config.json, which is
// gitignored. Not because they're secret, but because they describe one
// person's hosting account and don't belong in shared code.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const CONFIG = 'deploy.config.json';

// The upload happens in TWO phases, and the order is the whole safety
// argument.
//
// index.html now NAMES a second file (app.<hash>.js) instead of carrying
// the bundle inside it. That is a new way for a deploy to go wrong, and it
// is the oldest failure mode this project has: a page that references a
// script which is not on the server 404s, the SPA-fallback rewrite used to
// hand back index.html's HTML for that 404, and the browser dies on
// "Unexpected token '<'" with a blank page and nothing in any log. It has
// happened here twice -- an interrupted build leaving the raw Expo shell,
// and 2026-08-21 when brand-new files landed with permissions the web
// server could not read (scp only applies a fresh mode when it CREATES a
// remote file, so the first upload of any new filename is the one that can
// silently land unreadable -- and every bundle has a new filename).
//
// So: everything index.html DEPENDS ON goes up first and is fetched back
// over HTTPS and checked against the hash the build recorded. Only if that
// passes is index.html replaced. Until that moment the live site is still
// serving the previous release, whole and working.
//
// Stated precisely, because the comfortable version of this sentence is
// wrong: a failure in phase 1 is a no-op. A failure in phase 2 is not --
// index.html is being replaced by then, and the shell is sent `no-store`,
// so there is no cached good copy anywhere. Phase 2 is therefore verified
// too, and if THAT check fails the operator is told the site may be down
// and given the one-file recovery, rather than a message that sounds like
// nothing happened. Every file also lands via a rename rather than being
// written over in place, so no request can ever be answered with half of
// one (see uploadAtomically).
const ASSETS = ['.htaccess'];
const PAGES = [
  'index.html',
  'about.html', 'privacy-policy.html', 'terms.html',
  'about-ar.html', 'privacy-policy-ar.html', 'terms-ar.html',
];
const MANIFEST = 'dist/asset-manifest.json';
const DEFAULT_ORIGIN = 'https://vevaty.com';

// Old bundles are deliberately NOT deleted from the server. They cost a
// few MB and they cover the gap where a browser has the previous
// index.html already parsed and is about to ask for the script it names.

export function deployConfig() {
  if (!existsSync(CONFIG)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    throw new Error(`${CONFIG} is not valid JSON: ${e?.message || String(e)}`);
  }
}

function readManifest() {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `${MANIFEST} is missing, so there is no record of which bundle this build produced.\n` +
        '  Run `npm run build:web` again -- build-standalone.mjs writes it. Nothing has been uploaded.'
    );
  }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    throw new Error(`${MANIFEST} is not valid JSON: ${e?.message || String(e)}`);
  }
}

// Refuse to upload an index.html that names anything other than the bundle
// this build actually made.
//
// The old check here looked for a leftover `/_expo/` script src, which
// caught exactly one shape of the problem: an interrupted build leaving
// Expo's raw shell. This asks the real question instead -- does the page
// name a file we are about to put on the server? -- which also catches a
// stale index.html from a previous build, a hand-edited one, and the shell
// case the old check was written for.
function assertShellMatchesBundle(manifest) {
  const html = readFileSync('dist/index.html', 'utf8');
  const match = html.match(/<script src="([^"]+)"[^>]*><\/script>/);
  if (!match) {
    throw new Error(
      'dist/index.html does not load a script at all.\n' +
        '  Expected <script src="/' + manifest.bundle + '" defer>.\n' +
        '  Run `npm run build:web` again. Nothing has been uploaded.'
    );
  }
  const named = match[1].replace(/^\//, '');
  if (named !== manifest.bundle) {
    throw new Error(
      `dist/index.html loads "${named}", but this build produced "${manifest.bundle}".\n` +
        '  The two came from different builds, and uploading this page would point\n' +
        '  the live site at a file that is not there. Run `npm run build:web` again.\n' +
        '  Nothing has been uploaded.'
    );
  }
  if (!existsSync(`dist/${manifest.bundle}`)) {
    throw new Error(`dist/${manifest.bundle} is missing. Run \`npm run build:web\` again. Nothing has been uploaded.`);
  }
}

function sh(cfg, port, command) {
  execFileSync('ssh', ['-p', port, `${cfg.user}@${cfg.host}`, command], { stdio: 'inherit' });
}

// Uploads a set of files and puts each one into place with a RENAME.
//
// scp writes straight into the destination path, truncating whatever is
// there and filling it back in over the length of the transfer -- so for
// the duration of a 4 MB upload the server will happily answer a request
// for that file with however much of it has arrived, as a perfectly
// ordinary 200. That is survivable for a document sent `no-store`, which
// is what the site used to be: the visitor refreshes and gets a whole one.
// It is NOT survivable for app.<hash>.js, which is sent `immutable` for a
// year -- a browser that caches a half-written bundle has a blank page
// that a reload cannot fix, because the corrected re-upload lands at the
// same URL and is never asked for again. Same hazard, smaller window, for
// index.html: scp it directly and a dropped connection leaves a truncated
// page whose closing <script> tag never arrived.
//
// So everything lands in a temp directory first and is then moved into
// place. A rename within one filesystem is atomic: a request sees either
// the whole old file or the whole new one, never part of either. The
// moves are listed explicitly rather than globbed, so a stray file in the
// temp directory can never be swept into the document root.
function uploadAtomically(cfg, port, files, label, required = []) {
  const missingRequired = required.filter((f) => !existsSync(`dist/${f}`));
  if (missingRequired.length) {
    // The old code warned and carried on here, and reported success. The
    // file that made that dangerous is .htaccess: without it the server
    // keeps the PREVIOUS one, which has neither the asset-404 rule nor the
    // immutable cache header -- so the blank-page mechanism this whole
    // change exists to close stays live, the bundle is re-downloaded on
    // every visit, and the deploy says it worked.
    throw new Error(
      `dist/ is missing ${missingRequired.join(', ')}, which the site cannot go live without.\n` +
        '  Run `npm run build:web` again. Nothing has been uploaded.'
    );
  }
  const present = files.filter((f) => existsSync(`dist/${f}`));
  const missing = files.filter((f) => !existsSync(`dist/${f}`));
  if (missing.length) console.log(`  (not built, skipping: ${missing.join(', ')})`);
  if (!present.length) return [];

  const remoteDir = cfg.remoteDir.replace(/\/$/, '');
  const tmpDir = `${remoteDir}/.deploy-tmp`;
  const sources = present.map((f) => `dist/${f}`);
  console.log(`  ${label}: ${present.join(', ')}`);

  sh(cfg, port, `rm -rf '${tmpDir}' && mkdir -p '${tmpDir}'`);

  // -O forces the old scp protocol. Several shared hosts (cPanel included)
  // still don't run the SFTP subsystem that newer scp defaults to, and the
  // failure is an opaque "subsystem request failed". Fall back automatically
  // rather than making that someone's evening.
  const target = `${cfg.user}@${cfg.host}:${tmpDir}/`;
  try {
    execFileSync('scp', ['-P', port, ...sources, target], { stdio: 'inherit' });
  } catch {
    console.log('  retrying with the legacy scp protocol...');
    execFileSync('scp', ['-O', '-P', port, ...sources, target], { stdio: 'inherit' });
  }

  // chmod BEFORE the move, so a file is never briefly live with the wrong
  // mode. scp only applies a fresh permission mode (from the receiving
  // sshd's umask) when it CREATES a remote file -- overwriting an existing
  // one keeps whatever mode is already there. So the first upload of any
  // new filename is the one that can silently land unreadable, which is
  // exactly what happened 2026-08-21 to the Arabic legal pages. EVERY
  // bundle has a never-before-seen filename, so this is load-bearing now
  // rather than belt-and-braces -- and it is no longer a warning: a file
  // moved into place at the wrong mode is a 403 nobody asked for.
  //
  // index.html is moved LAST, so it is never the page naming a file that
  // has not landed yet.
  const ordered = [...present.filter((f) => f !== 'index.html'), ...present.filter((f) => f === 'index.html')];
  const moves = ordered.map((f) => `mv -f '${tmpDir}/${basename(f)}' '${remoteDir}/${basename(f)}'`).join(' && ');
  const chmods = ordered.map((f) => `'${tmpDir}/${basename(f)}'`).join(' ');
  sh(cfg, port, `chmod 644 ${chmods} && ${moves} && rmdir '${tmpDir}'`);

  return present;
}

// Ask the public internet for the file we just uploaded and check it is
// byte-for-byte what we built. This is the gate index.html waits behind.
//
// Checking the hash rather than just the status code is deliberate: a 200
// proves almost nothing here. The SPA fallback can answer a missing script
// with HTML and a 200; a half-finished transfer is a 200; a proxy can
// answer from somewhere else entirely. The hash is the only thing that
// says "the file being served IS the file I made".
async function fetchAndHash(origin, name) {
  const url = `${origin.replace(/\/$/, '')}/${name}`;
  const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) return { url, ok: false, status: res.status };
  const body = Buffer.from(await res.arrayBuffer());
  return { url, ok: true, body, hash: createHash('sha256').update(body).digest('hex') };
}

// The same question as verifyUploaded, asked without any consequence: is
// this exact file already being served? Used to skip an upload that would
// only put the live site at risk to change nothing.
async function isAlreadyServed(origin, name, expectedSha256) {
  try {
    const r = await fetchAndHash(origin, name);
    return r.ok && r.hash === expectedSha256;
  } catch {
    return false;
  }
}

async function verifyUploaded(origin, name, expectedSha256, label = name, { onFail } = {}) {
  const url = `${origin.replace(/\/$/, '')}/${name}`;
  let lastError = 'never attempted';
  // A few attempts: a file can take a beat to become visible after scp.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const r = await fetchAndHash(origin, name);
      if (!r.ok) {
        lastError = `the server answered ${r.status}`;
      } else if (r.hash === expectedSha256) {
        console.log(`  verified ${label}: ${url} (${r.body.length.toLocaleString()} bytes, hash matches)`);
        return true;
      } else {
        const looksLikeHtml = r.body.slice(0, 200).toString('utf8').trim().toLowerCase().startsWith('<');
        lastError = looksLikeHtml
          ? 'the server answered with HTML, not the file -- the SPA fallback caught it, which means it is not actually there'
          : `the file served does not match what was built (${r.body.length.toLocaleString()} bytes, hash ${r.hash.slice(0, 16)}...)`;
      }
    } catch (e) {
      lastError = e?.message || String(e);
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(
    `${url} did not come back correctly: ${lastError}.\n  ` +
      (onFail ||
        'index.html has NOT been replaced, so the live site is still serving the\n' +
          '  previous release and nobody is looking at a broken page. Fix this and\n' +
          '  run the upload again.')
  );
}

// Exported under a deliberately awkward name so the guard above can be
// test-fired against the failure modes it exists to stop (HTML served in
// its place, a 403 from wrong permissions, a truncated transfer) without
// anything touching the real host. Not part of this module's real API.
export const __verifyUploaded = verifyUploaded;

export async function deployWeb() {
  const cfg = deployConfig();
  if (!cfg) throw new Error(`${CONFIG} not found`);

  for (const key of ['host', 'user', 'remoteDir']) {
    if (!cfg[key]) throw new Error(`${CONFIG} is missing "${key}"`);
  }

  const manifest = readManifest();
  assertShellMatchesBundle(manifest);

  const port = String(cfg.port || 22);
  const origin = cfg.siteOrigin || DEFAULT_ORIGIN;
  console.log(`  to        ${cfg.user}@${cfg.host}:${cfg.remoteDir.replace(/\/$/, '')}/`);

  // --- phase 1: everything index.html is about to depend on --------------
  //
  // Asked before it is sent. A re-run of the same build -- which ship.mjs
  // actively tells the operator to do after any failure -- would otherwise
  // re-upload 4 MB over a file the live index.html already names, and any
  // visitor who asked for it mid-write would cache a truncated copy for a
  // year. If the server already has this exact bundle there is nothing to
  // do and nothing to risk.
  const alreadyThere = await isAlreadyServed(origin, manifest.bundle, manifest.bundleSha256);
  const assets = [...ASSETS, alreadyThere ? null : manifest.bundle, manifest.shareImage].filter(Boolean);
  if (alreadyThere) console.log(`  ${manifest.bundle} is already on the server and matches -- not re-uploading`);
  uploadAtomically(cfg, port, assets, 'uploading assets', ASSETS);

  await verifyUploaded(origin, manifest.bundle, manifest.bundleSha256, 'the bundle');

  // The share card is not worth failing a deploy over -- a blank link
  // preview is recoverable, a site that will not load is not. The read is
  // inside the try with everything else it is meant to cover.
  if (manifest.shareImage) {
    try {
      const localShare = readFileSync(`dist/${manifest.shareImage}`);
      await verifyUploaded(origin, manifest.shareImage, createHash('sha256').update(localShare).digest('hex'), 'the share image');
    } catch (e) {
      console.log(`  WARNING: ${manifest.shareImage} did not verify (${(e?.message || e).split('\n')[0]}).`);
      console.log('  The site is fine; WhatsApp/Facebook link previews may have no image.');
    }
  }

  // --- phase 2: the pages, now that what they name is provably there -----
  uploadAtomically(cfg, port, PAGES, 'uploading pages', ['index.html']);

  // Phase 2 gets checked too, and this is not a formality: everything
  // above only guarantees that a BAD deploy never replaces a good
  // index.html. It says nothing about index.html's own upload, which can
  // fail exactly like any other -- and the shell is sent `no-store`, so
  // there is no cached good copy anywhere to fall back on. Without this,
  // a deploy that broke the site would exit reporting a failure that
  // sounds like nothing happened.
  await verifyUploaded(origin, 'index.html', createHash('sha256').update(readFileSync('dist/index.html')).digest('hex'), 'index.html', {
    onFail:
      'THE LIVE SITE MAY BE BROKEN RIGHT NOW. index.html was replaced and what came\n' +
      '  back is not what was built. Fastest recovery, one file, needs nothing else:\n\n' +
      '    scp dist/vevaty-standalone.html <user>@<host>:<remoteDir>/index.html\n\n' +
      '  (or upload it through cPanel File Manager and rename it to index.html).',
  });

  console.log(`\n  live bundle: ${manifest.bundle} (${(manifest.bundleBytes / 1024 / 1024).toFixed(2)} MB, cached for a year)`);
  console.log(`  live shell:  index.html (${(manifest.shellBytes / 1024).toFixed(1)} KB, never cached)`);
  console.log('  rollback:    upload dist/vevaty-standalone.html as index.html -- it carries');
  console.log('               the whole bundle inline and needs nothing else on the server.');

  deployShareSnippets(cfg, port);
}

// dist/share/collection/<slug>/index.html -- the static OG-meta-tag
// snippets build-og.mjs generates (see that file for why they exist and
// why they live at their own /share/... path). Unlike everything in FILES
// above, this is a whole directory TREE with a variable number of
// subdirectories (one per collection), so it can't go through the flat
// basename()-keyed upload above -- that would collide every slug's
// index.html onto the same remote filename. `scp -r` instead, preserving
// structure, as its own step: best-effort and non-fatal, same as
// build-og.mjs generating these in the first place -- link previews just
// fall back to a generic default if this doesn't run, the app itself is
// unaffected either way.
function deployShareSnippets(cfg, port) {
  const localShareDir = 'dist/share';
  if (!existsSync(localShareDir)) {
    console.log('  (no dist/share/ -- OG snippets not built, skipping)');
    return;
  }
  const remoteDir = cfg.remoteDir.replace(/\/$/, '');
  const target = `${cfg.user}@${cfg.host}:${remoteDir}/`;
  console.log(`  uploading ${localShareDir} (collection share/OG snippets)`);
  try {
    try {
      execFileSync('scp', ['-r', '-P', port, localShareDir, target], { stdio: 'inherit' });
    } catch {
      execFileSync('scp', ['-r', '-O', '-P', port, localShareDir, target], { stdio: 'inherit' });
    }
    // Same first-upload-defaults-to-wrong-permission risk as above,
    // separately for directories (need 755, not 644) and files.
    execFileSync(
      'ssh',
      [
        '-p', port, `${cfg.user}@${cfg.host}`,
        `find '${remoteDir}/share' -type d -exec chmod 755 {} \\; -o -type f -exec chmod 644 {} \\;`,
      ],
      { stdio: 'inherit' }
    );
  } catch (e) {
    console.log(`  WARNING: could not upload collection share/OG snippets (${e?.message || e}).`);
    console.log('  The main site deploy above still succeeded -- this only affects link-preview cards.');
  }
}

// Allow `node deploy-web.mjs` on its own, as well as being imported by ship.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (!deployConfig()) {
      console.error(`\nNo ${CONFIG} yet, so there's nowhere to upload to.`);
      console.error('See "Automatic website upload" in WORKFLOW.md for the one-time setup.\n');
      process.exit(1);
    }
    await deployWeb();
    console.log('\n  uploaded. Now run: npm run verify:web\n');
  } catch (e) {
    console.error(`\nUpload failed: ${e?.message || String(e)}\n`);
    process.exit(1);
  }
}
