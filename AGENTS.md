# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Branding

See @BRANDING.md before touching any logo, icon, colour token, typeface or
brand asset. It is the source of truth and the assets are generated from
it — do not hand-edit a PNG in `assets/`, change the spec and regenerate.

# What forces a new native build

`app.json` sets `runtimeVersion` to the `fingerprint` policy. An
over-the-air update only reaches an app whose runtime hash matches it, and
`@expo/fingerprint` computes that hash from more than the native code:

```
.gitignore    package.json (INCLUDING "scripts")    app.json
eas.json      assets/ icon and splash images
```

Touch one and every update after it is orphaned — `eas update` reports
success, the update appears in `eas update:list`, and no phone ever asks
for that runtime. Nothing fails; the app stays on an old bundle while the
website updates correctly, which reads over and over as a change that did
not work rather than one that was never delivered.

**This has happened twice, both times over something that was not code.**

1. `"test:upload"` added to `scripts`. `b3a56e8f...` -> `e97b364d...`,
   six ships lost.
2. `*.patch` added to `.gitignore`, to stop delivery artefacts being
   committed. `543df3a5...` -> `d0d31f6d...`, thirteen commits and a full
   day lost -- the vehicle merge, all three domains steps, the storefront
   skip, sectioned banners and Pets, every one of them live on the website
   the whole time.

Both were reverted rather than rebuilt around: restoring the file
byte-for-byte restores the old hash, and the installed app picks up
everything on the next ship. Measure it with
`npx expo-updates fingerprint:generate --platform android` before and
after -- do not reason about it.

- Dev-only tooling: run it directly (`node scripts/...`), never as an npm script.
- Machine-local ignores go in `.git/info/exclude`. Not tracked, not hashed.
- If one of these files genuinely must change, say so and expect a build.
- `npm run ship` checks this and says so loudly. It did not always: it
  passed `--non-interactive` to `eas-cli`, which that CLI rejects, so the
  check threw and printed "skipped" every time. A diagnostic that cannot
  run must never report like one that ran and passed -- and when it prints
  COULD NOT VERIFY, that is a red flag, not a shrug.

devDependencies themselves are fine -- `esbuild` and `sharp` are not
autolinked and do not move the fingerprint.

# Grant every new column, or writes fail silently

`myazar.listings`, `myazar.profiles` and `myazar.shops` are granted **per
column**, not per table. A column added by a migration is invisible to `anon`/`authenticated`
until it is granted explicitly, and PostgREST rejects the *whole* statement
over one ungranted column — so a single missed grant silently discards
every field of every write while the UI reports success.

```sql
grant select (new_col) on myazar.listings to anon, authenticated;
grant insert (new_col), update (new_col) on myazar.listings to authenticated;
```

One more consequence of that same SECURITY DEFINER pattern, learned the
awkward way: **a function whose argument list changes has to be dropped and
recreated, not `CREATE OR REPLACE`d.** Replace cannot change the signature —
it creates a second overload beside the old one, and PostgREST then has two
candidates for the same name. `myazar.upsert_own_profile` went from three
arguments to six this way. Every argument still defaults to null and every
column is `coalesce(excluded.x, profiles.x)`, which is what lets one caller
write `{phone, is_phone_verified}` without erasing a name — and is also why
that function can never *clear* a field. Removing an email is a plain
`UPDATE`, which the column grants above already allow.

Related, and subtler: **`INSERT ... ON CONFLICT DO UPDATE` requires
table-level `SELECT`.** Column-level grants alone are not enough, whatever
the columns. This is what broke profile writes for weeks — `.upsert()` from
AuthScreen failed with `42501 permission denied for table profiles` on an
account that could `UPDATE` those same columns perfectly well, so a
verified user stayed unverified and could not post. The fix was a
`SECURITY DEFINER` function (`myazar.upsert_own_profile`), which runs as the
owner and sidesteps the caller's grants entirely. Reach for that pattern
rather than widening grants.

A quieter version of the same trap on the read side: a `select()` that
names a column the caller has no grant on fails the *whole* query, so a
screen that asks for a column it never uses is one missed grant away from
rendering as not-found. Select what the screen reads, nothing more.

Both failures are silent by construction, so when a write "works" but the
row does not change, suspect grants before logic.

And one that runs the other way: **on `myazar.profiles`, a SELECT grant is
not "the owner can read it" — it is "everyone can read it, on every row."**
The table carries the policy `profiles are publicly readable` with a `true`
qualifier, so a column-level SELECT grant to `authenticated` publishes that
column to every signed-in user. This is why `phone` has never had one, and
why `email`, `whatsapp` and `whatsapp_opt_in` do not either: they are
INSERT/UPDATE-granted only, and every read goes through a `SECURITY
DEFINER` function pinned to `auth.uid()` (`myazar.get_own_contact_details`
for your own, `myazar.get_seller_contact` for a listing's seller). Adding a
grant so that "the settings screen can show it" would hand every contact
detail on the platform to anyone who asks PostgREST for it. **@ACCOUNTS.md
has the reasoning behind those three columns** — what an account is, why
email is optional and unverified, and what the WhatsApp consent box does and
does not mean.

# Three ways a write reports success and changes nothing

Reading the error is necessary and not sufficient. A Supabase write has
three separate ways to do nothing while looking fine, and each needs its
own check:

1. **It errored and nobody looked.** `const { error } = await ...` and
   then no `if (error)`. Every listing write in `AppStore` did this until
   30-31 Aug: `addListing` handed back a row that existed nowhere,
   `updateListing` warned and returned as though it had saved, and the
   five status actions did not read the error at all. Worse, each one
   rewrote local state *first*, so a refused write left the seller
   looking at a listing that was hidden, sold or deleted on their screen
   alone.
2. **It matched no row.** An `UPDATE ... WHERE` that touches nothing is
   not an error, it is a silent success. `.select('id')` and check the
   result is non-empty; a seller can always read their own row back
   (`status = 'active' OR seller_id = auth.uid()`), so an empty result
   really does mean nothing was written.
3. **A trigger put it back.** `enforce_listing_moderation_gate` is a
   `BEFORE UPDATE` trigger that rewrites `new.status` to `old.status`
   rather than raising — the statement succeeds, a row is returned, and
   the status is unchanged. Only reading the status back catches it. See
   `updateOwnListingRow`'s `expectStatus`.

The seller-facing half matters as much: throw a **code**, never a
message. PostgREST's text is an English diagnostic naming a column, which
is unreadable under an Arabic interface and is not what the seller needs
to know anyway (whether anything saved, and whether pressing the button
again will help). `src/lib/listingActionMessage.ts` turns the code into
the right sentence; the diagnostic goes to `console.warn`, where it names
the column or constraint that refused.

And when a screen updates local state optimistically, the failure path
has to put it back — see `updateListing`'s sequence guard for why a plain
restore is not enough once two writes can be in flight on one row.

# Listing money and condition are not what their names suggest

`listings.price` is the **headline number**, not always a sale price. Every
consumer reads it — cards, the Home and storefront price filters,
price-drop collections, the related-listings sort — so a rent-only property
mirrors its rent value into it rather than leaving it null (the column is
`NOT NULL`) and sorting as $0. `rent_price` carries the rent whenever
renting is offered at all, including alongside a sale price.

One consequence worth knowing: switching a property from sale to rent moves
`price` by orders of magnitude, which the `listing_price_changes` trigger
logs as a ~99% discount. Rentals are therefore excluded from price-drop
collections — see `CollectionsStore`. Any future feature that reads a price
delta needs the same guard.

`listings.condition` carries four meanings in one column and one UI slot,
and which one applies is `categories.condition_mode`:

| mode | values | where |
|---|---|---|
| `new_used` | `new` / `used` | the default, most of the catalogue |
| `offer_type` | `sale` / `rent` / `both` | Properties, Vehicles |
| `rehome` | `sale` / `free` | live animals |
| `graded` | `new` / `like_new` / `good` / `fair` | Fashion & Beauty |

The mode is resolved by walking UP from the category, nearest first
(`conditionModeForCategory`) — so Pets can hold live animals on `rehome`
beside pet supplies on the default, under one parent, and Fashion sets
`graded` once on the section. The overlaps are deliberate: `sale` is
shared by two modes and `new` by two others, because "for sale" and
"brand new" mean the same thing whichever scale is asking. That is also
why "did the category change invalidate this answer?" must be asked with
`conditionValidUnder` rather than by eye.

**Never hand-write the value list.** Every list — the create-form pills,
the batch row pills, the cross-category clear, the browse filter, the card
badge, and the whitelist that decides which values survive a round trip
out of the database — derives from one table in
`src/lib/conditionModes.ts`. They used to be six separate nested
ternaries, which is exactly how `rehome` shipped broken: two of them were
never updated, so a listing saved as `free` came back as null and a pet
given away read as "$0" to everyone but its seller. Adding a fifth mode
is one edit to that table plus its labels.

That table used to carry a warning: "if a third meaning ever appears, stop
adding branches and make it a per-category definition instead". A third
appeared, and this enum is that definition. A fourth has now appeared too,
and the honest note is that the enum is still the right shape but the
*consumers* were the problem — hence the single table above. A fifth
should extend the enum, never add a flag beside it: two booleans able to
disagree about the same field is the thing this replaced.

A `free` listing posts at `price: 0` and renders as the word "Free"
(`listingPriceLines`), never as `$0`.

# Listing expiry is per category, and the database owns it

How long a listing lives is `categories.listing_lifetime_days` — nullable,
resolved nearest-ancestor-first, exactly like `condition_mode`. About a
dozen categories set it; the other eighty-odd inherit, and 14 days is the
fallback. **@LIFECYCLE.md has the reasoning for every number**, and for the
two options that were rejected first.

The client does not compute expiry. `myazar.category_lifetime_days()`
resolves it, `trg_set_listing_expiry` applies it on insert, and
`extend_own_listing` / `republish_own_listing` apply it on renewal and
return the row they wrote. `lifetimeDaysForCategory` in SettingsStore is a
display copy for "expires in N days" and the Extend button's label —
nothing more. `DEFAULT_LISTING_LIFETIME_DAYS` and the SQL function's own
`return 14` are one answer written twice; change both or neither.

Two rules that are easy to break by accident:

- **Buyer interest never extends a listing.** `listing_contact_events`
  records that a buyer revealed a seller's phone number — the only
  observable moment in a phone-only conversation — but it is evidence of
  demand, not evidence the seller is still there. Only seller actions reset
  the clock.
- **Redeploying an edge function turns `verify_jwt` back ON.** Both
  cron-invoked functions are called by pg_net with an `x-cron-secret`
  header; that alone gets a 401 the moment verify_jwt flips, and nothing
  fails loudly — the job just stops working. Both cron commands now send an
  `apikey`/`Authorization` pair as well, so they survive it either way. If
  you deploy `send-expiry-reminders` or `purge-removed-listings`, fire the
  job once by hand and check `net._http_response` for a 200.

# Stock and sizes belong to shops, not to categories

`categories.stock_mode = 'multiple'` plus one `is_variant` multiselect
attribute is what turns the create form's Stock step into a per-size
table (`Listing.variants`, with `stockQty` as their sum). Both are
properties of the CATEGORY — but the categories that carry stock are also
the ones private sellers use most, so Clothing set to `multiple` would
put a stock table in front of someone selling one used jacket to say
"one, medium".

So the step is additionally gated on this listing actually going **into**
a verified storefront: `attachToShop && myShop?.verifiedAt` in
`CreateListingScreen`, and a non-null `listing.shopId` in the batch flow,
which means the same thing because an unverified shop's listing is saved
with no `shopId` at all. Gating on merely *having* a shop is not enough —
a shop owner selling one of their own jackets standalone would get a
per-size table, and an untouched table posts at zero stock with an OUT OF
STOCK ribbon on the card. When the step
does not appear, the variant attribute falls back into the ordinary spec
list rather than vanishing — otherwise the seller is never asked their
size by anything. Both paths write the identical value (the option values
under the attribute's own slug), so filters and spec displays cannot tell
a shop's listing from an individual's.

Two traps this walked into first, both worth knowing before gating any
other step:

- **A step's presence must not depend on an index.** `attachToShop`'s
  correction toggle lives on the Details step, *after* Stock, so flipping
  it rebuilds the step list under the seller. `step` is a plain integer,
  so inserting or removing a step ahead of them slid them silently onto a
  different one, skipping its Continue gate — reachable all the way to
  posting a listing with an empty title. `CreateListingScreen` now
  reconciles on the step KIND rather than the index whenever the list
  changes shape, and only when the list itself changed (reconciling on
  the kind alone blocks forward navigation entirely).
- **A step nobody filled in must not reset what it would have
  collected** — and "not shown" and "shown but untouched" are the same
  thing here. `buildStock` returned the default whenever the gate read
  false and zero whenever the fields were blank, while `updateListing`
  writes `stock_qty`/`variants` unconditionally. Between them, an edit
  made before `myShop` loaded, an edit after a verification lapsed, and
  an edit that simply tapped through the step all rewrote a shop's whole
  size table. It now writes numbers only once `stockTouched` is true, and
  preserves the listing's existing values otherwise.
- **Stock belongs to a category, not to a wizard session.** The intake
  state is keyed to `category` and cleared when it changes, and the
  preserve branch only returns the edited listing's stock while it is
  still in the same category — otherwise re-filing a Clothing listing as
  Shoes wrote `s` and `m` under the shoe size slug, and put sizes that
  belong to no option row into the buyer's filter.
- **`stock_mode` no longer means "somebody entered this number".**
  Clothing and Shoes are `multiple` for everyone, so a display gated on
  `stockMode === 'multiple'` alone says "1 in stock" under a private
  seller's single used jacket. `ListingDetailScreen` gates on
  `listing.shopId` as well; anything new that reads `stockQty` should
  too.

# RLS filters rows. It never confers a privilege

The whole admin half of the auctions feature was written, reviewed and
shipped dead, and this is why.

`authenticated` was deliberately given no INSERT, UPDATE or DELETE on any
auction table — a grant nobody needs is a leak waiting for a policy change.
The admin screens were then written against those tables anyway, on the
assumption that the `admins manage …` RLS policies would allow it. **They
cannot.** A policy narrows the rows a privilege already applies to; it
cannot hand out the privilege. Every admin action failed with `42501`,
including reading the lot list, which named a column granted to
`service_role` alone — and one ungranted column fails the whole statement
(see the per-column grants above).

The fix was five SECURITY DEFINER functions that check `myazar.admins`
themselves. The rule to carry forward: **before writing a screen against a
table, check the GRANTS, not the policies.** A policy list that reads
exactly right tells you nothing about whether the write can happen at all.

# An inference standing in for a fact will eventually be wrong

`delete_auction` decided whether a lot's listing had been created for the
auction — and so whether to destroy it — by testing whether
`listing_prev_status` was null. It was a fair inference: only a
consigned listing records a previous status. A lot recorded before that
column existed had a null anyway, so deleting one test auction hard-deleted
a real, live listing and its photos. Unrecoverable.

`auction_lots.created_for_auction` is now an explicit boolean that only
`create_auction_lot` ever sets. A fact cannot be wrong by omission; an
inference over data older than the inference always can.

Two habits came out of it, both cheap:

- **A destructive branch takes an explicit flag, never a derived one.**
- **Prefer soft removal in that branch.** The listing is parked at
  `status = 'removed'` instead of deleted, which makes the whole class of
  mistake survivable — and then check what ELSE acts on that state:
  `purge-removed-listings` erases removed listings after fifteen days, so
  "kept, not destroyed" was true for a fortnight and then quietly stopped
  being. Those rows carry their own `removed_reason` and the purge skips it.

# Writing media and showing media are two different jobs

The auctions feature shipped media nobody could see, twice.

First, `listing_photos`, `listing_spin_sets` and `listing_videos` each gate
reads on the parent listing being `'active'`, which an auction lot never
is. The listing came back, the media did not, and every lot rendered the
placeholder glyph for every buyer. **Adding a listing status is never one
policy — it is one per table that gates on status.**

Then, with all three policies fixed and an admin able to attach a 360 spin
and a video, the buyer's lot page rendered `listing.photos` and nothing
else — and `photos` is `sortedByKind(rows, 'gallery')`, so spin frames are
filtered out of it by construction. Both wrote correctly, came back
correctly, and appeared nowhere.

A third instance, found in Sep while fixing the photo-publication bug and
the same lesson one axis over: `listings` carries `admins can view all
listings`, and the three media tables never got the equivalent. So a
moderator opening a flagged listing belonging to another seller saw no
photos, no spin and no video — they were being asked to approve or reject
something they could not look at. It went unnoticed for months because
this project's only admin is also the seller of every listing on it, so
`seller_id = auth.uid()` happened to be true for everything. **Whatever
widens who can see a listing has to widen who can see its media, table by
table.**

Finishing the write path is not finishing the feature. Open the surface a
real person looks at.

# Before deciding a capability is expensive to reuse, open the file

The admin auction screens offered library-pick only for photos and 360
frames, for one reason: an assumption that the seller flow's guided camera
was welded into the posting wizard and would be costly to extract.

It had been extracted long before. `CameraCapture` is standalone, takes its
frame limits and wording as props, works on native and web, and the wizard
already mounts it three separate ways. So does `SpinPreviewModal`. Both
dropped in unchanged.

The cost of that assumption was not the extra work later — it was shipping
a feature the person who asked for it could not use, and a recommendation
that talked them out of asking again.

# A column nothing reads is worse than no column

`category_attributes.card_priority` existed for weeks: added by a migration,
mapped into the `CategoryAttribute` type, mapped again in `SettingsStore`, and
read by **nothing**. Seventeen rows already carried values — somebody had sat
down and decided a dog card should say age, sex and breed — and the card went
on showing something else entirely, because it derived its own specs inline
with a heuristic nobody else could see.

Two rules came out of it:

- **Land a mechanism end to end or not at all.** A half-built one is worse
  than an absent one, because it looks finished. The type comment even said
  "not yet consumed anywhere", and that comment was read by everyone who
  touched the file and acted on by no one.
- **When a component derives something a whole feature depends on, that
  derivation belongs in `src/lib/`, not in the component.** The card's rule
  was three lines inside `ListingCard`, so the question "what does a card
  show?" had exactly one possible answer: read the component. It lives in
  `src/lib/cardSpecs.ts` now — @CARDS.md has the reasoning.

The same shape has now bitten twice (see also the six nested ternaries that
shipped `rehome` broken, which became `src/lib/conditionModes.ts`). Per-value
and per-category lists go in one table in one file, every time.

# navigate() does not go back -- it pushes

React Navigation 7 changed this, and the app was written against the old
behaviour in five places. `navigation.navigate('X')` only reuses route X
when X is **already focused**; anything else is a push. Every cross-stack
jump that assumed otherwise stacked a second copy of the screen it meant
to return to -- twice, a second copy of the entire tab navigator, mounted
and holding its own state, with back walking out through an
identical-looking app.

Use `popTo(name, params)` within a stack, or pass `pop: true` at each
nesting level for a nested jump:

```ts
navigation.navigate('MainTabs', { screen: 'HomeTab', params: { screen: 'HomeRoot', pop: true } }, { pop: true });
```

`pop: true` is a valid sibling of `screen` in a nested payload (threaded
through by `useNavigationBuilder`) and a valid third-argument option.
`popTo` adds the route if it is not already in the stack, so it is safe
where there is nothing to pop back to.

Related, and silent: navigate bubbles UP to parent navigators and is never
handed DOWN into a child. Addressing a tab route from a screen that sits
ABOVE the tabs in the root stack does nothing at all -- no error, no
warning. A banner pointing at a category did exactly nothing, everywhere,
for as long as that code existed. All the "show me this category" jumps
now live in `lib/browseNav.ts` so this cannot be re-decided one screen at
a time.

# Category structure

Leaf-ness is **derived**, never stored: a category is postable when it has
no children. Deleting or re-parenting rows is all it takes to change what
the AI classifier offers and what sellers can post into — no flag, no code.

`category_attributes.depends_on_slug` / `depends_on_values` give any
category conditional fields: a spec appears only when another spec on the
same category holds one of those values (Properties uses it so Land hides
Bedrooms). `resolveVisibleAttrs` in `src/lib/attributeVisibility.ts` is the
single place this is interpreted, and both listing flows filter their
`specAttrs` through it — which is why validation, the AI-suggestion schema
and the saved payload all respect visibility without knowing about it.

**The driver has to be single-valued.** `resolveVisibleAttrs` tests
`typeof v === 'string'`, so pointing `depends_on_slug` at a `multiselect`
hides the dependent field for ever — its value is an array, the test is
false every time, and nothing anywhere reports it. That is why Auto Parts'
brand/model are ungated rather than hanging off `fits_vehicle_type`, which
has to be a multiselect because one part fits several vehicle types. Gate
on a `select`, or widen the check to accept an array and intersect — but
widen it deliberately, for a case that needs it, rather than meeting the
limit as a field that silently never appears.

**A tier is written through `myazar.effective_tier`, never
`tier_for_points` directly.** `profiles.tier_override` holds an
admin-granted tier and NULL means "follow the points"; `effective_tier`
is what reconciles the two. Any new code path that changes a points
balance and rewrites the tier alongside it must go through that function,
or it will silently undo an admin's grant the next time the seller does
anything. See @ACCOUNTS.md, "Editing an account as an admin".

A category's condition question belongs to `categories.condition_mode`,
never to an attribute row. An attribute whose slug is `condition` puts a
second condition picker on the form next to the real one, with its own
values and no relationship to `listings.condition`. Two have been found and
deleted this way (Watches, Books), both pre-dating `condition_mode`; if a
category needs its own set of values, add a mode rather than a field.

# Publish only once the media has landed

**@MEDIA.md is the reasoning record** for everything in this section and
the two below it, including the audit of every silent write the incident
turned up.

A listing is published by `moderate-listing`, an edge function the client
kicks off and does not wait for. It answers in about four seconds. Six
photos take ten to twenty. Until 3 Sep those two facts sat next to each
other with nothing between them: `addListing` started the uploads
fire-and-forget, called moderation immediately, and moderation set the
listing `active`. So EVERY listing was publicly visible with no pictures
for ten seconds or more, and any listing whose upload never finished — a
closed tab, a reload, a backgrounded browser, a dropped connection — was
live and empty for good. It happened to three listings in nine minutes;
two got their photos at +19s and +14s, the third never did, and the
seller only got pictures by editing the listing and uploading them again.
The edge logs had it exactly, and no report anywhere else did.

The ordering rule that came out of it: **media first, publication
second, and publication needs positive evidence there is something to
look at.** Not the absence of a failure — an empty photo list produces no
failure at all, and "nothing went wrong" then reads as "publish". Both
`addListing` and `updateListing` check the photo count itself.

The parking rule is the other half. A listing whose media did not land
stays at `pending_review`, which is invisible to buyers: a listing nobody
can see yet is a far better failure than a live one with nothing in it.
That is only true if it can get out again, so `updateListing` re-runs
moderation for a listing sitting at `pending_review` — for anything but
`moderation_status = 'flagged'`, which is a human moderator's to clear.
The gate is written as that single exclusion on purpose. Listing the
states worth releasing instead was wrong three times running: it missed
the `'rejected'` a resubmit leaves behind, then the `'ai_approved'` a
hide-and-resubmit leaves behind (both because
`enforce_listing_moderation_gate` silently keeps the old value), and each
miss was a listing invisible for ever with no route back short of an
admin. A repair path that only repairs one of the things that breaks is a
trap.

And the rule holds where it can be enforced, not only where it is
convenient. Three things set a listing `active`: `moderate-listing`,
`republish_own_listing` and `restore_auto_hidden_listing`. All three are
server-side, all three now refuse a listing with no `kind='gallery'` row,
and the client checks are there to give the seller a sentence they can
act on rather than to be the thing that holds. Guarding the client alone
left two routes open that needed no failed write at all: let a listing
expire, strip its photos through "Save & exit", press Republish; or let
buyers auto-hide it, strip it as a draft, press Restore.

# A request that never answers is not an error

Neither browser `fetch` nor React Native's OkHttp times out on its own,
and supabase-js adds nothing — so a socket that goes quiet mid-request
leaves a promise pending for ever, and no `catch` anywhere will run. That
was survivable while every write was fire-and-forget. It stopped being
survivable the moment three screens started WAITING on a media save
before letting the seller move on: one stalled call meant a spinner and a
dead button for the rest of the session, with a reload — losing the form
— the only way out.

The deadline lives on the client itself (`lib/supabase.ts`), once, rather
than as a race around each of a dozen awaits. Two details there are load-
bearing and both were wrong first:

- **Abort with an `AbortController`, never `AbortSignal.timeout`.** The
  latter aborts with a `TimeoutError`; postgrest-js treats only
  `AbortError` as final and RETRIES anything else on a GET three times
  with 1/2/4s backoff. A 45-second bound became 187 seconds, on web only,
  because React Native's polyfill has no `.timeout` and quietly took the
  other path.
- **Do not clear the timer when the fetch promise settles.** On the web
  that promise settles at the RESPONSE HEADERS; the body is read
  afterwards, by postgrest-js. Disarming on settle covers only the half
  that was never the problem. Measured against a header-then-stall
  server: cleared on settle, still hanging at 4s against a 1.5s deadline;
  left armed, aborted at 1.503s.

Uploads are bounded separately and per photo, because they are legitimately
slow — and a timeout there is NOT retried. Retrying it multiplies the
bound by the attempt count and again by the number of photos, which is how
a six-photo listing turned into half an hour of spinner.

# One alert, ranked, or the seller reads whichever fired last

`AlertHost` holds exactly one alert and has no queue, so a second one
silently replaces the first. Any code path that can produce two problems
has to collect them and say one sentence, ranked by what it costs the
seller — not fire one per problem and hope. `updateListing` is the worked
example: the gallery, the spin sets and the video all report into one
holder, and one `reportMedia` reads them.

The ranking has to wait for everything it ranks. When the uploads are not
awaited, the gallery outcome arrives after the video does, so reporting
at the end of the function would say nothing about the half still in
flight and then be destroyed by it a few seconds later. Two gates —
`mediaSettled` and `videoSettled` — and whichever finishes last runs the
report.

The same reasoning is why a caller driving this in a loop passes
`quietMedia`: twenty items firing twenty alerts means the seller reads one
at random. The loop collects the results and says one sentence about all
of them — and having asked for silence, it then owes the seller that
sentence. Every `quietMedia` call site pays it back.
