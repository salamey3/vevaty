# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**Give the remaining categories the treatment Properties just had.**
Properties was rebuilt on 29 Aug 2026: eleven real-estate categories
merged into one, Sale/Rent/Both replacing a meaningless New/Used, a
generic conditional-field mechanism, and real rent terms. The same
questions apply elsewhere, in this order.

1. **Vehicles.** All eight vehicle leaves have *zero* spec attributes —
   no make, model, year, mileage, transmission, fuel, body type. Cars are
   the highest-consideration purchase after property and those are
   exactly the fields buyers filter on; right now a car listing is a
   photo, a title and a price. Vehicles also still carries the same
   `Cars for Sale` / `Cars for Rent` split Properties just shed, which
   makes the classifier guess sale-vs-rent from a photo that cannot show
   it. Do the specs first — they hurt every listing, where the split
   only misfires on rentals. `depends_on_slug` applies directly: one
   vehicle-type field showing engine cc for motorcycles, length for
   boats, neither for spare parts.

2. **Jobs and Services.** Both top-level categories are `active = false`
   today, so neither is reachable from the home grid — decide whether
   that is deliberate before building anything. Neither fits the item
   model: New/Used is meaningless for a plumber or a vacancy, and the
   price is hourly, per-project, or a salary range rather than a sale
   price. `is_service` is already wired (it swaps the detail CTA to
   "contact to hire"); it is only ever set on the inactive parent.

3. **Pets.** Six leaves, no attributes, and live animals currently get a
   New/Used tag. Wants age, breed, sex, vaccinated, and a price field
   that allows free-to-a-good-home.

4. **Fashion.** Eight leaves, no attributes — and the size-variant
   machinery (`Category.stockMode: 'multiple'` +
   `CategoryAttribute.isVariant`) is already built and entirely unused.
   Clothing is its natural home.

Everything else — Furniture, Kids & Babies, Sports, Hobbies, Businesses &
Industrial — needs attribute rows rather than new mechanisms. That is
database work with no code behind it.

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
