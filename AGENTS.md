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

Checked 10 Sep 2026, and that is no longer the whole picture: `authenticated`
now holds table-level INSERT and UPDATE on all three tables, and table-level
SELECT on `listings` and `shops`. So a new column there is writable by every
signed-in session by default, and readable on those two. Only SELECT on
`profiles` is still per column — the case that matters most, below. A new
column a client must NOT be able to write needs a guard trigger, not a
missing grant (see "Membership and tester tags are the server's to write").

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

Two things follow from that drop-and-recreate, and both have cost real
time. **The `EXECUTE` grant dies with the function**, so a drop must be
followed by `grant execute ... to authenticated, service_role` in the same
migration or every client call starts failing with `42501`. And **the
original body is gone the moment you drop it** — recover it from
`supabase_migrations.schema_migrations` (its `statements` array holds the
SQL text) *before* dropping, not after. Dropping `add_auction_lot` and
replacing it with a call to a helper that had never been written took the
whole intake path down until the old body was dug back out of the
migration history.

Which is the general rule: **plpgsql does not validate a function body when
you create it.** A migration that references a table, column or function
that does not exist reports `success` and then fails at the first call.
Nothing is proven until the function has actually been *run* — so every
migration here ends with a test-fire, and a write path is exercised inside
a transaction that raises at the end (`raise exception 'RESULTS %'`) so the
proof costs no production residue.

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

`listings.condition` carries five meanings in one column and one UI slot,
and which one applies is `categories.condition_mode`:

| mode | values | where |
|---|---|---|
| `new_used` | `new` / `used` | the default, most of the catalogue |
| `offer_type` | `sale` / `rent` / `both` | Properties, Vehicles |
| `rehome` | `sale` / `free` | live animals |
| `graded` | `new` / `like_new` / `good` / `fair` | Fashion & Beauty |
| `made_to_order` | `ready` / `to_order` | Arts & Crafts |

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

A fifth then did appear — `made_to_order`, for Arts & Crafts — and it went
in that way: one row in `CONDITION_VALUES_BY_MODE` and its labels in the
three value maps and three mode maps beside it. `ready` and `to_order` are
NOT aliases of `new`: a buyer filtering crafts for "I can have it today"
must not be handed every brand-new item in the catalogue.

Four other places still had to change, and they are the checklist for a
sixth:

- **`ConditionMode` in `src/types/index.ts`** — the union itself.
- **`CONDITION_MODE_LABELS` in `AdminCategoriesScreen`** — the one list of
  modes outside `conditionModes.ts`, because an admin-only English label
  cannot live in the translation table. It is a `Record<ConditionMode,…>`
  so leaving a mode out is a compile error; it used to be an array, and an
  array silently gives a category on the missing mode no lit chip at all,
  which reads as "Inherit" and invites an admin to overwrite it.
- **`DEFAULT_CATEGORIES` in `src/data/categories.ts`** — the first-paint
  fallback. Its `active` flag has to agree with the database's or a tile
  flashes in or out on every cold start.
- **Wherever the answer genuinely changes something.** For this mode, two:
  a "From $45" price line, because the figure on a made-to-order piece is
  where the price starts, and a "Contact to order" button.

`conditionModeForCategory` returns a mode only if this build has an answer
list for it, and otherwise stops and answers `new_used` — it does NOT keep
walking up, because a category that names its own mode has overridden its
ancestors deliberately and inheriting the parent's answer would put
Sale/Rent pills on a leaf whose owner said otherwise. The database runs
ahead of the app for as long as an update takes to reach a device, and an
unknown mode is not a wrong label: it is `undefined.map()` in the create
form's picker and in the browse filter, i.e. a white screen. That guard is
the belt; the brace is seeding a new mode's categories `active = false`
and flipping them on once the update has landed.

**Both CHECK constraints are drop-and-recreate, so build the new list from
the LIVE definition, never from memory or from a snapshot.**
`categories_condition_mode_check` and `listings_condition_check` each
enumerate every allowed value, so widening one means dropping it and
adding it back with the full list. On 12 Sep two sessions added a mode the
same afternoon; the second one's list was written against a definition
that was already stale, and re-adding the constraint failed against the
first one's rows — the good outcome, but only because a row happened to
use the dropped value. Read `pg_get_constraintdef` immediately before
writing the migration.

A `free` listing posts at `price: 0` and renders as the word "Free"
(`listingPriceLines`), never as `$0`.

# Name the foreign key in every PostgREST embed

`select('*, owner:profiles(full_name)')` works right up until someone adds a
second column pointing at the same table, and then the whole query dies at
parse time with *"Could not embed because more than one relationship was
found"* — an empty screen, not a missing field. It has happened once: the
admin Storefronts page went dark the first time a storefront was created,
because `shops` had grown a `verified_by` beside its `owner_id`.

So spell the key out: `owner:profiles!shops_owner_id_fkey(full_name)`. Seven
tables in this schema already reach `profiles` twice — `shops`, `reports`,
`reviews`, `chat_threads`, `transactions`, `admin_actions`,
`auction_submissions` — and any of the others can grow a second path the day
somebody records who did something.

# A category can offer choices with prices, and the server owns the money

`categories.options_mode` ('off'/'on', nullable, resolved
nearest-ancestor-first exactly like `condition_mode` — read it through
`optionsOnForCategory`, never off the row) turns on a step in the posting
form where the seller builds option groups: Size (pick one), Add-ons (tick
any), each choice able to add money and to ask the buyer one short
question. On for Arts & Crafts and nowhere else so far.

Three rules, all of them load-bearing:

1. **The groups belong to the LISTING, never to a shared template.** What a
   buyer saw has to stay what a buyer saw. `myazar.seller_option_sets` is
   the seller's library of named sets, and a set is COPIED in — its stored
   body holds no ids at all, only labels, prices and questions — so editing
   "my usual sizes" next month cannot rewrite an order from last month. The
   library hangs off the seller rather than the shop: for every real case
   they are the same person, and the seller this was built for has no shop.
2. **Every price a human reads is built server-side.** The client sends
   only the ids it ticked, the quantity and any typed answers;
   `myazar.send_listing_order` rebuilds the labels, the prices and the
   total from the live rows and writes them into the message. A card can
   therefore never show a price the seller never published, and it is
   frozen at the moment of sending.
3. **A priced choice is per item or per order.** Twelve gift boxes at +$12
   is fair; one delivery at +$30 charged twelve times is not. The formula
   is `qty × (base + per-item extras) + per-order extras`, and it is
   written twice on purpose — in `send_listing_order` and in `totalsFor`
   in `src/lib/listingOptions.ts` — because a total that changes when the
   buyer taps Send is a total nobody trusts.
   `scripts/test/listing-options.test.mjs` checks the client against the
   figures the SQL harness produced (60 favours with a per-order delivery
   = $7,710). Change one side and you must change the other, and that test
   is what will tell you.

The buyer's picks arrive in the chat as `kind = 'order'`, a fourth kind
beside text, offer and system, with the frozen detail in
`chat_messages.order_snapshot`. `body` always carries the same thing as a
readable sentence, which is what a build that predates the kind renders.
The seller's "Give a price" pre-fills the existing offer card rather than
sending it.

It is an **estimate**, not a checkout. Vevaty takes no money; a total
presented as final would be the app promising something on the seller's
behalf. Anything added here says so.

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

# A policy's subquery sees only what the caller can see

Found 10 Sep 2026, and it had been open for weeks: **any signed-in account
could make itself an admin.** `myazar.admins` carried a policy "bootstrap
first admin" that allowed an INSERT while the table was empty, tested with
`NOT EXISTS (SELECT 1 FROM myazar.admins)`. But a subquery inside a policy
runs under the CALLER's row security, and the only read policy on that
table is "admins can read own row" — so to everyone who was not already an
admin the table always looked empty, and the check always passed. Proven
with a throwaway account in a rolled-back transaction, then closed
(`close_admin_self_insert`): the policy dropped, INSERT/UPDATE/DELETE
revoked. Every `admin_*` function, every admin policy and the tester
round's invite rule trust that table.

The rule: **"no row is visible" is not "no row exists".** A policy that
decides anything from another table's CONTENTS answers from the caller's
view of it. The restrictive "admin identity requires mfa" policy is the
same trap the other way round — it counts the caller's rows in
`auth.mfa_factors`, whose rows a signed-in session cannot see, so it always
counts zero and always accepts aal1 (see @NEXT.md). A decision that must
see the real table belongs in a SECURITY DEFINER function.

# A new table in this schema is granted to everyone until you say otherwise

The schema's default privileges hand every new table to `authenticated`
wholesale — SELECT, INSERT, UPDATE, DELETE. A column-level grant written
beneath that is decorative. Found by test-firing `problem_reports`: the
intent was "admins may change a report's status", and an admin could
rewrite the tester's own words. Every new table starts with

```sql
revoke all on myazar.new_table from anon, authenticated;
```

and then grants exactly what is meant.

# Membership and tester tags are the server's to write

`profiles.is_phone_verified` (membership), `tester_roles` and the
suspension columns are written only by SECURITY DEFINER functions.
`authenticated` holds table-level INSERT/UPDATE on `profiles`, so
`guard_profile_membership_columns_trg` refuses any client session writing
them directly — an admin's too, so that every admin change is one the
`admin_*` functions logged. Posting a listing, starting a chat and reading a seller's
number all require a member. `tester_roles` must never get a SELECT grant —
`profiles` is readable by everyone on every row, so a grant would publish
who is in the tester round; `my_tester_status()` is how an account reads its
own. (`listings.is_test` does say it, for anyone with a live listing — see
@TESTERS.md.) @ACCOUNTS.md and @TESTERS.md have the reasoning.

# An admin power asks admin_session_active(), not the admins table

Since 11 Sep 2026 the admin lock is the server's (@ACCOUNTS.md, "The admin
lock is the server's"): admin powers need an unlocked, code-verified admin
session. These rules keep it that way:

- **A new SECURITY DEFINER function that grants an admin power checks
  `myazar.admin_session_active()`.** Never `exists (select 1 from
  myazar.admins where user_id = auth.uid())` — as the function's owner it
  bypasses the admins table's policy and answers "an admin account", locked
  or not, code or no code, which is the hole this closed in 32 functions.
  Use membership only where the question genuinely is "is this an admin
  account?" (the four listed in @ACCOUNTS.md).
- **A new RLS policy may keep the usual `exists (select 1 from
  myazar.admins ...)`.** It runs as the caller, under the admins table's own
  policy, which already requires `admin_session_active()`. Do not loosen
  that policy: every admin policy in the schema leans on it — and keep it
  `TO authenticated`, because `anon` has no EXECUTE on the function.
- **`admin_session_status()` must never raise.** It now runs inside the
  row-level security of every signed-in query, so an error in it is an
  outage for every member. Anyone who is not an admin returns before
  anything that can fail, and the admin path is wrapped to answer "locked"
  instead of raising. Keep both when changing it.
- **An admin's authenticators are pinned** (`admins.totp_factor_ids`). A
  new admin, or a new authenticator, needs its factor id added there — the
  literal id, never one found by a lookup in the same statement — or its
  codes open nothing. Never pin "whatever factors the account has": a
  locked session can add one of its own (@ACCOUNTS.md). And in SQL about
  the pin, test membership with `(x = any (list)) is not true`, never
  `not (x = any (list))`: the second is NULL, and skipped by an IF, when
  the list holds a NULL.

# An admin page is registered through adminOnly

Every admin screen except the sign-in itself (`Admin`, AdminGateScreen) is
registered in RootNavigator as `adminOnly(Screen)`, created once at module
level, and its web path goes under `control-room/`, never `admin/`. A
screen registered bare is a page anyone can open by typing its address —
which is what every inner admin page was until 10 Sep 2026. The server
refusing the page's reads and writes is the lock; `adminOnly` is what keeps
members from seeing the room at all. @ACCOUNTS.md has the reasoning.

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

**A mapper that collapses an unknown value into a default is a silent
bug waiting for the next enum member.** `ChatStore`'s
`row.kind === 'offer' ? 'offer' : 'text'` was correct for exactly as long as
there were two kinds; the day the database grew a third, the new one arrived
in the app disguised as the oldest one -- a system announcement rendering as
a chat bubble from a person. Name every case you know and let an unknown one
be visibly wrong rather than quietly ordinary. The same shape hides in any
`x === 'a' ? 'a' : 'b'` over a column with a CHECK constraint.

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
