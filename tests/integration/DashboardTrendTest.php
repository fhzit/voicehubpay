<?php

declare(strict_types=1);

use VoiceHubPay\Analytics\DashboardService;

/**
 * Dashboard income trend must bucket revenue by the same paid_at timestamp
 * that the order records carry — so the trend's time axis matches the orders'
 * payment time. Regression for "收入趋势与订单时间不对".
 */
return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('dashboard-trend');

    // Insert a paid shop order whose paid_at is a fixed instant in a specific
    // Shanghai hour: 2026-08-27 02:30 UTC = 2026-08-27 10:30 Asia/Shanghai.
    $paidAt = '2026-08-27T02:30:00+00:00';
    $pdo->prepare("INSERT INTO orders
        (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency,
         order_status, payment_status, fulfillment_status, created_at, paid_at, updated_at)
        VALUES ('TST', 0, 'shop', 103, 103, 'CNY', 'completed', 'paid', 'fulfilled',
                :paidAt, :paidAt, :paidAt)")
        ->execute(['paidAt' => $paidAt]);

    $svc = new DashboardService($app);
    // Today range resolves relative to real "now"; to avoid depending on the
    // clock, we rely on trends('week') buckets which always include 08-27's day.
    $week = $svc->trends('week', 'all');
    $found = null;
    foreach ($week['income'] as $b) {
        if ($b['label'] === '08-27') {
            $found = $b;
            break;
        }
    }
    $t->assertFalse($found === null, 'a 08-27 bucket exists in the week trend');
    $t->assertSame(103, $found['shop'], 'shop revenue lands in the 08-27 bucket (bucketed by paid_at)');
    $t->assertSame(103, $found['total'], 'total reflects the order amount');
    $t->assertSame(0, $found['afdian'], 'no afdian revenue in that bucket');

    // Afdian order in a different bucket.
    $afPaid = '2026-08-27T08:00:00+00:00'; // = 16:00 Shanghai, same day
    $pdo->prepare("INSERT INTO afdian_orders
        (out_trade_no, user_id, amount_cents, status, paid_at, created_at, updated_at)
        VALUES ('AF1', 'u1', 500, 'paid', :p, :p, :p)")
        ->execute(['p' => $afPaid]);
    $week2 = $svc->trends('week', 'all');
    foreach ($week2['income'] as $b) {
        if ($b['label'] === '08-27') {
            $t->assertSame(500, $b['afdian'], 'afdian revenue lands in the 08-27 bucket');
            $t->assertSame(603, $b['total'], 'shop + afdian combine correctly');
        }
    }

    return ['assertions' => $t->assertions()];
};