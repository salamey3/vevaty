# Being found

Vevaty is a React app: the HTML it serves is an empty shell and everything
a person reads is drawn by JavaScript afterwards. That is invisible to a
person and close to fatal for a marketplace, because a classifieds site
nobody can find on Google is a site that depends entirely on its owner
telling people it exists.

This describes what is built, what is deliberately switched off, and the
one line that switches it on.

## The door is shut, on purpose

`public/robots.txt` says `Disallow: /`. Nothing here is crawled until that
line is deleted.

That is not caution for its own sake. The first time Google crawls a
marketplace it forms a view of how much is on it and how good it is, and
that view is slow and expensive to change. As of September 2026 there are
thirteen listings, most of them tests, one of them filed in the wrong
category with the brand "Test". Being indexed as an empty half-test site
is worse than not being indexed at all.

**To open:** delete the `Disallow: /` line from `public/robots.txt`, leave
the rest, and ship. Do it when the tester round is over and there are real
listings from real sellers. Nothing else needs to change — everything
below is already live and working behind the door.

## What is built

**`public/sitemap.php` → `/sitemap.xml`.** Every URL worth crawling: the
home page, the static legal pages, every active listing, and every
category whose branch is switched on. Generated on request, not at build
time, which is the whole reason it is PHP — a sitemap written during
`npm run ship` is accurate for exactly as long as nobody posts anything,
and a marketplace's entire point is that people post things between
deploys. Cached an hour.

Tester listings (`is_test`) are excluded. They are real rows on the real
site, and a search result for somebody's practice post is exactly what
makes a young marketplace look abandoned.

**`public/listing.php` → `/listing/<uuid>`.** The same page as always,
with the answer already in it. A person gets the app shell, the boot
screen, and Vevaty a moment later — unchanged. A crawler gets a `<title>`
naming the item, a description, the photo, a canonical URL and schema.org
`Product` data with the price and condition, all present before a single
byte of JavaScript runs. That is the difference between a listing that can
appear in a search result and one that cannot.

The readable copy is placed inside `<div id="root">`, which looks wrong
and is not. React replaces that element's children when it mounts, so
nothing survives into the running app, and the boot screen is fixed over
the whole viewport until it does — so no person ever sees it. It exists
for the seconds before the bundle lands, which is the only window a
crawler that does not run JavaScript will ever look at.

Every failure path falls through to serving `index.html` untouched: a bad
id, a listing that is not active (with a 404 status, so dead URLs do not
teach Google that this site's links are worthless), an unreachable
database, a missing shell. Nothing here can make the site worse than it
was before it existed.

## The thing that would have gone badly

These two pages are the only part of Vevaty that depends on PHP running.
If PHP were off — not configured for the domain, disabled by the host,
broken by an upgrade — Apache would serve the *source* of `listing.php` as
plain text, and every listing page on the site would be a wall of code.

So `deploy-web.mjs` asks first. It uploads the PHP, fetches
`listing.php?selftest=1` back over HTTPS, and only counts an answer that
could not have come from a plain text file. The `.htaccess` carrying the
rewrite rules is uploaded *after* that check and only if it passed;
otherwise the build's `.htaccess-nophp` goes up instead, the site works
exactly as it did before, and the deploy says loudly what it did.

`node scripts/test/seo-pages.test.mjs` runs both pages against a stand-in
that answers exactly like PostgREST, using a real row copied out of the
live database — including the failure paths: a 404 for an inactive
listing, a non-UUID id that never reaches the database, and a database
that has stopped answering.

## What is deliberately NOT done

**Full server-side rendering.** The usual answer to "Google can't read our
pages" is to rebuild the site around a rendering server. Two files on the
hosting that is already paid for get most of the benefit; a rebuild is
weeks and changes the shape of the project. Revisit it if and when
per-listing pages are measurably not enough.

**Category and search pages are in the sitemap but not server-rendered.**
They are lists, they change constantly, and a listing page is where a
search result should land anyway. If category pages turn out to matter,
they are the same pattern again.

**The sitemap is capped at 45,000 listings**, under the 50,000-URL limit
the spec sets. Past that it needs splitting into a sitemap index. Noted
here rather than discovered later.
