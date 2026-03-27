<?php
// Transparent sitemap proxy — fetches live data from backend (Render)
// Served at elegantize.com/sitemap.xml via .htaccess rewrite (no redirect)
$backendUrl = 'https://elegantize-zl57.onrender.com/sitemap.xml';

// Render free tier can cold-start in ~30 s; allow up to 3 attempts so
// Googlebot and other crawlers always get a valid sitemap.
$maxAttempts = 3;
$xml         = false;

for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
    $context = stream_context_create([
        'http' => [
            'timeout' => 30,
            'header'  => 'User-Agent: ElegantizeSitemapProxy/1.0',
        ],
    ]);

    $xml = @file_get_contents($backendUrl, false, $context);

    if ($xml !== false) {
        break; // success — stop retrying
    }

    // Brief back-off before the next attempt (skip sleep on the last attempt)
    if ($attempt < $maxAttempts) {
        sleep(5);
    }
}

if ($xml === false) {
    http_response_code(503);
    header('Content-Type: text/plain');
    echo 'Sitemap temporarily unavailable — backend did not respond after ' . $maxAttempts . ' attempts.';
    exit;
}

// Basic sanity-check: make sure we got XML, not an error page
if (strpos($xml, '<?xml') === false && strpos($xml, '<urlset') === false) {
    http_response_code(502);
    header('Content-Type: text/plain');
    echo 'Sitemap temporarily unavailable — backend returned unexpected content.';
    exit;
}

header('Content-Type: application/xml; charset=UTF-8');
header('Cache-Control: public, max-age=3600');
echo $xml;
