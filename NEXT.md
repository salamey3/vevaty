# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**Listing domains, step 4: Jobs & Services — see @DOMAINS.md.** Only when
there is an actual intention to launch them, and with real thinking about
salary ranges and hourly pricing rather than a guess made now. Steps 1
(domains as data), 2 (posting) and 3 (browsing, banners included) are all
done — every decision in that document is now built.

Two smaller things left over, neither blocking:

- A storefront's saved category is not used at posting time at all — see
  the note in @DOMAINS.md on why the obvious uses were dropped. Filling
  the category in when the classifier says it cannot tell is the one safe
  use, and it needs doing in the batch flow at the same time or not at
  all.
- Tapping Change on the batch flow's domain line abandons an empty
  `in_progress` batch row. Harmless while nothing reads batches back;
  worth cleaning up alongside the "my batches" view that row's own
  comment anticipates.

## After that

Categories still short of specs, in the order they are worth doing.

1. **Pets.** Six leaves, no attributes, and live animals currently get a
   New/Used tag. Wants age, breed, sex, vaccinated, and a price field
   that allows free-to-a-good-home.

2. **Fashion.** Eight leaves, no attributes — and the size-variant
   machinery (`Category.stockMode: 'multiple'` +
   `CategoryAttribute.isVariant`) is already built and entirely unused.
   Clothing is its natural home.

Everything else — Furniture, Kids & Babies, Sports, Hobbies, Businesses &
Industrial — needs attribute rows rather than new mechanisms. That is
database work with no code behind it.

Jobs and Services are deliberately not on this list: they are step four of
the domains work, and both are `active = false` until then.

## Recently done

**Properties**, 29 Aug 2026. Eleven real-estate categories merged into
one, Sale/Rent/Both replacing a meaningless New/Used, a generic
conditional-field mechanism (`depends_on_slug`), real rent terms, and
21 specs.

**Vehicles**, 30 Aug 2026. Five vehicle-kind categories merged into one
postable category with a `vehicle_type` spec; Auto Parts & Accessories
promoted to its own top-level; 19 specs where there had been none at all;
and the Properties-or-not question behind Sale/Rent/Both generalised into
the `categories.uses_offer_type` flag.

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
