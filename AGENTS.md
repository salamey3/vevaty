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
