<?php

declare(strict_types=1);

/**
 * CLI: process pending fulfillments (VoiceHub deliveries) for paid orders.
 * Runs as a cron every minute. One HTTP request per code, never batched.
 *
 *   php scripts/process-fulfillments.php [--limit=50]
 */

use VoiceHubPay\App;
use VoiceHubPay\Fulfillment\FulfillmentService;

require __DIR__ . '/../src/bootstrap.php';

$args = array_slice($argv, 1);
$limit = 50;
foreach ($args as $arg) {
    if (preg_match('/^--limit=(\d+)$/', $arg, $m)) {
        $limit = max(1, (int) $m[1]);
    }
}

$app = new App(dirname(__DIR__));
$fulfillment = new FulfillmentService($app);
$summary = $fulfillment->processPendingOrders($limit);

echo sprintf(
    'Fulfillment run: processed=%d success=%d failed=%d (limit=%d)',
    $summary['processed'],
    $summary['success'],
    $summary['failed'],
    $limit
) . PHP_EOL;
