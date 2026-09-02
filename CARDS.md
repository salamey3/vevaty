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

**Each spec glyph sits on a tinted disc** (20px, `colors.primaryTint`) rather
than as a bare stroke on white. The bare 13px line icon this replaced read
as decoration next to a bold value; a 12px glyph on a filled circle reads as
a labelled figure, which is what it is. The tint is the brand green at the
palette's lightest step, so the row still belongs to the card instead of
introducing a second accent.

It is not free, and the cost is width rather than height. A bare glyph led its
value by 17px (13px icon, 4px gap); a 20px disc with the same gap leads by 24,
so a three-spec row asks for 21px more than it used to. That is why the disc
is 20 and not the 22 it was first drawn at: 22 with a 5px gap cost 30px, and
those nine pixels are the difference between a 390pt phone's spec row falling
about 7px short of one line and falling about 16px short. Shrinking the disc
narrowed the shortfall; it did not buy any slack, and the row wraps on a
current phone either way. See the wrap threshold under Known limits, which
this change moved from ~376px of screen to ~402.

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

**Carousels take their width from the same rule**, which they did not for
the first three rounds of this. The domain landing pages' per-category
sections, the collection rows and the browse gate all passed a hardcoded
`width={192}`, chosen back when a phone grid card was 175. The grid then
went to one full-width column and to ~388px on desktop, and the carousels
stayed at 192. The result was the thing that
prompted this: a listing was a roomy card in the filtered grid and a card
half that size in the row you scrolled past to reach it, which reads as two
designs rather than one, and makes the smaller one look like a version
somebody forgot to update.

`carouselCardWidth` in `lib/cardWidth.ts` now derives it from the same
column count and the same gutter the grid uses, less one `CAROUSEL_PEEK`
spread across the cards in the row. One exception is worth naming rather
than glossing: Home's own filtered grid gives up a 240px filter sidebar and
a 72px gutter, so a card there is narrower than the row that led to it. That
is Home's sidebar arithmetic — already recorded above as its own unsolved
problem — and the alternative would be narrowing every row in the app to
agree with the one cramped grid.

The peek is not decoration. A carousel showing a whole number of cards and
nothing else is indistinguishable from a list of exactly that many, and
these rows hide their scrollbar, carry six to ten items and have no arrows —
the sliver of the next card is the only thing saying there is more. It has
to be taken deliberately rather than left to fall out of the arithmetic,
because the grid's gutter is a percentage of the row and the row's gap is a
flat 6px. What three grid-width cards leave over is `0.014 × rowWidth − 12`,
and on desktop Home an 1180px window gives the row 948 of it — so 1.3px, and
0.15px at the 1100 breakpoint where three columns start. 44px costs ~15 of a
388px desktop card
— invisible — and leaves at least 38px of the next card's photo showing once
the row's own gap is paid, about 56 on a phone where the row's trailing
inset adds to it.

The width is **measured**, not derived from the window, for the same reason
`ListingCard` measures its photo: a window width is not a container width.
`Screen` caps content at 1180 and reserves a 232px nav sidebar on the main
tabs, and any screen may pass its own cap. One live case already proves the
point: a one-category domain (Properties) renders its collection rows inside
Home's desktop grid branch, filter sidebar and all — an 868px box where a
window-derived estimate says 1180. It is invisible only because every
collection kind is photo-left on desktop and sizes itself, so the number is
discarded there. The estimate covers the first
frame so nothing visibly jumps, and on a phone it is exact on all three
paths in portrait, flush or not: the 36px of inset comes from the row on one
and from the grid around it on the other, so the row's usable width is the
window less 36 either way. Landscape on a notched phone adds safe-area edges
the estimate does not know about, and the measurement corrects it.

`DESKTOP_CONTENT_MAX_WIDTH` is a constant now rather than `1180` typed into
twenty-three `Screen` calls, because that estimate has to predict it. It is
the shared default for a full-page browse surface, not an enforced cap:
`Screen` still takes any number, and the narrower surfaces — a payment
sheet, an admin form, a chat thread — deliberately pass their own.

**The listing page's related strips are deliberately NOT part of this.**
Similar Listings, Editor's Picks and Hot Deals under a listing stay at
140px. They are a footnote under something you are already reading, not a
browse surface, and a full-size card there would compete with the listing
the page exists to show. It is the one place in the app where a listing card
is a different size on purpose, which is why it is written down here.

**The cost, stated:** a carousel card's photo request goes from 200px to
320 on a 390pt phone and to as much as 400 (the cap) at two and three
columns, and
`sizedPhotoUrl` doubles that for a retina screen — so on that phone a seeded
card's decoded bitmap goes from about 0.85MB to 2.2MB, and about 2.8MB on a
412pt Android where the request rounds up to 360. The
carousels scroller is not virtualised, so a six-category domain page holds
every row at once. This only touches picsum-seeded listings: a real upload's
thumbnail is baked at 640 and Bunny returns exactly that, so the request
width changes nothing for it. Recorded in NEXT.md rather than fixed here —
the fix is virtualising that scroller, which is its own change.

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

## Making cards line up with each other

A card's height follows its content, and content varies: a property offered
for sale *and* rent carries two price lines where everything else carries
one. Left alone that pushes everything below the price down by a line, so
nothing under it agrees with the card beside it.

Three mechanisms, and the third is the one with a real cost.

**The footer is pinned to the bottom** (`marginTop: 'auto'`). Wherever cards
are stretched to a common height — a grid row, a home carousel — every card's
district line sits on the same baseline and the difference in content shows
as a gap in the middle rather than as a ragged bottom.

**The title and spec row reserve a fixed height**, so a one-line title does
not pull everything under it up by 18px, and a category with no curated specs
does not sit a row shorter than one that has them.

**The price block reserves two lines.** This is the expensive one: only
properties offered both ways ever use the second line, so nearly every card
carries a blank line under its price. It buys the last piece of alignment —
without it the spec row on a two-price card sits 17px below its neighbour's,
which is `priceSecondary`'s line height exactly — the block itself carries no
gap between its two lines, by the decision recorded two paragraphs down.

Chosen deliberately over the alternatives of leaving that one row unaligned,
or of collapsing the two figures onto one line (which would undo the
Properties decision that a rent and an asking price must never be able to be
read as each other).

One detail that is not conditional: wrapping the two price lines in a block
of their own also removed the 5px the info column's `gap` used to put between
them, everywhere. They are two halves of one offer and read better tight; it
is mentioned because it is the one part of this that a one-column phone card
sees too.

All three reservations are switched **off** on the one-column phone grid.
There is no card beside any card there, so they would buy nothing and cost
about 55px of blank per card (18.5 + 20 + 17) on the layout that exists to
give the photo room.

**The photo-left card's picture fills the row.** It was a square, which left a
band of empty white beneath it once the details column grew taller than its
own width — worst on the cards with the most to say. The frame now takes its
height from the row, which makes it roughly 128×171 on a phone — very close
to 3:4, which is the ratio the seeded photos are already in, and a portrait
crop of what a seller's own camera usually shoots landscape. That is the accepted cost of not
having the gap, and the lever if it reads as too tight is the thumbnail's 38%
share of the card, not the ratio.

The shop pill moved inside that pinned footer at the same time. Left hanging
below it, a shop-sourced card's district line sat ~26px above a plain card's
in the same row — the pinning would have swapped one misalignment for
another.

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
- **Below about 402px of screen, the photo-left card's spec row can take two
  lines.** The card is the screen less 52, capped at 380 (400 on desktop,
  which is well clear of all of this). Out of that the photo takes
  `max(128, 38%)` and `infoHorizontal`'s padding plus the card border take
  26. Three specs with typical property or vehicle values need about 191 of
  what is left — the ~170 they needed before the glyphs got their discs, plus
  the 21 the discs cost.

  The photo's 128 floor is what makes this a threshold rather than a straight
  subtraction. Up to a 390px screen the photo is pinned at 128 and every
  point of screen goes to the text (screen − 206); above it the photo starts
  taking its 38%, so the text grows at 0.62 and 191 first arrives at a 402px
  screen.

  This was ~376 before the discs — it cleared an iPhone 12–16 (390pt) and a
  Pixel (393pt), and caught only an SE (375) or a 360px Android. It does not
  clear them any more: at 390 the text column is 184 against 191, so the row
  is about 7px short of fitting. Note the threshold moved 26px, not the 21
  the discs cost, because the extra 12 of screen it takes to make up 7px of
  text is spent 38% on the photo.

  Nothing clips — the row wraps and the card is a row taller. In Hot Deals
  and desktop Editor's Picks the other cards in the row stretch to match; in
  Just Listed they do not, because that carousel stacks its cards in columns
  of two (`twoRowColumn`) and a column child stretches in width, not height,
  so one wrapped card leaves its column-mate short. The alternatives were a
  smaller disc that stops reading as a disc, or shrinking the photo below a
  size this card has already rejected once.

- **The small vertical cards are tighter still, and always were.** A vertical
  card's text column is the card less 22 (`info`'s 10 each side, plus the
  border). The 192px carousel card therefore has 170, and the 140px
  related-listings cards on the listing page have 118 — both under the ~191
  three specs now ask for, on every screen size rather than only narrow ones.
  Only one of the two is a regression. The 140px card had 118 against the
  ~170 three specs needed and always wrapped; the discs only make its wrapped
  row about 4px taller, since a spec line goes from 18 to 20. The 192px card
  had exactly the 170 it needed and sat on the boundary, and the discs push it
  over. Worth recording alongside this: the related-listings row sets
  `alignItems: 'flex-start'`, so nothing there equalises the ragged bottoms
  that result. The lever, if it ever matters enough, is those cards' widths
  rather than the disc — 192 is 160 × 1.2, chosen for the photo and not for
  the text under it.
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
