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

## How wide a card is, and why the photo changed shape

These two are one decision, and the first was made wrong for a while.

**One column on a phone, three on desktop** (was two and four). A
two-column phone card is about 175px. Everything the card says fits at that
width — but the moment it had more to say, the *horizontal* card at 300px
did not, and the vertical one was only ever a few characters from the same
fate. The cost is real and was accepted knowingly: roughly two listings per
phone screen instead of four, so browsing takes more scrolling. It is the
shape Dubizzle and OLX use on mobile in this market.

`useListingGridColumns()` is the one place that decides it, rather than the
five listing screens each spelling out the rule. It reads the window width
directly rather than going through `useGridColumns`, because "phone" and "not
desktop" are not the same thing: a single 860px breakpoint gave an iPad in
portrait and an 800px browser window one 730px card with a photo taller than
most of the viewport. Below 600 is one column, 600–1099 is two, 1100 and up is three.

Three waits for 1100 rather than for the 860 desktop breakpoint on purpose:
at 860 the desktop layout also switches on a 232px nav sidebar, a 240px
filter sidebar and a 72px gutter, so the grid gets 316px of that window, and
three columns of it is a 104px card — narrower than the two-column phone card
this whole change exists to replace.

Stated honestly, because waiting does not fix it: two columns of 316px is
still only 156px. **Home in a narrow desktop window is cramped by its own two
sidebars**, and this change makes that less bad rather than good. Every other
grid screen reserves no sidebar, so a card there is ~362px at 1100. Home's
sidebar arithmetic is the real fix and is not attempted here.

Shop cards are not part of this — `ShopsDirectoryScreen` keeps its own 2/4
grid, because a logo and a name do not want the room.

**The photo became 4:3, having been 1:1, and the reason genuinely changed
rather than being overruled.** The square was chosen on 28 Aug because
Lebanese sellers still shoot landscape out of Facebook/OLX habit, and at a
175px card a square crops a landscape and a portrait shot by about the same
amount — a fair middle when the frame is small either way.

At full width that stops paying. A 354px card with a square photo is 354px
of photo before a word of text, so barely one listing reaches a phone
screen; and at that size the crop is no longer a rounding error, because
taking the sides off a landscape photo of a room removes the room. 4:3
matches the shape the photos were taken in and gives back about 90px of
height per card.

The cost, stated plainly: a portrait-shot photo now loses more top and
bottom than it did. Same trade as before, further along, and it falls on the
minority orientation rather than the majority one.

The listing detail page keeps its own 3:4 display — there is room for a
taller frame there and no grid rhythm to hold.

**The photo-left card sizes itself now**, and the thing that was actually
wrong with it was subtler than it first looked. At a flat 300px, minus a
128px photo, minus 24px of padding and 2px of border, the text column was
**146px**. But of the three things that looked broken in it, only one was
losing information: the title wraps at two lines and the spec row has
`flexWrap`, so both were merely getting taller. The district was the only
`numberOfLines={1}` on the card, and the only thing truly truncating —
"Beit ech Chaar · 3 day…".

So the fix is not to win pixels back off the photo: that line is simply
allowed two lines now instead of one. The card is 400px on desktop and, on a
phone, the screen width less a margin and a peek of the next card, capped at
380; the photo takes 38% of that, never less than 128.

To be exact about what that did and did not fix — the title is still capped
at two lines and the district at two, and a long enough one of either still
ellipsises. What changed is that the line which clipped on an *ordinary*
listing at an ordinary width no longer does.

The floor matters more than the percentage. A bare share made the photo
*smaller* than the 128 it had been on every phone narrower than about 388px —
117px on a 360px one — which is below the width this same card had already
rejected once as "a stamp on the card". Trading photo size for text width was
the wrong trade, and once the text stopped truncating there was nothing to
trade for.

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
- **Below about 376px of screen, the photo-left card's spec row takes two
  lines.** A 375px phone leaves it 169px against the ~170 three specs need,
  and a 360px one leaves 154. Nothing clips — the row wraps and the card is
  simply taller — and the alternative was shrinking the photo below the size
  this card had already rejected once. Stated because it will look like an
  oversight on an iPhone SE or a 360px Android and it is not.
- **Photos on listings posted before 1 Sep 2026 look soft at full width.**
  The card thumbnail is baked at upload time, and it was baked at 400px for a
  175px two-column card. New uploads bake at 640px; old ones keep the 400 they
  have until their photos are re-uploaded. 640 rather than the ~708 a
  full-width card would want at 2x, because one file serves every card in the
  app and Bunny returns exactly the bytes it was given — a carousel thumbnail
  decodes the same bitmap a grid card does, so the last 10% of sharpness would
  have cost every card in the app 50% more heap. There is no migration for this —
  the original full-size photo is still on Bunny, but re-deriving thumbnails
  for every listing is a job worth doing deliberately, not as a side effect.
- **No reference number.** The card that prompted this shows one (`#BJ94898`)
  because an agency reads it out on the phone. A C2C marketplace has no such
  workflow, and it would be a line of clutter.
