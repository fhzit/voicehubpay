<?php

declare(strict_types=1);

use VoiceHubPay\Http\Request;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // Forwarding headers must not affect the audit/throttle IP unless proxy
    // trust is explicitly enabled by the deployment.
    $untrusted = new Request('GET', '/', [], [], [
        'REMOTE_ADDR' => '198.51.100.10',
        'HTTP_X_FORWARDED_PROTO' => 'https',
        'HTTP_X_FORWARDED_FOR' => '203.0.113.7, 10.0.0.1',
    ], '');
    $t->assertSame('198.51.100.10', $untrusted->ip(), 'client headers cannot spoof IP');

    $trusted = new Request('GET', '/', [], [], [
        'REMOTE_ADDR' => '10.0.0.2',
        'APP_TRUST_PROXY' => '1',
        'HTTP_X_FORWARDED_FOR' => '203.0.113.7, 10.0.0.1',
    ], '');
    $t->assertSame('203.0.113.7', $trusted->ip(), 'explicit proxy trust uses first forwarded IP');

    $invalidForwarded = new Request('GET', '/', [], [], [
        'REMOTE_ADDR' => '10.0.0.2',
        'APP_TRUST_PROXY' => 'true',
        'HTTP_X_FORWARDED_FOR' => "not-an-ip\r\nX-Test: injected",
    ], '');
    $t->assertSame('10.0.0.2', $invalidForwarded->ip(), 'invalid forwarded IP falls back safely');

    // Static integration guards for bugs that cross PHP-view-JS boundaries.
    $base = $t->basePath;
    $checkout = file_get_contents($base . '/views/checkout/checkout.php') ?: '';
    $t->assertContains("'wxpay' =>", $checkout, 'SG65 wxpay identifier matches backend');
    $t->assertContains("'qqpay' =>", $checkout, 'SG65 qqpay identifier matches backend');

    $orderController = file_get_contents($base . '/src/Controllers/OrderController.php') ?: '';
    $t->assertContains("], 'account');", $orderController, 'account order detail keeps account layout');

    $js = file_get_contents($base . '/public/assets/js/app.js') ?: '';
    $t->assertContains("body.set('_csrf', csrf)", $js, 'AJAX POST test actions include CSRF');
    $t->assertContains("(cents / 100).toFixed(2)", $js, 'frontend money keeps two decimals');

    foreach (glob($base . '/views/install/step-*.php') ?: [] as $view) {
        if (str_contains((string) file_get_contents($view), '<form method="post"')) {
            $t->assertContains('name="_csrf"', (string) file_get_contents($view), basename($view) . ' includes CSRF');
        }
    }

    return ['assertions' => $t->assertions()];
};
