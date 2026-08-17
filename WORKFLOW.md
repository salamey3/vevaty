# Working on Vevaty — plain English guide

You are not expected to understand the code. You need four things to work,
and this page is only about those four.

---

## The idea in 30 seconds

There is **one master copy** of Vevaty, stored online at
`github.com/salamey3/vevaty`. Think of it like a shared folder in the cloud.

Your laptop and your phone each keep their **own copy**. They do not talk to
each other. They both talk to the master copy:

```
        laptop  ⇅
                  master copy on GitHub
        phone   ⇅
```

- **Download from master** = `git pull` ("get me the latest")
- **Upload to master** = `git push` ("save my work for everyone")

Vevaty ships to two places, and **both are built from the same copy**:

- **the website** (vevaty.com) — you build one file and upload it
- **the phone app** — a build service (EAS) makes the installable app

---

## The one rule

> **Pull when you sit down. Push before you walk away.**

Do that and switching between laptop and phone always just works. Skip it and
the two copies drift apart, which is the only thing here that gets messy.

---

## First time only — set up the laptop

Do this once. The phone is already set up.

**1.** Install **Node.js** — the "LTS" version — from nodejs.org. That's the
only thing you need to install.

**2.** Open a terminal (Mac: *Terminal*. Windows: *Git Bash*, which comes
with git from git-scm.com) and run these one at a time:

```sh
git clone https://github.com/salamey3/vevaty.git
cd vevaty
npm install
```

- `git clone` downloads the master copy to your laptop.
- `npm install` downloads the building blocks the app is made of. It prints a
  lot and may warn about "vulnerabilities" — **ignore those warnings**, and
  never run `npm audit fix --force`; it breaks the project.

**3.** The first time you ever `git push`, it asks for a username and
password:

- Username: `salamey3`
- Password: **your GitHub token**, not your GitHub password

(A token is a long password that starts with `ghp_`. Make one at
**github.com/settings/tokens/new** — tick the box `public_repo`, then
*Generate token*, and copy it. GitHub shows it only once. Never paste it into
a chat.)

Run this once so it remembers the token and stops asking:

```sh
git config --global credential.helper store
```

---

## The four things you will ever do

### 1. Get Claude's latest changes

Claude sends a `.bundle` file. Save it, then:

**On the laptop**

```sh
cd vevaty
git pull ~/Downloads/NAME-OF-FILE.bundle main
git push
```

**On the phone**

```sh
cd ~/vevaty-app
git pull ~/storage/downloads/NAME-OF-FILE.bundle main
git push
```

The `git push` matters — that's what saves it to the master copy so your
other device can get it too.

### 2. Put the changes on the website

Nothing reaches vevaty.com by itself. You have to build and upload it.

```sh
git pull
npm run verify
npm run build:web
```

- `verify` checks the code for mistakes. **If it shows an error, stop** and
  send Claude the message — do not upload.
- `build:web` creates the website as a single file: `dist/index.html`
  (about 2.6 MB).

Then upload it:

1. Log in to cPanel → **File Manager**
2. Open the folder **`vevaty.com`** — the full path is
   `/home/yousifs1/vevaty.com`
   ⚠️ **Not `public_html`.** That folder is a different website.
3. Tick **"Overwrite existing files"** — do this *before* choosing the file
4. **Upload** → choose `dist/index.html` from your vevaty folder
5. Open vevaty.com and check your change is there

**Do this from the laptop when you can.** Phone browsers are unreliable at
uploading files this size.

### 3. Put the changes in the phone app

Only the phone does this.

```sh
cd ~/vevaty-app
git pull
npm run verify
npm run build:android
```

It uploads the project and builds it in the cloud, then gives you a link to
install the app. Takes 10–20 minutes.

⚠️ **The free plan allows only a few builds per month.** Don't build for one
small fix — collect several changes, then build once.

### 4. Switch between laptop and phone

Before you stop working on one:

```sh
git add -A
git commit -m "short note about what changed"
git push
```

When you pick up the other:

```sh
git pull
```

That's the whole handover.

---

## If something goes wrong

**"Authentication failed" / "Invalid username or token"**
Your token is wrong or expired. Make a new one at
github.com/settings/tokens/new and push again. Tokens expire — this will
happen every 90 days and is normal.

**cPanel: "Your account may be over its quota or you attempted to upload a
folder"**
Almost always means the **"Overwrite existing files"** checkbox wasn't
ticked. Tick it and upload again.

**The website doesn't show my change**
Almost always one of the three steps was skipped. In order: did you
`git pull`? Did you run `npm run build:web` *after* pulling? Did you upload
the freshly built file rather than an older copy still sitting in Downloads?

**`git pull` says "divergent branches" or refuses**
You committed on both devices. Fix:

```sh
git pull --rebase
```

**Anything else**
Screenshot the terminal and send it. The error text is the useful part.

---

## What the words mean

| Word | Plain meaning |
|---|---|
| **repository / repo** | The project folder, with its full history |
| **GitHub** | The website holding the master copy |
| **clone** | Download the project to a machine for the first time |
| **pull** | Get the latest changes |
| **push** | Send your changes to the master copy |
| **commit** | Save a snapshot, with a note about what changed |
| **bundle** | A file Claude sends containing changes; you `git pull` it |
| **token** | A long password (`ghp_...`) that proves you're you to GitHub |
| **build** | Turn the code into something usable — a website file or an app |
| **terminal / Termux** | The text window where you type these commands |
| **npm** | The tool that fetches the building blocks the app needs |
| **EAS** | Expo's cloud service that builds the Android app |
| **dist/** | The folder holding freshly built output. Never edit by hand |

---

## Quick reference

| I want to… | Command |
|---|---|
| Start working | `git pull` |
| Get Claude's bundle | `git pull <path-to-file>.bundle main` then `git push` |
| Check for mistakes | `npm run verify` |
| Build the website | `npm run build:web` → upload `dist/index.html` |
| Build the app | `npm run build:android` (phone only) |
| Finish working | `git add -A && git commit -m "note" && git push` |
