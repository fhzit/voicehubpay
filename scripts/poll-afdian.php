<?php

declare(strict_types=1);

/**
 * CLI: poll Afdian for new orders and process them through the single
 * AfdianOrderProcessor (webhook / poll / manual all share the same path).
 *
 *   php scripts/poll-afdian.php [--limit=20]
 */

use VoiceHubPay\App;
use VoiceHubPay\Integrations\AfdianOrderProcessor;

require __DIR__ . '/../src/bootstrap.php';

$app = new App(dirname(__DIR__));
$afdian = $app->make('afdian');
if (!$afdian->isEnabled()) {
    echo 'Afdian integration is disabled.' . PHP_EOL;
    exit(0);
}

$processor = new AfdianOrderProcessor($app);
$results = $processor->processPoll($afdian);

$success = count(array_filter($results, static fn ($r) => $r['status'] === 'success'));
$failed = count(array_filter($results, static fn ($r) => $r['status'] === 'failed'));
$skipped = count($results) - $success - $failed;

echo sprintf('Polled Afdian: total=%d success=%d failed=%d skipped=%d', count($results), $success, $failed, $skipped) . PHP_EOL;
foreach ($results as $r) {
    if ($r['status'] === 'failed') {
        echo '  FAIL ' . $r['out_trade_no'] . ': ' . $r['message'] . PHP_EOL;
    }
}
