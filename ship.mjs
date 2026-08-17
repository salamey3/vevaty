// One command to push everything you've changed to everywhere it has to go.
//
// There are three places the code lives -- GitHub, the phone app, and the
// website -- and they are updated by three unrelated mechanisms. Doing them
// one at a time by hand is how they drift apart, which has already cost real
// time on this project: a fix live on the phone and missing from the site
// reads exactly like a fix that didn't work.
//
// This runs them in the only order that is safe:
//
//   1. refuse to ship uncommitted work
//   2. typecheck  -- catch it here, not after it's live
//   3. push to GitHub  -- so the code exists somewhere other than this laptop
//   4. build the website bundle
//   5. publish the app update
//
// Step 5 is last on purpose. If anything earlier fails, nothing has been
// released yet and you can fix it and re-run with nothing to undo.
//
// The website upload itself is still yours to do: it is a drag-and-drop into
// cPanel, and this script has no business holding hosting credentials. It
// prints the fingerprint of what you should end up with, and
// `npm run verify:web` checks the live site against it afterwards.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const step = (n, what) => console.log(`\n[${n}/5] ${what}`);
const loud = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

// --- 1. nothing unsaved -------------------------------------------------
step(1, 'Checking for unsaved work');
const dirty = run('git status --porcelain');
if (dirty) {
  console.error('\nThese files have changes that are not committed:\n');
  console.error(dirty + '\n');
  console.error('Commit them first, so what ships matches what is in the repo:');
  console.error('  git add -A && git commit -m "what changed"\n');
  console.error('Then run "npm run ship" again.\n');
  process.exit(1);
}
console.log('      clean');

// --- 2. typecheck -------------------------------------------------------
step(2, 'Checking the code compiles');
try {
  loud('npx', ['--yes', 'tsc', '--noEmit']);
} catch {
  console.error('\nThe code does not compile, so nothing was shipped.');
  console.error('Fix the errors above and run "npm run ship" again.\n');
  process.exit(1);
}
console.log('      ok');

// --- 3. GitHub ----------------------------------------------------------
step(3, 'Pushing to GitHub');
try {
  loud('git', ['push']);
} catch {
  console.error('\nThe push failed, so nothing was shipped.');
  console.error('Usually this means the GitHub token expired -- make a new one,');
  console.error('then run "npm run ship" again.\n');
  process.exit(1);
}

// --- 4. website bundle --------------------------------------------------
step(4, 'Building the website');
loud('npm', ['run', 'build:web']);
const fingerprint = createHash('sha256').update(readFileSync('dist/index.html')).digest('hex');

// --- 5. app update ------------------------------------------------------
step(5, 'Publishing the app update');
loud('npm', ['run', 'publish:app']);

// --- what's left for you ------------------------------------------------
const commit = run('git rev-parse --short HEAD');
const message = run('git log -1 --pretty=%s');

console.log(`\n${'='.repeat(64)}`);
console.log(`Shipped ${commit} -- ${message}`);
console.log('='.repeat(64));
console.log('\n  GitHub   done');
console.log('  App      done -- force stop the app on the phone, open it, force');
console.log('           stop again, open it. First open downloads, second runs.');
console.log('\n  Website  ONE STEP LEFT, do this now or the site falls behind:');
console.log('             1. cPanel -> File Manager');
console.log('             2. open the vevaty.com folder (NOT public_html)');
console.log('             3. tick "Overwrite existing files" BEFORE choosing the file');
console.log('             4. upload dist/index.html');
console.log('\n           then check it actually landed:');
console.log('             npm run verify:web');
console.log(`\n           it should report this fingerprint:`);
console.log(`             ${fingerprint}\n`);
