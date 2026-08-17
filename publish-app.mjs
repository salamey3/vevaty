// Publishes the current code to the installed Android app over the air.
//
// This is the everyday alternative to `npm run build:android`. A full build
// takes 10-20 minutes and consumes one of a small monthly quota; an update
// takes about a minute, is unlimited, and lands on the phone the next time
// the app is opened. It can only carry JavaScript, styling and image assets
// -- which is what almost every change to this project actually is.
//
// Written as a Node script rather than inline in package.json so the commit
// message can be reused as the update message without shell-specific
// syntax like $(...), which would not work in Windows cmd.
import { execFileSync, execSync } from 'node:child_process';

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// Refuse to publish uncommitted work. Otherwise it's possible to ship
// something to the phone that exists on no machine but this one and is in
// no commit -- which is exactly how a phone and a website silently drift
// apart, and it would be near-impossible to work out afterwards what the
// installed app actually contains.
const dirty = run('git status --porcelain');
if (dirty) {
  console.error('\nThere are uncommitted changes:\n');
  console.error(dirty + '\n');
  console.error('Commit and push them first, so the update matches the repo:');
  console.error('  git add -A && git commit -m "what changed" && git push\n');
  process.exit(1);
}

const message = run('git log -1 --pretty=%s');
const commit = run('git rev-parse --short HEAD');

console.log(`\nPublishing to the "preview" channel`);
console.log(`  commit:  ${commit}`);
console.log(`  message: ${message}\n`);

// npx rather than a global install, so this works on any machine that has
// only run `npm install`.
// --environment is passed explicitly so eas never stops to ask. Left
// interactive, it prompts with `development` highlighted first, and picking
// anything other than `preview` publishes to a channel the installed app
// isn't listening on -- the update simply never arrives, with no error to
// explain why. Not a decision worth re-making by keyboard each time.
execFileSync(
  'npx',
  [
    '--yes', 'eas-cli', 'update',
    '--channel', 'preview',
    '--environment', 'preview',
    '--message', `${message} (${commit})`,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

console.log('\nDone. Fully close the app on the phone and reopen it twice:');
console.log('  the first open downloads the update, the second runs it.\n');
