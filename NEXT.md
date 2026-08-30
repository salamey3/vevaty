# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**Listing domains, step 4: Jobs & Services — see @DOMAINS.md.** Only when
there is an actual intention to launch them, and with real thinking about
salary ranges and hourly pricing rather than a guess made now. Steps 1
(domains as data), 2 (posting) and 3 (browsing, banners included) are all
done — every decision in that document is now built.

Two things worth fixing, both found while clearing the last of those:

- **`addListing` swallows a refused insert.** On a Supabase error it keeps
  its optimistic local row and returns it, so the caller cannot tell a
  saved listing from an unsaved one -- and every screen reads that same
  local array, so the app looks entirely correct while the server has
  nothing. The batch flow is where this bites hardest: a whole session of
  items can appear to save. It is also exactly what a missed column grant
  produces (see the grants note in @AGENTS.md), which is the failure this
  repo has already been caught by twice. `updateListing` at least warns.
- **The app has not had a native build since 26 Aug.** Nothing needs one
  right now -- the fingerprint was restored rather than rebuilt around, so
  updates reach it again (see @AGENTS.md, "What forces a new native
  build"). But the installed app is several months of native config behind
  whatever it will be built from next, and that gap is only discovered the
  day something genuinely native changes. Worth a build on a quiet day
  rather than an urgent one.

## After that

Categories still short of specs, in the order they are worth doing.

1. **Fashion & Beauty.** Nine categories, five attribute rows — and the
   size-variant machinery (`Category.stockMode: 'multiple'` +
   `CategoryAttribute.isVariant`) is built and entirely unused. Clothing
   is its natural home, which is what puts it first: a feature already
   paid for.

2. **Auto Parts & Accessories.** Four categories, zero attributes. Not on
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
