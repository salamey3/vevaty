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

- **Nothing has confirmed the VV001 path by hand.** When a seller taps
  Restore on an auto-hidden listing that has not passed moderation, they
  should read "This listing has to be reviewed before it can go back on
  the site", not "please try again". Everything says PostgREST surfaces
  the custom SQLSTATE as `error.code`, but it was never exercised against
  the real endpoint. One tap confirms it.

- **The app has not had a native build since 26 Aug.** Nothing needs one
  right now -- the fingerprint was restored rather than rebuilt around, so
  updates reach it again (see @AGENTS.md, "What forces a new native
  build"). But the installed app is several months of native config behind
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
