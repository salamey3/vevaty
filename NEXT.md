# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**Listing domains, step 4: Jobs & Services — see @DOMAINS.md.** Only when
there is an actual intention to launch them, and with real thinking about
salary ranges and hourly pricing rather than a guess made now. Steps 1
(domains as data), 2 (posting) and 3 (browsing, banners included) are all
done — every decision in that document is now built.

Two things worth fixing:

- **The listing lifecycle has two pieces left.** The expiry engine, the
  contact log and the buyer-side "did you reach the seller?" prompt are
  all in (see @LIFECYCLE.md). Still to build: a passive "no longer
  available?" flag for buyers who never made contact at all, and the
  `kind = 'system'` message posted into the buyer's own chat thread, which
  is the chat-side equivalent of the prompt. Neither is urgent -- the
  prompt covers the case that actually loses buyers.

- **Two things about the new registration form need a real tap.** Sign up
  with a fresh number and confirm the profile lands complete — name, email,
  WhatsApp number and consent flag all written the moment the OTP verifies,
  not on a screen after it. Then open a listing as a buyer and confirm the
  WhatsApp button opens the seller's *nominated* number rather than their
  account phone. Both are new writes and neither has been exercised against
  the real endpoint. See @ACCOUNTS.md.

- **Auctions: run one end to end by hand.** Everything is built and
  exercised against the live database — schema, proxy engine, closer,
  screens both sides, full admin control, media (@AUCTIONS.md). What has
  NOT happened is one sale walked through on a real device: build a lot
  from scratch with photos, a 360 and a video, publish, force it live, bid
  from a second account, let it close. The feature is off behind
  `site_settings.auctions_enabled`, which is what has to be switched on for
  any of it to be visible to a buyer, and it is still `false`.

- **Auctions: what is genuinely not built.** Settlement is the big one —
  lots close to `won`/`unsold` and stop there; charging, invoicing and the
  commission split are waiting on a real payment provider rather than on
  design. Then outbid/won notifications, which want the WhatsApp channel
  Meta still will not approve; a seller submission queue (v1 has the admin
  creating every lot, which is how the first few will really run); category
  attributes on a from-scratch lot, so its card has a spec row; and a
  terminal listing status for a settled lot, which currently sits at
  `'auction'` and stays publicly readable for ever. @AUCTIONS.md carries
  the reasoning for each.

- **The home carousels scroller is not virtualised, and cards just got 60%
  wider.** `renderCarousels` mounts every section on the page at once -- it
  was un-virtualised deliberately, because a windowed list re-mounted each row
  every time it scrolled back into view and that cost landed on the swipe.
  That was affordable at a 192px card asking for a 200px photo. A carousel
  card is now one grid card wide, so it asks for 320 on a 390pt phone and up
  to 400 at two or three columns, which is
  about 2.2MB of decoded bitmap per card there against 0.85MB before, and
  ~2.8MB on a 412pt Android where the request rounds up to 360. A
  six-category domain page holds six rows of six. Only seeded picsum
  listings are affected -- a real upload's thumbnail is baked at 640
  and Bunny returns exactly that -- so this is not urgent, and it is also not
  something to discover on a mid-range phone later. See @CARDS.md.

- **The storefront pill sits on the wrong edge in Arabic on the web.**
  `storefrontPillRTL` uses `alignSelf: 'flex-end'`, and on the web the
  document already carries `dir="rtl"`, so the cross axis is reversed and
  `flex-end` resolves to the left. Same web-versus-native divergence
  `mirrorRow` exists for, in a style `mirrorRow` cannot express. Pre-dates the
  card rebuild and was left alone rather than widened into it; the app is
  unaffected, only Arabic web.

- **~88 categories still have no card specs curated.** Listing cards now show
  up to three specs chosen per category (@CARDS.md), and Properties, Vehicles,
  Pets and Fashion are done. Everything else shows no spec row until someone
  numbers its fields in Admin -> Categories -> Attributes -> "On the listing
  card". That is deliberate -- the old guess was wrong more often than it was
  right -- but it means most of the catalogue currently shows less on a card
  than it could. Electronics and Furniture are the ones worth doing first.

- **Nothing has confirmed the VV001 path by hand.** When a seller taps
  Restore on an auto-hidden listing that has not passed moderation, they
  should read "This listing has to be reviewed before it can go back on
  the site", not "please try again". Everything says PostgREST surfaces
  the custom SQLSTATE as `error.code`, but it was never exercised against
  the real endpoint. One tap confirms it.

- **The app has not had a native build since 26 Aug** — over a week now.
  Everything since has reached the installed app over the air, which is why
  it has not bitten -- the fingerprint was restored rather than rebuilt
  around, so updates reach it again (see @AGENTS.md, "What forces a new
  native build"). But the installed app is several months of native config behind
  whatever it will be built from next, and that gap is only discovered the
  day something genuinely native changes. Worth a build on a quiet day
  rather than an urgent one.

## After that

Categories still short of specs, in the order they are worth doing.

1. **Auto Parts & Accessories.** Four categories, zero attributes. Not on
   this list before because it only became a top-level during the Vehicles
   work — and it sits inside Vehicles, the section a buyer enters
   expecting what Vehicles now has.

Everything else — Furniture & Decor and Kids & Babies (nine categories
each, no attributes at all), then Hobbies, Sports & Equipment and
Businesses & Industrial — needs attribute rows rather than new mechanisms.
That is database work with no code behind it.

Jobs and Services are deliberately not on this list: they are step four of
the domains work, and both are `active = false` until then.

## Recently done

**Listings stopped going live without their photos**, 3-4 Sep 2026. A
seller's apartment listing went out with no pictures and only got them
when he edited it and uploaded them again. Cause, read off the edge logs
rather than guessed: photos uploaded fire-and-forget while
`moderate-listing` published the listing four seconds later. Fixed by
putting publication after the media write and requiring positive evidence
there is a photo — plus a repair path for a listing parked by a failure,
the same refusal in all three server-side routes that can set a listing
`active`, a request deadline on the Supabase client, and an audit of
every write in the app that used to report success and change nothing.
@MEDIA.md is the reasoning record; the rules are in @AGENTS.md under
"Publish only once the media has landed", "A request that never answers
is not an error" and "One alert, ranked".

Along the way, and worth knowing separately:

- Posting points now go through `claim_posting_points`, a SECURITY
  DEFINER RPC that does the claim flag, the ledger row and a RELATIVE
  balance increment in one transaction. The old client-side version wrote
  an ABSOLUTE total it had computed locally, so twenty items posted at
  once each wrote a total from before the others landed and the seller
  lost points they had watched arrive.
- Moderators could not see the media they were moderating.
  `listing_photos`, `listing_spin_sets` and `listing_videos` had no admin
  RLS policy, so a flagged listing belonging to another seller showed no
  photos, no spin, no video and nothing saying why. Three SELECT policies
  mirroring `admins can view all listings`.

**Auctions, finished**, 2–3 Sep 2026. Six patches over two days took it from
a schema to something that can be demonstrated. The buyer side: a gate tile,
the auction page and its countdown, the lot page with Photos/360/Video tabs,
the bid sheet, card registration. The admin side: create an auction, build a
lot **from scratch** as well as by consigning an existing listing, add photos,
a 360 spin and a video from either the library or the in-app camera, edit or
delete anything at any status. Proxy bidding, anti-snipe, reserves and the
minute-by-minute closer were all exercised against the live database rather
than reasoned about. @AUCTIONS.md is the reasoning record.

Three things in there are worth reading even if auctions never ship, and all
three are now in @AGENTS.md: **RLS filters rows, it never confers a
privilege** (which is why the entire admin half shipped dead and had to be
rebuilt as SECURITY DEFINER functions); **an inference standing in for a fact
will eventually be wrong** (a null column read as "created for the auction"
hard-deleted a real listing — recorded in full because it destroyed a
seller's data); and **writing media and showing media are two jobs** (the
feature shipped media no buyer could see, twice — once through three RLS
policies that gated on `status = 'active'`, once through a lot page that
rendered only gallery photos).

**Browse grid widened**, 1 Sep 2026. One column on a phone and three on
desktop (was two and four), and the card photo moved from 1:1 to 4:3 — at
full width a square photo is taller than a phone screen has to spare, and 4:3
is the shape sellers actually shoot in. The photo-left carousel card now sizes
itself instead of sitting at a flat 300px, which is why its district line
truncated. @CARDS.md carries the arithmetic, including what did NOT truncate
and was only getting taller.

**Listing cards rebuilt**, 1 Sep 2026. One surface instead of a forest-green
band and a white half, with the green doing the work as the kind pill, the
spec glyphs and the price. A category pill that says "Apartment" rather than
"Properties", a title that wraps to two lines, and up to three specs with
icons chosen per attribute in admin. The photo stays 1:1 -- that decision was
made on evidence in August and re-examined rather than re-litigated.
@CARDS.md is the reasoning record, including why `card_priority` sat unread
in the database for weeks with seventeen rows of curation in it.

**Registration became a real form**, 1 Sep 2026. Full name, an optional
unverified email, a separate WhatsApp number with a "same as my mobile"
checkbox and a consent line, and a password with show/hide — all on one step,
all written when the OTP verifies. Phone stays the sole account identity;
email is a free channel and nothing more. Contact details are editable
afterwards from Profile → Edit your profile → Email & WhatsApp, because a
field you can enter once and never correct is a defect. `send-expiry-reminders`
now sends only to sellers who consented, and only on the number they
nominated — that one is a Supabase deploy (version 16), not part of the
commit, since edge functions are not tracked here. @ACCOUNTS.md is the
reasoning record.

**"Did you reach the seller?"**, 31 Aug 2026. The piece that actually
catches a dead lead. A day after a buyer reaches for a seller's number,
they are asked how it went -- on the section home and on the listing
itself -- and two independent phone-verified buyers saying "they said
it's sold" hides the listing, with the seller told why and one tap to
restore. Every guard is in the database, because it is the one write in
the app where one user's word affects another user's listing. See
@LIFECYCLE.md.

**Listing lifecycle**, 31 Aug 2026. Expiry became a per-category setting
resolved nearest-ancestor-first -- a phone gets 7 days, an apartment 45, a
ticket 3 -- and the database took ownership of it: a trigger on insert, and
RPCs for extend and republish that resolve the same function and hand back
the row they wrote, replacing two hand-written "now + 15 days" in the
client. Verified storefronts are exempt from per-item reminders. And
`listing_contact_events` now records the one observable moment in a
phone-only conversation: the buyer revealing the seller's number. The
reasoning for every number, and for the two approaches rejected first, is
in @LIFECYCLE.md.

**Fashion & Beauty**, 31 Aug 2026. The gendered Clothing and Accessories
pairs merged into one each with gender as a spec — the third time that
call has been made, after Properties and Vehicles — and Shoes and Bags
added, neither of which existed anywhere in the tree. Shoes needed its own
category rather than a corner of Clothing for a concrete reason: a
category carries exactly one size-variant attribute, and EU 36–46 cannot
share a list with S/M/L. Eight leaves, all specced, in both languages.
Wear grading (`graded`) replaced New/Used for the whole section and the
duplicate Condition spec on Watches was deleted. The size-variant
machinery is finally in use, but only for verified storefronts — see
@AGENTS.md, "Stock and sizes belong to shops, not to categories".

**The six silent listing writes**, 31 Aug 2026. `updateListing`,
`deleteListing`, `extendListing`, `republishListing`, `hideListing` and
`markListingSold` all reported success whatever the database said, and
each rewrote the screen before asking. They now check three separate
ways a write can quietly do nothing (see @AGENTS.md, "Three ways a write
reports success and changes nothing"), throw a translatable code, and
either wait for the answer or put the screen back. Every call site was
decided on its own rather than swept: two batch steps had no error
handling at all and would have gone dead-quiet, five discarded the error
deliberately, and the batch photo retry link would have inserted a second
listing for the same item.

**Listing domains**, 30 Aug 2026. The largest change the app has had: it is
now split into Properties, Vehicles and Classifieds (and a dormant Jobs &
Services), on both sides. Sellers answer one question the photos cannot --
which is what stopped the classifier being asked to choose between
"Apartment" and "Decor Concept" on the same pictures -- and buyers land on
a gate instead of one mixed home, with each section carrying its own
categories, collections, banners, filters and feed. Every decision, and
the reasoning behind each, is in @DOMAINS.md; all four steps of its build
order are done except Jobs & Services.

**Properties**, 29 Aug 2026. Eleven real-estate categories merged into
one, Sale/Rent/Both replacing a meaningless New/Used, a generic
conditional-field mechanism (`depends_on_slug`), real rent terms, and
21 specs.

**Pets**, 30 Aug 2026. Live animals stopped being asked whether they are
new or used: `categories.uses_offer_type` became `condition_mode`, a third
answer ("For sale / Free to a good home") joined New/Used and
Sale/Rent/Both, and a free listing hides its price field and reads as
"Free" rather than "$0". Age, sex, breed and vaccination on all four
animal categories, size on dogs, and Pets services flagged as a service —
which turned up that a service category could not be posted at all, since
every listing was required to name a condition.

**Vehicles**, 30 Aug 2026. Five vehicle-kind categories merged into one
postable category with a `vehicle_type` spec; Auto Parts & Accessories
promoted to its own top-level; 19 specs where there had been none at all;
and the Properties-or-not question behind Sale/Rent/Both generalised into
a category flag -- which the Pets work above then turned into
`categories.condition_mode`.

Three things this work turned up and deliberately did not fix:

- **`anon` cannot read `myazar.listings` at all.** Any query as the true
  `anon` role fails with `permission denied for table mfa_factors` — the
  restrictive `admin identity requires mfa` policy's subquery touches
  `auth.mfa_factors`, which `anon` has no grant on. Nobody has hit it
  because the app signs everyone in anonymously (role `authenticated`)
  before it reads anything. It would bite the moment a page tried to read
  before `ensureSession()` resolved, or if a public read were ever added.
  Pre-dates this work — `listing_photos` behaves identically, and did
  before the new admin policies.

- **Two `updateListing` calls on one listing can double-insert photos.**
  `BatchPhotosScreen` fires one per photo tap with no lock, so two
  overlapping runs both read a short `existingRows`, both upload, and both
  insert. It self-heals on the next sync and again on the location screen,
  and adopting hosted URLs narrowed the window a lot, but the real fix is
  a per-listing queue.

- **`profiles.points` and `profiles.tier` are still UPDATE-granted to
  `authenticated`.** `claim_posting_points` closed the honest path; the
  balance is still directly writable by anyone with a console. The same
  treatment — a definer RPC and a revoke — would close it.

## Waiting on something external

**The 12 caza corrections** in `src/data/lebanonPlacesData.ts`.
`scripts/generate-lebanon-places.py` now pulls geoBoundaries' full-
resolution polygons instead of the simplified ones, which moves twelve
villages into the right district (Bsifrin and Zahriye from Baabda to Matn,
El Fradis from Zgharta to Bcharre, and nine others). Regenerating needs
`download.geonames.org`, which was offline on 17 Aug. Re-run the script
once it's back.

**WhatsApp OTP delivery still falls back to SMS** ($0.36 a send against
roughly $0.06). Meta rejected the authentication template
(`subCode=2388185`, "does not have permission to create message
template"), so Verify's own templates were never provisioned on the WABA,
and Twilio's WhatsApp→SMS fallback hides the failure. Needs a Twilio
support ticket to provision the templates and disable the fallback.

## Open question

**Should Magic Listing become the default path rather than one option?**

The argument for: your competition is a form, nobody enjoys a form, and a
marketplace lives on listing volume. It also produces better data than
sellers do — consistent titles, real specs, and a category the buyer will
actually browse to.

The argument against: it fails in front of the user. A form is frustrating
but predictable; an AI that says 2021 when the car is a 2019 hands the
seller a wrong listing they may not proofread.

The way to settle it without guessing: record what the AI proposed, what
the seller changed before posting, and how often they overrode the
category. That edit rate is the accuracy number. Keep 80%+ of what it
proposes and it should be the front door; rewrite half of it and it stays
optional until it improves. `myazar.ai_listing_generations` already stores
the suggestion — what's missing is the comparison against what was
actually posted.
