# Listing domains

The decisions behind splitting Vevaty into Properties, Vehicles,
Classifieds and (later) Jobs & Services. Agreed 30 Aug 2026, before any of
it was built, so that the reasoning survives the build rather than being
reconstructed from the diff afterwards.

Steps 1 and 2 of the build order at the end are done. Everything else is
still spec.

## Why

Two problems, one cause.

**The classifier was being asked an impossible question.** The same set of
apartment photos, uploaded repeatedly during testing, came back as
"Apartment" some runs and "Decor Concept" others. That is not a tuning
failure. An apartment interior genuinely contains furniture, so the model
was being asked to choose between incompatible answers on evidence that
supports both. No amount of prompt work fixes a category space where the
right answer is unknowable from the input.

**The three groups no longer share a data model.** `condition` means
Sale/Rent/Both under Properties and Vehicles and New/Used everywhere else.
Rent terms exist for two of them and are meaningless for the third. A
listing is not one shape any more; it is three.

So the domain is not a form field we are adding back after removing forms.
It is the one question photos cannot answer, asked once, that tells the
rest of the system which schema applies. That is why it earns a screen.

## What it is not

The three cards look symmetric. They are not: Properties is one category,
Vehicles is two, Classifieds is nine.

This change eliminates apartment-versus-sofa confusion completely. It does
nothing whatsoever for phone-versus-tablet, which stays exactly as accurate
as it is today. Anyone measuring the classifier after this ships should
expect a step change in cross-domain errors and no movement at all in
within-Classifieds errors.

## The decisions

| Question | Decision |
|---|---|
| Scope | Domains govern both posting and browsing |
| Home screen | A gate — four domains, three active today |
| Structure | Domains are a layer **above** the category tree, not the top of it |
| Auto Parts & Accessories | A second tile inside Vehicles |
| Classifier | Hard-constrained to the chosen domain, with a one-tap switch when the photos disagree |
| Storefronts | Skip the gate entirely; "Posting in Properties — Change"; not shown to buyers |
| Shop setting | A domain, optionally narrowed to one category |
| Jobs & Services | Their own fourth domain, dormant until activated |
| Per-domain home | Each domain gets its own collections, banners and feed |
| Search | Scoped to the domain, with a line pointing at matches elsewhere |

## The browsing decisions

Step 3's own set, agreed 30 Aug 2026 the same way -- one question at a
time, before any of it was built. The first table settled what domains
*are*; this one settles what a buyer meets.

| Question | Decision |
|---|---|
| Buyer's home | The gate itself |
| Stickiness | None -- asked every launch, never remembered |
| Switching | Back to the gate; no persistent section switcher |
| Collections | The same collections, filtered to the section |
| Search on the gate | Yes -- across everything, each result labelled by section |
| Search inside a section | Scoped, with a line handing the same words to the gate's search |
| Gate content | Live counts on the tiles, and one newest-across-the-site row |
| Banners | A banner gains an optional section; the five slots are unchanged |
| Where a banner runs | Only where the section is known AND matches; the sidebar knows none |
| Category tiles | A section shows its own top-level categories, and none when it has one |
| Addresses | `/category/electronics` still resolves; each section gets its own too |

Not sectioned, deliberately: favourites, chat, profile, storefronts and the
shops directory. A shop sells what it sells.

**The newest-across-the-site row is not a collection.** It is the single
exception to the row above it, and the exception is the point: collections
filter to their section, that row does not, because it lives on the one
screen that sits above the sections. Building it as a collection would put
a cross-section row one config change away from appearing inside a section,
where it would undo the whole design.

**Asked every launch is a choice with a cost, taken on purpose.** A buyer
who is house-hunting this month opens into the gate every single time
rather than into Properties. The reason to accept that: nobody is ever in
a section they did not just pick, and all three stay equally visible --
which is what the first months are for finding out.

## Three things that had to be reconciled

These are conflicts the decisions above created between them. Recorded
because each one is somewhere a later reader would otherwise assume the
opposite.

**"Tapping a domain goes straight to listings" is not true.** It was the
original shape of the gate, and per-domain homes replaced it. Every domain
opens its own home: Properties gets a feed and collections, Vehicles gets
its two tiles plus a feed, Classifieds gets nine tiles plus a feed.

**The domain is a hard wall. A shop's category narrowing is not.** If both
were absolute, a computer shop could never add mobile phones — which is
exactly the flexibility a storefront owner asked for. So the domain
constrains the classifier absolutely, while a shop's saved category is a
pre-selection the seller overrides inside the flow without editing their
storefront settings.

**A domain with no active categories does not render.** Which is why the
gate shows three cards today and four the day Jobs & Services is switched
on. Derived from the category rows, never stored — the same rule as
leaf-ness, and for the same reason: a stored flag is a second source of
truth that drifts.

**The shop's domain is stored, not derived from its category.** Every
top-level category belongs to exactly one domain, so a shop that has
picked "Electronics" has already said "Classifieds" — the setting could
have been read straight off the category it already had, with no new
column. It is stored anyway, deliberately: a merchant has to be able to
say "Vehicles" without committing to Cars *or* to Auto Parts. The two
cannot contradict each other because the category chips are narrowed to
the chosen domain — the domain picks which categories are on offer, never
the other way round.

**The shop's category does nothing at posting time yet.** It narrows what
the storefront settings will accept, and it still drives the storefront's
own filters and its directory card, but the posting flow reads only the
domain. Using it as a classifier constraint was considered and dropped: a
phone shop listing an office chair would get a confident wrong answer
instead of a right one, and the seller cannot see an error in a list they
were never shown. Using it to settle the category outright would make it
the wall the decision above says it must not be. The one safe use — filling
the category in when the classifier says it cannot tell — was built and
then removed, because the batch flow has no equivalent and the same
merchant would have got two different answers from the same photo.

**A domain with exactly ONE category asks no category question.** Found in
testing: having picked Properties on the gate, the seller was then shown
"AI guessed: Properties" and asked to confirm it. The candidate list holds
one real option in that case, so the classifier could not have answered
anything else — it was ceremony over a decision with one outcome. Where a
domain resolves to a single category the wizard settles it silently and
the step drops to the question that is actually open (Sale or rent). The
classify call is still made: it seeds the title and can still raise the
domain-mismatch offer, neither of which depends on the category answer.
Derived, not hardcoded to Properties: Vehicles has four leaves and its
guess is real.

## What this costs

**~~The classify edge function changes shape.~~** *Turned out not to be
needed.* The function already takes its candidate list from the caller and
validates its own answer against it, so constraining the classifier is
purely a matter of sending fewer categories. The second output — its read
of which domain the photos really belong to — is obtained by appending one
sentinel candidate per other domain, described in plain terms; picking one
is the mismatch signal. The whole of step 2 therefore ships as an ordinary
app patch, with no separate deploy.

**Collections need domain scoping.** They resolve globally today. Editor's
Picks and Hot Deals have to become per-domain, which means either a domain
on each collection row or deriving one from its listings.

**Deep links and saved searches survive untouched.** Categories keep their
ids and their parentage; only the layer above them is new. `/category/electronics`
still resolves, it just now sits inside Classifieds.

## The known risk

A gate multiplies emptiness. At the time of writing there are seven
listings in the whole database. Today a thin home screen reads as a young
marketplace; behind a gate, Properties and Vehicles each read as a broken
one, and a buyer has to tap to find that out.

The structure is right at scale. The mitigation is to put live counts on
the gate cards, so an empty domain reads as honest rather than broken —
and to treat "does the gate go live now, or once there is volume" as a
separate decision from "do we build it".

## Build order

Each step ships something usable on its own.

1. ~~**Domain as data.**~~ *Done 30 Aug 2026.* `myazar.listing_domains`
   plus a `domain_id` on categories, set on top-level rows and inherited
   downward; `domains` / `domainOfCategory` / `categoriesInDomain` in
   SettingsStore; a Domain picker on the admin category editor, shown
   only for top-level rows since a subcategory's own value would be
   ignored. Invisible to users -- nothing reads it yet.
2. ~~**Posting.**~~ *Done 30 Aug 2026.* The gate is an in-screen step on
   SellHubScreen after the kind and shop questions; the domain reaches the
   single-item wizard as a route param and the batch flow through a
   `domain_id` on the batch row. Both classify call sites are narrowed to
   the domain's leaves, with sentinels raising the switch offer in the
   single-item flow. A storefront answers the gate once in its settings
   (`shops.domain_id`, granted per column like everything else on that
   table) and skips it while posting into itself; both flows show the
   domain and a Change link that pops back to the hub with the gate
   forced, so the skip never becomes a lock.
3. **Browsing.** *Done 30 Aug 2026, except banners.* HomeRoot is now the
   buyer's gate (BrowseGateScreen); HomeDomain and HomeCategory render the
   same HomeScreen one level apart, with the feed, category tiles,
   collection rows and every facet's option list scoped to the section.
   Collections take a scope predicate applied before their own limit, so a
   section's Just Listed is genuinely its newest and not the part of the
   site's newest that happens to belong to it. Search inside a section
   stays scoped and offers a count of what the same words find elsewhere,
   which hands them to the gate's own search. A banner carries an optional
   section (`myazar.banners.domain_id`, table-granted, so no column grant):
   null runs everywhere, set runs only where the section is known and
   matches -- a section's home and the listings inside it, never the
   sidebar, which belongs to no section. The shuffle bag is keyed by slot
   AND section; its "never twice in a row" memory stays keyed by slot
   alone, because that promise is about one place on the screen and a
   viewer does not know the pool behind it changed.
4. **Jobs & Services.** Only when there is an actual intention to launch
   them, and with real thinking about salary ranges and hourly pricing
   rather than a guess made now.
