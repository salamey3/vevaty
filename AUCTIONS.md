# Auctions

Written 2 Sep 2026, finished 3 Sep. The section is built end to end —
schema, proxy engine, closer, buyer screens, admin screens, and media on
both — and switched OFF behind `site_settings.auctions_enabled`, so
nothing is reachable until somebody turns it on in Admin → Auctions. This
is the record of what was decided and why, so the next person to open the
engine does not undo a rule by accident.

**Where it stands.** Every mechanism has been exercised against the live
database — opening bid, outbid, self-raise, tie, reserve lift, anti-snipe,
close to won and to unsold, every rejection code, and the whole admin path
including delete. What has NOT happened is one sale walked through on a
real device by a person: build a lot, publish, bid from a second account,
let it close. Do that before showing it to anyone. Settlement is the one
piece deliberately absent — see the last section.

## What it is

Fifteen or so curated lots, every second Friday. Sellers consign, Vevaty
selects, Vevaty takes physical custody, shoots the photos, the 360 spin
and the video itself, and runs a 48-hour auction that opens Friday night
and closes Sunday evening. The winner is charged, the item ships Monday.

**Custody is the whole idea, not an operational detail.** An auction asks
somebody to commit money to a photograph of a stranger's object, which is
a very large ask in a low-trust market. Holding the item and producing the
media ourselves takes the seller out of the trust equation: the buyer is
trusting Vevaty, and Vevaty has the thing. Nobody else here does it
because it is expensive, which is exactly why it is defensible.

The model is not novel and that is a point in its favour, not against it —
Catawiki runs curated weekly auctions with expert selection, StockX does
custody plus authentication at a fixed price, Bring a Trailer does
seven-day car auctions. None of them operate in this market. Mechanics
worth copying are copied below rather than reinvented.

## Where a lot lives

**A lot IS a listing**, carrying the new `listings.status = 'auction'`,
with an `auction_lots` row beside it holding everything auction-specific.

That was the decision with the most consequences, so the reasoning:
photos, 360 spin sets, video, category attributes, the AI classifier and
`ListingCard` itself all hang off a listing. A separate `auction_items`
table would have duplicated every one of them, and the 360 spin is the
single most persuasive thing this feature has to show.

The cost is one exclusion, and it has to be paid in exactly one place.
`AppStore` loads every listing RLS will give it into a client-side array
that the whole browse surface filters locally, so without a filter a lot
would appear in a Classifieds grid, in Hot Deals, and in search. Its fetch
therefore excludes `status = 'auction'` explicitly rather than relying on
the status enum being handled somewhere downstream.

The matching RLS door is deliberately narrow: a listing with that status
is publicly readable **only** while it is a lot in an auction that is
itself published. A draft auction's lots are invisible even to somebody
holding their ids.

**That door has to be opened three more times, and shipping without it was
a real bug.** `listing_photos`, `listing_spin_sets` and `listing_videos`
each carry their own policy, and every one of them gated reads on the
parent listing being `'active'` — which a lot never is. The listing came
back, the media did not, and every lot rendered the placeholder glyph for
every buyer: the whole product missing, on a feature whose pitch is the
photography. Three matching policies now let a lot's media through on the
same condition the listing itself uses. The general shape is worth
remembering: adding a listing status is never one policy, it is one per
table that gates on status.

## The bidding engine

**Proxy bidding**, the eBay and Catawiki model. A bidder names the most
they will pay; the house bids the minimum increment on their behalf and
publishes only the price reached.

Over 48 hours this is not a nicety. Without it nothing happens for 47
hours and the whole auction resolves in the last sixty seconds, so the
winner is whoever happened to be awake with a good connection — which is
not price discovery, and it teaches everyone else not to bother next time.

It lives in `myazar.place_bid()`, one `SECURITY DEFINER` function, and the
reasons it is not client-side logic are worth stating:

- **`SELECT ... FOR UPDATE` on the lot.** Two bids in the same instant must
  serialise. Without the lock both read the same price, both compute
  themselves the winner, and the lot ends with a leader whose ceiling was
  never actually the highest.
- **There is no INSERT policy on `auction_bids` at all.** A bid that could
  be written directly is a bid that skips the increment table, the
  registration check and the clock.
- **A LIVE leader's ceiling is never published.** Publish it and the
  mechanism is over. The table has no public read policy — the same lesson
  as `profiles.phone`, where a column-level SELECT grant turned out to mean
  "every signed-in user, on every row" (@AGENTS.md). Public price and bid
  count live on `auction_lots`; the visible history comes from
  `auction_lot_bid_history()`, which returns amounts and a per-lot alias.

  An **exhausted** proxy's ceiling is published, and deliberately: when a
  challenger is outbid on arrival their bid row stands at their own max,
  because that is what a losing bid is and every auction house shows it.
  The bid sheet's copy says exactly this — "while you're winning nobody
  sees it" — and it took a review to catch that an earlier draft promised
  "nobody sees the number", which the engine breaks within seconds of a
  losing bid.
  The price can also land exactly on a beaten leader's ceiling. Neither
  tells anyone anything about a bidder who is still in the running, which
  is the only secret that matters — but the distinction is worth stating,
  because "max_amount is never published" is the sentence somebody will
  build on and it is not quite true.

- **Three columns on `auction_lots` are not readable by anyone**, and the
  blanket table grant that made them so was the first review's blocking
  finding. `reserve_price` — a reserve everyone can read is not a reserve.
  `leading_bidder_id` and `winner_id` — an `auth.users` id joins straight
  to a publicly readable profile name, which would have undone the aliases
  in the bid history from the column right next to them. What a client
  gets instead is `has_reserve`, `reserve_met`, and `my_leading_lots()`,
  which answers "am I winning" without ever naming who is.

Rules the engine encodes, each of which is a decision:

- **The opening bid stands at the start price**, however high the bidder's
  ceiling. Naming a big number first should not cost them the difference.
- **Raising your own ceiling does not move the price.** Bidding against
  yourself is the thing a proxy exists to prevent.
- **A tie goes to the earlier bidder**, at that price. Two people with the
  same ceiling is a real case, and "whoever committed first" is the only
  defensible answer.
- **Increments are tiered** — $5 under $100, up to $250 over $10,000. A
  flat step is wrong at both ends: $5 on a $12,000 watch is noise, $250 on
  a $60 lamp is a wall.
- **The reserve is a floor the proxy climbs to, not a test applied at the
  end.** The naive reading — "at close, if the price is under the reserve,
  the lot is unsold" — loses sales that were made. A bidder whose ceiling
  is $3,000 on a lot reserved at $2,500 has met the reserve; the price
  simply never climbed there because nobody pushed them. So a bid whose
  ceiling covers the reserve lifts the price to it immediately. Whether
  the reserve is MET is public; the number is not.
- **A consignor cannot bid on their own lot.** Shill bidding is the exact
  thing a curated auction house exists to be trusted about, and the reserve
  makes it unnecessary anyway: a seller who wants a floor sets one.
- **Anonymous sessions cannot bid, register or save a card.** The app signs
  every visitor in anonymously, so an anonymous JWT is the DEFAULT caller
  into these functions rather than an edge case, and `auth.uid() is null`
  does not catch it. Registration additionally requires a verified phone —
  the same bar posting already sets, since bidding commits money and should
  not be reachable from an account that could not list a bicycle.
- **Anti-snipe**: a bid inside the last two minutes pushes that lot's close
  out by two minutes, so a lot ends when bidding stops rather than when the
  clock happens to run out. `advance_auctions()` is what actually opens an
  auction and closes its lots, and it runs on a **one-minute** pg_cron
  tick. That cadence is set by this rule: a coarser tick would let bids
  land minutes after a lot should have closed and would make the staggered
  two-minute closes meaningless.
- **Lots close two minutes apart**, not together. Fifteen lots ending at
  one instant splits attention and destroys fifteen endgames at once.

## Money

15% from the seller **and 10% from the buyer**. The buyer's premium is not
in the original sketch and is the single largest economic lever available:
every auction house charges both sides, and it raises the take from 15% to
25% without the seller feeling anything.

It matters because the arithmetic is tight. Fifteen lots × 26 auctions is
390 lots a year, and at a $500 average hammer a seller-only 15% takes
$29,250 before the storage unit, the studio time, the courier and the
fraud reserve. The same year at 25% takes $48,750. **The model needs
a high average lot value to work at all** — this is a watches, gold,
jewellery, art and high-end-electronics operation, and the selection rule
that follows from the economics is "is this lot worth more than about a
thousand dollars", not "is it in good condition".

**Rates are set per LOT, not per sale.** `auction_lots.seller_commission_pct`
and `auction_lots.buyer_premium_pct` are nullable, and null means "use the
auction's rate" -- so `auctions.seller_commission_pct` /
`auctions.buyer_premium_pct` are the sale's *defaults*, and a lot only
carries its own numbers where a real agreement differs from them. Same
shape as `profiles.tier_override` beside `profiles.tier`: an override
column next to a default, resolved by coalesce at read time
(`myazar.effective_lot_rates(lot_id)`).

That shape, rather than stamping the sale's rate onto every lot at
creation, because otherwise changing an auction's defaults would silently
fail to reach any lot already added under them -- and the admin would have
no way to tell which lots were negotiated and which merely predated the
change. Storing only the exception keeps that distinction, which is why
the lots list says "15/10 default" or "6/15 agreed" rather than just a
number.

This exists because a flat rate is wrong at both ends of the range. 15%
off a $500 lot is a fair price for photography, authentication, storage
and a sale; 15% off a $23,000 handbag is $3,450 for the same work, and the
consignor who owns that handbag can take it to a house that will charge
him almost nothing -- at Christie's and Sotheby's the seller's commission
on a good consignment is negotiable and frequently near zero, and the take
is loaded onto the buyer instead. Being able to answer that with a
per-lot deal is the difference between winning a consignment and losing
it. The columns are admin-only (`revoke` on both, not just RLS): a rate is
a commercial term between Vevaty and one consignor, and a rival consignor
reading it off the wire is a negotiation problem before it is a privacy
one.

**The two sides are two different invoices.** The seller's commission comes
*off* the hammer and the buyer's premium goes *on top* of it, so a lot that
falls at $1,850 in a 15/10 sale produces:

| | |
| --- | --- |
| Hammer | $1,850.00 |
| Seller commission (15%) | −$277.50 |
| **Seller collects** | **$1,572.50** |
| Buyer's premium (10%) | +$185.00 |
| **Buyer pays** | **$2,035.00** |
| **Vevaty's take** | **$462.50** |

`myazar.lot_settlement(hammer, seller_pct, buyer_pct)` is the only place
that arithmetic exists, and it takes the rates as arguments precisely
because they now vary lot by lot. It returns all six figures as jsonb and the monitor
reads them from there rather than multiplying in TypeScript -- the invoices
and payouts settlement eventually generates have to agree with what an
admin read off the screen to the cent, and two implementations of one sum
is precisely how a seller gets paid a different number from the one he was
quoted.

Two rules inside it that are accounting decisions, not implementation
details:

- **Rounding is per lot, to two decimals.** An invoice line is a real
  amount of money and gets rounded once, where it is created.
- **An auction total is the sum of the per-lot lines**, never a percentage
  of the total hammer. With per-lot rates this stops being a rounding
  nicety: once two lots in a sale settle at different percentages there is
  no single rate you could apply to the total and get the right answer at
  all.

**Rates freeze when a lot is won.** `advance_auctions()` stamps the
resolved pair onto the lot as it closes, and `update_auction_lot` refuses
a rate change on a `won` or `settled` lot with `rates_locked`. Without the
stamp, a lot that inherited its rates would keep inheriting them -- so
editing the sale's defaults months later would silently restate what
Vevaty owes a seller who has already been paid. The refusal is the same
rule from the other side. Correcting a genuine mistake on a settled lot is
deliberately not something this function can do by accident; it takes a
migration, which is the right amount of friction for restating an account.

**An unsold lot charges nobody** -- no sale, no commission, no premium, no
line in the books. If Vevaty ever wants an unsold or withdrawal fee (some
houses charge one) that is a new percentage on `auctions`, not a change to
this function.

## Payments

**No card number reaches this codebase.** The `demo` provider accepts
published test numbers only, and what is stored is exactly what a real
gateway hands back after tokenising on the client: an opaque token, a
brand, four digits and an expiry. Wiring Areeba or Tap changes `provider`
and the client-side tokenise call, and nothing else about the shape.

The provider is stubbed because there is nothing to charge yet, not
because the design is undecided. Two decisions that are made:

- **Registration is per auction**, not once forever. A card that cleared a
  fortnight ago is not evidence about this weekend, and it gives an
  obvious place to block one bidder from one event without banning them.
- **A blocked registration is never silently healed** by re-registering.
  The upsert updates the card and leaves the status alone.

When a real gateway does land, the design to build is an **authorisation
hold at bid time**, not a stored card charged at close. Storing a card and
charging it unattended 48 hours later is the highest-decline flow that
exists, and it is worst in exactly this market — card-on-file is uncommon
in Lebanon and declines run high on currency mismatch and 3DS. A hold
verifies the card while the bidder is present and 3DS can challenge them.

The cascade to the next bidder in the original sketch is deliberately NOT
built. Charging a runner-up 48 hours later for something they did not win
and stopped thinking about is a chargeback generator, and card networks
side with the cardholder on card-not-present disputes almost every time.
The runner-up should get a time-boxed **offer**, not a charge. That is a
v2 decision and it is unbuilt rather than forgotten.

One more thing the consignment model had to be defended against, found in
review: `get_seller_contact()` took a listing id and returned the seller's
phone with no status filter, and a lot's `listing_id` became publicly
readable the moment `auction_lots` did. So any signed-in user could read a
lot id off the auction and phone the consignor directly — around both
commissions, and around the custody model that is the whole reason the
feature exists. It is now pinned to `status = 'active'`, which is the only
state where a contact button is rendered anyway.

## The admin half writes through functions, not tables

Worth its own note because the first version of these screens did not, and
none of it worked.

`authenticated` has no INSERT, UPDATE or DELETE on any auction table —
deliberately, since a grant nobody needs is a leak waiting for a policy
change. The admin screens were written against those tables anyway, on the
assumption that the `admins manage …` policies would allow it. **They
cannot: a policy filters rows, it does not confer a privilege.** Every
admin action failed with `42501`, including reading the lot list, which
named `reserve_price` — a column granted to `service_role` alone, and
naming one ungranted column fails the whole statement (@AGENTS.md).

So every admin write is a `SECURITY DEFINER` function that checks
`myazar.admins` first: `create_auction`, `update_auction`,
`delete_auction`, `publish_auction`, `add_auction_lot`,
`create_auction_lot`, `remove_auction_lot`, `cancel_auction_lot`, and
`admin_auction_lots` for the read that needs `reserve_price`. Several of
them exist as functions for a second reason as well: they are pairs that
must not half-complete.

- **Adding** a lot inserts it AND flips its listing to status `'auction'`.
  Apart, either half is wrong in a way somebody has to notice: a lot whose
  listing is still active puts a consigned item into the browse grid and
  Hot Deals, and a flipped listing with no lot is invisible to the
  marketplace, invisible to the auction, and reachable from no screen in
  the app. The lot NUMBER is assigned in there too, under the auction's
  row lock — the client was reading it off the list it had already
  rendered, which races the unique constraint with two tabs open.
- **Withdrawing** a lot from a published auction is a third function
  (`cancel_auction_lot`), and it is not a delete: bids may have been
  placed, and the lot has to stay readable so the people who placed them
  can see what became of it. The item goes back to the marketplace the same
  way a draft removal returns it. This existed as a *rendered state* before
  it existed as an action — the cards already knew how to draw
  `cancelled` — which is the half-built mechanism @AGENTS.md warns about,
  found in review.
- **Removing** one restores the listing, closes the lot-number gap so
  `publish_auction` does not stamp a hole in the staggered closes, and
  **restamps `expires_at`**. That last one is not housekeeping:
  `set_listing_expiry` only restamps on a category change or out of
  `'draft'`, so a listing that spent three weeks in consignment would come
  back to the marketplace already past its expiry and be swept by the
  nightly job within hours.

## Two ways in, and no status gates

A lot can be **consigned** from an existing listing or **built from
scratch** by `create_auction_lot`, which inserts the listing at status
`'auction'` directly and the lot beside it, in one transaction.

Consignment alone was the original design and it was wrong. Consignment in
reality starts with the item arriving at our door — nobody listed it for
sale first, and requiring them to means posting every auction item to the
marketplace and immediately pulling it back out. The from-scratch form takes stills, a 360 set and a
video; the lot editor takes the same three afterwards, which is the only
way to correct them.

Photos are uploaded **before** the lot is created, not after. Reversed, the
lot exists first — publicly biddable, on a live auction, rendering the
placeholder glyph for as long as eight uploads take, and permanently so if
they fail. Uploading first means a failure creates nothing at all.

Every "only while this auction is a draft" guard is also gone. Lots can be
added, removed and withdrawn at any status, the schedule can be moved after
publication, the status can be forced to any value, and the whole auction
can be deleted. The reasoning is not that these all make sense — removing
a live lot deletes real bids — but that an auction being tested has to be
correctable without being rebuilt, and a guard that stops the operator is
worth less here than the screen that warns them. Every destructive action
names its consequence in the confirmation instead.

Two things do the guarding that is left:

- `publish_auction` still refuses an auction with no lots, an incomplete
  schedule, or a first close behind its open. Publishing is the step with a
  reader on the other end. `update_auction` deliberately refuses none of
  that, which is what makes "pull the first close behind now() to end the
  sale at the next minute tick" possible.
- **`auction_lots.created_for_auction`** decides what happens to a lot's
  listing when the lot or the auction goes away: a consigned one returns to
  the status it had (`coalesce(listing_prev_status, 'active')`, restamped);
  one created for the sale is **soft-removed, never destroyed**.

  That column exists because of a specific incident. The first version
  inferred the same thing from `listing_prev_status IS NULL`, and a lot
  recorded before that column existed had a null — so deleting a test
  auction hard-deleted a real, live listing and its photos. An inference
  standing in for a fact is exactly the class of bug @AGENTS.md is about; a
  boolean that only `create_auction_lot` ever sets cannot be wrong by
  omission. Soft-removal is the second belt: the destructive branch can no
  longer destroy anything, and it also cannot fail — `reports` and
  `transactions` reference listings with `NO ACTION`, so a lot somebody
  reported was undeletable and the delete surfaced as `unknown`.

  **Soft removal only counts if nothing else erases it later**, and the
  first version of that did not. `purge-removed-listings` runs daily and
  permanently deletes anything that has sat at `status = 'removed'` for
  fifteen days, photos and Bunny video included — so "kept, not destroyed"
  was true for a fortnight and then quietly stopped being true, which is
  worse than an instant delete because nobody would connect the loss to the
  click that caused it. These removals are filed under
  `removed_reason = 'auction_lot'` and the purge job skips that reason.
  Its filter is spelled `or=(removed_reason.is.null,removed_reason.neq.auction_lot)`
  rather than a bare `neq`, because `removed_reason <> 'auction_lot'` is
  NULL for a row with no reason on file and a plain `neq` would have
  silently stopped purging every legacy row.

- **A forced status carries the lots, for every status.** `advance_auctions`
  closes any lot that is `'live'` with a passed `closes_at` and never reads
  the auction above it. `update_auction` handled two of the six statuses at
  first, so an auction forced to `cancelled` went on stamping winners a
  minute later, and one forced back to `draft` did it invisibly — RLS hides
  a draft auction from every buyer while its lots resolve underneath. It
  now cancels, demotes, stops the clock or brings the lots to their close
  as each status requires.

  Every column it writes is coalesced, so a null argument means "leave it
  alone" — which meant the two schedule fields could not be EMPTIED, and
  the attempt was silent: the form accepted a blank box, the save reported
  success, and a `scheduled` sale went on opening at its old time.
  `p_clear_opens_at` and `p_clear_first_lot_closes_at` are the same
  explicit flags `update_auction_lot` uses for the reserve, for the same
  reason. Both are refused unless the status the save LANDS on is `draft`
  (testing the status it started from would refuse clearing the schedule
  in the same save that demotes the auction, which is a real thing to
  want), and the lot-reschedule cascade below now also requires a non-null
  first close — otherwise a cleared schedule would compute `null +
  interval` into every lot's `closes_at`, which is the one state
  `advance_auctions` can never resolve.

- **`update_auction_lot`** corrects a lot in place: start price, reserve
  (with an explicit `p_clear_reserve`, since null already means "leave
  it"), the lot's status, and the title and description of an item this
  account owns. It is not a nicety. No listing screen in the app will open
  something at `status = 'auction'` — `AppStore` and the moderation screen
  both exclude it — so before this, a typo in a from-scratch lot could
  only be fixed by removing the lot and rebuilding it.

  The biggest thing it does is the least obvious: **the listing follows the
  lot.** Moving a lot back into the sale takes its item out of the
  marketplace; cancelling one hands a consigned item back, recording what
  it was. Without that, the two disagree — a revived lot whose item is
  still publicly on sale, or a withdrawn lot whose item is in neither
  place — which is the exact state `add_auction_lot` was made a
  transaction to prevent.

  Two more that are easy to miss. It writes `reserve_met`,
  a plain stored boolean that otherwise only `place_bid` sets — a reserve
  raised past the current bid would leave every bidder reading "Reserve
  met" on a lot heading for unsold. And setting a lot `live` stamps a
  fresh close when the lot's own is null **or already past**, because the
  case this parameter exists for — reviving a lot its auction cancelled —
  is exactly the case where the old close is behind us.

**A withdrawn lot stays withdrawn.** `publish_auction` reset every lot in
the auction to `pending` with a fresh close, cancelled ones included. That
was harmless only because withdrawal was impossible on a draft — which this
change makes possible. Withdrawing a consigned lot from a draft puts its
listing back in the marketplace and leaves the lot `cancelled`; publishing
then revived the lot, so the same item was live in an auction and buyable
in the browse grid at once. Both the lot update and the `no_lots` check now
exclude `cancelled`.

**A lot with no clock stops the whole sale.** `place_bid` refuses a bid on
a lot whose `closes_at` is null, the lot-closing pass skips it, and the
auction-closing pass waits for no `pending` or `live` lots to remain — so
one such lot keeps its auction `live` for ever, with every other lot's
result frozen inside a sale that never ends. It was reachable by reviving a
withdrawn lot with the `pending` pill on a published auction. Two guards
now: `update_auction_lot` stamps a close for `pending` as well as `live`
whenever the auction is past draft, and `advance_auctions` gained a repair
pass that promotes any `pending` lot inside a `live` auction and stamps a
floored close on any live lot missing one. The second is the one that
matters — it makes the invariant true rather than trusting every writer to
maintain it, and the previous version only ever promoted lots for auctions
it had opened in that same statement.

**One status the pills cannot hold.** `advance_auctions` opens any
`scheduled` auction whose `opens_at` has passed, so forcing a running sale
back to `scheduled` is undone within a minute unless `opens_at` moves with
it. `draft` and `cancelled` are the two that stop a sale on their own. The
form says so rather than the function silently rewriting a schedule nobody
asked it to change.

**A lot page that shows the media.** Adding spin and video on the admin
side was half the job: `AuctionLotScreen` rendered `listing.photos` and
nothing else, and `photos` is `sortedByKind(rows, 'gallery')`, so spin
frames are filtered out of it by construction. A 24-frame spin and a
60-second video both wrote correctly, came back correctly through
`fetchLotListings`, and appeared nowhere — on the one page that has to sell
the thing, for a feature whose entire pitch is the photography. The page now
carries Photos / 360 / Video tabs, shown only when there is something to
switch to, so an ordinary lot looks exactly as it did. This is the second
time this feature shipped media that no buyer could see; the first was the
three RLS policies. **Writing media and showing media are two jobs, and
finishing one is not finishing the other.**

**Both screens take the media; only the editor can fix it.** The first
version put the 360 set and the video on the lot editor alone, on the sound
technical ground that a video has to attach to a listing that already
exists. What that produced in practice was an admin building a lot from
scratch, looking at the form, and concluding the feature was not there —
because the media lived behind a pencil on a row that did not exist yet.
A correct place is not the same as a findable one. The create form now
takes both, holds them locally, and writes them in the right order once the
lot exists: stills and 360 frames upload BEFORE the lot is created (so a
total failure creates nothing), the spin rows are written from those
already-hosted urls without re-uploading, and the video goes LAST — it is
the only step measured in minutes and the only one whose failure leaves
something usable behind.

**Both ways in, on both surfaces, through the seller's own components.**
Photos and 360 frames can be picked from the library OR shot in-app, on the
create form and in the lot editor alike. Nothing was written to do it:
`CameraCapture` and `SpinPreviewModal` are the components the posting
wizard already mounts, generic in their props and working on native and
web, and `SPIN_MIN_FRAMES` / `SPIN_MAX_FRAMES` moved into
`src/lib/listingMedia.ts` so both flows read one number.

That is worth recording as a mistake, not a feature. The first version of
the admin media offered library-pick only, because the guided camera was
assumed to be welded into the wizard. It was not — it had been extracted
long before, precisely so it could be reused, and the assumption was never
checked. **Before deciding a capability is expensive to reuse, open the
file.**

Every route into a spin — picked or shot, create form or editor — ends at
the same preview, so the assembled rotation is judged turning before
anything is written. A spin is the one kind of media that cannot be judged
from thumbnails: a frame out of order, or one bad exposure, only shows up
in motion.

**Media is written straight to its tables.** Photos,
a 360 set and a video all hang off the lot's listing, and all three are
written straight to their tables rather than through a function: RLS allows
it on ownership alone (`sellers manage their own listing photos` / `... spin
sets` / `... videos` are ALL policies with no status test), so an item this
account owns is editable at status `'auction'` exactly as it would be at
`'active'`. An item consigned from somebody else's listing is not, which is
the same boundary `update_auction_lot` draws around a listing's title.

Two traps in that, both found in review and both worth remembering
outside auctions:

- `uploadPhotos` **never rejects** — it alerts and resolves with fewer URLs,
  or none. A spin set therefore has to be written as insert-set,
  upload-frames, and then **delete the set again if no frame landed**:
  otherwise a total failure leaves a real `listing_spin_sets` row with zero
  frames, which takes a sort_order, renders as an empty 360 tab, and is
  indistinguishable from a real set. The first version told the admin the
  set "was not added" while it sat there.
- `writeSpinSets` is best-effort by default, because one bad set in a
  seller's save must not lose the rest. That default swallowed an RLS
  denial and reported it as "check your connection" — a thing an admin
  retries for ever. It takes a `strict` flag for the single-set caller who
  has somebody waiting on the answer.

- **Admins are exempt from the daily video ceiling.**
  `bunny-video-token` allows ten new video objects per `seller_id` in a
  rolling day — written for a person posting listings by hand, who cannot
  plausibly exceed it. `create_auction_lot` makes the admin the seller of
  every lot it builds, so one fortnightly catalogue puts fifteen videos on
  a single `seller_id`, and every replacement burns another: against this
  workload the ceiling stops the work rather than any abuse of it. The
  check falls the safe way — a failed lookup counts as "not an admin", so
  the quota applies.
- Nothing in this project sweeps orphaned Bunny videos — the only
  scheduled jobs are the expiry reminders and the removed-listing purge —
  so an upload abandoned mid-flight is stored and billed for ever. The
  screen deletes the object itself on every abort and every failure, and
  claims the guid the instant the ticket resolves rather than after the
  upload starts: the object comes into being during that await, so a
  screen torn down inside it would otherwise find nothing to delete.
- A video only leaves `uploading` / `processing` when Bunny's webhook
  arrives, and Bunny does not document whether it retries a dropped
  delivery. Our row is not evidence: re-reading it returns what it already
  said. The editor polls `nudgeVideoStatus` while a non-terminal video is
  open, the same way the seller flow does — without it, one dropped
  callback means a video no buyer can ever see (RLS shows `ready` only) and
  no way to fix it but delete and re-upload. **Both** non-terminal states,
  not just `processing`: the row is born `uploading`, and the reload after
  an upload routinely beats the nudge that would have moved it on, so a
  guard written for `processing` alone missed the case it existed for —
  and missed it non-deterministically, which passes a manual test more
  often than it fails one.
- A screen with tabs has to open on one that has something in it. A lot
  can carry a 24-frame spin and no stills — the create form does not
  require photos — and defaulting to Photos showed the placeholder glyph as
  the first thing a bidder saw.
- A `SpinViewer` needs a `key` per set. It keeps the drag position in its
  own state, so switching between two sets of different lengths reconciles
  the same instance against a shorter array and every frame renders at
  opacity 0 — a blank box and a counter reading 18/10. The component now
  clamps as well, because a call site that forgets is not a thing to find
  in production.

The video in particular has to be here rather than on the create form. It
uploads to Bunny over minutes and has to attach to a listing that already
exists, so hanging it off creation would let a failed upload block a lot
from being created — the mistake the photo ordering already made once. One
consequence worth knowing: a video is only visible to buyers at status
`'ready'`, which Bunny's webhook sets a minute or two after the upload
finishes, so a freshly added one reads as `processing` until the editor is
reopened. Removing a video deletes it from Bunny too, through
`bunny-video-delete` — otherwise every clip anyone changed their mind about
is stored and billed for ever.

**Scoping a cascade to what it actually changed.** `update_auction`'s
`cancelled` branch cancels the lots still running, then hands their
consigned listings back. Written as two independent statements — the lot
update scoped to `pending`/`live`, the listing update scoped to the whole
auction — voiding a finished sale set every consigned listing back to
`active`, sold ones included, while their lots stayed `won` with a winner
recorded; `already_a_lot` then refused to re-consign them, so there was no
way back through the app. The listing update now reads the lot update's own
`returning` rows. A cascade must be scoped to the rows the same call
changed, not to the parent.

## Telling bidders how it ended

A lot closes on its own clock. Nobody is watching at 8pm on a Sunday, so
every outcome is a ROW, written by `advance_auctions` in the same
transaction that closes the lot -- not an event fired at whoever happens to
be connected. Three of them go out, and the same pass writes all three.

**The popup.** `myazar.auction_announcements`, one row per bidder per lot,
`UNIQUE (user_id, lot_id)`. `AuctionOutcomeHost` (mounted beside AlertHost,
not on a screen, because a lot can close while the bidder is anywhere) shows
the oldest unseen one, marks it seen, and moves to the next. A bidder who
slept through a fifteen-lot auction gets fifteen, one at a time -- stacking
them would bury the one saying they won something.

**The chat message**, posted as Vevaty. This is the bit worth reading twice:
a thread is `(listing, buyer, seller)` and RLS shows it to the buyer or the
seller, so posting as the SELLER would work and would be wrong -- a
fifteen-lot auction with several bidders each would drop a conversation into
the consignor's inbox for every person who did not buy anything. Vevaty has
its own profile row (`11111111-1111-4111-8111-111111111111`, no phone, no
password, nobody can sign in as it) and sits on the seller side of these
threads instead. No schema change, no policy change. `chat_messages.kind`
gained `'system'`, rendered as a centred notice rather than a bubble,
because a bubble invites a reply and there is nobody there to read one.
The body is bilingual in one string: that column is a single text field, and
an announcement written only in English reaches half this market in a
language it did not pick.

**The winner's phone**, through `myazar.outbound_messages` and the
`send-auction-messages` edge function on a two-minute cron. Queued rather
than sent inline because `advance_auctions` runs inside the one-minute cron
transaction -- an HTTP call that hung in there would hold the close open,
and a failed send would be lost instead of retried. Three attempts, then the
row is marked failed so one unreachable number cannot occupy the queue.

Three decisions inside that last one:

- **SMS today, WhatsApp the day Meta relents.** A business-initiated
  WhatsApp needs an approved template and this WABA still may not create one
  (subCode 2388185). The function checks `TWILIO_AUCTION_TEMPLATE_SID`
  first and falls back to SMS, so the channel changes by setting a secret
  rather than by editing code. Worth the SMS money here where it was not for
  expiry reminders: those scale with every listing on the site, wins scale
  with sales -- at most 15 a fortnight, about $141/year at Lebanese rates.
- **English only, and short.** One Arabic character switches an SMS to the
  70-character encoding and multiplies what a message to Lebanon costs. The
  in-app copy is bilingual; the SMS is not.
- **Not gated on `whatsapp_opt_in`**, unlike `send-expiry-reminders`. That
  flag is consent to be marketed to about your own listings. This is the
  outcome of a sale someone entered by putting a card on file, and
  withholding it because they did not tick a marketing box reads the consent
  wrongly. If that judgement is ever reversed the filter belongs in the
  queue's own query.

An unsold lot gets its own wording rather than the losing one. "You have not
won this bid" implies somebody outbid you; when a lot fails its reserve
nobody won, and saying otherwise would be a small lie told at scale.

Reruns are safe, which matters because this runs every minute: the closing
UPDATE's `RETURNING` names exactly the lots that just moved out of `live`,
the announcement insert is `ON CONFLICT DO NOTHING`, and its own `RETURNING`
is what the chat and SMS writes key off. Tested by calling the closer twice
in a row -- the second pass reports zeroes across the board.

## Watching a sale run

Admin -> Auctions -> the eye icon on any published auction opens
`AdminAuctionMonitorScreen`: every lot on one screen with its current price,
whether the reserve is met, who is leading and what their hidden maximum is,
plus one feed of bids across the whole sale with the automatic ones marked.
Read-only by design -- the place to CHANGE a lot is AdminAuctionLots, and a
screen that both watches and edits is a screen where a mis-tap during a live
sale costs something.

It is live by two mechanisms on purpose:

- **A realtime subscription** on `myazar.auction_bids` (added to the
  `supabase_realtime` publication for this), so a bid shows within a moment.
  It is used as a NUDGE, never as the data: the payload carries a
  `bidder_id` rather than a name, and none of the derived state -- who now
  leads, whether the reserve is met, whether anti-snipe moved the clock --
  is in that row. An event just triggers the same refetch the poll uses, so
  the screen never reimplements the bidding engine to stay correct.
- **A ten-second poll** underneath it. A dropped socket, a throttled
  background tab, or an RLS rule that quietly withholds the event would
  otherwise leave the monitor frozen while looking live. Stale-but-honest
  beats confidently wrong, and this is the screen someone watches to decide
  whether a sale is going well.

The countdown ticks locally off each lot's `closes_at`. A countdown that
needs a round trip per second is a countdown that stutters.

**Setting the times.** Both schedule fields are entered through
`components/DateTimeField.tsx` — a month grid plus hour and minute rows —
or typed, as they always could be. The picker writes the same
`YYYY-MM-DD HH:MM` local string the box always held, which is the whole
reason it could be added without touching parsing, validation or the save
path. It is built from plain Views with no new dependency, deliberately:
every off-the-shelf picker is a native module or pulls one in, and a
changed `package.json` changes the OTA runtime fingerprint and orphans
every installed copy of the app until somebody makes a native build
(@AGENTS.md). Building it also answers the objection that kept this a bare
text box — a picker that behaves differently on three platforms — because
one made of Views behaves the same on all three.

Three rules in it are not cosmetic. The hour and minute rows are inert
until a day has been chosen, because falling back to "today" meant tapping
an hour on an empty field set the date to today, and a new auction is only
checked for parseability, not for being in the future — so that produced a
sale opening today that the minute job would take live at once. The
calendar follows a value typed into the box, but only when the value
actually changes, and never when the change came from the panel's own
hour/minute row: watching for "the calendar and the value disagree" made
month paging impossible, and re-anchoring on a time change would quietly
move a day-tap a month backwards. And Clear only appears where the save
can carry it out — a new auction or a draft — because a button that
reports success and changes nothing is worse than no button.

Terms are set where the deal is: **all three lot forms take them** — the
consign form, the build-from-scratch form, and the lot editor afterwards
(both blank = sale default, and clearing them puts a lot back on it). The
lots list shows each lot's resolved pair and whether it was agreed or
inherited.

The from-scratch form was left out of the first version, on the reasoning
that a lot built there is Vevaty's own stock so a seller commission would
only be Vevaty paying itself. That is backwards: per the intake note above,
consignment does not start with a seller posting the item, it starts with
the item arriving at our door and Vevaty photographing it and writing the
listing — so that form is where a negotiated rate gets typed in MORE often
than the consign-an-existing-listing one, not less. Its rate check runs
with the price checks, before the photo and 360 uploads, because those take
minutes and refusing a typo'd percentage on the far side of them would
throw all that work away.

Once lots start closing, the same screen becomes the sale's **books**. Every
won lot grows a two-column block -- what the seller collects after
commission on the left, what the buyer owes with the premium on the right,
each showing its own working at that lot's own rates, with a pill on any
lot whose terms were negotiated -- and the auction gets a totals panel:
hammer, commission, payable to sellers, premium, collectable from buyers,
and Vevaty's take. Those figures come from `myazar.lot_settlement()` (see
"Money" above), not from arithmetic in the screen, and they are formatted
with cents where bids are formatted in whole dollars. Bids round because
the increment ladder does; money somebody is invoiced does not.

A lot only shows money once it is `won`. While it is still running there is
nothing owed and nothing to show, which is also why the books panel is
absent from an auction where nothing has closed yet.

Everything comes from `myazar.admin_auction_monitor(auction_id)` in one
call -- two calls per tick would be two chances to paint half an update. It
is SECURITY DEFINER and checks `myazar.admins` itself, because it reads
every bidder's name and every hidden maximum: RLS filters rows, it never
confers a privilege, and this is exactly the data that must not leak to a
bidder who could use it to snipe.

## What is deliberately not built yet

- **Seller submission.** v1 has the admin creating lots directly, both
  ways, which is how the first few will actually run — sourced and curated
  by hand. A submit-for-review queue roughly doubles v1 and is almost
  entirely admin screens rather than auction.
- **Category attributes on a from-scratch lot.** The form writes title,
  description, category, condition, district and price, and no
  `attributes` — so a lot built here has an empty spec row on its card
  where a consigned one has bedrooms or mileage. The spec form is a large
  piece of `CreateListingScreen` and lifting it into an admin screen is its
  own change; the description carries the same facts in the meantime.
- **Settlement.** Lots close to `won` / `unsold` and stop there. What each
  side owes is now computed and shown (`myazar.lot_settlement()`, and the
  books panel on the monitor), so the numbers exist; what does not exist is
  anything that *moves* them -- charging the buyer's saved card, issuing an
  invoice, paying the seller out. That is waiting on a real payment
  provider rather than on design.
- **Notifications.** Outbid and won are the two that matter, and both want
  the WhatsApp channel Meta still will not approve (@LIFECYCLE.md).
- **A settled lot's listing has no terminal status.** It sits at 'auction'
  after the lot is won or unsold, which keeps it publicly readable
  indefinitely. That is right while results are being shown and wrong
  eventually; settlement is where it gets decided.
