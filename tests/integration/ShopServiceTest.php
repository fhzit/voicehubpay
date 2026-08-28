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

    // --- card search (by value via SHA-256 hash) ---
    // exact card value resolves its row
    $hit = $inv->listForProduct((int) $product['id'], '', 'CC33--SECRET3', 1, 20);
    $t->assertSame(1, $hit['total'], 'search by exact card value finds the row');
    $t->assertSame(1, count($hit['items']));
    // hash comparison is unambiguous to the exact card
    $miss = $inv->listForProduct((int) $product['id'], '', 'CC33--SECRET3x', 1, 20);
    $t->assertSame(0, $miss['total'], 'near-miss card value does not match');
    // already-sold card is still searchable by its value
    $soldHit = $inv->listForProduct((int) $product['id'], '', 'AA11-SECRET-ONE', 1, 20);
    $t->assertSame(1, $soldHit['total'], 'sold card still found by value');
    // listAll: card value match (not only product-name substring)
    $all = $inv->listAll('BB22/SECRET/TWO', 1, 20);
    $t->assertSame(1, $all['total'], 'listAll matches by card value');
    // listAll: product-name substring still works
    $byName = $inv->listAll('数字', 1, 20);
    $t->assertSame(3, $byName['total'], 'listAll product-name substring still works');

    // --- cancel marks pending payment transactions as cancelled ---
    // A fresh order with 1 remaining available card (CC33) + a pending tx,
    // then cancelUnpaidOrder must flip the tx status to 'cancelled'.
    $payments = $app->make('payments');
    $o3 = $shop->createOrder((int) $u['id'], (int) $product['id'], 1);
    $payments->upsert([
        'order_id' => (int) $o3['id'],
        'gateway' => 'sg65',
        'merchant_order_no' => (string) $o3['order_no'],
        'amount_cents' => (int) $o3['amount_due_cents'],
        'status' => 'pending',
        'pay_type' => 'wxpay',
        'pay_url' => 'https://example.test/pay',
    ]);
    $before = $payments->listForOrder((int) $o3['id']);
    $t->assertSame('pending', $before[0]['status'], 'tx starts pending (待确认)');
    $shop->cancelUnpaidOrder((int) $o3['id'], 'user_cancel');
    $t->assertSame('cancelled', $app->make('orders')->findById((int) $o3['id'])['order_status'], 'order is cancelled');
    $after = $payments->listForOrder((int) $o3['id']);
    $t->assertSame(1, count($after), 'one tx row remains');
    $t->assertSame('cancelled', $after[0]['status'], 'cancel flips pending tx to cancelled');

    // markCancelledForOrder never downgrades a paid transaction
    $payments->upsert([
        'order_id' => (int) $paid['id'], // a paid order
        'gateway' => 'sg65',
        'merchant_order_no' => (string) $paid['order_no'] . '-RESET',
        'amount_cents' => (int) $paid['amount_due_cents'],
        'status' => 'paid',
        'pay_type' => 'wxpay',
    ]);
    $payments->markCancelledForOrder((int) $paid['id']);
    $paidTxs = $payments->listForOrder((int) $paid['id']);
    foreach ($paidTxs as $pt) {
        $t->assertSame('paid', $pt['status'], 'paid transactions are never downgraded to cancelled');
    }

    return ['assertions' => $t->assertions()];
};
