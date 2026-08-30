<?php

declare(strict_types=1);

use VoiceHubPay\Config\Config;
use VoiceHubPay\Controllers\AuthController;
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
    // 复制卡密：必须拉取真实卡密（reveal API）而非复制页面上的掩码。
    $t->assertContains('data-copy-unit', $js, 'copy-card handler reads data-copy-unit');
    $t->assertContains("/api/cards/' + id + '/reveal", $js, 'copy-card handler calls the reveal API for the real code');
    $t->assertContains('data-revealed', $js, 'copy-card handler detects when the real code is already shown');
    $cards = file_get_contents($base . '/views/account/cards.php') ?: '';
    $t->assertContains('data-copy-unit=', $cards, 'cards page copy buttons carry data-copy-unit (not masked copy)');
    $t->assertFalse(str_contains($cards, 'data-copy-target'), 'cards page no longer copies the masked #code-box via target');
    $detail = file_get_contents($base . '/views/account/order-detail.php') ?: '';
    $t->assertContains('data-copy-unit=', $detail, 'order-detail copy buttons carry data-copy-unit');
    $t->assertFalse(str_contains($detail, 'data-copy-target'), 'order-detail no longer copies the masked #code-box via target');

    foreach (glob($base . '/views/install/step-*.php') ?: [] as $view) {
        if (str_contains((string) file_get_contents($view), '<form method="post"')) {
            $t->assertContains('name="_csrf"', (string) file_get_contents($view), basename($view) . ' includes CSRF');
        }
    }

    $installEnv = file_get_contents($base . '/views/install/step-env.php') ?: '';
    $t->assertContains('$canContinue', $installEnv, 'install env step computes availability from current checks');
    $t->assertContains('$canContinue ?', $installEnv, 'install env button uses current checks instead of session state');
    $t->assertFalse(str_contains($installEnv, "!empty(\$state['env_ok']) ? '' : 'disabled'"), 'install env button has no pre-submit session deadlock');

    $installDb = file_get_contents($base . '/views/install/step-db.php') ?: '';
    $t->assertContains('name="db_sqlite_database"', $installDb, 'SQLite and PostgreSQL database fields have distinct names');
    $t->assertContains('name="db_pgsql_database"', $installDb, 'PostgreSQL database field has a distinct name');
    $t->assertFalse(str_contains($installDb, 'name="db_database"'), 'hidden database form does not submit duplicate db_database values');

    [$redirectApp] = $t->freshApp('safe-redirect');
    $authController = new AuthController($redirectApp);
    $safeRedirect = new ReflectionMethod($authController, 'safeRedirect');
    $t->assertSame('/account/orders', $safeRedirect->invoke($authController, '/account/orders'));
    $t->assertSame('/', $safeRedirect->invoke($authController, '//evil.example'));
    $t->assertSame('/', $safeRedirect->invoke($authController, '/\\evil.example'));
    $t->assertSame('/', $safeRedirect->invoke($authController, "/account\r\nLocation: https://evil.example"));

    $configDir = $t->tmpDir('config-precedence');
    mkdir($configDir . '/storage', 0777, true);
    $config = Config::fromEnv($configDir);
    $config->settings()->set('PRECEDENCE_TEST', 'database');
    $config->reloadSettings();
    $t->assertSame('database', $config->get('PRECEDENCE_TEST'));
    $envConfig = new Config(['PRECEDENCE_TEST' => 'environment'], $configDir);
    $envConfig->reloadSettings();
    $t->assertSame('environment', $envConfig->get('PRECEDENCE_TEST'), 'environment overrides persistent WebUI settings');

    // Duplicate-account guard: submitting the register form while already
    // logged in (e.g. a QQ/WeChat-only account) must NOT create a second
    // account — it should redirect the user to complete the current account.
    $authCtrlSrc = file_get_contents($base . '/src/Controllers/AuthController.php') ?: '';
    $t->assertContains('function register', $authCtrlSrc, 'register action exists');
    $t->assertTrue(str_contains($authCtrlSrc, 'isLoggedIn()'), 'register guards against already-logged-in user');
    $t->assertContains('/account?complete=1', $authCtrlSrc, 'register redirects logged-in users to complete flow');

    return ['assertions' => $t->assertions()];
};
