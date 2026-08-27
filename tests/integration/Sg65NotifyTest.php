<?php

declare(strict_types=1);

use VoiceHubPay\Payments\PaymentService;
use VoiceHubPay\Payments\Sg65Signer;
use VoiceHubPay\Shop\ShopService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('sg65');
    $users = $app->make('users');
    $u = $users->create(['username' => 'buyer3', 'password' => 'password123', 'display_name' => 'B', 'role' => 'user']);
    $cats = $app->make('categories');
    $c = $cats->create('分类C', 'cat-c');
    $prods = $app->make('products');
    $p = $prods->create([
        'category_id' => $c['id'], 'name' => 'SG65 卡', 'slug' => 'sg65-1', 'description' => '',
        'price_cents' => 1990, 'status' => 'active',
        'delivery_mode' => 'card', 'voicehub_enabled' => 0, 'voicehub_code_source' => 'inventory',
        'stock_enabled' => 1, 'min_quantity' => 1, 'max_quantity' => 1, 'quantity_step' => 1,
        'low_stock_threshold' => 0, 'sort_order' => 0,
    ]);
    $app->make('inventory')->import((int) $p['id'], ['CARDTEST-SECRET-XYZ'], $app->crypto);

    // Configure SG65 (keys stored as legacy plaintext exercises the SecretStore fallback).
    $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($res, $merchantKey);
    $platformKey = openssl_pkey_get_details($res)['key'];
    $app->config->settings()->setMany([
        'SG65_ENABLED' => '1',
        'SG65_PID' => '10086',
        'SG65_MERCHANT_PRIVATE_KEY' => $merchantKey,
        'SG65_PLATFORM_PUBLIC_KEY' => $platformKey,
    ]);
    $app->config->reloadSettings();

    $order = (new ShopService($app))->createOrder((int) $u['id'], (int) $p['id'], 1);
    $payment = new PaymentService($app);

    // Build a valid V2 notify payload: sign with MERCHANT key, verify uses PLATFORM key.
    $notify = [
        'pid' => '10086',
        'out_trade_no' => $order['order_no'],
        'trade_no' => 'GATEWAY-1',
        'api_trade_no' => 'API-1',
        'money' => '19.90',
        'type' => 'alipay',
        'trade_status' => 'TRADE_SUCCESS',
    ];
    $notify['sign'] = Sg65Signer::sign($notify, $merchantKey);
    $notify['sign_type'] = 'RSA2';

    $r1 = $payment->handleNotify($notify);
    $t->assertSame('success', $r1);
    $paid = $app->make('orders')->findByOrderNo($order['order_no']);
    $t->assertSame('paid', $paid['payment_status']);

    // duplicate notify -> still success, no double confirm, single paid txn
    $r2 = $payment->handleNotify($notify);
    $t->assertSame('success', $r2);
    $txn = $pdo->query("SELECT COUNT(*) FROM payment_transactions WHERE order_id = " . (int) $paid['id'])->fetchColumn();
    $t->assertSame(1, (int) $txn, 'one paid transaction row');

    // tampered signature rejected, order stays as-is
    $bad = $notify;
    $bad['money'] = '1.00';
    $t->assertSame('verify_failed', $payment->handleNotify($bad), 'signature verified over all fields');

    // amount mismatch with valid signature -> amount_mismatch
    $mismatch = $notify;
    unset($mismatch['sign'], $mismatch['sign_type']);
    $mismatch['money'] = '9.90';
    $mismatch['sign'] = Sg65Signer::sign($mismatch, $merchantKey);
    $mismatch['sign_type'] = 'RSA2';
    $t->assertSame('amount_mismatch', $payment->handleNotify($mismatch));

    // wrong pid rejected
    $wrongPid = $notify;
    unset($wrongPid['sign'], $wrongPid['sign_type']);
    $wrongPid['pid'] = '99999';
    $wrongPid['sign'] = Sg65Signer::sign($wrongPid, $merchantKey);
    $wrongPid['sign_type'] = 'RSA2';
    $t->assertSame('pid_mismatch', $payment->handleNotify($wrongPid));

    // non-success status not confirmed
    $pending = $notify;
    unset($pending['sign'], $pending['sign_type']);
    $pending['trade_status'] = 'TRADE_PENDING';
    $pending['sign'] = Sg65Signer::sign($pending, $merchantKey);
    $pending['sign_type'] = 'RSA2';
    $t->assertSame('not_success', $payment->handleNotify($pending));

    return ['assertions' => $t->assertions()];
};
