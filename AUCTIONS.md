# Auctions

Written 2 Sep 2026. The section is built — schema, engine, buyer screens
and admin screens — and switched OFF behind
`site_settings.auctions_enabled`, so nothing is reachable until somebody
turns it on in Admin → Auctions. No auction has been assembled yet. This
is the record of what was decided and why, so the next person to open the
engine does not undo a rule by accident.

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

Both percentages are per-auction columns rather than constants, so a
launch event can run at a different rate without a deploy.

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

So creating an auction, adding a lot, removing a lot, withdrawing a lot and
listing lots with their reserves are five `SECURITY DEFINER` functions that
check `myazar.admins` (six with `publish_auction`). Three of them exist as
functions for a second reason as well: they are pairs that must not
half-complete.

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

## What is deliberately not built yet

- **Seller submission.** v1 has the admin creating lots directly, which is
  how the first few will actually run — sourced and curated by hand. A
  submit-for-review queue roughly doubles v1 and is almost entirely admin
  screens rather than auction.
- **Settlement.** Lots close to `won` / `unsold` and stop there. Charging,
  invoicing and the commission split are the next thing, and they are
  waiting on a real payment provider rather than on design.
- **Notifications.** Outbid and won are the two that matter, and both want
  the WhatsApp channel Meta still will not approve (@LIFECYCLE.md).
- **A settled lot's listing has no terminal status.** It sits at 'auction'
  after the lot is won or unsold, which keeps it publicly readable
  indefinitely. That is right while results are being shown and wrong
  eventually; settlement is where it gets decided.
