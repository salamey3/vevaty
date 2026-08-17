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

### 2. Publish

Always check first:

```sh
npm run verify
```

If that reports an error, **stop and send it to Claude.** Do not publish.

**To the phone app:**

```sh
npm run publish:app
```

Then on the phone: fully close Vevaty (swipe it away) and open it **twice** —
the first open downloads the update, the second runs it.

**To the website:**

```sh
npm run build:web
```

Then:

1. cPanel → **File Manager**
2. Open the folder **`vevaty.com`** (full path `/home/yousifs1/vevaty.com`)
   ⚠️ **Not `public_html`** — that's a different website.
3. Tick **"Overwrite existing files"** *before* choosing the file
4. **Upload** → `dist/index.html` from your vevaty folder
5. Open vevaty.com and confirm your change is there

**Publish to both.** If you only do one, the app and the website drift apart —
which is exactly how "it works on the website but not the app" happens.

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
