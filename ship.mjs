// One command to push everything you've changed to everywhere it has to go.
//
// There are three places the code lives -- GitHub, the phone app, and the
// website -- and they are updated by three unrelated mechanisms. Doing them
// one at a time by hand is how they drift apart, which has already cost real
// time on this project: a fix live on the phone and missing from the site
// reads exactly like a fix that didn't work, and twice the `git push` was
// the step that got skipped, stranding commits on one laptop.
//
// Order matters here, and it isn't the obvious one:
//
//   1. refuse to ship uncommitted work
//   2. typecheck            -- catch it here, not after it's live
//   3. push to GitHub       -- the code now exists off this laptop
//   4. build the website
//   5. upload the website, then check the live page matches
//   6. check the update can actually reach the installed app
//   7. publish the app update
//
// The app goes LAST. It's the only step that can't be repeated cheaply --
// every publish is one your testers have to force-stop and reopen for -- so
// everything that might fail happens before it. If step 5 breaks, the app
// hasn't shipped yet and you fix the website with nothing half-released.
//
// Website upload needs deploy.config.json (see WORKFLOW.md). Without it,
// this still does everything else and tells you what to upload by hand.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deployConfig, deployWeb } from './deploy-web.mjs';

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const loud = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

const auto = deployConfig() !== null;
const TOTAL = auto ? 7 : 6;
let n = 0;
const step = (what) => console.log(`\n[${++n}/${TOTAL}] ${what}`);

// --- nothing unsaved ----------------------------------------------------
step('Checking for unsaved work');
const dirty = run('git status --porcelain');
if (dirty) {
  console.error('\nThese files have changes that are not committed:\n');
  console.error(dirty + '\n');
  console.error('Commit them first, so what ships matches what is in the repo:');
  console.error('  git add -A && git commit -m "what changed"\n');
  console.error('Then run "npm run ship" again.\n');
  process.exit(1);
}
console.log('       clean');

// --- typecheck ----------------------------------------------------------
step('Checking the code compiles');
try {
  loud('npx', ['--yes', 'tsc', '--noEmit']);
} catch {
  console.error('\nThe code does not compile, so nothing was shipped.');
  console.error('Fix the errors above and run "npm run ship" again.\n');
  process.exit(1);
}
console.log('       ok');

// --- GitHub -------------------------------------------------------------
step('Pushing to GitHub');
try {
  loud('git', ['push']);
} catch {
  console.error('\nThe push failed, so nothing was shipped.');
  console.error('Usually this means the GitHub token expired -- make a new one,');
  console.error('then run "npm run ship" again.\n');
  process.exit(1);
}

// --- build the website --------------------------------------------------
step('Building the website');
loud('npm', ['run', 'build:web']);
const fingerprint = createHash('sha256').update(readFileSync('dist/index.html')).digest('hex');

// --- upload the website, and confirm it took ----------------------------
let websiteDone = false;
if (auto) {
  step('Uploading the website');
  try {
    deployWeb();
    loud('npm', ['run', 'verify:web']);
    websiteDone = true;
  } catch {
    console.error('\nThe website upload or verification failed, so the APP UPDATE');
    console.error('was NOT published -- the two would have drifted apart, which is');
    console.error('the exact problem this command exists to prevent.\n');
    console.error('Fix the error above and run "npm run ship" again. Repeating it is');
    console.error('safe: every step overwrites rather than accumulating.\n');
    process.exit(1);
  }
}

// --- will the update actually reach the installed app? ------------------
//
// An over-the-air update is only delivered to an installed app whose
// "runtime version" matches it. That runtime is a fingerprint of everything
// native: app.json, package.json, eas.json, the assets, the native config
// of every Expo plugin -- and .gitignore, which is where this bit me.
//
// When they diverge, nothing fails. `eas update` reports success, the
// update appears in `eas update:list`, and the phone quietly never sees it,
// because it is asking for a runtime nobody is publishing to. You are left
// force-quitting the app over and over wondering why a change that is
// plainly live on the website refuses to appear.
//
// So: compute the fingerprint of what we are about to publish, ask EAS what
// the last Android build was compiled with, and say so plainly if they
// don't match.
//
// THIS CHECK SILENTLY DID NOT RUN FOR SIX SHIPS, and the exact thing it
// exists to catch is what happened. `eas-cli build:list` was being passed
// `--non-interactive`, which that CLI does not accept -- it wants CI=1 in
// the environment -- so the command threw, the catch swallowed it, and the
// step printed a bland "skipped ... not fatal" every time. Meanwhile a
// single line added to package.json's "scripts" had changed the runtime
// fingerprint, and every update since had been publishing to a runtime no
// installed app was asking for. Two of the ships in between were spent
// force-quitting the app wondering why a change that was plainly live on
// the website refused to appear.
//
// Two lessons, both encoded below: pass CI through the environment, and
// never report a diagnostic that could not run as though it had run.
function runtimeCheck() {
  const quiet = (cmd, args) =>
    execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // eas-cli reads CI from the environment. It rejects
      // --non-interactive outright, which is what broke this.
      env: { ...process.env, CI: '1' },
    });
  try {
    const fpOut = quiet('npx', ['--yes', 'expo-updates', 'fingerprint:generate', '--platform', 'android']);
    const local = JSON.parse(fpOut.trim().split('\n').pop()).hash;
    const buildsOut = quiet('npx', ['--yes', 'eas-cli', 'build:list', '--platform', 'android', '--limit', '1', '--json']);
    const installed = JSON.parse(buildsOut)[0]?.runtimeVersion;
    if (!local || !installed) return { error: 'the lookup returned nothing usable' };
    return { local, installed, match: local === installed };
  } catch (e) {
    return { error: (e?.stderr || e?.message || String(e)).toString().trim().split('\n').slice(-3).join(' ') };
  }
}

step('Checking the update can reach the installed app');
const rt = runtimeCheck();
if (rt.error) {
  // Deliberately noisy. A check that cannot run is not a check that
  // passed, and the quiet version of this line cost six ships.
  console.log('\n  ' + '?'.repeat(62));
  console.log('  COULD NOT VERIFY THAT THIS UPDATE WILL REACH THE APP.');
  console.log('  ' + '?'.repeat(62));
  console.log(`\n    ${rt.error}`);
  console.log('\n  Publishing anyway, but nothing here has confirmed the phone will');
  console.log('  see it. If an update does not appear after two force-quits, run:');
  console.log('    npx expo-updates fingerprint:generate --platform android');
  console.log('    CI=1 npx eas-cli build:list --platform android --limit 1 --json');
  console.log('  and compare the hash with the build\'s runtimeVersion.\n');
} else if (rt.match) {
  console.log(`       ok -- runtime ${rt.local.slice(0, 12)}`);
} else {
  console.log('\n  ' + '!'.repeat(62));
  console.log('  THIS UPDATE CANNOT REACH THE APP THAT IS INSTALLED.');
  console.log('  ' + '!'.repeat(62));
  console.log(`\n    installed app was built with : ${rt.installed}`);
  console.log(`    this update publishes as     : ${rt.local}`);
  console.log('\n  Something native changed -- app.json, package.json, eas.json,');
  console.log('  the assets, or .gitignore. Over-the-air updates only reach an');
  console.log('  app whose runtime matches, so this will publish successfully');
  console.log('  and silently never arrive on the phone.');
  console.log('\n  A new build is required:');
  console.log('    npm run build:android');
  console.log('\n  Install the APK it produces, and updates resume as normal.');
  console.log('  Publishing anyway -- it is harmless, and it is what the next');
  console.log('  build will carry.\n');
}

// --- publish the app ----------------------------------------------------
step('Publishing the app update');
loud('npm', ['run', 'publish:app']);

// --- what's left --------------------------------------------------------
const commit = run('git rev-parse --short HEAD');
const message = run('git log -1 --pretty=%s');

console.log(`\n${'='.repeat(64)}`);
console.log(`Shipped ${commit} -- ${message}`);
console.log('='.repeat(64));
console.log('\n  GitHub   done');
console.log(`  Website  ${websiteDone ? 'done, and verified byte-for-byte' : 'NOT DONE -- see below'}`);
console.log('  App      done -- force stop the app on the phone, open it, force');
console.log('           stop again, open it. First open downloads, second runs.');

if (!websiteDone) {
  console.log('\n  The website is still on the old code. Upload it by hand:');
  console.log('    1. cPanel -> File Manager');
  console.log('    2. open the vevaty.com folder (NOT public_html)');
  console.log('    3. tick "Overwrite existing files" BEFORE choosing the file');
  console.log('    4. upload dist/index.html');
  console.log('    5. npm run verify:web');
  console.log(`\n  It should report this fingerprint:`);
  console.log(`    ${fingerprint}`);
  console.log('\n  To stop doing this by hand, see "Automatic website upload"');
  console.log('  in WORKFLOW.md -- it is a one-time setup.');
}
console.log('');
