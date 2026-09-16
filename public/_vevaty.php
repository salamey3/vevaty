<?php
/**
 * Shared helpers for Vevaty's two server-rendered endpoints.
 *
 * WHY THERE IS PHP HERE AT ALL. vevaty.com is a React app: the HTML it
 * serves is an empty shell and everything a person reads is drawn by
 * JavaScript afterwards. That is fine for people and useless for search
 * engines, which have to decide what a page is about and increasingly
 * will not spend several megabytes of JavaScript to find out. A
 * classifieds marketplace nobody can find on Google is a marketplace
 * that depends entirely on its owner telling people it exists.
 *
 * The usual answer is to rebuild the site around a server that renders
 * pages. This host already runs one -- cPanel/LiteSpeed with PHP 8 --
 * so the far smaller answer is two files: one that lists every URL for
 * a crawler to find, and one that answers a listing URL with the real
 * title, price and photo BEFORE the app boots over it. People still get
 * the app, unchanged. Crawlers get a page they can read.
 *
 * Nothing in here is a secret. The Supabase URL and publishable key are
 * the same pair already compiled into the public JavaScript bundle, and
 * every read below goes through the same Row Level Security policy that
 * governs the app: "active listings are publicly readable". This code
 * cannot see anything a logged-out visitor could not already see.
 */

// The origin is overridable ONLY so that scripts/test/seo-pages.test.mjs can
// point these two pages at a stand-in that answers with the same JSON
// PostgREST does, and check what they build out of it. There is no request
// path to this: a shared host's environment comes from its own config, not
// from anything a visitor can send. The default is the live project, and a
// deploy never sets the variable.
define('VEVATY_SUPABASE_URL', getenv('VEVATY_SUPABASE_URL') ?: 'https://ajrrmropskvutjizulkb.supabase.co');
const VEVATY_SUPABASE_KEY = 'sb_publishable_DK_WRVSv9ymAGCgL9o8k9g_9Lg2wB1l';
const VEVATY_ORIGIN = 'https://vevaty.com';

/**
 * A GET against Supabase's REST API, or null on any failure at all.
 *
 * Null is the important part. Everything that calls this has a working
 * fallback -- the app itself -- so a slow database, a network blip or a
 * changed schema must degrade to "the page behaves exactly as it did
 * before any of this existed", never to a white page or a PHP error. The
 * timeouts are deliberately short for the same reason: a visitor waiting
 * on Supabase is a visitor who would have been served instantly a week
 * ago.
 */
function vevaty_get(string $path, int $timeout = 4) {
    $ch = curl_init(VEVATY_SUPABASE_URL . $path);
    if ($ch === false) return null;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . VEVATY_SUPABASE_KEY,
            'Authorization: Bearer ' . VEVATY_SUPABASE_KEY,
            'Accept-Profile: myazar',
            'Accept: application/json',
        ],
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $status !== 200) return null;
    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

/** Everything written into HTML goes through this. No exceptions. */
function vevaty_h($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Trims to a length a search result will actually show, on a word
 * boundary, with the newlines flattened -- a meta description is one line
 * whatever the seller typed.
 */
function vevaty_summarise(?string $text, int $max = 155): string {
    $flat = trim(preg_replace('/\s+/u', ' ', (string) $text));
    if ($flat === '') return '';
    if (mb_strlen($flat, 'UTF-8') <= $max) return $flat;
    $cut = mb_substr($flat, 0, $max - 1, 'UTF-8');
    $space = mb_strrpos($cut, ' ', 0, 'UTF-8');
    if ($space !== false && $space > $max * 0.6) $cut = mb_substr($cut, 0, $space, 'UTF-8');
    return rtrim($cut, " ,.;:-") . '…';
}
