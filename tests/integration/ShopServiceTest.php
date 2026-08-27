<?php

declare(strict_types=1);

use VoiceHubPay\Shop\ShopService;
use VoiceHubPay\Payments\PaymentService;
use VoiceHubPay\Repositories\InventoryRepository;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('shop');
    $users = $app->make('users');
    $u = $users->create(['username' => 'buyer1', 'password' => 'password123', 'display_name' => '买家', 'role' => 'user']);
    $cats = $app->make('categories');
    $c = $cats->create('分类A', 'cat-a');
    $prods = $app->make('products');
    $inv = new InventoryRepository($app);
    $crypto = $app->crypto;

    $product = $prods->create([
        'category_id' => $c['id'], 'name' => '数字卡密', 'slug' => 'card-1', 'description' => '',
        'price_cents' => 990, 'status' => 'active',
        'delivery_mode' => 'card', 'voicehub_enabled' => 0, 'voicehub_code_source' => 'inventory',
        'stock_enabled' => 1, 'min_quantity' => 1, 'max_quantity' => 5, 'quantity_step' => 1,
        'low_stock_threshold' => 0, 'sort_order' => 0,
    ]);

    // import 3 cards
    $imp = $inv->import((int) $product['id'], ["AA11-SECRET-ONE", "BB22/SECRET/TWO", "CC33--SECRET3"], $crypto);
    $t->assertSame(3, $imp['total']);
    $t->assertSame(3, $imp['imported']);

    $shop = new ShopService($app);
    $order = $shop->createOrder((int) $u['id'], (int) $product['id'], 2);
    $t->assertSame(1980, (int) $order['amount_due_cents'], 'server computes price*qty');
    $t->assertSame(2, count($order['units']), 'two fulfillment units');
    $t->assertSame(1, count($order['items']));
    $t->assertSame('pending', $order['fulfillment_status']);

    // unit numbers -001 / -002
    $t->assertSame($order['order_no'] . '-001', $order['units'][0]['unit_no']);
    $t->assertSame($order['order_no'] . '-002', $order['units'][1]['unit_no']);

    // stock reserved atomically
    $t->assertSame(1, $inv->countAvailable((int) $product['id']), '3 - 2 reserved');

    // confirm payment (card mode => no HTTP, immediate success)
    $payment = new PaymentService($app);
    $payment->confirmPaid($order, 'manual', 'test');
    $paid = $app->make('orders')->orderWithItems($order['order_no']);
    $t->assertSame('paid', $paid['payment_status']);
    $t->assertSame('success', $paid['fulfillment_status'], 'card mode completes on payment');
    $stats = $app->make('orders')->countUnitsByStatus((int) $paid['id']);
    $t->assertSame(2, (int) $stats['success']);
    $t->assertSame(2, $inv->countByStatus((int) $product['id'], 'sold'), 'reserved -> sold');

    // double confirm is idempotent
    $payment->confirmPaid($paid, 'manual', 'test-again');
    $again = $app->make('orders')->orderWithItems($order['order_no']);
    $t->assertSame('success', $again['fulfillment_status']);

    // cancel unpaid order releases stock (no payment)
    $o2 = $shop->createOrder((int) $u['id'], (int) $product['id'], 1);
    $t->assertSame(0, $inv->countAvailable((int) $product['id']));
    $shop->cancelUnpaidOrder((int) $o2['id'], 'test_cancel');
    $t->assertSame(1, $inv->countAvailable((int) $product['id']), 'cancel releases reservation');
    $cancelled = $app->make('orders')->findByOrderNo($o2['order_no']);
    $t->assertSame('cancelled', $cancelled['order_status']);

    // paid orders can never be cancelled
    $t->assertThrows(\InvalidArgumentException::class, static fn () => $shop->cancelUnpaidOrder((int) $paid['id'], 'test'));

    // insufficient stock: full rollback, no order rows leaked
    $t->assertThrows(\RuntimeException::class, static fn () => $shop->createOrder((int) $u['id'], (int) $product['id'], 2));
    $remaining = (int) $pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn();
    $t->assertSame(2, $remaining, 'failed order leaves no rows');

    return ['assertions' => $t->assertions()];
};
