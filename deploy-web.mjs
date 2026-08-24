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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const CONFIG = 'deploy.config.json';

// Everything the server needs: the page itself, the rewrite rule that makes
// deep links work, and the static legal pages (About Us / Privacy Policy /
// Terms & Conditions, each in English and an Arabic -ar.html sibling) linked
// from src/lib/legalLinks.ts. .htaccess and legal/*.html are both copied
// into dist/ by every build, so uploading all of them keeps dist/ and the
// live site in step.
const FILES = [
  'index.html', '.htaccess',
  'about.html', 'privacy-policy.html', 'terms.html',
  'about-ar.html', 'privacy-policy-ar.html', 'terms-ar.html',
];

export function deployConfig() {
  if (!existsSync(CONFIG)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    throw new Error(`${CONFIG} is not valid JSON: ${e?.message || String(e)}`);
  }
}

export function deployWeb() {
  const cfg = deployConfig();
  if (!cfg) throw new Error(`${CONFIG} not found`);

  for (const key of ['host', 'user', 'remoteDir']) {
    if (!cfg[key]) throw new Error(`${CONFIG} is missing "${key}"`);
  }

  const sources = FILES.map((f) => `dist/${f}`).filter((p) => existsSync(p));
  const missing = FILES.filter((f) => !existsSync(`dist/${f}`));
  if (!sources.length) throw new Error('Nothing in dist/ to upload -- run `npm run build:web` first.');
  if (missing.length) console.log(`  (not built, skipping: ${missing.join(', ')})`);

  // Refuse to upload the raw Expo shell.
  //
  // `npm run build:web` is two commands joined by &&: `expo export` writes a
  // ~1KB dist/index.html that pulls its JavaScript from /_expo/static/js/web/,
  // and only then does build-standalone.mjs replace it with the ~2.7MB
  // self-contained bundle. If the second half doesn't run -- an interrupted
  // build, a non-zero exit from the first half -- dist/index.html is left as
  // that shell, and uploading it silently breaks the whole site: the script it
  // points at was never uploaded, so it 404s, the SPA-fallback rewrite serves
  // index.html back for that 404, and every page is blank.
  //
  // This has actually happened, and it cost an afternoon of "my changes aren't
  // live" -- from the outside it looks exactly like a deploy that worked.
  const html = readFileSync('dist/index.html', 'utf8');
  if (/<script[^>]+src=["']\/?_expo\//.test(html)) {
    throw new Error(
      'dist/index.html is the raw Expo shell, not the self-contained bundle.\n' +
        '  It still loads its JavaScript from /_expo/, which never gets uploaded.\n' +
        '  Run `npm run build:web` again and check it finishes both halves --\n' +
        '  the last line should say "Overwrote dist/index.html with the\n' +
        '  self-contained bundle". Nothing has been uploaded.'
    );
  }

  const port = String(cfg.port || 22);
  const target = `${cfg.user}@${cfg.host}:${cfg.remoteDir.replace(/\/$/, '')}/`;

  console.log(`  uploading ${sources.join(', ')}`);
  console.log(`  to        ${target}`);

  // -O forces the old scp protocol. Several shared hosts (cPanel included)
  // still don't run the SFTP subsystem that newer scp defaults to, and the
  // failure is an opaque "subsystem request failed". Fall back automatically
  // rather than making that someone's evening.
  try {
    execFileSync('scp', ['-P', port, ...sources, target], { stdio: 'inherit' });
  } catch {
    console.log('  retrying with the legacy scp protocol...');
    execFileSync('scp', ['-O', '-P', port, ...sources, target], { stdio: 'inherit' });
  }

  // scp only applies a fresh permission mode (from the receiving sshd's
  // umask) when it CREATES a remote file -- overwriting an existing one
  // preserves whatever mode is already there. That means the first-ever
  // upload of any new filename can silently land unreadable by the web
  // server, while every already-existing file keeps working right next to
  // it -- which is exactly what happened 2026-08-21: about.html (already
  // on the server from an earlier upload) kept serving fine, but the
  // brand-new about-ar.html/privacy-policy-ar.html/terms-ar.html 403'd
  // until their permissions were corrected by hand. Force 644 on every
  // upload, every time, so the next new file can't repeat this -- it's a
  // no-op for files that are already 644.
  const remoteFiles = sources.map((s) => `${cfg.remoteDir.replace(/\/$/, '')}/${basename(s)}`);
  try {
    execFileSync('ssh', ['-p', port, `${cfg.user}@${cfg.host}`, 'chmod', '644', ...remoteFiles], { stdio: 'inherit' });
  } catch (e) {
    console.log(`  WARNING: could not set permissions on the uploaded files (${e?.message || e}).`);
    console.log('  If a page 403s after this, set it to 644 by hand (cPanel File Manager or chmod over SSH).');
  }

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
    deployWeb();
    console.log('\n  uploaded. Now run: npm run verify:web\n');
  } catch (e) {
    console.error(`\nUpload failed: ${e?.message || String(e)}\n`);
    process.exit(1);
  }
}
