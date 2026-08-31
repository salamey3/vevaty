# How long a listing lives, and why

The problem this solves, stated plainly: **a seller sells the item, forgets
to remove the listing, and buyers keep enquiring about something that has
been gone for days.** A dead lead costs a buyer their time and costs Vevaty
its credibility, and it is invisible in every metric — the listing looks
healthy right up until someone calls it.

Everything below follows from that one goal. It is written down because
several of these numbers look arbitrary and are not, and because two of the
options we rejected are the ones anybody would reach for first.

## The decision that does the real work

**A listing dies unless somebody says it is alive.** That inversion is the
whole design. Before it, a listing stayed up forever unless a seller
remembered to act — and the seller who forgets to mark something sold is,
by definition, the seller who will not act. Making silence lethal means the
platform self-cleans without depending on the person who already failed to
do the thing.

Everything else — reminders, prompts, notifications — is an *optimisation*
on top of that. If every message we ever send fails to arrive, expiry still
clears the dead listing. Keep that ordering in mind before spending money on
a channel.

## Why not five days for everything

The original proposal was a flat five-day life for every listing, with a
WhatsApp message on day five asking "is this still available?". The
inversion in it was right and is kept. The uniformity and the channel were
not, for three reasons.

**The cost scales with inventory, not with sales.** A five-day cycle is
about six messages per listing per month. SMS to Lebanon is $0.3619 —
one of Twilio's most expensive destinations anywhere — which is $2.17 per
listing per month, or $2,170/month at a thousand active listings. Even
WhatsApp at ~$0.06 is $360/month at a thousand and $3,600 at ten thousand.
You would pay more the more listings you held, and holding listings is the
business.

**Five days is wrong for most of the catalogue.** A $450,000 apartment does
not sell in five days; Lebanese real estate moves in months. A flat window
taxes the highest-value supply on the platform — agencies, dealers — to
solve a freshness problem that only really exists at the fast end.

**The channel does not exist.** WhatsApp business-initiated messages need a
Meta-approved template, and WABA 1089953527116350 was refused
template-creation permission outright (rejection subCode 2388185) — the same
blocker that stopped the OTP channel. `send-expiry-reminders` has been
deployed and ticking hourly since before this work; it returns
`skipped: twilio_not_configured` and will keep doing so until Meta clears
that.

## The lifetimes

`categories.listing_lifetime_days` is nullable and resolved
**nearest-ancestor-first**, the same shape as `condition_mode` and for the
same reason: there are ninety-odd categories and about a dozen answers.
Null means inherit. Nothing set anywhere up the chain means 14 days.

| Category | Days | Why this number |
|---|---|---|
| Properties | 45 | Real estate moves in months. A shorter window taxes the most valuable supply on the platform to solve a problem it does not have. |
| Vehicles | 30 | Cars take weeks, not days. |
| Auto Parts & Accessories | 30 | Sporadic demand, but low dead-lead risk — a shop usually has more than one. |
| Number Plates | 45 | Held as an investment. Nobody is in a hurry. |
| *(Classifieds default)* | **14** | The fallback in `category_lifetime_days`, so the ordinary case is written nowhere. |
| Mobiles & Accessories | 7 | Fastest-moving and highest dead-lead risk on the platform. A phone listed three weeks ago is almost certainly gone. |
| Dogs, Cats, Birds, Other Animals | 7 | The worst dead lead there is — a rehomed animal still listed — and litters go quickly. |
| Pet supplies | 14 | Not animals. Inherits nothing from the leaves beside it. |
| Pets services | 60 | A service is never "sold". |
| Fashion & Beauty | 21 | Second-hand clothing sits. Nobody is racing. |
| Furniture & Decor | 21 | Big items; the buyer has to arrange transport. |
| Sports & Equipment | 21 | Same shape as furniture. |
| Hobbies | 30 | Books, instruments and collectibles can sit for months. |
| Tickets & Vouchers | 3 | The sharpest case on the list: a real event date, so the listing is dead the moment the event passes. |
| Businesses & Industrial | 45 | High value, low volume, long sales cycles. |
| Jobs | 30 | A vacancy has a natural closing date. |
| Services | 60 | A plumber's listing does not go stale the way an object does. |

These are judgements, not measurements. **Replace them with measurements as
soon as you can** — every "mark as sold" already records `sold_via`
(`vevaty` / `elsewhere`), so time-from-post-to-sold per category is
computable the moment there is volume.

## Why the database decides, not the app

`expires_at` used to be a flat column default (`now() + interval '15 days'`)
with the client recomputing the same 15 days by hand in two more places.
That could not vary by category, and every future client would have had to
re-implement it identically.

Now:

- `myazar.category_lifetime_days(category_id)` walks the tree. It has a
  depth guard, because `parent_id` has no cycle constraint and a cycle would
  hang every insert on `listings`.
- `trg_set_listing_expiry` sets `expires_at` on insert when the client does
  not supply one — which it does not.
- `extend_own_listing` and `republish_own_listing` are `SECURITY DEFINER`
  RPCs that resolve the same function and **return the row they wrote**, so
  the app stops guessing at a date it did not choose.
- The app keeps a copy of the number (`lifetimeDaysForCategory` in
  SettingsStore) for **display only** — "expires in N days", and the label
  on the Extend button, which used to promise "another 15 days" to
  everybody and would now be wrong for almost every listing.

`DEFAULT_LISTING_LIFETIME_DAYS` in `src/data/categories.ts` and the `return
14` in `category_lifetime_days` are one answer written twice. If you change
one, change the other.

## The clock follows the category, and starts at publication

Two rules the trigger enforces, both learned the hard way while testing:

**Change the category and the window is recomputed.** The batch flow
creates each item as a draft *before* the classifier has run, so the row
exists with no category at all; the real one arrives minutes later by
UPDATE. A trigger that only ran on INSERT gave every batch-posted
apartment the 14-day fallback while the Extend button beside it promised
45. A seller could in principle flip a category back and forth to renew,
but that is a rare, visible edit, and the alternative — a window that
belongs to a category the listing has left — is worse.

**The clock starts when the listing becomes visible, not when its row
appeared.** A draft is visible to nobody. Without this, a batch parked for
two weeks and then posted would publish already past its expiry and be
swept to `expired` by that night's cron.

Neither rule fires when `expires_at` is being set in the same statement —
that is extend/republish having already resolved the same function, and
recomputing over the top of them would be the same answer at best and a
race at worst.

## The batch flow had never saved anything

Found while testing the above, and unrelated to it. `BatchPhotosScreen`
creates each draft with `cat: ''`, which its own comment explains as
"not classified yet". But `listings.category_id` was `NOT NULL` with a
foreign key to `categories`, and `''` is not a category — so **every one
of those inserts was rejected by the database**. Until `addListing`
started throwing (31 Aug), the error was discarded and an optimistic local
row handed back, so the flow appeared to work and wrote nothing. The
database held one batch and zero batch listings, which is exactly that
shape.

`category_id` is now nullable, because `''` was never a value — it was a
stand-in for null. A CHECK (`listings_classified_before_publication`)
keeps an unclassified row from ever being anything but a draft, and the
client maps `null` ↔ `''` at the boundary so nothing downstream has to
learn a third state.

The lesson generalises, and is the same one @AGENTS.md records about
silent writes: **a flow that looks like it works is not evidence that
anything was saved.** Nobody noticed for as long as the error was
swallowed.

## Storefronts are exempt from being chased

`send-expiry-reminders` now filters on `shop_id is null`. A verified
storefront manages inventory deliberately and often holds dozens of
listings; one message per item is the difference between a nudge and spam
from your own platform. **Their listings still expire on the same clock** —
they are simply not chased item by item. When they get their own inventory
view, a single digest replaces the per-item message entirely.

## The phone-only blind spot

The in-app chat gives us the conversation for free: we can see the thread,
see whether the seller replied, and post into it. **Roughly half the
platform does not use it** — `contactMethod` can be `phone`, and a buyer who
calls or opens WhatsApp has a conversation Vevaty will never observe.

There is exactly one moment we *can* see, and we already own it: a buyer
cannot see a number until `get_seller_phone(p_listing_id)` runs. That RPC
now records the reveal in `myazar.listing_contact_events` — listing, seller,
buyer, channel, timestamp — deduplicated to one row per buyer per listing
per day, because a double tap on "Call seller" is not two interested buyers.
Only the `SECURITY DEFINER` function writes to that table; there is no
insert policy for anyone, so a seller cannot manufacture interest in their
own listing.

Two rules that matter more than the table:

**A contact event never extends a listing.** It is *buyer* interest, not
proof the *seller* is alive. Several reveals with no seller activity
afterwards is a listing to suspect, not one to reward. Only seller actions —
replying, editing, renewing — reset the clock.

**When the conversation is invisible, ask the buyer.** They called. They
were told it was sold last Tuesday. The seller is the one person who might
be ignoring us; the buyer is annoyed and motivated to answer. Three
independent "they said it's sold" answers is stronger evidence than anything
that seller will ever give us.

## "Did you reach the seller?"

The piece that actually catches the dead lead. A buyer who called and was
told the item sold last Tuesday is the only person who knows that; the
seller who forgot to remove it is by definition not going to say.

Asked 24 hours after a contact event — long enough that the conversation
has happened — and only while the listing is still active and the buyer
has not already answered. Shown in two places, one component and one
answer: a card above the feed on a section home (one at a time; a column
of them reads as a chore and gets dismissed wholesale) and, compactly, on
the listing itself if they revisit it. Answering anywhere removes it
everywhere.

Four answers: still available, they said it's sold, no answer, and
dismiss. **Dismiss is a real answer**, recorded like the others — that is
what stops the same card returning tomorrow.

### Two independent reports hide a listing

Two, not one and not three. Two strangers who both made real contact and
both came back to say the same thing is hard to fake and hard to get
wrong, while one person acting alone must never be able to take down a
competitor's listing.

Hidden, not deleted: the listing goes to `draft` with `auto_hidden_at`
set, so the seller keeps every path back. `auto_hidden_at` is also what
lets MyListings tell the two kinds of draft apart — "resume this draft" is
bewildering on a listing you finished weeks ago — and it is why restore is
its own RPC rather than reusing republish: it must also stamp
`sold_reports_cleared_at`, or the next answer re-hides the listing on a
count the seller has already overruled.

### The seller's two ways back

Restoring is one of them, and it refuses outright if the listing has not
passed moderation — because `enforce_listing_moderation_gate` would
silently rewrite the status back and the seller would be left with a
listing that stayed hidden, an `auto_hidden_at` that had been cleared, and
no button to try again. It raises `VV001` instead, which the app turns
into "this has to be reviewed first" rather than "try again".

Editing and resubmitting is the other, and it is the one most sellers will
actually take. Publication clears the auto-hide state wherever it comes
from (in `set_listing_expiry`), or the listing would go back up with the
old two reports still counting and the next single answer would hide it
again instantly.

### Every guard, and why it is in the database

This is the one write in the app where one user's word affects another
user's listing, so none of it is trusted to a client:

- **Only somebody who actually made contact.** There must be a
  `listing_contact_events` row for this buyer and this listing. Without
  it, anyone could report any listing sold without ever touching it.
- **Phone-verified only, and only for "sold".** An unverified account can
  still say "still available" or dismiss the card; it cannot help hide
  anything.
- **Never the seller**, about their own listing.
- **Never an anonymous session.**
- **`auto_hidden_at` and `sold_reports_cleared_at` are not writable by a
  client.** `authenticated` holds TABLE-level UPDATE on `listings`, so a
  column-level revoke does nothing — a seller could have PATCHed
  `sold_reports_cleared_at` to `infinity` and made their listing
  permanently un-hideable. A BEFORE trigger reverts any change to either
  column unless the caller is one of the two functions allowed to make it,
  which announce themselves with a transaction-local setting a PostgREST
  request cannot set. Same shape as `enforce_listing_moderation_gate`.
- **One answer per buyer per listing.** The row is replaceable at the
  database level, so a buyer who says "no answer" on Tuesday and is told
  "sold" on Thursday could correct themselves — but no screen offers that
  today, because `my_pending_contact_prompts` excludes any listing that
  already has an answer. Worth adding when there is traffic to justify it.

One deliberate asymmetry: the buyer can read their own answers and admins
can read all of them, but **the seller cannot see who said what**. They
are told their listing was hidden and why; a seller who could identify
the reporter could retaliate against them.

## Not built yet, and why

Deliberately staged. Each of these depends on the expiry engine above
existing first, and each is worth reviewing on its own.

- **A passive "no longer available?" flag** on the listing, for buyers who
  never made contact at all. Same guardrails as the prompt below.
- **The in-thread system message.** `chat_messages` already has a `kind`
  column (it is how offers are typed), so a `kind = 'system'` message needs
  no new machinery. Posting it into the buyer's own thread — rather than
  messaging the seller in a vacuum — means both sides see it, and the
  buyer can see the seller's silence for themselves.
- **Push notifications.** Free and unlimited, but nothing is wired:
  no `expo-notifications`, no `notification` block in `app.json`, no push
  plugin. Adding it changes `package.json` and `app.json`, which are both
  fingerprint inputs, so **it forces a native build** — see @AGENTS.md,
  "What forces a new native build". Bundle it with the build the app is
  overdue anyway.
- **WhatsApp.** Last, if Meta ever unblocks templates. By then we will
  probably find we do not need it.

## What this cannot fix

A seller who keeps renewing out of habit while the item is long gone looks
identical to an active seller from every signal we hold. Only the buyer-side
answer catches that one, which is the strongest argument for building it.

And a seller who reveals nothing, replies to nothing and ignores every
prompt is unreachable by design — which is fine, because expiry still kills
the listing. That is the point of putting the inversion first.
