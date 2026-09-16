# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**The tester round is built, and not switched on — see @TESTERS.md.** The
database half is live (10 Sep 2026, every function test-fired in a
rolled-back transaction); the app half is the invite step and waitlist at
sign-up, the Report a problem tab, and Admin → Tester centre and Problem
reports. Sign-up is still open to everyone, so nobody's experience changes
until the switch in the Tester centre is flipped. The one rule already live
for everybody: posting, starting a chat and seeing a seller's number need a
verified member, which every real account already is. Before the first
invite goes out, in this order:

1. **Tap through it on the phone once it has shipped.** Admin → Tester
   centre: create an invite for yourself, "Send invite" to your own
   WhatsApp, then cancel it. Then the two forms (Tester centre → Forms):
   "Send link" for Vevaty Tester Onboarding to your own WhatsApp, open it
   on the phone, fill it in once in Arabic, and Remove your answer; send
   one Testers Report from Profile and Delete it; download both Excel
   files on the computer and open them. The admin account gets the flag tab too (right
   edge, a little below the middle): send one report with a screenshot and
   find it under Admin → Problem reports. On the Android phone, type enough
   to fill the box with the keyboard up and check Send can still be
   reached — the sheet is its own window, and whether it moves for the
   keyboard there has not been seen yet.
2. **(DONE 10 Sep) The seven live listings are hidden for the round** —
   four on the admin account, three on the account created 1 Sep, at
   Yousif's request, so testers start on an empty site. Each went to
   `status = 'draft'` with its moderation verdict kept, and each is logged
   in `admin_actions` as `hide_listing_for_tester_round`. To bring them
   back after the round (they get a fresh expiry window as they leave
   draft):

   ```sql
   update myazar.listings set status = 'active'
    where status = 'draft'
      and id in (select (details->>'listing_id')::uuid
                   from myazar.admin_actions
                  where action = 'hide_listing_for_tester_round');
   ```

   What testers post goes live on the public website like any other
   listing — flagged `is_test` in the database, with nothing on screen
   saying so.
3. **A fresh Android build for the testers' install link** — decided 10
   Sep, made AFTER this patch and the admin sign-in move (see Recently
   done) have shipped and been checked on the phone, so the app testers
   install already carries both. The last APK was built 31 Aug
   and its link lives about thirty days. Nothing here moves the fingerprint,
   so the new build and the installs already out there take the same
   updates.
4. **Only then** switch sign-up to invite-only and send the invites.

**Arts & Crafts is live and its choices are built**, 13 Sep 2026. The
category went on that morning; the choices half — the seller's groups with
prices, the buyer's chooser and running total, and the order card in the
chat — is the patch after it. What is left of that thread:

1. **Post one handmade listing yourself and order from it.** Build a Size
   group and an Add-ons group with a per-order delivery charge, then open
   the listing on the other account, pick, set a quantity above one, and
   send. The number on the chooser and the number on the card in the chat
   must be the same number, and the delivery must be charged once.

Found on the way and deliberately not fixed here:

- **The "admin identity requires mfa" policies are dead weight.** They
  count rows in `auth.mfa_factors`, which a signed-in session cannot see, so
  they never required anything; what they were for is done properly now by
  the admin lock (@ACCOUNTS.md, "The admin lock is the server's"). Dropping
  them is a tidy-up, not a fix — but mind @MEDIA.md: their subquery is also
  why `anon` cannot read `listings` at all, so dropping them changes what a
  signed-out visitor can read.
- **A seller can switch `is_test` off their own listing** (added this
  morning with the invites; table-level UPDATE on `listings`, nothing
  guarding the column), which is what the end-of-round clean-up trusts. No
  screen writes it. A guard trigger in the style of
  `guard_posting_points_awarded` closes it.
- **Check that phone sign-ups need the text message.** Membership now rests
  on `auth.users.phone_confirmed_at`, which Supabase sets without an OTP if
  phone confirmation is switched off in the Auth settings. One look in the
  dashboard.
- **`profiles.phone` is still directly writable by its owner** — the
  number buyers are shown. Change phone number is the OTP-verified way to
  move it; a console can skip that. Same shape as `profiles.points` below.
- **Collection link previews have not been built since the move to the new
  database.** `build-og.mjs` still points at the old Supabase project
  (`ueqfkxvvfrhppdsnsfpx`), so every ship prints "could not fetch
  collections for OG snippets" and skips them. Pointing it at the project
  in `src/lib/supabase.ts` is one line, but it switches back on a step
  that has not run since 27 Aug and whose failure stops the ship — do it on
  its own, with a ship somebody is watching.
- **Leaving the admin panel is rougher than it looks.** All older than
  the admin sign-in move of 10 Sep, but the Admin row on Profile now makes
  the panel something a phone signs in to:
  - A device signed in to the panel stays signed in to it until "Sign out
    of admin". Since 11 Sep it cannot be used past the lock time without
    the code, but a phone, whose authenticator is usually on the same
    phone, should still sign out of admin when done. (Since 10 Sep that
    signs out this device only; the member Log out still signs out every
    device — worth one decision.)
  - "Sign out of admin" skips the clean-up the member Log out does, so the
    guest session that follows writes the admin's cached name, district,
    points and tier into a fresh guest profile row (the insert in
    `syncFromSupabase`). The lock screen's "Not you? Sign out" does the
    same. A SIGNED_OUT branch in
    AppStore's auth listener that forgets the local account would cover
    every way of being signed out at once.
  - Offline with an expired session token, "Sign out of admin" and the
    lock's "Not you? Sign out" act as though they worked and do not: the
    client cannot sign out without reaching the server first, and
    `adminSignOut` ignores the error it gets back. It should say so and
    keep the lock up.
  - Setting up an authenticator from the phone app shows the text key but
    no QR code: the code arrives as an SVG, which React Native's `Image`
    does not draw. Set one up on the website.
- **`moderate-listing` judges what the caller sends, not what is stored.**
  It asks the AI about the photos, title and description in the request
  body, then approves the listing by id — so a seller could send harmless
  photos and text and publish something else. It should load the listing's
  own stored photos and text (it already reads the row) and judge those.
  Found while checking the edge functions for admin checks, 11 Sep.
- **Switch on "secure password change" in Supabase Auth.** A signed-in
  session — an admin's locked one included — can change the account's
  password through the auth server without the old one. The setting asks
  for recent sign-in first. A dashboard switch, no code.
- **Every launch runs the settings refresh twice, side by side** — once
  from SettingsStore's first-mount effect and once from the auth
  listener's INITIAL_SESSION — so categories, attributes and site settings
  are fetched twice and two admin checks overlap. Since 10 Sep only the
  newer check may write (so a slow one from an earlier session cannot
  undo a sign-in), which leaves one rare case: if the newer check's read
  fails while the older one's succeeded, an admin reloading an admin page
  gets the sign-in form. Letting a refresh that arrives mid-flight run
  once more afterwards, instead of alongside, fixes both.

**Card previews: three loose ends from the spin thumbnails change** (found
10 Sep while checking it, put aside for the tester round):

- **Editing a listing throws away its 360's small copies.** Every save from
  Edit — a price change included — rewrites all of a listing's spin frames,
  and `writeSpinSets` gives every frame it keeps its own full-size address
  as its thumbnail, so one edit sends that card's preview back to
  full-size frames. The edit form already carries the real thumbnails
  (`previewFrames`); `writeSpinSets` never takes them. Contained fix.
- **The seller's own card can preview stale photos.** Reorder or swap photos
  in Edit while keeping the same count, and the seller's own device can
  preview the old order, or a removed photo, until the app restarts. A
  retaken 360 does the same while it uploads. Buyers are unaffected.
- **Auction lots built from scratch in admin upload their 360 with no small
  copies.** Auctions are switched off, so no rush.

**Listing domains, step 4: Jobs & Services — see @DOMAINS.md.** Only when
there is an actual intention to launch them, and with real thinking about
salary ranges and hourly pricing rather than a guess made now. Steps 1
(domains as data), 2 (posting) and 3 (browsing, banners included) are all
done — every decision in that document is now built.

Two things worth fixing:

- **The listing lifecycle has two pieces left.** The expiry engine, the
  contact log and the buyer-side "did you reach the seller?" prompt are
  all in (see @LIFECYCLE.md). Still to build: a passive "no longer
  available?" flag for buyers who never made contact at all, and the
  `kind = 'system'` message posted into the buyer's own chat thread, which
  is the chat-side equivalent of the prompt. Neither is urgent -- the
  prompt covers the case that actually loses buyers.

- **Two things about the new registration form need a real tap.** Sign up
  with a fresh number and confirm the profile lands complete — name, email,
  WhatsApp number and consent flag all written the moment the OTP verifies,
  not on a screen after it. Then open a listing as a buyer and confirm the
  WhatsApp button opens the seller's *nominated* number rather than their
  account phone. Both are new writes and neither has been exercised against
  the real endpoint. See @ACCOUNTS.md.

- **Auctions: walk one through on a real device.** The SERVER side is
  now thoroughly exercised — several full sales have run end to end against
  the live database, including a ten-bidder war over two luxury lots that
  opened, escalated through twenty bids, met both reserves, closed on the
  clock and produced its settlement figures. What has still not happened is
  a sale driven by hand THROUGH THE SCREENS on a phone: build a lot from
  scratch with photos, a 360 and a video, publish, register a card, bid,
  watch the outcome popup arrive. The feature is off behind
  `site_settings.auctions_enabled`, which is what has to be switched on for
  any of it to be visible to a buyer, and it is still `false`.

- **Auctions: the demo scaffolding is PARKED, not gone.** Done 8 Sep 2026,
  ahead of closed testing. The `demo-bids` cron is unscheduled — it had
  been firing `play_demo_bids()` every minute, which would have shown a
  tester lots bidding themselves. `play_demo_bids()` had `EXECUTE` granted
  to PUBLIC, so any signed-in caller could place bids on other people's
  behalf with no cron involved; that is revoked. The twenty prop bidders
  (`dddddddd-0000-4000-a000-000000000001` through `…020`) are suspended
  and phone-unverified.

  Two things worth knowing about that. `myazar.demo_bid_script` and
  `play_demo_bids()` were deliberately KEPT — they hold nothing live, and
  dropping a function to tidy up is how a body gets lost, which this
  project has already paid for once with `add_auction_lot`. Every step is
  one line to reverse; the migration
  `park_demo_bidding_scaffolding` carries each undo in a comment beside
  the thing it undid.

  And the reason both flags were set: **suspension alone would have done
  nothing.** `place_bid` does not look at `is_suspended` at all — it only
  requires a registration — and `register_for_auction` checks
  `is_phone_verified` but not `is_suspended` either. Clearing the phone
  verification is what actually closes the chain.

- **A suspended account can still bid.** Found while parking the demo
  bidders, and it is a real gap rather than a leftover: neither
  `register_for_auction` nor `place_bid` checks `is_suspended`, so an
  account suspended AFTER it registered for a sale can go on bidding in
  that sale until the lot closes — and win it. Harmless today, since the
  only suspended accounts are props with no registrations, and squarely
  not harmless the first time somebody is suspended for a reason. One
  check in each function.

- **Auctions: what is genuinely not built.** Settlement is the big one, and
  it is now HALF built: what each side owes is computed and shown to the
  cent, live while the sale runs and settled once it closes
  (`myazar.lot_settlement`, the books panel on the monitor). What does not
  exist is anything that MOVES that money — charging the buyer's saved
  card, issuing an invoice, paying the seller out — and that is waiting on
  a real payment provider rather than on design. Then OUTBID notifications --
  a won/lost/unsold announcement now goes out on close (popup, chat and an
  SMS to the winner, see @AUCTIONS.md), but nothing tells a bidder they have
  been outbid while the lot is still running, which is the one that actually
  brings people back; a seller submission queue (v1 has the admin
  creating every lot, which is how the first few will really run); category
  attributes on a from-scratch lot, so its card has a spec row; and a
  terminal listing status for a settled lot, which currently sits at
  `'auction'` and stays publicly readable for ever. @AUCTIONS.md carries
  the reasoning for each.

- **The home carousels scroller is not virtualised, and cards just got 60%
  wider.** `renderCarousels` mounts every section on the page at once -- it
  was un-virtualised deliberately, because a windowed list re-mounted each row
  every time it scrolled back into view and that cost landed on the swipe.
  That was affordable at a 192px card asking for a 200px photo. A carousel
  card is now one grid card wide, so it asks for 320 on a 390pt phone and up
  to 400 at two or three columns, which is
  about 2.2MB of decoded bitmap per card there against 0.85MB before, and
  ~2.8MB on a 412pt Android where the request rounds up to 360. A
  six-category domain page holds six rows of six. Only seeded picsum
  listings are affected -- a real upload's thumbnail is baked at 640
  and Bunny returns exactly that -- so this is not urgent, and it is also not
  something to discover on a mid-range phone later. See @CARDS.md.

- **The storefront pill sits on the wrong edge in Arabic on the web.**
  `storefrontPillRTL` uses `alignSelf: 'flex-end'`, and on the web the
  document already carries `dir="rtl"`, so the cross axis is reversed and
  `flex-end` resolves to the left. Same web-versus-native divergence
  `mirrorRow` exists for, in a style `mirrorRow` cannot express. Pre-dates the
  card rebuild and was left alone rather than widened into it; the app is
  unaffected, only Arabic web.

- **Card specs are numbered everywhere they can be** (6 Sep) — every
  category that has attributes now has a card spec row. What follows is the
  older note, kept for the reasoning behind curating them by hand rather
  than guessing:

- **(DONE 6 Sep) Around sixty categories still have no card specs curated.** Listing
  cards show up to three specs chosen per category (@CARDS.md). Properties,
  Vehicles, Pets and Fashion were done in their own overhauls, and the 5 Sep
  specs pass numbered its own twenty-seven as it went. Everything else shows
  no spec row until someone numbers its fields in Admin -> Categories ->
  Attributes -> "On the listing card". That is deliberate -- the old guess
  was wrong more often than it was right -- but it means a good part of the
  catalogue still shows less on a card than it could. Electronics is the one
  worth doing first: it has plenty of attributes already and none of them are
  numbered.

- **Nothing has confirmed the VV001 path by hand.** When a seller taps
  Restore on an auto-hidden listing that has not passed moderation, they
  should read "This listing has to be reviewed before it can go back on
  the site", not "please try again". Everything says PostgREST surfaces
  the custom SQLSTATE as `error.code`, but it was never exercised against
  the real endpoint. One tap confirms it.

- **The app has not had a native build since 26 Aug** — over a week now.
  Everything since has reached the installed app over the air, which is why
  it has not bitten -- the fingerprint was restored rather than rebuilt
  around, so updates reach it again (see @AGENTS.md, "What forces a new
  native build"). But the installed app is several months of native config behind
  whatever it will be built from next, and that gap is only discovered the
  day something genuinely native changes. Worth a build on a quiet day
  rather than an urgent one.

## After that

The category-specs list that used to live here is finished — see "Every
category has specs now" below. What is left of that thread is smaller and
of a different kind:

- **Card specs are curated for the sections that have been through a specs
  pass, and nowhere else.** Every category done in an overhaul got its
  `card_priority` numbers set at the same time, so its cards show a spec
  row. The categories that already had attributes from before the card
  feature existed — Electronics above all — still show nothing until
  someone numbers their fields in Admin → Categories → Attributes → "On
  the listing card". See @CARDS.md.

- **A few categories may still carry a duplicate Condition spec.** Two
  have been found and removed so far (Watches during Fashion, Books
  during the last pass): an attribute-level `condition` field left over
  from before `categories.condition_mode` existed, which shows a seller
  two different condition pickers on one form. Worth one query across the
  whole table rather than finding the third by accident.

Jobs and Services are deliberately not on this list: they are step four of
the domains work, and both are `active = false` until then.

## Recently done

**The website stopped re-downloading itself**, 15 Sep 2026. vevaty.com was
ONE `index.html` with the whole 4 MB bundle inlined, sent `no-store` with
no etag. Measured on a real Lebanese mobile connection: 24.7 s to
download, 25.0 s to first paint, and **19.2 s again on the very next
fetch** -- nothing was cached because nothing could be. It is now a 23 KB
shell (3.4 KB over the wire) plus `app.<sha256>.js` cached for a year as
immutable. The shell stays `no-store`, so everyone still gets the newest
HTML on every visit; the bundle's name changes whenever its contents do,
so nobody can be served a stale one. See "Why the site is two files" in
@DEPLOY.md.

Said plainly because it matters for the tester round: **a FIRST visit is
exactly as slow as it was.** The bundle still has to arrive once. What
changed is every visit after it, which is most of them. The 67 KB share
image also moved out of the HTML into a real file, which is two thirds of
what the shell used to weigh.

The risky part was never the split, it was the deploy: `index.html` NAMES
a file now, and a page whose script is missing is a blank screen with
nothing in any log -- the same failure as the interrupted build and the
2026-08-21 permissions incident. So `deploy-web.mjs` uploads the bundle
first, **fetches it back over HTTPS and compares its SHA-256** with what
was built, and only then replaces `index.html`; a failed deploy leaves the
previous release serving, whole. `.htaccess` 404s a missing asset instead
of answering it with `index.html`, so the failure is loud if it ever
happens. Every file also lands via a RENAME rather than being written over in
place -- scp truncates and refills, and a bundle sent `immutable` cannot
survive a visitor caching half of one. `scripts/test/deploy-guards.test.mjs`
fires the verification against HTML-in-its-place, a 403, a 404 and a
truncated transfer, asserts it refuses all four, and checks against the
source that the gate is still in front of `index.html` -- that last one was
mutation-tested by committing the regression and watching it fail.

What is left of this thread, in order of what it would buy:

- **CORRECTION, 15 Sep 2026:** the line that used to sit here said most of
  the 4 MB was images inlined as data: URIs. That was wrong, and measuring
  rather than assuming is the only reason it did not send the next person
  chasing the wrong thing. Images are **3 KB** of it. Measured breakdown of
  a first visitor's ~1.05 MB (gzipped): fonts 162 KB, the Lebanon gazetteer
  133 KB, both languages of every string 63 KB, and ~716 KB of app code and
  libraries. The fonts are done (below). What is left:

- **The Lebanon gazetteer, 133 KB.** `src/data/lebanonPlacesData.ts`, 3,712
  towns, needed only when someone is choosing a location -- but used
  SYNCHRONOUSLY while listing cards render, in eight files, with lookup
  maps built at module load. Note for whoever picks this up: compacting the
  data is not the answer. Re-encoding it as positional arrays with interned
  governorate/caza names saves 383 KB raw and **15 KB gzipped**, because
  gzip already eats the repetition. It has to be genuinely deferred to be
  worth anything.

- **Both languages of every string, 63 KB**, of which about half is ever
  used by a given visitor. Low payoff and `t()` is synchronous everywhere,
  so this is the worst risk-to-reward of the three.

**The fonts left the code, and the control room loads on demand**, 15 Sep
2026. Two changes in one night, measured at every step:

- 215 KB of base64 Inter and Almarai moved out of `src/theme/fonts.ts` into
  six real `.woff2` files in `public/`, cached a month, preloaded from the
  shell for the two weights the landing screen actually renders in (400 and
  600 — measured by driving a browser at the built site and reading
  `document.fonts` back, not guessed).
- The 18 control-room screens are registered through `lazyAdminScreen()`
  and fetched the first time they are rendered. The gate is what makes it
  safe: `adminOnly()` returns the sign-in without rendering the page, so a
  member who types `/control-room/branding` never causes the code to be
  requested at all. 17 chunks come out, not 18 — `AdminAuctionsScreen`
  exports something `AdminAuctionLotsScreen` imports, so Metro hoisted it
  into the eager shared chunk. It works; it just still ships to everyone.

First visit over the wire, English: **1,078,657 -> 905,086**, a 16% cut,
about four seconds on the connection this was measured on. The bundle
alone is 221 KB smaller, so every future release costs a returning visitor
that much less too.

Deliberately admin-only. The auction and batch screens are the obvious
next candidates and are NOT done, because those are screens testers are
about to use on Lebanese mobile connections, where a failed chunk is a
broken screen rather than an inconvenience for the one person who can fix
it. The pattern is proven now; widening it is a decision, not a chore.

One thing was NOT exercisable in the sandbox: an actual signed-in admin
rendering one of those lazy screens, since that needs the admin password.
Everything around it was — the chunks are valid JS, every path baked into
the bundle is in the manifest the deploy uploads, and a control-room URL
renders the gate without fetching anything. **Open the control room once
after shipping this.**
- **A missing bundle shows the boot screen for 40 s and then a blank
  page.** Measured, not guessed. The deploy now makes that nearly
  impossible, but an honest error after the fallback fires would be better
  than nothing.
- **`build-og.mjs` still points at the wrong Supabase project**
  (`ueqfkxvvfrhppdsnsfpx`, the older one) while the app runs on
  `ajrrmropskvutjizulkb`. Collection share previews are built from the
  wrong database.

**Vevaty can be found, once the door is opened**, 16 Sep 2026 — see
@SEO.md. The site had no robots.txt, no sitemap, no structured data
anywhere, and listing URLs that existed only inside a JavaScript bundle.
Google was not failing to render the listings; it had never been told they
exist. Now: a sitemap generated live from the database, per-listing pages
that carry the title, price, photo and schema.org Product data before any
JavaScript runs, and a robots.txt that keeps all of it shut until there is
something worth indexing.

**The door is the whole point.** Thirteen listings, most of them tests, is
not what Vevaty wants Google's first impression to be. One line in
`public/robots.txt` opens it when the tester round is done.

Both pages are PHP on the existing cPanel host — not a rewrite, two files.
The deploy proves PHP actually executes before it will upload an .htaccess
that routes real URLs into them, because the failure mode otherwise is
every listing page serving PHP source as text.

Also fixed here, outstanding since 12 Sep: `build-og.mjs` was pointed at
`ueqfkxvvfrhppdsnsfpx`, a different and older Supabase project, while the
app has always run on `ajrrmropskvutjizulkb`. Every collection link
preview WhatsApp and Facebook have ever shown was built from the wrong
database.

**The public site depended on a session it does not need**, 15 Sep 2026.
Anonymous sign-ins were switched off at the Supabase project some time
around 13 Sep, and `ensureSession()` throws when `signInAnonymously` is
refused. Two things sat behind that throw: the browsable-listings fetch
(inside `syncFromSupabase(uid)`, which only runs `if (uid)`) and
`SettingsStore.refreshFromSupabase`, whose `await ensureSession()` is the
first line in its try -- so categories, domains, attributes and
`site_settings` were all abandoned with it, silently. A logged-out visitor
got the bundled `DEFAULT_CATEGORIES` and no listings at all. The toggle is
back on, but **the fragility is still there**: RLS already lets the `anon`
role read active listings and categories, so the public browse should not
be gated on holding a session. Worth a patch so the failure mode is
"favourites don't work" rather than "there is no marketplace".


**Shop stock, stages 1 and 2 of 4**, 14 Sep 2026. The second kind of shop — the
one that buys in bulk and sells the same shirt in four sizes and three
colours — had nowhere to keep a number. It has one now: a size × colour
table on the posting form, and on the shop's own listing a counter with a
minus button, "a delivery came" and "I counted them".

Everything about it follows from one fact: **Vevaty never sees the money,
so nothing can tell the app a sale happened.** A number only moves because
a person said so, which makes saying so almost free (one tap) and makes
ADD and SET different verbs that never share a control. See @AGENTS.md,
"A quantity nobody can post", before touching any of it.

Five migrations, each test-fired in a rolled-back transaction:
`myazar.listing_variants` and `stock_movements` with `stock_move` /
`stock_count` / `stock_move_many` (the row is locked, going below zero is
refused rather than clamped, and every change is filed with who made it);
a second `variant_rank` so a category can break stock down two ways
instead of one; and `hold_stock_total`, a trigger that quietly replaces
any `stock_qty` the app sends with the true sum, so no screen can put a
stale total on a card. Then, for stage 2: `send_stock_order`, which prices
the row, refuses more than there are, and freezes the size and colour into
the message as words in the buyer's own language; and
`stock_sold_from_order`, the seller's one tap.

**Stage 2 is the buyer's half, and it ships in the same patch.** The buyer
picks a size and a colour; combinations the shop never made are absent,
ones it has sold out of are shown and marked, because "M is out until
Friday" is what they came to find out. Picking a colour moves the gallery
to that colour's photo — which the shop tags on its own listing, where
every picture is already hosted, and not in the posting form, where a
first post's gallery is still on the phone when the listing saves. The
buyer's pick goes into the chat as an order card naming the exact one
("Size: M, Colour: Navy"), and the seller gets one tap on that card:
**Sold — take 2 off**.

That tap is the only thing in the whole system that can tell the app a
sale happened, which is why it sits next to the conversation where the
sale was agreed rather than three screens away. It files the movement
against that exact message, and a unique index means a second tap, a
double-tap or a second device can only ever move the stock once.

Nothing is reserved when an order is sent — an order is a question, and
holding stock against a question takes a shirt off the site for somebody
who never came back. So the listing refuses to send a *second* order for a
row it has already asked about: two orders are two sales, and no index can
tell them apart.

Still to come, in order: **Stage 3**, the shop's day — a morning "needs
you" list, a restock screen, search by code, and "tell me when it's back".
**Stage 4**, staff accounts: invite by phone, a stock-only role, and
per-person history (which the `actor_id` column already records).

Nothing in either stage touches the one-of-a-kind shop: a listing with no
stock table is untouched by all of it, and a private seller never sees any
of it.

**Shop stock, stage 4: a shop can be run by more than one person**,
15 Sep 2026. The last of the four. Until now "the shop" and "the person
who signed up" were the same row -- every stock function asked whether the
listing's seller was you -- and a real shop has somebody behind the counter
who is not the owner, standing exactly where stock moves.

An owner adds people by PHONE NUMBER, and the invite can be written for
somebody who has never opened Vevaty: it waits, and finds them when they
sign up. They get the whole counter -- deliveries in, taking stock off,
correcting a count, and answering buyers in the shop's chats. They do not
get anything that changes what the shop SELLS: the storefront, the
listings, the size-and-colour table. One shop per person, owner or staff,
because every shop screen resolves "my shop" without being told which.

What the buyer sees is unchanged, and that was worth checking rather than
assuming: the chat header is named from the listing's seller and each
message is drawn from its sender id, so an assistant's reply reaches the
buyer under the shop's name while the database still records who typed it.

Every stock verb already funnelled through one function, `can_manage_stock`,
so the counter was one line to widen -- and that turned out to be the
danger. Three things it reached that it should not have, all caught before
shipping: `save_listing_variants` asked the same question and PARKS every
row it is not sent, so staff could have wiped a listing's sizes; a staff
member could create their own shop and silently stop being staff while the
row still said they were; and a second shops row for one owner, previously
cosmetic, would now abort the whole chat read because the resolver sits
inside a policy.

The review found worse, and it is the lesson worth keeping. The invite
matched the number against `myazar.profiles.phone` -- and that column is
writable by its own row's owner, so anyone could type an invited number
onto their profile and walk in. Since every visitor gets an anonymous
session that can insert its own profile row, it did not even need an
account. Proved end to end, then fixed by comparing against
`auth.users.phone` with `phone_confirmed_at`, which only the SMS can set.
Also found: the four widened chat policies were dead code, because the
client still filtered threads with a hand-written copy of the old rule.

Still to do on this thread: the shop-wide "who did what" list and the same
history on each item. `stock_movements.actor_id` has been recording it
since stage 1, so both are read-side only.

**Items stop running together, and Profile grows a business drawer**,
15 Sep 2026. Two things off one look at the phone.

Every item on both shop screens sat inside ONE bordered card with hairline
rows, which is the same treatment that separates an item's own sizes from
each other — so a folded item's heading ran straight into the next item's
row and the two read as one thing. Each item now has its own card with air
between, and the row separator moved from "a line under every row" to "a
line above every row after the first", so the last row in a card has
nothing hanging under it against the card's edge.

Folding a shut item's border onto the card wrapper turned out to be the
wrong half, and the reason is worth keeping: `Pressy` scales the element
it is on. A border left on the wrapper stays put while the pressed head
shrinks out from under it, and a shut item's card IS its head — so every
tap hollowed the whole card out. The border now lives on the head while
shut and moves to the wrapper when open. The tint moved the same way: shut,
every card would be tinted, so it separated nothing and only made the list
read muddy.

On Profile, Listings Manager, Your shop today and My storefront were three
sibling rows and one subject. They fold into "My business", which shut is
an ordinary row and open is a card. A storefront still waiting on review
shows its dot on the shut row, because a signal behind a fold is a signal
nobody gets. The fold only appears once there IS a business: a member who
has never sold anything would otherwise find "Create a storefront" — the
one row whose job is to turn them into a seller — behind a row claiming
they already are one.

Worth knowing, because it is the cost of the fold: the delivery screen is
reachable from exactly one place, the shop's morning, and on a quiet
morning the Home card that points there hides itself. So booking a
delivery in went from two taps to three. Profile is a tab and stays
mounted, so it is three taps once per app launch rather than every time.

**One line per item, not one per variant**, 15 Sep 2026. A shop posting
three sizes in four colours has twelve stock rows, and both shop screens
were printing all twelve with the same title on them. Twelve identical
lines is not a list, it is a wall: you cannot find the thing the delivery
actually contained, and "out of stock" stops meaning anything when it says
the same name three times in a row. Now an item is one line — what it
holds altogether, how many options that is across — and a tap opens it
onto its own sizes and colours. Anything with a single option, a crib or a
sofa, has nothing to fold and keeps its box right there.

The catch is that the folded line has to say what the ITEM holds, and
neither screen had that number. The morning list is only sent the rows
that are at zero, so adding up what arrived would put "none left" on a
lamp with sixty-four on the shelf; the delivery screen has every row, but
only up to a three-hundred-row cap and only while nothing is narrowing the
list. So `shop_needs_me` and `shop_stock_rows` now send the listing's own
total and row count on every row, counted server-side over the whole shop
before any search and before any cap. `shop_stock_rows` does it in a
separate pass on purpose: a window function beside the search would be
computed over the rows that matched, so looking up one code would make the
item look like it holds one thing.

Review caught the same mistake one level down, which is worth writing out
because it is the ordinary case and not the edge case. Folding was keyed
off "this list is showing one row", and a twelve-option lamp with ONE size
out shows one row — so it rendered flat, dropped the item's numbers, and
read "none", identical to the crib beside it that really did hold nothing.
The same lamp four lines lower, in Running low with two rows, correctly
said "64 left". Same shelf, opposite message, decided by whether one or
two rows were bad. Folding is now keyed off how many options the ITEM has,
which is a fact about the item rather than about the list looking at it.

Two smaller ones from the same review. A tap to collapse an item used to
outrank every later search for the rest of the session, so an item you had
once opened and shut came back folded with no box to type in — the
hand-set state is now cleared whenever the search changes. And the morning
list had no tiebreaker under its ordering, so rows that tie (most out rows
have nobody waiting) came back in whatever order Postgres felt like; with
rows folded into items, that moved whole items around between one look and
the next.

**Shop stock, stage 3: the shop's day**, 14 Sep 2026. Three things a shop
cannot do one listing at a time.

**The morning list** (Profile → Your shop today, and a line at the top of
Home when something is actually waiting): orders sitting in chat that
nobody has taken off the shelf, rows at zero, rows at or under their low
mark. Nothing else — no totals, no charts. A shop opens it while unlocking
the door, and if it says "nothing needs you" that is the whole answer.

**The delivery screen.** A box arrives with twenty things across eight
listings; doing that one listing at a time is eight screens and eight
saves, so it does not get done and the numbers quietly stop being true.
One list, a +N box on each row, one save, all of it or none of it. Find by
code is in the same box, for a shop that labels its stock.

**The waiting list.** A buyer taps "tell me when it's back" on a sold-out
size; the shop restocks; a message appears in their chat. That is a
message and not a notification because **there is no way to reach a Vevaty
user who is not looking at the app** — no push (adding it changes
package.json and app.json, so it forces a native build), no email, and
Meta blocks the WhatsApp channel. Chat is the only thing that works today.
If push is ever added, the waiting list starts buzzing phones with nothing
rebuilt.

Review found eleven things; the two that mattered are both written up in
@AGENTS.md because each is a class. The waiting list pointed at
`auth.users` while chat threads point at `myazar.profiles`, and fifteen
accounts here have no profile — one of them joining a list would have made
that combination permanently unrestockable, with the seller seeing only
"that did not save". And the delivery screen booked the box in and then
re-read in the same try block, so a dropped connection said "nothing was
booked in" over a delivery that had landed, after clearing the typed
numbers — retyping it books the box in twice.

**Shop stock reaches every countable category**, 14 Sep 2026. The first
cut gated the whole thing on `categories.stock_mode`, which was set on
eight categories, all of them clothing. Yousif posted a sofa into his
storefront and got no count — and he was right that the gate was wrong.
Whether a thing comes in multiples belongs to the category; whether THIS
seller has twelve belongs to the listing. One flag was answering both, so
a shop importing twelve cribs got nothing.

Stock is now on for 93 of 115 category rows and off only where a shop
genuinely cannot have twelve: properties, vehicles, jobs, services, live
animals, phone numbers, number plates, business liquidations. A category
with no size or colour opens the count at **1** — a shop posting one sofa
has one sofa — and selling the last one retires the listing by itself,
which replaces "Item Sold" for shops.

Made-to-order crafts are the one case the category cannot answer: a candle
maker keeps twelve on a shelf, the woman casting a baby's hands does not,
and they are in the same category. So those eight ask the LISTING, with a
switch that is off by default — handing a made-to-order listing a count
means the maker sells one and reads SOLD OUT for something she can make
again tomorrow.

That last point turned up a gap worth naming: **"not counted" and "sold
out" were the same state.** Turning the count off parks every row, the
total went to zero, and zero means sold out. A listing with rows but none
active now reads 1 — available, not counted — while genuinely selling out
keeps its rows active at zero and still reads 0. All three writers of
`listings.stock_qty` had to be taught the same rule.

**Saved sets**, 13 Sep 2026. A seller keeps up to twelve named sets of
choices and drops one into a listing in a tap, instead of retyping Size and
Add-ons on every item. A set is a template and is COPIED: the stored body
holds no ids, so editing one next month cannot rewrite an order from last
month, and the seller is told as much on the step. Kept on the seller, not
the shop — for every real case they are the same person, and the maker this
was built for has no shop. Using one asks before it replaces work already
typed. The caps moved into `myazar.check_option_groups`, which the listing
saver now asks too, so the two cannot drift about what a legal set is.

**Choices with prices**, 13 Sep 2026. A made-to-order craft has no single
price: a baby-cast is $60 for one hand and $110 for hands and feet, plus
$10 for a dark base and $8 to engrave a name. The seller now builds real
groups — Size (pick one), Add-ons (tick any) — each choice able to add
money; the buyer picks, says how many, and watches a total build.

Three things that decide whether it is any use:

- **Per item or per order.** Twelve gift boxes at +$12 is fair; one
  delivery at +$30 charged twelve times is $360 of delivery shown as if it
  were real. The seller marks each priced choice, defaulting to per item.
  60 favours with a $30 delivery come to $7,710, not $9,480.
- **A choice can ask a question.** "Name engraved +$8" — but whose name?
  The seller writes the question, the buyer's answer travels in the order
  and can be made compulsory.
- **It is an estimate, not a checkout.** Vevaty takes no money, so the
  figure says so on the chooser and again on the card, and the button
  reads "Send my choices", never "Buy".

The card in the chat is a fourth message kind beside text, offer and
system, and the labels and prices in it are built by the SERVER from the
live listing at the moment of sending — so it can never show a price the
seller never published, and the seller raising a price tomorrow does not
rewrite what was sent today. The seller reads it and taps "Give a price",
which pre-fills the offer card that already existed with the estimate;
pre-fills rather than sends, because the whole reason it is an estimate is
that they may want a different number. `body` still carries the same thing
as a plain sentence, which is what an older build shows.

Open to anyone posting in the category, not only verified shops — the
woman making crochet baskets at her kitchen table is who this is for. Five
groups of twelve choices, and an optional smallest-order-accepted for
favours.

**Arts & Crafts, the category half**, 12 Sep 2026. A fifth
`condition_mode`: `made_to_order`, answering `ready` / `to_order`. Handmade
work is the one section where New/Used is not a question anyone should be
asked and a stock count is meaningless — the maker has as many as she has
hours — so the fact a buyer needs is how long they wait, which arrives as
`craft_lead_time`, hung off the condition with the same `$condition`
dependency Properties uses for "Pets allowed". It is a five-bucket pick
(1-3 days … more than a month) rather than a number of days, because a
number cannot be filtered usefully and because Arabic cannot agree with
one: a static unit renders "7 يوم", which is wrong for every count from 2
to 10. A made-to-order price reads
"From $45", because the figure is where the price starts and the size and
add-ons are still to come, and the button says "Contact to order" rather
than "Contact to buy". Nine leaves, six shared specs, and Craft Supplies
overriding its parent back to New/Used, since half-used yarn really is one
or the other. Everything is seeded `active = false` — see "Next up" for the
three-step order it has to go live in.

The same patch hardens `conditionModeForCategory` against a mode the build
does not know, answering New/Used instead of throwing. That was written for
this category's own rollout and immediately earned its keep: a fifth mode
went into the database from a second session the same afternoon
(`antique_grade`, under Hobbies), and on the build shipped today the admin
auction-lot editor offers those leaves — its picker filters on a row's own
`active`, not its parent's — and throws the moment one is chosen. Hobbies
itself is off, so nothing a buyer or seller can reach is affected.

**The tester forms are on the site**, 11 Sep 2026, in place of Google
Forms: Vevaty Tester Onboarding (`vevaty.com/testers/join?k=KEY`, the link
to send before the invite, with the follow-up questions a Google Form
cannot ask) and Testers Reports (`vevaty.com/testers/report`, members only,
one per mission, recording the phone and the build by itself). Both land in
tables under Tester centre → Forms, each downloadable as an Excel file; the
missions list is edited there too. The database half went in as one
migration, test-fired in a rolled-back transaction first. See @TESTERS.md,
"The two forms".

**The admin lock is the server's**, 11 Sep 2026. Yousif found the idle
lock skipped by a page reload; underneath, the database had never checked
the authenticator code at all. Now every admin power — about sixty
permission rules, 28 admin functions, 4 triggers — needs an unlocked,
code-verified admin session whose code came from a pinned authenticator;
activity is recorded on the server by a heartbeat, the lock time lives
there, only the code unlocks, and admin pages are taken down while locked.
The fingerprint unlock went with it. The database work went in as five
migrations: four that changed nothing on their own (the server's answer,
the pin, the reasons a session is locked, a NULL-proof pin), then the
enforcement, switched on after the app half had shipped — an app that has
not yet downloaded the update cannot open the panel until it does. See @ACCOUNTS.md, "The admin lock is the server's",
and @AGENTS.md for the rules new admin code follows.

**The admin sign-in is off the member login**, 10 Sep 2026. It lives at
`vevaty.com/control-room` in any browser (it was `/admin` for a few hours
the same day — too obvious a guess), and Profile shows an Admin row to an
admin account and to nobody else; on a device not already signed in to
the panel, both ask for the admin email, password and authenticator code.
Every inner admin page now shows that sign-in, in its place, to anyone
not signed in to the panel — until then `/admin/branding` showed anyone
the branding editor. The first-admin setup form is gone, a dropped
connection no longer reads as "not an admin" — neither mid-sign-in nor in
the background check that runs on every return to the tab, which would
otherwise swap an open admin page, unsaved edits and all, for the sign-in
form — and "Sign out of admin" signs out that device only. See
@ACCOUNTS.md, "The admin door is not on the member login".

**Card previews play on the card itself**, 8–10 Sep 2026: a preview button,
then a PREVIEW pill with only one preview playing at a time, then spin
frames with their own small copies — a 24-frame spin was ~7MB off the CDN
for a picture drawn 350 points wide — and a spin set's row written only
after its frames have landed, which narrows the moment a closed app can
strand an empty 360 tab on a live listing to the gap between two adjacent
inserts. The loose ends are under "Next up".

**The conditions of sale are published where each side signs up**, 6 Sep
2026. Conditions of consignment on the offer-an-item form, conditions of
bidding on the auction registration screen, both versioned in the database
and both enforced server-side rather than by the checkbox. @AUCTIONS.md,
"The conditions each side agrees to".

Still open on them, and all of it is a decision rather than a build:

- **A legal entity to be a party to the contract**, plus the premises, the
  bank, the insurance position while a lot is in our custody, and the
  storage and late-payment rates. Six brackets, published as brackets.
- **What payment methods we accept, and in what dollars.** In Lebanon "US
  dollars" is not one currency, and a consignor paid in the wrong ones has
  lost most of the sale.
- **The post-collection disclaimer wants a lawyer.** "We authenticate
  everything" and "no responsibility once collected" pull against each
  other, and Law 659/2005 limits what a contract can waive. The narrower
  version to put to them: condition exactly as written, authenticity alone
  carved out — a lot proved a forgery within 12 months is rescinded
  against return of the item. Consignor clause 13 already lets us recover
  that from whoever gave us the fake.
- **The 5-business-day payment window is a recommendation, not a decision.**
  The card at registration is real; the authorisation hold at bid time is
  not built, and would not remove the need for a deadline even once it is.
- **Arabic.** `body_ar` is null on both documents.

**Consignors can offer us an item**, 6 Sep 2026. A phone-verified account
can send us something for a sale: what it is, maker and reference, its
condition, box/papers/certificate, provenance, their own estimate and
floor, where it is, and three to eight photographs — picked from seven
auction-only categories rather than the ninety-leaf marketplace tree. An
admin works the queue from Admin → Consignments: accept, decline, or send
it back with a question the consignor answers by editing. Accepting creates
nothing; a second, separate act turns an accepted item into a listing owned
by the consignor and a lot in a named sale, with their photographs and
their text carried across. @AUCTIONS.md, "Consignors offering us things".

Two things it does not do yet, both deliberate: nothing **notifies** the
admin that a submission has arrived (the Waiting filter and its count are
the whole mechanism), and nothing notifies the consignor that we answered —
they see it next time they open the screen. Both close with the same
notification work outbid alerts are waiting on.

**Buyers can rate sellers**, 6 Sep 2026. One to five stars and an optional
comment, from any buyer who has contacted that seller about a listing —
revealed their number or opened a chat. One review per buyer per listing,
editable. Shown on the listing page and on the seller's profile, with the
seller's average and count kept on `profiles` by a trigger. @ACCOUNTS.md,
"Buyers rating sellers", carries the reasoning — above all why the gate is
contact rather than a completed sale, which the table was originally keyed
to and which cannot happen until payments exist.

Two things fixed alongside it. `listing.rating` was hardcoded to `5`, so
every seller in the app read "5.0" having never been rated; that row now
shows the real score and shows nothing until there is one. And eleven more
categories carried a duplicate attribute-level "Condition" — the same defect
found on Watches and on Books — which is now swept: their `condition_mode`
is `graded` and the duplicate rows are gone. The note below that said "a few
categories may still carry" one was understating it, and the sweep is a
query rather than an eye now.

**Every category with attributes has card specs**, 6 Sep 2026. The
seventeen that had attributes but no `card_priority` on any of them are
numbered — Electronics above all, which is the highest-volume section in
this market and showed no spec row at all. Three per category, chosen for
what a buyer COMPARES on a card rather than what describes the item best:
brand plus the one or two numbers that separate two otherwise identical
results. Model is deliberately off most cards — free text, long, and it
repeats the title.

**The money, live and per lot**, 5 Sep 2026. Four changes that together turn
the monitor into the sale's books.

*Commission is set per LOT, not per sale.* `auction_lots` carries a nullable
`seller_commission_pct` / `buyer_premium_pct`; null inherits the auction's,
which are now defaults. A flat rate is wrong at both ends of the range — 15%
of a $500 lot is a fair price for the work, 15% of a $23,000 handbag is
$3,450 for the same work, and that consignor has somewhere else to go. All
three lot forms take the terms; the lots list shows `15/10 default` against
`6/15 agreed`. Rates FREEZE when a lot is won, so editing a sale's defaults
months later cannot restate what a paid seller was owed. @AUCTIONS.md,
"Money".

*The monitor shows what everyone gets.* Each sold lot displays what the
seller collects after commission beside what the buyer owes with the premium
on top — two separate invoices, each with its working — and the auction gets
a totals panel. A lot that WOULD sell if the clock stopped shows the same
figures as a projection in gold, recomputed on every bid; a lot under its
reserve shows none and says why. Above the lots, Vevaty's running take,
split into Settled and Projected and never merged. All arithmetic is in
`myazar.lot_settlement` and `myazar.sum_settlements`, not in TypeScript, so
the invoices settlement eventually generates cannot disagree with what an
admin read off the screen.

*The auction times are picked, not typed.* `components/DateTimeField.tsx` —
a month grid and hour/minute rows, hand-built with no new dependency,
because every off-the-shelf picker is a native module and a changed
`package.json` orphans every installed app (@AGENTS.md). It writes the same
local datetime string the box always held.

Found in review, and worth the four separate reads it took: `update_auction`
coalesced every argument, so a blank time meant "leave it alone" and a
schedule could not be emptied at all — the save reported success and a
scheduled sale went on opening at its old time. And `profiles.full_name` is
nullable, which the monitor's lot rows never handled the way the bid feed
does, so a lot led by a nameless account read "No bids yet" while having
bids. Both fixed; both were there before any of this work.


**A live monitor for a running auction**, 5 Sep 2026. Admin -> Auctions ->
the eye icon: every lot with its price, reserve state, leader and that
leader's hidden maximum, plus a feed of bids across the sale with automatic
ones marked. Live via a realtime subscription on `auction_bids` used as a
nudge to refetch, with a ten-second poll underneath so a dropped socket
shows as stale rather than as quiet. @AUCTIONS.md, "Watching a sale run".


**Bidders are told how a lot ended**, 5 Sep 2026. A won/lost/unsold popup
the next time they open the app, the same news as a message from Vevaty in
their chat, and an SMS to the winner. All three are written by
`advance_auctions` in the transaction that closes the lot, so they survive
nobody being there to watch it close. @AUCTIONS.md, "Telling bidders how it
ended", carries the reasoning -- why Vevaty has its own profile row rather
than posting as the seller, why an unsold lot gets different words from a
lost one, and why the phone message is SMS and English-only for now.

The sending half is dormant until one secret is set: the
`send-auction-messages` function returns `twilio_not_configured` without
`TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_SMS_FROM`). Everything else works
today.

Found in review: `ChatStore`'s row mapper read
`row.kind === 'offer' ? 'offer' : 'text'`, so the first `'system'` message
would have rendered as an ordinary bubble from a person, with a reply box
under it. Now in @AGENTS.md as a rule.


**A Sponsored pill on boosted listings**, 5 Sep 2026. A listing someone has
paid points to feature now says so, bottom-left of the photo on its card and
top-left of the media box on the listing itself. Featured only -- a Bump Up
has no duration to be currently anything for, so it deliberately gets no
pill. Derived inside `ListingCard` from the listing rather than passed in as
a prop, so all nine surfaces that draw a card got it at once. @CARDS.md
carries the reasoning, including why the seller still reads "Featured" for
the same state.

**Admins can edit a user**, 5 Sep 2026. Admin → Users is a search box over
name, phone, email and district that opens one person on their own screen:
their details, their points, their tier, their listings, suspension, and a
record of what admins have already changed. @ACCOUNTS.md carries the
reasoning; three things in it are worth knowing on their own.

Searching by phone was not a UI problem. `authenticated` has no column
grant on `profiles.phone`/`email`/`whatsapp` — deliberately, because that
table's SELECT policy is `true` and a grant would publish every user's
number to every signed-in account — so a client genuinely cannot read them,
and the whole screen reads and writes through SECURITY DEFINER functions
instead. The phone stays visible and searchable but not editable: it is a
copy of the login identity in `auth.users`, and writing one without the
other leaves an account displaying a number it cannot sign in with.

Granting a tier needed a schema change rather than a form field. `tier` was
recomputed from points by every RPC that touched a balance, so setting one
by hand lasted until the seller's next listing. `profiles.tier_override`
now holds the admin's answer and `myazar.effective_tier` is the only thing
that writes `tier` — which is now a rule in @AGENTS.md, because the trap is
for whatever touches points next, not for the code that exists today.

Suspension moved onto the same path as every other edit. It had been a
direct table update from the client while the rest went through the audited
function, which put the most consequential thing an admin can do outside
the log — found in review, not in use.

The guest/registered split from earlier the same day survives, and moved
server-side with everything else: the search returns fifty rows at most, so
hiding guests after the fact would have shown fewer than fifty registered
accounts while looking like the whole answer. `admin_search_users` takes
the flag and `admin_user_counts` counts both kinds over the whole table, so
the "N guest sessions" line stays a fact about the marketplace rather than
about the page.

**Every category has specs now**, 5 Sep 2026. Two batches of pure database
work — no app code in either, because every screen that reads specs (the
wizard, the batch flow, filters, card specs, the admin editor) has been
fully generic since Fashion.

*Auto Parts & Accessories.* Its three leaves had zero attributes. All
Vehicles Accessories and All Vehicles Spare Parts share one shape —
`fits_vehicle_type` (a multiselect reusing Vehicles' own vehicle-type
options, because one part fits several), `part_category` (its own option
list per leaf), `part_origin` (OEM or aftermarket), and brand + model.
Number Plates is deliberately unlike them: a plate is a registration
number being resold, not a car part, so it got `plate_format`, `region`
(the nine governorates, spelled as `lebanonPlacesData.ts` spells them),
`digit_count` and `is_personalized`.

*Furniture & Decor, Kids & Babies, Sports & Equipment, Businesses &
Industrial.* Twenty-four leaves, attribute rows only: an `item_type`
select tailored per leaf, plus material/brand/dimensions for furniture,
`age_range` for the Kids leaves where it means something, brand for
sports, and a free-text "what's included" for shop liquidations. Kids &
Babies Clothing was the one that needed a real decision: it reuses
Fashion Clothing's per-size stock mechanism with age-based sizes (0-3m
through 8y) rather than a new one, which is a `stock_mode` value and an
`is_variant` flag and nothing else — `hasStockStep` reads the category's
own `stockMode`, so there was no code to write.

Two things found in passing: Books carried a duplicate attribute-level
Condition field (fixed the way Watches was — `condition_mode = 'graded'`,
duplicate deleted), and `resolveVisibleAttrs` turns out to only accept a
single-valued driver, which is now written down in @AGENTS.md.

**360 spinners available in every category**, 4 Sep 2026. A seller added a
camera and the wizard went from the verification shot straight to Specs,
never showing the 360 step. Nothing was broken: `categories.supports_3d`
gates whether that step exists at all, and it was true for exactly two of
the ninety-seven active categories. It is now on everywhere except the
intangible ones -- the Jobs and Services trees, Mobile Numbers, Tickets &
Vouchers -- the column defaults on for anything added later, and the
per-category switch in admin Categories stays, which is what turned those
twelve back off. The buyer's listing page never gated on the category
(it renders a spin whenever one exists), so nothing else was in the way.

Two things that came out of doing it:

- **Spin frames were not being moderated at all.** `moderate-listing` is
  what publishes a listing, and its payload was built from the gallery
  only -- so six clean photos plus twenty-four frames of anything else,
  per set, went live unseen. Narrow while two categories could carry a
  spin; not narrow at ninety-six. The payload now carries two spin frames
  alongside the six gallery ones, which is exactly the edge function's own
  cap, sampled at random so the unlooked-at positions are not choosable.
  It narrows the gap rather than closing it -- most frames are still never
  seen -- and a human moderator opening the row does see all of them.
- **`uriToCompressedBase64` had no timeout, and on an edit it fetches.**
  The URIs there are hosted URLs, and RN's `Image.getSize` has no deadline
  of its own, so one stalled photo left a `Promise.all` pending for ever
  and the listing was never moderated -- the silent-stall shape @MEDIA.md
  is about, one file over. Bounded at 30s, and a skipped photo is now
  logged instead of vanishing.

**Listings stopped going live without their photos**, 3-4 Sep 2026. A
seller's apartment listing went out with no pictures and only got them
when he edited it and uploaded them again. Cause, read off the edge logs
rather than guessed: photos uploaded fire-and-forget while
`moderate-listing` published the listing four seconds later. Fixed by
putting publication after the media write and requiring positive evidence
there is a photo — plus a repair path for a listing parked by a failure,
the same refusal in all three server-side routes that can set a listing
`active`, a request deadline on the Supabase client, and an audit of
every write in the app that used to report success and change nothing.
@MEDIA.md is the reasoning record; the rules are in @AGENTS.md under
"Publish only once the media has landed", "A request that never answers
is not an error" and "One alert, ranked".

Along the way, and worth knowing separately:

- Posting points now go through `claim_posting_points`, a SECURITY
  DEFINER RPC that does the claim flag, the ledger row and a RELATIVE
  balance increment in one transaction. The old client-side version wrote
  an ABSOLUTE total it had computed locally, so twenty items posted at
  once each wrote a total from before the others landed and the seller
  lost points they had watched arrive.
- Moderators could not see the media they were moderating.
  `listing_photos`, `listing_spin_sets` and `listing_videos` had no admin
  RLS policy, so a flagged listing belonging to another seller showed no
  photos, no spin, no video and nothing saying why. Three SELECT policies
  mirroring `admins can view all listings`.

**Auctions, finished**, 2–3 Sep 2026. Six patches over two days took it from
a schema to something that can be demonstrated. The buyer side: a gate tile,
the auction page and its countdown, the lot page with Photos/360/Video tabs,
the bid sheet, card registration. The admin side: create an auction, build a
lot **from scratch** as well as by consigning an existing listing, add photos,
a 360 spin and a video from either the library or the in-app camera, edit or
delete anything at any status. Proxy bidding, anti-snipe, reserves and the
minute-by-minute closer were all exercised against the live database rather
than reasoned about. @AUCTIONS.md is the reasoning record.

Three things in there are worth reading even if auctions never ship, and all
three are now in @AGENTS.md: **RLS filters rows, it never confers a
privilege** (which is why the entire admin half shipped dead and had to be
rebuilt as SECURITY DEFINER functions); **an inference standing in for a fact
will eventually be wrong** (a null column read as "created for the auction"
hard-deleted a real listing — recorded in full because it destroyed a
seller's data); and **writing media and showing media are two jobs** (the
feature shipped media no buyer could see, twice — once through three RLS
policies that gated on `status = 'active'`, once through a lot page that
rendered only gallery photos).

**Browse grid widened**, 1 Sep 2026. One column on a phone and three on
desktop (was two and four), and the card photo moved from 1:1 to 4:3 — at
full width a square photo is taller than a phone screen has to spare, and 4:3
is the shape sellers actually shoot in. The photo-left carousel card now sizes
itself instead of sitting at a flat 300px, which is why its district line
truncated. @CARDS.md carries the arithmetic, including what did NOT truncate
and was only getting taller.

**Listing cards rebuilt**, 1 Sep 2026. One surface instead of a forest-green
band and a white half, with the green doing the work as the kind pill, the
spec glyphs and the price. A category pill that says "Apartment" rather than
"Properties", a title that wraps to two lines, and up to three specs with
icons chosen per attribute in admin. The photo stays 1:1 -- that decision was
made on evidence in August and re-examined rather than re-litigated.
@CARDS.md is the reasoning record, including why `card_priority` sat unread
in the database for weeks with seventeen rows of curation in it.

**Registration became a real form**, 1 Sep 2026. Full name, an optional
unverified email, a separate WhatsApp number with a "same as my mobile"
checkbox and a consent line, and a password with show/hide — all on one step,
all written when the OTP verifies. Phone stays the sole account identity;
email is a free channel and nothing more. Contact details are editable
afterwards from Profile → Edit your profile → Email & WhatsApp, because a
field you can enter once and never correct is a defect. `send-expiry-reminders`
now sends only to sellers who consented, and only on the number they
nominated — that one is a Supabase deploy (version 16), not part of the
commit, since edge functions are not tracked here. @ACCOUNTS.md is the
reasoning record.

**"Did you reach the seller?"**, 31 Aug 2026. The piece that actually
catches a dead lead. A day after a buyer reaches for a seller's number,
they are asked how it went -- on the section home and on the listing
itself -- and two independent phone-verified buyers saying "they said
it's sold" hides the listing, with the seller told why and one tap to
restore. Every guard is in the database, because it is the one write in
the app where one user's word affects another user's listing. See
@LIFECYCLE.md.

**Listing lifecycle**, 31 Aug 2026. Expiry became a per-category setting
resolved nearest-ancestor-first -- a phone gets 7 days, an apartment 45, a
ticket 3 -- and the database took ownership of it: a trigger on insert, and
RPCs for extend and republish that resolve the same function and hand back
the row they wrote, replacing two hand-written "now + 15 days" in the
client. Verified storefronts are exempt from per-item reminders. And
`listing_contact_events` now records the one observable moment in a
phone-only conversation: the buyer revealing the seller's number. The
reasoning for every number, and for the two approaches rejected first, is
in @LIFECYCLE.md.

**Fashion & Beauty**, 31 Aug 2026. The gendered Clothing and Accessories
pairs merged into one each with gender as a spec — the third time that
call has been made, after Properties and Vehicles — and Shoes and Bags
added, neither of which existed anywhere in the tree. Shoes needed its own
category rather than a corner of Clothing for a concrete reason: a
category carries exactly one size-variant attribute, and EU 36–46 cannot
share a list with S/M/L. Eight leaves, all specced, in both languages.
Wear grading (`graded`) replaced New/Used for the whole section and the
duplicate Condition spec on Watches was deleted. The size-variant
machinery is finally in use, but only for verified storefronts — see
@AGENTS.md, "Stock and sizes belong to shops, not to categories".

**The six silent listing writes**, 31 Aug 2026. `updateListing`,
`deleteListing`, `extendListing`, `republishListing`, `hideListing` and
`markListingSold` all reported success whatever the database said, and
each rewrote the screen before asking. They now check three separate
ways a write can quietly do nothing (see @AGENTS.md, "Three ways a write
reports success and changes nothing"), throw a translatable code, and
either wait for the answer or put the screen back. Every call site was
decided on its own rather than swept: two batch steps had no error
handling at all and would have gone dead-quiet, five discarded the error
deliberately, and the batch photo retry link would have inserted a second
listing for the same item.

**Listing domains**, 30 Aug 2026. The largest change the app has had: it is
now split into Properties, Vehicles and Classifieds (and a dormant Jobs &
Services), on both sides. Sellers answer one question the photos cannot --
which is what stopped the classifier being asked to choose between
"Apartment" and "Decor Concept" on the same pictures -- and buyers land on
a gate instead of one mixed home, with each section carrying its own
categories, collections, banners, filters and feed. Every decision, and
the reasoning behind each, is in @DOMAINS.md; all four steps of its build
order are done except Jobs & Services.

**Properties**, 29 Aug 2026. Eleven real-estate categories merged into
one, Sale/Rent/Both replacing a meaningless New/Used, a generic
conditional-field mechanism (`depends_on_slug`), real rent terms, and
21 specs.

**Pets**, 30 Aug 2026. Live animals stopped being asked whether they are
new or used: `categories.uses_offer_type` became `condition_mode`, a third
answer ("For sale / Free to a good home") joined New/Used and
Sale/Rent/Both, and a free listing hides its price field and reads as
"Free" rather than "$0". Age, sex, breed and vaccination on all four
animal categories, size on dogs, and Pets services flagged as a service —
which turned up that a service category could not be posted at all, since
every listing was required to name a condition.

**Vehicles**, 30 Aug 2026. Five vehicle-kind categories merged into one
postable category with a `vehicle_type` spec; Auto Parts & Accessories
promoted to its own top-level; 19 specs where there had been none at all;
and the Properties-or-not question behind Sale/Rent/Both generalised into
a category flag -- which the Pets work above then turned into
`categories.condition_mode`.

Four things this work turned up and deliberately did not fix:

- **Unverified: whether the AI sees anything at all on the web build's
  edit path.** `expo-image-manipulator` on web sets `crossOrigin =
  'anonymous'`, so if the Bunny pull zone does not return an
  `Access-Control-Allow-Origin` header, every hosted photo fails to encode
  and the moderation payload goes out empty -- the AI approving on title
  and description alone, silently. Pre-dates all of this and applies to
  the gallery, not just the new spin frames. It is now at least findable:
  a skipped photo logs to the console. One edit of an existing listing on
  vevaty.com with the console open settles it.

- **`anon` cannot read `myazar.listings` at all.** Any query as the true
  `anon` role fails with `permission denied for table mfa_factors` — the
  restrictive `admin identity requires mfa` policy's subquery touches
  `auth.mfa_factors`, which `anon` has no grant on. Nobody has hit it
  because the app signs everyone in anonymously (role `authenticated`)
  before it reads anything. It would bite the moment a page tried to read
  before `ensureSession()` resolved, or if a public read were ever added.
  Pre-dates this work — `listing_photos` behaves identically, and did
  before the new admin policies.

- **Two `updateListing` calls on one listing can double-insert photos.**
  `BatchPhotosScreen` fires one per photo tap with no lock, so two
  overlapping runs both read a short `existingRows`, both upload, and both
  insert. It self-heals on the next sync and again on the location screen,
  and adopting hosted URLs narrowed the window a lot, but the real fix is
  a per-listing queue.

- **`profiles.points` and `profiles.tier` are still UPDATE-granted to
  `authenticated`.** `claim_posting_points` closed the honest path; the
  balance is still directly writable by anyone with a console. The same
  treatment — a definer RPC and a revoke — would close it.

## Waiting on something external

**The 12 caza corrections** in `src/data/lebanonPlacesData.ts`.
`scripts/generate-lebanon-places.py` now pulls geoBoundaries' full-
resolution polygons instead of the simplified ones, which moves twelve
villages into the right district (Bsifrin and Zahriye from Baabda to Matn,
El Fradis from Zgharta to Bcharre, and nine others). Regenerating needs
`download.geonames.org`, which was offline on 17 Aug. Re-run the script
once it's back.

**WhatsApp OTP delivery still falls back to SMS** ($0.36 a send against
roughly $0.06). Meta rejected the authentication template
(`subCode=2388185`, "does not have permission to create message
template"), so Verify's own templates were never provisioned on the WABA,
and Twilio's WhatsApp→SMS fallback hides the failure. Needs a Twilio
support ticket to provision the templates and disable the fallback.

## Open question

**Should Magic Listing become the default path rather than one option?**

The argument for: your competition is a form, nobody enjoys a form, and a
marketplace lives on listing volume. It also produces better data than
sellers do — consistent titles, real specs, and a category the buyer will
actually browse to.

The argument against: it fails in front of the user. A form is frustrating
but predictable; an AI that says 2021 when the car is a 2019 hands the
seller a wrong listing they may not proofread.

The way to settle it without guessing: record what the AI proposed, what
the seller changed before posting, and how often they overrode the
category. That edit rate is the accuracy number. Keep 80%+ of what it
proposes and it should be the front door; rewrite half of it and it stays
optional until it improves. `myazar.ai_listing_generations` already stores
the suggestion — what's missing is the comparison against what was
actually posted.
