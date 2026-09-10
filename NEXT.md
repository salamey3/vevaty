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
   WhatsApp, then cancel it. The admin account gets the flag tab too (right
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

Found on the way and deliberately not fixed here:

- **The admin MFA requirement does less than its name says.** The
  restrictive "admin identity requires mfa" policy counts rows in
  `auth.mfa_factors`, whose rows a signed-in session cannot see, so the
  count is always zero and a password-only (aal1) admin session passes
  it. And no `admin_*` function checks the session's `aal` — they check
  `myazar.admins` and nothing else. So an admin's password alone opens
  everything the TOTP step is meant to guard. Worth doing properly before
  a second person holds an admin row.
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
  - A device signed in to the panel stays signed in to it, across
    relaunches, until "Sign out of admin" — the lock starts unlocked on
    every launch and then asks only for the code. So a phone, whose
    authenticator is usually on the same phone, should sign out of admin
    when done. (Since 10 Sep that signs out this device only; the member
    Log out still signs out every device — worth one decision.)
  - "Sign out of admin" skips the clean-up the member Log out does, so the
    guest session that follows writes the admin's cached name, district,
    points and tier into a fresh guest profile row (the insert in
    `syncFromSupabase`). The lock screen's "Not you? Sign out" does the
    same. A SIGNED_OUT branch in
    AppStore's auth listener that forgets the local account would cover
    every way of being signed out at once.
  - In the phone app the auto-lock is a fixed timer: nothing records
    activity there (the listener in `App.tsx` is web-only), so the lock
    screen comes up 30 minutes (the default) after each launch or unlock,
    however busy the admin is.
  - Offline with an expired session token, "Sign out of admin" and the
    lock's "Not you? Sign out" act as though they worked and do not: the
    client cannot sign out without reaching the server first, and
    `adminSignOut` ignores the error it gets back. It should say so and
    keep the lock up.
  - Setting up an authenticator from the phone app shows the text key but
    no QR code: the code arrives as an SVG, which React Native's `Image`
    does not draw. Set one up on the website.
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
