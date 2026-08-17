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

const CONFIG = 'deploy.config.json';

// Everything the server needs: the page itself, and the rewrite rule that
// makes deep links work. .htaccess is copied into dist/ by every build, so
// uploading both keeps the two in step.
const FILES = ['index.html', '.htaccess'];

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
