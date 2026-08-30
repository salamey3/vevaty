# Listing domains

The decisions behind splitting Vevaty into Properties, Vehicles,
Classifieds and (later) Jobs & Services. Agreed 30 Aug 2026, before any of
it was built, so that the reasoning survives the build rather than being
reconstructed from the diff afterwards.

Step 1 of the build order at the end is done. Everything else is still
spec.

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
| Storefronts | Skip the gate entirely; "Posting in Properties — change"; not shown to buyers |
| Shop setting | A domain, optionally narrowed to one category |
| Jobs & Services | Their own fourth domain, dormant until activated |
| Per-domain home | Each domain gets its own collections, banners and feed |
| Search | Scoped to the domain, with a line pointing at matches elsewhere |

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

## What this costs

**The classify edge function changes shape.** It must accept a domain and
return two things: the best category *within* that domain, and its own
independent read of which domain the photos actually belong to. The
mismatch between the two is what raises the switch offer. Note this is a
Supabase edge function, so it deploys separately from the app — outside
the ordinary patch flow.

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
2. **Posting.** The gate screen, the constrained classifier, the storefront
   skip. This is where the accuracy win lands, and it can ship while
   browsing is untouched.
3. **Browsing.** Per-domain homes, collections scoping, search scoping.
   The large one.
4. **Jobs & Services.** Only when there is an actual intention to launch
   them, and with real thinking about salary ranges and hourly pricing
   rather than a guess made now.
