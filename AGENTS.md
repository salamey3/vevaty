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

`listings.condition` carries three meanings in one column and one UI slot,
and which one applies is `categories.condition_mode`:

| mode | values | where |
|---|---|---|
| `new_used` | `new` / `used` | the default, most of the catalogue |
| `offer_type` | `sale` / `rent` / `both` | Properties, Vehicles |
| `rehome` | `sale` / `free` | live animals |

The mode is resolved by walking UP from the category, nearest first
(`conditionModeForCategory`) — so Pets can hold live animals on `rehome`
beside pet supplies on the default, under one parent. `sale` is shared by
two modes on purpose: "for sale" means the same thing whichever it is.

That warning used to read "if a third meaning ever appears, stop adding
branches and make it a per-category definition instead". A third one
appeared; this is that definition. A fourth should extend the enum, not
add a flag beside it — two booleans able to disagree about the same field
is the thing this replaced.

A `free` listing posts at `price: 0` and renders as the word "Free"
(`listingPriceLines`), never as `$0`.

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
