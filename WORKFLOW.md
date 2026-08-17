# Working on Vevaty — plain English guide

You are not expected to understand the code. This page covers only what you
actually have to do.

---

## The idea in 30 seconds

There is **one master copy** of Vevaty stored online at
`github.com/salamey3/vevaty` — like a shared folder in the cloud.

Your laptop keeps its own copy. It talks to the master copy:

- **`git pull`** = get the latest
- **`git push`** = save your work to the master

Vevaty ships to two places, **both built from that same copy**:

- **the website** — vevaty.com
- **the phone app** — the installed Android app

**Work on the laptop.** The phone is your test device, not a work machine.
Everything below is typed on the laptop.

> **`npm run publish:app` only works on the laptop.** It compiles the code
> into Hermes bytecode locally before uploading, and that compiler is not
> available for Android, so on the phone it fails with "Unsupported host
> platform for Hermes compiler: android". The phone can still `git pull`,
> `git push`, and run `npm run build:android` -- that one bundles on Expo's
> servers rather than on your device.

---

## Which account is which

Two different systems both have things called "vevaty". They are unrelated,
and confusing them cost a lot of time once.

**GitHub — where the code lives.** Everything is under the `salamey3`
GitHub account:

| Repo | Use it? |
|---|---|
| `salamey3/vevaty` (public) | **YES — this is the project.** |
| `salamey3/Vevaty-app` (private) | No. Abandoned early start, one commit. |

**Expo — the service that builds the app.** Two accounts:

| Account | What it is |
|---|---|
| `salamey3` | Personal. Free plan. |
| `vevaty` (organization) | **Holds the paid Starter subscription. The project lives here.** |

The Expo project must be *owned by* `vevaty`, because plans attach to
whoever owns the project. `app.json` records this as `"owner": "vevaty"`.
There is also a leftover project named "Vevaty App" inside that
organization from the same early start — ignore it.

**Nothing needs moving on GitHub.** Only the Expo project was ever
transferred, and that is already done.

---

## The one rule

> **Pull when you sit down. Push before you walk away.**

---

## The two ways changes reach the phone app

This is the part worth understanding, because it saves the most pain.

**1. Publishing an update — `npm run publish:app`**
Takes about a minute. Unlimited. Sends the new code straight to the app
already installed on your phone. Works for almost everything: text, layout,
Arabic, colours, logic, bug fixes.

**2. A full rebuild — `npm run build:android`**
Takes 10–20 minutes and uses one of a **small monthly quota**. Only needed
when something changes deep inside the app — a new camera/maps/notifications
capability, the app icon or name, or an Expo version upgrade.

**Rule of thumb: always use #1. I will tell you explicitly on the rare
occasions #2 is required.** You never have to work this out yourself — the
system also physically prevents a #1 update from reaching an app that needs
#2, so a wrong guess is harmless.

---

## First time only — set up the laptop

**1.** Install **Node.js** (the "LTS" version) from nodejs.org.

**2.** Open a terminal (Mac: *Terminal*. Windows: *Git Bash*, installed with
git from git-scm.com) and run, one line at a time:

```sh
git clone https://github.com/salamey3/vevaty.git
cd vevaty
npm install
```

`npm install` prints a lot and may warn about "vulnerabilities" — **ignore
those**, and never run `npm audit fix --force`; it breaks the project.

**3.** Sign in to the build service, once:

```sh
npx eas-cli login
```

This opens a browser to log in. Nothing else needs installing -- every
command here fetches the build tool on demand via `npx`.

**4.** The first time you `git push`, it asks for:

- Username: `salamey3`
- Password: **your GitHub token** (not your GitHub password)

A token is a long password starting with `ghp_`. Create one at
**github.com/settings/tokens/new** — tick `public_repo`, click *Generate
token*, copy it. GitHub shows it once. Never paste it into a chat.

Run this once so it stops asking:

```sh
git config --global credential.helper store
```

---

## Everyday: the three things

### 1. Get Claude's changes

Claude sends a `.bundle` file. Save it, then:

```sh
cd vevaty
git pull ~/Downloads/NAME-OF-FILE.bundle main
git push
```

The `git push` is what saves it to the master copy. Don't skip it.

### 2. Publish — one command

```sh
npm run ship
```

That's the whole thing. It refuses to ship unsaved work, checks the code
compiles, pushes to GitHub, builds and uploads the website, confirms the
live page matches, and then publishes the app update — stopping at the
first problem.

**The app goes last on purpose.** It's the only step that can't be repeated
cheaply: every publish is one you have to force-stop and reopen the app for.
So everything that might fail happens before it. If the website upload
breaks, the app hasn't shipped and nothing is half-released. Re-running
`npm run ship` after a failure is always safe — every step overwrites rather
than piling up.

The website is verified, not assumed: after uploading it fetches the live
page and compares fingerprints with what you built. You'll see `IN SYNC`.

**Then on the phone:** fully close Vevaty and open it **twice** — the first
open downloads the update, the second runs it. If it seems not to have
landed, use Force stop (long-press the icon → ⓘ → **Force stop**) rather
than swiping it away; swiping often leaves the app running, so it never
gets the fresh start that swaps the update in.

---

### Automatic website upload — one-time setup

Until you do this, `npm run ship` does everything except the website and
tells you to upload `dist/index.html` through cPanel by hand. Fifteen
minutes now removes that step forever.

**1. Make an SSH key on this Mac** (skip if `ls ~/.ssh/id_ed25519.pub`
already shows a file):

```sh
ssh-keygen -t ed25519 -C "vevaty-deploy"
```

Press Enter at all three prompts. The passphrase can be blank — the key
never leaves this Mac.

**2. Show yourself the public half:**

```sh
cat ~/.ssh/id_ed25519.pub
```

Copy the whole line, starting `ssh-ed25519`. This half is safe to share.
The other file, `id_ed25519` with no `.pub`, is the private half — never
copy, send, or paste that one anywhere.

**3. Give it to the host:** cPanel → **SSH Access** → **Manage SSH Keys** →
**Import Key**. Paste it into the *public key* box, leave the private key
box empty, Import. Then click **Manage** next to it and **Authorize**.

**4. Tell the script where to put files:**

```sh
cp deploy.config.example.json deploy.config.json
```

Open `deploy.config.json` and check the values match your account. `port` is
usually 22; ChemiCloud sometimes uses a different one, shown on the same SSH
Access page.

`deploy.config.json` is gitignored — it stays on this Mac and never reaches
the public repo. **No password goes in it.** The SSH key is what proves it's
you.

**5. Test it:**

```sh
npm run build:web && npm run deploy:web && npm run verify:web
```

`IN SYNC` means it worked, and from then on `npm run ship` does the whole
job by itself.

If step 5 asks for a password, the key isn't authorized yet — redo step 3.
If it says `Permission denied`, check `user` and `remoteDir` in the config.
If SSH isn't available on your hosting plan at all, nothing is lost: keep
uploading by hand, and `npm run verify:web` still tells you whether it
worked.

Don't skip this. Opening the site and thinking "that looks right" is not the
same check — a stale upload looks right too, and you find out days later as
a bug that exists on the website and nowhere else.

**And on the phone:** fully close Vevaty and open it **twice** — the first
open downloads the update, the second runs it. If it seems not to have
landed, use Force stop (long-press the icon → ⓘ → **Force stop**) rather than
swiping it away; swiping often leaves the app running, so it never gets the
fresh start that swaps the update in.

#### Doing it by hand

`npm run ship` is just these, in order. Use them individually only if
something is broken and you're working around it:

```sh
npm run verify        # does it compile?
git push              # save to GitHub
npm run build:web     # build the website file
npm run deploy:web    # upload it to vevaty.com
npm run verify:web    # confirm the live site matches
npm run publish:app   # send the update to the phone
```

**Whichever route, do both targets.** If you only do one, the app and the
website drift apart — which is exactly how "it works on the website but not
the app" happens.

### 3. Test on the phone

After `npm run publish:app`, open the app and actually use the part that
changed. Things that work in a browser don't always work in the app —
Arabic layout and the AI photo feature have both broken this way before, and
the only way to catch it is to look.

---

## The rare thing: a full rebuild

Only when Claude tells you. Requires quota, so it gets batched.

```sh
npm run build:android
```

It uploads the project, builds in the cloud (10–20 min), and gives you a link
to install the new app. Install it on the phone, and from then on
`npm run publish:app` works again as normal.

---

## If something goes wrong

**"Authentication failed" / "Invalid username or token"**
Your GitHub token expired or is wrong. Make a new one at
github.com/settings/tokens/new. Tokens expire — expect this roughly every 90
days.

**`npm run publish:app` says "There are uncommitted changes"**
Working as intended — it refuses to send anything not saved to the master
copy. Do:

```sh
git add -A && git commit -m "what changed" && git push
```

then publish again.

**"Unsupported host platform for Hermes compiler: android"**
You ran `npm run publish:app` on the phone. It can only run on the laptop
(see the note at the top). Nothing is broken -- `git push` from the phone,
then `git pull` and publish on the laptop.

**The phone doesn't show the update**
Fully close the app (swipe away from recents), open twice. If it still
doesn't appear, the change likely needs a full rebuild — send Claude what you
changed.

**cPanel: "over its quota or you attempted to upload a folder"**
Almost always the **"Overwrite existing files"** checkbox wasn't ticked.

**The website doesn't show my change**
In order: did you `git pull`? did you run `npm run build:web` *after*
pulling? did you upload the freshly built file, not an older copy still in
Downloads?

**`git pull` says "divergent branches"**
Run `git pull --rebase`.

**A build says "used its Android builds from the Free plan"**
Expo is checking the wrong account. It means the project is not owned by
the `vevaty` organization — the one with the subscription. Check
`app.json` still says `"owner": "vevaty"`, and that the project on
expo.dev sits under the Vevaty organization rather than salamey3.

**Anything else** — screenshot the terminal and send it. The error text is
the useful part.

---

## What the words mean

| Word | Plain meaning |
|---|---|
| **repository / repo** | The project folder plus its full history |
| **GitHub** | The website holding the master copy |
| **clone** | Download the project to a machine the first time |
| **pull** | Get the latest changes |
| **push** | Send your changes to the master copy |
| **commit** | Save a snapshot with a note about what changed |
| **bundle** | A file Claude sends with changes; you `git pull` it |
| **token** | A long password (`ghp_…`) proving you're you to GitHub |
| **publish / update** | Send new code to the already-installed app (fast) |
| **build** | Make a whole new app file (slow, limited) |
| **channel** | Which group of phones an update goes to — ours is `preview` |
| **terminal** | The text window where you type these commands |
| **dist/** | Freshly built website output. Never edit by hand |

---

## Quick reference

| I want to… | Command |
|---|---|
| Start working | `git pull` |
| Take Claude's changes | `git pull <file>.bundle main` then `git push` |
| Check for mistakes | `npm run verify` |
| Send to the phone app | `npm run publish:app` |
| Send to the website | `npm run build:web` → upload `dist/index.html` |
| Save my work | `git add -A && git commit -m "note" && git push` |
| New app build (rare) | `npm run build:android` |
