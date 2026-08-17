# Vevaty — sync & release

Two shipping targets, **one source tree**: the Android app (EAS Build) and
the website at vevaty.com (a single self-contained HTML file). They only stay
in sync because both are built from the same commit — nothing enforces that
automatically, so the checklist below is what keeps them together.

## Where the code lives

- **GitHub is the source of truth.** Both the phone and any assistant working
  on the repo clone from it.
- **The phone (Termux, `~/vevaty-app`)** is the only place that can build:
  it's the machine with EAS credentials and network access to vevaty.com.
- A cloud assistant sandbox can read the repo and produce commits, but cannot
  push to GitHub, cannot reach vevaty.com, and is wiped between sessions.
  Anything it produces must land on the phone and be pushed from there.

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

Then upload to cPanel (File Manager → public_html):

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
