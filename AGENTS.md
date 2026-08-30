# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Branding

See @BRANDING.md before touching any logo, icon, colour token, typeface or
brand asset. It is the source of truth and the assets are generated from
it — do not hand-edit a PNG in `assets/`, change the spec and regenerate.

# Do not add npm scripts casually

`@expo/fingerprint` hashes package.json's **`scripts`** block into the
runtime version (source: `packageJson:scripts`). Over-the-air updates only
reach an installed app whose runtime matches, so adding one line to
`scripts` orphans every future update: `eas update` reports success, the
update appears in `eas update:list`, and no phone ever asks for that
runtime.

This has already happened once. `"test:upload"` was added, the fingerprint
went from `b3a56e8f…` to `e97b364d…`, and the app sat frozen on an old
bundle through six ships while the website updated correctly every time —
which made it look, repeatedly, like the code was wrong rather than
undelivered.

- Dev-only tooling: run it directly (`node scripts/…`), not via an npm script.
- If a script genuinely must exist, a new native build is required before
  any update reaches existing installs.
- `npm run ship` checks this now and says so loudly. It did not before: it
  passed `--non-interactive` to `eas-cli`, which that CLI rejects, so the
  check threw and printed "skipped" every time. A diagnostic that cannot
  run must never report like one that ran and passed.

devDependencies themselves are fine — `esbuild` and `sharp` are not
autolinked and do not move the fingerprint. It is the `scripts` block.

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
row does not change, suspect grants before logic. `updateListing` now
`console.warn`s its Supabase error; it used to discard it.

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

`listings.condition` does double duty: `new`/`used` for most categories,
`sale`/`rent`/`both` for Properties, reusing the same column and the same
first-step UI slot. If a third meaning ever appears (services priced hourly,
say), stop adding branches and make it a per-category "offer type"
definition instead.

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
