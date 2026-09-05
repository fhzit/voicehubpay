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

    // The bucketing logic is what we're testing; the specific calendar day is
    // incidental and must not go stale as the wall clock advances. Use
    // "yesterday" so the fixed instant is always inside trends('week').
    [$yy, $mm, $dd] = array_map('intval', explode('-', date('Y-m-d', strtotime('-2 days'))));
    $paidAt = sprintf('%04d-%02d-%02dT02:30:00+00:00', $yy, $mm, $dd); // yesterday, ~10:30 Shanghai
    $label = date('m-d', strtotime('-2 days')); // e.g. '09-03'
    $pdo->prepare("INSERT INTO orders
        (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency,
         order_status, payment_status, fulfillment_status, created_at, paid_at, updated_at)
        VALUES ('TST', 0, 'shop', 103, 103, 'CNY', 'completed', 'paid', 'fulfilled',
                :paidAt, :paidAt, :paidAt)")
        ->execute(['paidAt' => $paidAt]);

    $svc = new DashboardService($app);
    // Today range resolves relative to real "now"; the "week" bucket window
    // always includes yesterday's day, so we look that label up dynamically.
    $week = $svc->trends('week', 'all');
    $found = null;
    foreach ($week['income'] as $b) {
        if ($b['label'] === $label) {
            $found = $b;
            break;
        }
    }
    $t->assertFalse($found === null, "a $label bucket exists in the week trend");
    $t->assertSame(103, $found['shop'], 'shop revenue lands in the $label bucket (bucketed by paid_at)');
    $t->assertSame(103, $found['total'], 'total reflects the order amount');
    $t->assertSame(0, $found['afdian'], 'no afdian revenue in that bucket');

    // Afdian order in a different bucket.
    $afLabel = $label; // same day for the combined-assertions to stay simple
    $afPaid = sprintf('%04d-%02d-%02dT08:00:00+00:00', $yy, $mm, $dd); // = same day, 16:00 Shanghai
    $pdo->prepare("INSERT INTO afdian_orders
        (out_trade_no, user_id, amount_cents, status, paid_at, created_at, updated_at)
        VALUES ('AF1', 'u1', 500, 'paid', :p, :p, :p)")
        ->execute(['p' => $afPaid]);
    $week2 = $svc->trends('week', 'all');
    foreach ($week2['income'] as $b) {
        if ($b['label'] === $afLabel) {
            $t->assertSame(500, $b['afdian'], 'afdian revenue lands in the $label bucket');
            $t->assertSame(603, $b['total'], 'shop + afdian combine correctly');
        }
    }

    // Channel filter must apply to the trend buckets, not just KPIs.
    $weekShop = $svc->trends('week', 'shop');
    foreach ($weekShop['income'] as $b) {
        if ($b['label'] === $afLabel) {
            $t->assertSame(103, $b['shop'], 'shop channel keeps shop revenue');
            $t->assertSame(0, $b['afdian'], 'shop channel hides afdian revenue');
            $t->assertSame(103, $b['total'], 'shop channel total = shop only');
        }
    }
    $weekAf = $svc->trends('week', 'afdian');
    foreach ($weekAf['income'] as $b) {
        if ($b['label'] === $afLabel) {
            $t->assertSame(0, $b['shop'], 'afdian channel hides shop revenue');
            $t->assertSame(500, $b['afdian'], 'afdian channel keeps afdian revenue');
            $t->assertSame(500, $b['total'], 'afdian channel total = afdian only');
        }
    }

    // Actual (net) income: gross minus each channel's configured fee%.
    // shop 103 * (1 - 0.03) = 100 ; afdian 500 * (1 - 0.06) = 470 ; net = 570
    $dayStart = sprintf('%04d-%02d-%02dT00:00:00+00:00', $yy, $mm, $dd);
    $dayEnd = sprintf('%04d-%02d-%02dT00:00:00+00:00', $yy, $mm, $dd + 1);
    $kpi = $svc->computeKpi($dayStart, $dayEnd, 'all');
    $t->assertSame(100, $kpi['actual_shop'], 'shop net after 3% fee');
    $t->assertSame(470, $kpi['actual_afdian'], 'afdian net after 6% fee');
    $t->assertSame(570, $kpi['actual_revenue'], 'actual revenue = both net sums');
    $t->assertSame(603, $kpi['total_revenue'], 'gross untouched');

    return ['assertions' => $t->assertions()];
};