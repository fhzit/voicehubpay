<?php

declare(strict_types=1);

use VoiceHubPay\Integrations\AfdianOrderProcessor;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('afdian');
    $crypto = $app->crypto;
    $proc = new AfdianOrderProcessor($app);
    $orders = $app->make('afdianOrders');
    $deliveries = $app->make('deliveries');

    $normalized = [
        'out_trade_no' => 'AFD20260826ORDER0001',
        'trade_no' => 'TRADE-88',
        'user_id' => 'ifdian-user-9',
        'buyer_name' => '买家小明',
        'plan_id' => 'plan-x',
        'sku_detail' => '赞助档位',
        'amount_cents' => 6600,
        'status' => 'paid',
        'raw' => ['order_no' => 'AFD20260826ORDER0001'],
    ];

    // first pass: stores order + delivery row; VoiceHub offline so it fails but records
    $r = $proc->processNormalizedOrder($normalized);
    $t->assertSame('AFD20260826ORDER0001', $r['out_trade_no']);
    $t->assertTrue(in_array($r['status'], ['failed', 'success'], true), 'processed');

    $row = $orders->findByOutTradeNo('AFD20260826ORDER0001');
    $t->assertTrue($row !== null);
    $t->assertSame(6600, (int) $row['amount_cents']);
    $t->assertSame('paid', $row['status']);
    $t->assertSame('买家小明', $row['buyer_name'], 'buyer_name captured from payload');

    // code == out_trade_no verbatim, single delivery row
    $d = $pdo->query("SELECT * FROM voicehub_deliveries WHERE source_order_no='AFD20260826ORDER0001'")->fetchAll();
    $t->assertSame(1, count($d), 'exactly one delivery');
    $t->assertSame('afdian:' . 'AFD20260826ORDER0001', $d[0]['idempotency_key']);
    $t->assertSame('AFD20260826ORDER0001', $crypto->decrypt($d[0]['code_ciphertext']), 'code == out_trade_no');
    $t->assertSame('afdian_order_no', $d[0]['code_source']);

    // duplicate webhook/poll: no second row, retry not new delivery
    $proc->processNormalizedOrder($normalized);
    $d2 = $pdo->query("SELECT COUNT(*) FROM voicehub_deliveries WHERE source_order_no='AFD20260826ORDER0001'")->fetchColumn();
    $t->assertSame(1, (int) $d2, 'idempotent, no duplicate delivery');

    // simulate a success, then verify never re-pushed
    $pdo->exec("UPDATE afdian_orders SET voicehub_status='success' WHERE out_trade_no='AFD20260826ORDER0001'");
    $r3 = $proc->processNormalizedOrder($normalized);
    $t->assertSame('already_success', $r3['status'], 'success never re-pushed');

    // unpaid orders are never delivered
    $unpaid = $proc->processNormalizedOrder([
        'out_trade_no' => 'AFD20260826UNPAID',
        'amount_cents' => 100,
        'status' => 'unpaid',
    ]);
    $t->assertSame('unpaid', $unpaid['status']);
    $n = (int) $pdo->query("SELECT COUNT(*) FROM voicehub_deliveries WHERE source_order_no='AFD20260826UNPAID'")->fetchColumn();
    $t->assertSame(0, $n, 'unpaid not delivered');

    // A later paid payload for the same order refreshes source fields and is
    // eligible for delivery instead of remaining permanently unpaid.
    $transition = $proc->processNormalizedOrder([
        'out_trade_no' => 'AFD20260826UNPAID',
        'trade_no' => 'LATE-PAID-TRADE',
        'amount_cents' => 100,
        'status' => 'paid',
    ]);
    $t->assertTrue(in_array($transition['status'], ['failed', 'success'], true), 'unpaid-to-paid transition is processed');
    $transitionedOrder = $orders->findByOutTradeNo('AFD20260826UNPAID');
    $t->assertSame('paid', $transitionedOrder['status']);
    $t->assertSame('LATE-PAID-TRADE', $transitionedOrder['trade_no']);
    $t->assertTrue($transitionedOrder['paid_at'] !== null && $transitionedOrder['paid_at'] !== '');
    $transitionDeliveries = (int) $pdo->query("SELECT COUNT(*) FROM voicehub_deliveries WHERE source_order_no='AFD20260826UNPAID'")->fetchColumn();
    $t->assertSame(1, $transitionDeliveries, 'paid transition creates one delivery');

    // sponsorName: empty for empty user id; unknown user id does not hard-fail
    // (token missing in test env → best-effort '' which is persisted to cache).
    $svc = $app->make('afdian');
    $t->assertSame('', $svc->sponsorName(''), 'empty user id yields empty name');
    $u = $svc->sponsorName('ifdian-user-9');
    $t->assertTrue(is_string($u), 'sponsor name lookup returns a string, never throws');

    return ['assertions' => $t->assertions()];
};
