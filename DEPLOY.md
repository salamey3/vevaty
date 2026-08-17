# Vevaty — sync & release

Two shipping targets, **one source tree**: the Android app (EAS Build) and
the website at vevaty.com (a single self-contained HTML file). They only stay
in sync because both are built from the same commit — nothing enforces that
automatically, so the checklist below is what keeps them together.

## Where the code lives

- **GitHub is the source of truth** (`github.com/salamey3/vevaty`, branch
  `main`). Every machine clones from it; nothing is ever passed between
  machines directly.
- **The laptop and the phone (Termux, `~/vevaty-app`)** are both full working
  copies. Either can edit, build the website, and run EAS builds.
- A cloud assistant sandbox can read the repo and produce commits, but cannot
  push to GitHub, cannot reach vevaty.com, and is wiped between sessions.
  Anything it produces arrives as a bundle and is pushed from a real machine.

## Working across two machines

The whole point of the GitHub anchor: whichever machine you pick up, it
catches up in one command. There is only one rule, and breaking it is the
only way this gets painful:

**Pull before you start. Push before you walk away.**

```sh
git pull            # first thing, every time you sit down
# ...work...
git add -A && git commit -m "what changed" && git push
```

If you forget and end up having committed on both machines, they've diverged
and a plain `git pull` will complain. Recover with:

```sh
git pull --rebase   # replays your local commits on top of the remote's
```

### One-time laptop setup

```sh
git clone https://github.com/salamey3/vevaty.git
cd vevaty
npm install
```

Also needs **Node.js** (LTS), **Python 3** for `build:web`, and a GitHub
Personal Access Token at the first `git push` prompt, same as the phone.

On **Windows**, `npm run build:web` will fail because the script calls
`python3`; either use WSL/Git Bash, or change that script to `python`.

### Which machine for what

- **Laptop** — the better default. Real editor, fast bundling, and reliable
  cPanel uploads. Mobile browsers are unreliable at multi-megabyte uploads,
  and cPanel's own error text ("over quota or you attempted to upload a
  folder") is misleading when the real cause is usually the **Overwrite
  existing files** checkbox being unticked.
- **Phone** — fine for pulling a bundle, committing, kicking off an EAS
  build, and reviewing the app on-device. Avoid it for the cPanel upload
  step if a laptop is available.
- Both produce **byte-identical** `dist/index.html` from the same commit,
  which is the check that proves the environments actually agree.

## Receiving work from an assistant

Preferred: a **git bundle** (a real commit stream, not a diff).

```sh
cd ~/vevaty-app
git pull ~/storage/downloads/vevaty.bundle main
```

Because the bundle is built on top of the current GitHub HEAD, this is always
a fast-forward. Unlike `git am` with patch files, it cannot fail on context
mismatch — the failure mode that repeatedly cost us builds before this setup
existed.

Then publish so everything re-syncs:

```sh
git push origin main
```

## Prerequisites on the phone

```sh
pkg install python    # build_standalone.py needs it
npm install           # devDependencies include the typescript used by `verify`
```

## Release checklist

Always in this order, from a clean tree:

```sh
cd ~/vevaty-app
git pull origin main          # make sure you're on the latest
npm run verify                # typecheck — never ship without this passing
npm run build:web             # -> dist/index.html (self-contained, ~2.6MB)
```

Then upload to cPanel (File Manager). The document root for vevaty.com is
`/home/yousifs1/vevaty.com` -- an addon domain, so NOT `public_html`, which
belongs to a different site on the same account. Tick **Overwrite existing
files** before selecting the file:

- `dist/index.html` — the entire site, one file, all JS and assets inlined
- `dist/.htaccess` — SPA fallback; without it any deep link 404s on refresh

Finally, the Android build:

```sh
npm run build:android         # eas build --platform android --profile preview
```

Tag the commit so the APK and the uploaded site are traceable to one revision:

```sh
git tag -a v-$(date +%Y%m%d) -m "web + android" && git push origin --tags
```

`npm run release` chains verify → web → android in one go.

## Notes

- `dist/` is gitignored. Build output is never committed.
- `build_standalone.py` inlines the entry JS bundle and all assets as data
  URIs, then overwrites `dist/index.html` with the result, so whichever of
  the two files gets uploaded as `index.html` works identically.
- Expo may emit extra lazily-loaded chunks (currently expo-camera's barcode
  scanner). They are **not** inlined. Nothing in `src/` imports them at
  runtime today; the build prints a NOTE listing any it finds. If the app
  ever does dynamically import one, upload `dist/_expo/` alongside
  `index.html` too.
- The EAS free plan caps Android builds per month. Batch changes rather than
  building per fix.
