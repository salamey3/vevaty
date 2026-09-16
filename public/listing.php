<?php
/**
 * https://vevaty.com/listing/<id> -- the same page as always, with the
 * answer already in it.
 *
 * A person gets exactly what they got before: the app shell, the boot
 * screen, and Vevaty a moment later. Nothing about their experience
 * changes, and if anything at all goes wrong here they still get that,
 * because every failure path below falls through to serving index.html
 * untouched.
 *
 * A crawler gets something it has never had: a <title> that names the
 * item, a description, the photo, a canonical URL and schema.org Product
 * data with the price and condition in it -- all present in the HTML,
 * before a single byte of JavaScript runs. That is the whole difference
 * between a listing that can appear in a search result and one that
 * cannot.
 *
 * The readable copy is placed INSIDE <div id="root">, which is worth
 * explaining because it looks wrong. React replaces that element's
 * children the moment it mounts, so nothing here survives into the
 * running app -- and the boot screen is fixed over the whole viewport
 * until it does, so no person ever sees this text. It exists for the
 * seconds before the bundle arrives, which is the only window a crawler
 * that does not run JavaScript will ever look at.
 */
require __DIR__ . '/_vevaty.php';

$shellPath = __DIR__ . '/index.html';

/**
 * Proof that this file is being EXECUTED rather than served as text.
 *
 * deploy-web.mjs asks for this before it will upload an .htaccess that
 * routes real listing URLs here. If PHP were off -- not configured for
 * the domain, disabled by the host, broken by an upgrade -- Apache would
 * hand the browser this source code as a plain text file, and every
 * listing page on the site would be a wall of PHP. That is a failure
 * worth one round trip to rule out.
 */
if (isset($_GET['selftest'])) {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo "vevaty-php-ok " . PHP_MAJOR_VERSION . "\n";
    exit;
}

/** Serve the app exactly as it would have been served without this file. */
function vevaty_fall_through(string $shellPath, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    $shell = @file_get_contents($shellPath);
    if ($shell === false) {
        // The shell is missing, which means the deploy is broken in a way
        // this file cannot paper over. Say so rather than printing nothing.
        http_response_code(500);
        echo '<!doctype html><meta charset="utf-8"><title>Vevaty</title>'
           . '<p>Vevaty is temporarily unavailable. Please try again shortly.</p>';
        return;
    }
    echo $shell;
}

// is_string first. `?id[]=x` makes $_GET['id'] an ARRAY, and casting that
// to string raises a warning which PHP prints BEFORE the document -- and
// once output has started every header() below silently fails too, so the
// page loses its content type as well. listing.php is directly reachable
// (the .htaccess -f passthrough serves it), so this needs no rewrite rule
// to reach.
$id = (isset($_GET['id']) && is_string($_GET['id'])) ? $_GET['id'] : '';
// Strict, and strict on purpose: this value is about to be interpolated
// into a URL sent to the database. A UUID is the only shape a listing id
// can take, so anything else is either a mistake or someone trying it on,
// and both get the app rather than a query.
if (!preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $id)) {
    vevaty_fall_through($shellPath);
    exit;
}

$rows = vevaty_get(
    '/rest/v1/listings?select=id,title_en,title_ar,description_en,description_ar,price,currency,condition,'
    . 'district,governorate,caza,created_at,updated_at,status,is_test,photos:listing_photos(url,kind,sort_order)'
    . '&id=eq.' . $id . '&status=eq.active&limit=1'
);

// Could not reach the database. The app can, from the visitor's own
// browser, so hand them the app and say nothing.
if ($rows === null) {
    vevaty_fall_through($shellPath);
    exit;
}

// Reached it, and there is no such active listing -- sold, expired,
// removed, or never existed. A 404 matters here: without it every dead
// listing URL answers 200 with a page that says nothing, which is how a
// site teaches a search engine that its URLs are worthless. The app still
// renders and shows its own "not found", because browsers display the
// body of a 404 perfectly happily.
if (count($rows) === 0) {
    vevaty_fall_through($shellPath, 404);
    exit;
}

$l = $rows[0];
$shell = @file_get_contents($shellPath);
if ($shell === false) { vevaty_fall_through($shellPath); exit; }

$title = trim((string) ($l['title_en'] ?? '')) ?: trim((string) ($l['title_ar'] ?? '')) ?: 'Listing';
// ?: not ?? -- an Arabic-only listing can carry description_en = '' rather
// than NULL, and ?? would have taken the empty string and left the page
// with no description at all. The title two lines up already does this.
$body = (string) (trim((string) ($l['description_en'] ?? '')) ?: ($l['description_ar'] ?? ''));
$price = $l['price'] ?? null;
$currency = strtoupper(trim((string) ($l['currency'] ?? 'USD'))) ?: 'USD';
$place = trim(implode(', ', array_filter([
    trim((string) ($l['district'] ?? '')),
    trim((string) ($l['governorate'] ?? '')),
])), ', ');

$photo = null;
foreach (($l['photos'] ?? []) as $p) {
    if (($p['kind'] ?? 'gallery') !== 'gallery' || empty($p['url'])) continue;
    if ($photo === null || ($p['sort_order'] ?? 0) < $photo['sort_order']) {
        $photo = ['url' => $p['url'], 'sort_order' => $p['sort_order'] ?? 0];
    }
}
$photoUrl = $photo['url'] ?? null;

$priceLabel = ($price !== null && $price !== '') ? $currency . ' ' . rtrim(rtrim(number_format((float) $price, 2, '.', ','), '0'), '.') : null;
$pageTitle = $title . ($place !== '' ? ' — ' . $place : '') . ' | Vevaty';
$metaDesc = vevaty_summarise($body) ?: trim(implode(' · ', array_filter([$title, $priceLabel, $place])));
$canonical = VEVATY_ORIGIN . '/listing/' . rawurlencode((string) $l['id']);

/**
 * schema.org Product. This is what lets a search result carry a price and
 * a condition rather than a bare blue link, and it is the single highest
 * -value thing on this page for how a listing appears.
 *
 * availability is InStock unconditionally because the query above already
 * refused anything that is not status=active -- a sold or expired listing
 * never reaches this line.
 */
$conditionMap = [
    'new' => 'https://schema.org/NewCondition',
    'like_new' => 'https://schema.org/UsedCondition',
    'used' => 'https://schema.org/UsedCondition',
    'good' => 'https://schema.org/UsedCondition',
    'fair' => 'https://schema.org/UsedCondition',
    'excellent' => 'https://schema.org/UsedCondition',
    'restored' => 'https://schema.org/RefurbishedCondition',
    'as_found' => 'https://schema.org/UsedCondition',
];
$ld = [
    '@context' => 'https://schema.org',
    '@type' => 'Product',
    'name' => $title,
    'url' => $canonical,
];
if ($metaDesc !== '') $ld['description'] = $metaDesc;
if ($photoUrl) $ld['image'] = [$photoUrl];
if (isset($conditionMap[(string) ($l['condition'] ?? '')])) {
    $ld['itemCondition'] = $conditionMap[(string) $l['condition']];
}
if ($price !== null && $price !== '') {
    $ld['offers'] = [
        '@type' => 'Offer',
        'price' => (string) (float) $price,
        'priceCurrency' => $currency,
        'availability' => 'https://schema.org/InStock',
        'url' => $canonical,
    ];
    if ($place !== '') $ld['offers']['areaServed'] = $place;
}

/**
 * Replace something in the shell with a LITERAL string.
 *
 * Every one of these goes through preg_replace_callback rather than
 * preg_replace, and that is not a style choice. preg_replace expands
 * backreferences in its REPLACEMENT -- and the replacement here is built
 * out of a title and a description that a seller typed. A title containing
 * "$0" spliced a raw <title>Vevaty</title> into the middle of the head; a
 * backslash before a digit spliced in a raw <meta> tag; and a single
 * trailing backslash swallowed the closing quote of an attribute and ate
 * the tag after it. `Cable 1\2 inch` was enough to produce invalid JSON-LD,
 * which means Google discards the price and condition for that listing
 * silently -- the single most valuable thing on this page, lost to a
 * backslash.
 *
 * A callback's return value is used verbatim. There is nothing to escape,
 * and nothing left to get wrong.
 *
 * The `?: $html` is the other half: preg_replace* returns null on a PCRE
 * error, and `echo null` is a blank 200 -- the white page this project has
 * spent two days making impossible everywhere else.
 */
function vevaty_sub(string $html, string $pattern, string $literal): string {
    $out = preg_replace_callback($pattern, static fn() => $literal, $html, 1);
    return is_string($out) ? $out : $html;
}

$shell = vevaty_sub($shell, '/<title>.*?<\/title>/is', '<title>' . vevaty_h($pageTitle) . '</title>');

$replaceAttr = function (string $html, string $property, string $value): string {
    return vevaty_sub(
        $html,
        '/<meta\s+property="' . preg_quote($property, '/') . '"\s+content="[^"]*"/i',
        '<meta property="' . $property . '" content="' . vevaty_h($value) . '"'
    );
};

$shell = $replaceAttr($shell, 'og:title', $title);
$shell = $replaceAttr($shell, 'og:description', $metaDesc);
$shell = $replaceAttr($shell, 'og:type', 'product');
if ($photoUrl) {
    $shell = $replaceAttr($shell, 'og:image', $photoUrl);
    // The shell declares 1200x630, which is true of the share card and
    // almost never true of a seller's photo. WhatsApp and Facebook lay the
    // preview out from the DECLARED size, so leaving them would letterbox
    // or crop every portrait phone photo -- which is most of them.
    $shell = vevaty_sub($shell, '/<meta\s+property="og:image:width"\s+content="[^"]*"\/?>\s*/i', '');
    $shell = vevaty_sub($shell, '/<meta\s+property="og:image:height"\s+content="[^"]*"\/?>\s*/i', '');
}

$inject = "\n    <meta name=\"description\" content=\"" . vevaty_h($metaDesc) . "\"/>"
    . "\n    <link rel=\"canonical\" href=\"" . vevaty_h($canonical) . "\"/>"
    . "\n    <meta property=\"og:url\" content=\"" . vevaty_h($canonical) . "\"/>"
    // A tester's practice listing is a real row on the real site. It should
    // still preview properly when they share it, and it should never be a
    // search result -- sitemap.php leaves them out of discovery, this
    // leaves them out of the index even if something else finds them.
    . (!empty($l['is_test']) ? "\n    <meta name=\"robots\" content=\"noindex\"/>" : '')
    . "\n    <script type=\"application/ld+json\">"
    . json_encode($ld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP)
    . "</script>\n  ";
$shell = vevaty_sub($shell, '/<\/head>/i', $inject . '</head>');

// The readable copy, inside #root -- see the note at the top of this file
// for why that is the right place and why nobody will ever see it. The
// boot screen stays up for it: build-standalone.mjs's loader treats
// whatever is already in #root as a seed and waits for React to replace
// it, rather than reading this as "the app has mounted".
$readable = '<div id="root">'
    . '<article>'
    . '<h1>' . vevaty_h($title) . '</h1>'
    . ($priceLabel ? '<p>' . vevaty_h($priceLabel) . '</p>' : '')
    . ($place !== '' ? '<p>' . vevaty_h($place) . '</p>' : '')
    . ($photoUrl ? '<img src="' . vevaty_h($photoUrl) . '" alt="' . vevaty_h($title) . '" width="600"/>' : '')
    . ($body !== '' ? '<p>' . nl2br(vevaty_h($body)) . '</p>' : '')
    . '<p><a href="' . vevaty_h($canonical) . '">View this listing on Vevaty</a></p>'
    . '</article>'
    . '</div>';
$shell = vevaty_sub($shell, '/<div id="root">\s*<\/div>/i', $readable);

header('Content-Type: text/html; charset=utf-8');
// Same policy the shell itself is served under. A listing changes -- price
// drops, it sells -- and a cached copy of a page that says otherwise is
// worse than the second it costs to ask again.
header('Cache-Control: no-cache, no-store, must-revalidate');
echo $shell;
