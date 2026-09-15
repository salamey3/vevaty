# Vevaty — sync & release

Two shipping targets, **one source tree**: the Android app (EAS Build) and
the website at vevaty.com (a small HTML shell plus one content-hashed JS
bundle -- see "Why the site is two files" below). They only stay
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

Also needs **Node.js** (LTS) and a GitHub Personal Access Token at the first
`git push` prompt, same as the phone. Nothing else -- the build runs on Node
alone, identically on Windows, macOS and Linux.

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

## Prerequisites (either machine)

```sh
npm install     # devDependencies include the typescript that `verify` runs
```

Node is the only runtime needed. The website bundler is
`build-standalone.mjs` (Node); it used to be a Python script, which meant
installing Python separately on every machine and calling it `python3` on
macOS/Linux but `python` on Windows.

## Release checklist

Always in this order, from a clean tree:

```sh
cd ~/vevaty-app
git pull origin main          # make sure you're on the latest
npm run verify                # typecheck — never ship without this passing
npm run build:web             # -> dist/index.html (~23KB shell) + dist/app.<hash>.js (~4MB)
```

Then upload to cPanel (File Manager). The document root for vevaty.com is
`/home/yousifs1/vevaty.com` -- an addon domain, so NOT `public_html`, which
belongs to a different site on the same account. Tick **Overwrite existing
files** before selecting the file:

By hand, upload **`dist/vevaty-standalone.html` renamed to `index.html`** --
one self-contained file that needs nothing beside it. Do NOT hand-upload
`dist/index.html` on its own: it names a separate `app.<hash>.js` that would
not be there, and the page would be blank. `npm run deploy:web` handles the
fast two-file version properly, in the right order, with verification.

- `dist/.htaccess` — SPA fallback and the cache rules; without it any deep
  link 404s on refresh, and the bundle is re-downloaded on every visit

Finally, the Android build:

```sh
npm run build:android         # eas build --platform android --profile preview
```

Tag the commit so the APK and the uploaded site are traceable to one revision:

```sh
git tag -a v-$(date +%Y%m%d) -m "web + android" && git push origin --tags
```

`npm run release` chains verify → web → android in one go.

## Two ways a pasted command block goes wrong

Both of these have cost real time, and neither announces itself.

**A trailing `#` comment is not a comment in interactive zsh.**
`INTERACTIVE_COMMENTS` is off by default in an interactive zsh, which is
what macOS Terminal gives you. So this:

```sh
git pull --ff-only origin main          # brings you up to date
```

passes `#` and `brings` and `you` as arguments — `fatal: couldn't find
remote ref #`. The same paste in a script file works fine, which is what
makes it confusing. Commands to be pasted go one per line with the
explanation ABOVE them, never after.

**`git reset --hard HEAD~1` after a successful push only rewinds you.**
An undo offered "before pushing" is not an undo afterwards: the commit is
already on GitHub, and the reset just leaves the local clone a commit
behind the remote. The recovery is `git pull --ff-only origin main`, not a
re-apply of the patch. Read which side of the push you are on before
running an undo.

## Why the site is two files

The site used to be ONE `index.html` with the whole 4 MB bundle inlined,
sent `no-store, no-cache, must-revalidate` with no etag. Measured on a real
Lebanese mobile connection in September 2026: **24.7 s to download, 25.0 s
to first paint, and 19.2 s again on the very next fetch.** Nothing was
cached because nothing could be -- the only file was the one that has to
stay fresh on every release.

They are split so each can have the cache policy it wants:

- **`index.html`** — a ~23 KB shell (~3.4 KB over the wire). Still
  `no-store`, so every visitor gets the newest HTML on every visit, now in
  a fraction of a second instead of twenty-five.
- **`app.<sha256>.js`** — the bundle, named after a hash of its own
  contents and sent `max-age=31536000, immutable`. Fetched once, then
  never again. A release that changes one byte changes the filename, which
  the never-cached shell names, so nobody can be served a stale bundle.
  That is the property the old `no-store` was protecting, kept intact.

A first visit still has to fetch the whole bundle, so it is as slow as it
ever was -- the boot screen is what covers that. What changed is every
visit after it. Shrinking the bundle itself is a separate job; the
measured breakdown is in @NEXT.md (it is almost entirely code -- images are
3 KB of it, which is not what an earlier version of this paragraph said).

### The rule that keeps this safe

`index.html` now NAMES a file instead of containing it, which is a new way
for a deploy to half-work -- and it is the oldest failure this project has:
a page whose script is missing 404s, the SPA fallback used to answer that
404 with `index.html`'s HTML, and the browser dies on `Unexpected token '<'`
with a blank page and nothing in any log.

Two things stop it, and both matter:

1. **`deploy-web.mjs` uploads in two phases.** The bundle, the share image
   and `.htaccess` go up first; the bundle is then fetched back over HTTPS
   and its SHA-256 compared with what was built. Only if that passes is
   `index.html` replaced. A failed deploy leaves the previous release
   serving, whole -- it is a no-op, not an outage.
2. **`.htaccess` 404s a missing asset** instead of falling back to
   `index.html`, so if one ever does go missing the failure is visible in
   the network tab at a glance rather than being a silent blank page.

The site is more than two files now. `dist/` also carries
`fonts/*.woff2` and, since the control room was code-split,
`_expo/static/js/web/*.js` — one chunk per admin screen, referenced by
absolute paths baked into the bundle. All of them ride in phase 1, before
`index.html`, and `asset-manifest.json` is what tells the deploy they
exist: the build writes the list, the upload reads it, nothing is globbed
for. `node scripts/test/deploy-guards.test.mjs` checks that every chunk
path the bundle actually names is one the manifest carries.

A third thing matters and is easy to miss: **every file lands via a
rename**, never written over in place. scp truncates and refills, so a
request arriving mid-upload gets a partial file with an ordinary 200 --
survivable for a `no-store` document, fatal for a bundle sent `immutable`
for a year, because the browser caches the broken copy and a reload asks
for the same URL. Files go to a temp directory and are moved in; a rename
within one filesystem is atomic.

Run the guard test after any change to the build or deploy scripts:

```sh
node scripts/test/deploy-guards.test.mjs
```

It fires the verification against the real failure modes -- HTML served in
its place, a 403 from wrong permissions, a 404, a truncated transfer --
and asserts it refuses each one, then checks against the source that the
gate is still in front of `index.html`. Run it directly, never as an npm
script: adding to `package.json`'s `scripts` block changes the Expo
runtime fingerprint and silently orphans every OTA update.

After the first deploy, confirm the host honours the new rules once:

```sh
curl -sI https://vevaty.com/app.nosuchfile.js | head -1   # want: 404
curl -sI https://vevaty.com/index.html | grep -i cache    # want: no-store
curl -sI "https://vevaty.com/$(node -p "require('./dist/asset-manifest.json').bundle")" | grep -i cache   # want: immutable
```

`[R=404,L]` is documented Apache behaviour and LiteSpeed emulates
mod_rewrite, but the host is LiteSpeed and this is worth seeing once. If
it ever redirected instead, it would only affect URLs that are already
missing, and the browser would say `ERR_TOO_MANY_REDIRECTS` -- loud, not
silent.

**Rollback**, if a deploy ever does go wrong: upload
`dist/vevaty-standalone.html` as `index.html`. It carries the eager bundle
inline, so the whole public site — browse, search, listings, auctions,
chat, posting — works with nothing else on the server.

One honest caveat since the control room was code-split: that file does
**not** contain the admin screens, which are still fetched from
`/_expo/static/js/web/`. After any normal deploy those are already on the
server and never removed, so the control room keeps working too. On a doc
root where phase 1 has never run — a fresh host, a purely manual upload —
the public site is fine and every control-room page shows its retry
screen.

## Notes

- `dist/` is gitignored. Build output is never committed.
- `build-standalone.mjs` inlines every asset the bundle references as a
  data: URI, writes the bundle to `dist/app.<sha256>.js`, and writes a
  matching `dist/index.html` shell plus `dist/asset-manifest.json` naming
  it. It also still writes `dist/vevaty-standalone.html`, the older
  everything-in-one-file form, which is the manual upload and the rollback.
- Lazily-loaded chunks under `dist/_expo/static/js/web/` are **not**
  inlined, on purpose — one per control-room screen (see "Why the site is
  two files" above), plus expo-camera's barcode scanner. The build lists
  them in `asset-manifest.json` and `deploy-web.mjs` uploads and verifies
  every one in phase 1, so there is nothing to do by hand. A chunk that
  referenced anything in `dist/assets/` would fail the build, because that
  directory is not uploaded.
- The EAS free plan caps Android builds per month. Batch changes rather than
  building per fix.
