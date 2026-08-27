<?php

declare(strict_types=1);

/**
 * CLI: release expired inventory reservations and cancel expired unpaid orders.
 * Runs as a cron (every few minutes). Never releases paid orders.
 *
 *   php scripts/release-reservations.php
 */

use VoiceHubPay\App;
use VoiceHubPay\Shop\ShopService;

require __DIR__ . '/../src/bootstrap.php';

$app = new App(dirname(__DIR__));
$inventory = $app->make('inventory');
$shop = new ShopService($app);

$nowIso = gmdate('c');

// 1) Release expired reservations (unpaid orders only; ShopService guards).
$released = $inventory->releaseExpired($nowIso);

// 2) Cancel expired unpaid orders (releases their reservations + cancels).
$expiredMinutes = max(5, (int) $app->config->get('ORDER_TTL_MINUTES', 30));
$ordersRepo = $app->make('orders');
$pdo = $app->db->pdo();
$stmt = $pdo->prepare("SELECT id FROM orders WHERE payment_status IN ('unpaid','pending') AND order_status = 'pending_payment' AND created_at <= ?");
$cutoff = gmdate('c', time() - $expiredMinutes * 60);
$stmt->execute([$cutoff]);
$cancelled = 0;
foreach ($stmt->fetchAll() as $row) {
    try {
        $shop->cancelUnpaidOrder((int) $row['id'], 'auto_expire');
        $cancelled++;
    } catch (\Throwable $e) {
        error_log('[release-reservations] ' . $e->getMessage());
    }
}

echo sprintf('Released expired reservations: %d cards; cancelled expired orders: %d.', $released, $cancelled) . PHP_EOL;
