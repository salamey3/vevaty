<?php
/**
 * https://vevaty.com/sitemap.xml -- every URL on Vevaty worth crawling.
 *
 * Generated on request rather than at build time, and that is the whole
 * reason it is PHP. A sitemap written during `npm run ship` is correct
 * for exactly as long as nobody posts anything; a marketplace's entire
 * point is that people post things between deploys. This one is never
 * more than an hour behind whatever is actually live.
 *
 * Nothing here is crawled while robots.txt says Disallow. That file is
 * the door; this is the list of rooms behind it.
 */
require __DIR__ . '/_vevaty.php';

header('Content-Type: application/xml; charset=utf-8');
// An hour. Long enough that a crawler hammering it costs nothing, short
// enough that a listing posted this morning is findable this afternoon.
header('Cache-Control: public, max-age=3600');

/** The static pages, which exist whatever the database says. */
$urls = [
    ['loc' => VEVATY_ORIGIN . '/', 'priority' => '1.0', 'changefreq' => 'daily'],
    ['loc' => VEVATY_ORIGIN . '/about.html', 'priority' => '0.3', 'changefreq' => 'yearly'],
    ['loc' => VEVATY_ORIGIN . '/privacy-policy.html', 'priority' => '0.1', 'changefreq' => 'yearly'],
    ['loc' => VEVATY_ORIGIN . '/terms.html', 'priority' => '0.1', 'changefreq' => 'yearly'],
];

/**
 * Listings.
 *
 * status=active is not just a tidiness filter -- it is the same condition
 * the Row Level Security policy enforces, so anything else would come
 * back empty anyway. is_test is excluded on purpose: tester listings are
 * real rows on the real site, and a search result for someone's practice
 * post is exactly the kind of thing that makes a young marketplace look
 * abandoned.
 *
 * Capped, and ordered newest first, so that the day this site has fifty
 * thousand listings the sitemap does not try to hold all of them in one
 * file. 45,000 is under the 50,000-URL limit the sitemap spec sets, with
 * room for the static pages and the categories. Past that it needs
 * splitting into an index -- noted here rather than pretended away.
 */
$listings = vevaty_get(
    '/rest/v1/listings?select=id,updated_at,created_at&status=eq.active&or=(is_test.is.null,is_test.is.false)'
    . '&order=created_at.desc&limit=45000',
    8
);
foreach ($listings ?? [] as $row) {
    if (empty($row['id'])) continue;
    $urls[] = [
        'loc' => VEVATY_ORIGIN . '/listing/' . rawurlencode($row['id']),
        'lastmod' => substr((string) ($row['updated_at'] ?? $row['created_at'] ?? ''), 0, 10),
        'priority' => '0.8',
        'changefreq' => 'weekly',
    ];
}

/**
 * Category pages. A leaf whose ancestors are switched off is not
 * reachable in the app, so it is not offered to a crawler either --
 * `active` is checked on the parent as well as the leaf, which is the
 * same mistake leafCategories() in the app makes and this deliberately
 * does not.
 */
// `id`, not `slug`. They hold the same value in all 115 rows today, which
// is exactly why it is worth being deliberate: the app's route is
// HomeCategory: 'category/:cat' and `cat` is a CategoryId, so the id is
// what the URL means. The day someone edits a slug, a sitemap built from
// slugs would quietly fill up with 404s.
$categories = vevaty_get('/rest/v1/categories?select=id,parent_id,active&active=is.true&limit=500');
$activeIds = [];
foreach ($categories ?? [] as $c) {
    if (($c['parent_id'] ?? null) === null) $activeIds[$c['id']] = true;
}
foreach ($categories ?? [] as $c) {
    $parent = $c['parent_id'] ?? null;
    if ($parent === null || isset($activeIds[$parent])) {
        $urls[] = [
            'loc' => VEVATY_ORIGIN . '/category/' . rawurlencode($c['id']),
            'priority' => '0.5',
            'changefreq' => 'daily',
        ];
    }
}

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($urls as $u) {
    echo "  <url>\n    <loc>" . vevaty_h($u['loc']) . "</loc>\n";
    if (!empty($u['lastmod'])) echo '    <lastmod>' . vevaty_h($u['lastmod']) . "</lastmod>\n";
    if (!empty($u['changefreq'])) echo '    <changefreq>' . vevaty_h($u['changefreq']) . "</changefreq>\n";
    if (!empty($u['priority'])) echo '    <priority>' . vevaty_h($u['priority']) . "</priority>\n";
    echo "  </url>\n";
}
echo "</urlset>\n";
