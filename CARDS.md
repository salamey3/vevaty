# What a listing card says, and who decides

Written 1 Sep 2026. The mechanics are in `src/lib/cardSpecs.ts` and
`src/components/ListingCard.tsx`; this is the record of why.

## The problem this fixes

A browse card is the only surface where Vevaty competes for attention against
every other card on the screen. It gets about a second. What it spends that
second saying is therefore an editorial decision — and until now, nobody was
making one.

The card derived its specs like this: **take the category's required
attributes, first two, in form order.** That looks defensible and is not.
`required` answers *"would I refuse to publish this listing without it?"* — a
completeness question, asked by an admin building a form. A card asks
something else entirely: *"what would make a buyer stop scrolling?"* The two
coincide often enough to look fine, and diverge exactly where it costs most.

Properties is the worst case, and it is not a corner case — it is the whole
domain. Its required attributes, in form order, begin: property type, floor
number, floors in building, total units. Bedrooms, bathrooms and area sit
fifth, sixth and seventh. So a Jounieh apartment card printed **the floor
number** and never reached the three numbers every property buyer on earth
scans for.

## The fix is a decision, not a better guess

`category_attributes.card_priority` — 1 is the first slot, null means "not on
the card". Nothing else. No fallback to required, no cleverness: a category
nobody has curated shows **no spec row at all**, which is the honest state.
An empty row is better than three fields chosen by something that does not
know what a buyer cares about.

That column already existed. It had been added, mapped into the
`CategoryAttribute` type, mapped again in `SettingsStore` — and read by
nothing. Seventeen attributes already carried values, put there during the
Pets and Fashion sessions by somebody who had decided a dog card should say
age, sex and breed. That decision sat in the database doing nothing for
weeks. **A half-built mechanism is worse than none: it looks done.**

## Icons come from the data, never from the slug

`category_attributes.icon` holds an `IconName`, chosen per attribute in the
admin. The tempting alternative — a `bedrooms → bed` lookup table in the
client — was rejected for the reason that keeps recurring in this codebase:
157 attributes across ~90 categories is not a table anyone keeps honest, and
an attribute added next month would silently get nothing until someone
shipped code.

**Null is a real answer, not a gap.** An attribute with no icon renders its
label beside the value instead — "Male", "Still sealed  No, opened". For a
value that already reads as an answer that is *better* than a glyph, and it
is why the icon set can stay at thirty legible-at-12px glyphs instead of
trying to cover everything.

Two attributes are deliberately iconless, and both earned it. `sex` on a pet,
because "Male" needs no picture. And `sealed` on cosmetics, because the
obvious glyph — a tick — put a green check beside the value "No, opened" on
every used lipstick, which at a glance reads as the opposite of what it
says.

The database column is unconstrained text; `SettingsStore` validates it
against the icon set on the way in and falls back to null. A typo in the
admin therefore looks plain, never broken.

## The pill says what the thing IS

Normally the category name, which is what a buyer would call it.

The exception is a category collapsed into one postable leaf with its real
kind moved into an attribute — Properties and Vehicles, both done
deliberately so the AI classifier would stop guessing sale-vs-rent from a
photo. For those, the category name has become a section heading:
"Properties" over a photo of an apartment tells nobody anything.
`categories.card_kind_slug` points at the attribute that does — `property_type`
gives "Apartment", `vehicle_type` gives "Car".

Null everywhere else. Inherited nearest-ancestor-first, like `condition_mode`
and `listing_lifetime_days`, so it is read through
`cardKindSlugForCategory` and never off the row.

## Why the green band went, and why the photo did not

The card used to be two zones: price and title in white on a forest-green
band, everything else on white beneath it. Three things were wrong with it.
It split every card visually in half; it forced anything inside the band to
be white text, which is what kept the title to one truncated line; and it
made the brand colour the loudest thing on the card, when the loudest thing
should be the price.

Now it is one surface and the green does the work as **accent** — the kind
pill's outline, the spec glyphs, and the price itself. Same colour, a
fraction of the weight, and room for a title that wraps to two lines.

There is a second reason, worth recording because it is not visible yet: the
per-domain colour study still has an open decision behind it. A thin accent
recolours per domain gracefully. A solid block of colour recolours loudly.

**The photo stays 1:1.** Going wider was considered and rejected. The square
was chosen on 28 Aug on real evidence — Lebanese sellers still shoot
landscape out of Facebook/OLX habit, and a square crops a landscape and a
portrait shot by roughly the same amount. A landscape card would flatter
property and vehicle photos and punish fashion, furniture and anything shot
vertically. The vertical room the card needed was cheaper to find in the info
block, which was paying for two padded halves and a colour change between
them.

## Known limits

- **~88 categories have no `card_priority` set** and therefore show no spec
  row. Properties, Vehicles, Pets and Fashion are curated; everything else is
  admin work, not a patch. This is deliberate — see above on why the fallback
  was removed rather than improved.
- **Three slots is a cap, not a target.** A category with one curated
  attribute shows one spec. Nothing is padded.
- **A spec is dropped when it repeats the title as a whole word AND is at
  least four characters.** Both halves matter. "2018" under "Honda Civic 2018"
  is a wasted slot out of three and goes. "3" under "3 bedroom apartment"
  stays — suppressing it would leave a property card showing bathrooms and
  area with a hole where the bedrooms belong. The whole-word test is what
  stops "Male" being suppressed by a title containing "female".

  The first version of this rule keyed off whether the spec had an *icon*,
  which was the wrong axis entirely: it exempted the year on every car card,
  so the one worked example the design was written around never happened.

- **A multiselect prints two values and a count** — "38, 39 +3" rather than
  "38, 39, 40, 41, 42". A shoe listed in five sizes is ordinary, and the full
  list is a paragraph in a slot meant for a glance.

- **Numbering past three is a fallback, not waste.** A higher number renders
  only when a lower one is hidden for that listing. Properties is numbered
  Bedrooms 1, Bathrooms 2, Area 3, Land area 4, View 5: an apartment shows
  the first three, and a plot of land — which has no bedrooms or bathrooms —
  falls through to Area and View. Two attributes may not share a number; the
  admin blocks it, because a tie is resolved by inheritance depth, which is
  not a decision anyone made.
- **No reference number.** The card that prompted this shows one (`#BJ94898`)
  because an agency reads it out on the phone. A C2C marketplace has no such
  workflow, and it would be a line of clutter.
