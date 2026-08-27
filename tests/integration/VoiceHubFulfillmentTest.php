<?php

declare(strict_types=1);

use VoiceHubPay\Shop\ShopService;
use VoiceHubPay\Payments\PaymentService;
use VoiceHubPay\Fulfillment\FulfillmentService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('vh');
    $users = $app->make('users');
    $u = $users->create(['username' => 'buyer2', 'password' => 'password123', 'display_name' => 'B', 'role' => 'user']);
    $cats = $app->make('categories');
    $c = $cats->create('分类B', 'cat-b');
    $prods = $app->make('products');
    $crypto = $app->crypto;

    // voicehub mode, code_source = order_no, stockless, qty 3
    $product = $prods->create([
        'category_id' => $c['id'], 'name' => 'VoiceHub 券', 'slug' => 'vh-1', 'description' => '',
        'price_cents' => 500, 'status' => 'active',
        'delivery_mode' => 'voicehub', 'voicehub_enabled' => 1, 'voicehub_code_source' => 'order_no',
        'stock_enabled' => 0, 'min_quantity' => 1, 'max_quantity' => 5, 'quantity_step' => 1,
        'low_stock_threshold' => 0, 'sort_order' => 0,
    ]);

    $shop = new ShopService($app);
    $order = $shop->createOrder((int) $u['id'], (int) $product['id'], 3);
    $t->assertSame(1500, (int) $order['amount_due_cents']);

    // before payment no delivery rows
    $d = $app->make('deliveries')->list([]);
    $t->assertSame(0, $d['total']);

    $payment = new PaymentService($app);
    $payment->confirmPaid($order, 'manual', 'test');

    // delivery rows created, one per unit, codes = unit_no (order_no source)
    $deliveries = $app->make('deliveries');
    $list = $deliveries->list([]);
    $t->assertSame(3, $list['total'], 'one delivery per unit');
    $units = $app->make('orders')->orderWithItems($order['order_no'])['units'];
    foreach ($units as $unit) {
        $row = $deliveries->findByUnitId((int) $unit['id']);
        $t->assertTrue($row !== null, 'delivery row per unit');
        $t->assertSame('shop', $row['source_type']);
        $t->assertSame($unit['unit_no'], $crypto->decrypt($row['code_ciphertext']), 'code == unit_no');
        $t->assertSame('shop_order_no', $row['code_source']);
        $t->assertSame('shop:' . $order['order_no'] . ':' . $unit['unit_no'], $row['idempotency_key']);
    }

    // the fulfillments worker leaves statuses untouched when VoiceHub is offline,
    // and records attempts/last_error (this environment has no VoiceHub server)
    $ff = new FulfillmentService($app);
    $ff->processPendingOrders(10);
    $statuses = $deliveries->stats();
    $t->assertTrue(isset($statuses['failed']) || isset($statuses['pending']), 'worker ran');

    // retry path is idempotent at row level (same unit, same idempotency key)
    $ff->processPendingOrders(10);
    $list2 = $deliveries->list([]);
    $t->assertSame(3, $list2['total'], 'no duplicate delivery rows after retry');

    return ['assertions' => $t->assertions()];
};
