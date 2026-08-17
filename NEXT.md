# What's next

Kept here rather than in anyone's head, so it survives closing a laptop.

## Next up

**Twilio phone-number registration with OTP, over SMS or WhatsApp.**
New accounts sign up with a phone number and verify it with a one-time
code, delivered by either SMS or WhatsApp. Agreed 17 Aug 2026, to start
straight after the Magic Listing button is finished.

## Waiting on something external

**The 12 caza corrections** in `src/data/lebanonPlacesData.ts`.
`scripts/generate-lebanon-places.py` now pulls geoBoundaries' full-
resolution polygons instead of the simplified ones, which moves twelve
villages into the right district (Bsifrin and Zahriye from Baabda to Matn,
El Fradis from Zgharta to Bcharre, and nine others). Regenerating needs
`download.geonames.org`, which was offline on 17 Aug. Re-run the script
once it's back.

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
