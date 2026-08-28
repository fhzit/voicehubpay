<?php

declare(strict_types=1);

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('guest-redirect');

    // Settings round-trip: the configured guest redirect URL is persisted and
    // readable through the same Config API the front controller uses.
    $app->config->settings()->setMany([
        'SITE_NAME' => '会员中心',
        'SITE_URL' => 'https://pay.test',
        'APP_URL' => 'https://pay.test',
        'AUTH_REDIRECT_URL' => 'https://portal.example.com',
    ]);
    $app->config->reloadSettings();
    $t->assertSame('https://portal.example.com', (string) $app->config->get('AUTH_REDIRECT_URL'), 'config exposes persisted AUTH_REDIRECT_URL');

    // Clearing the setting disables the redirect feature.
    $app->config->settings()->set('AUTH_REDIRECT_URL', '');
    $app->config->reloadSettings();
    $t->assertSame('', (string) $app->config->get('AUTH_REDIRECT_URL'), 'empty value disables guest redirect');

    // Source contract: the front controller guards anonymous visitors before
    // dispatch, redirecting (302) to the configured URL, while passing through
    // every functional / auth / API / order / payment route so the site keeps
    // working. Only the marketing roots and login-gated areas are guarded.
    $src = $t->basePath . '/public/index.php';
    $fc = (string) file_get_contents($src);
    $t->assertContains("'AUTH_REDIRECT_URL'", $fc, 'front controller reads AUTH_REDIRECT_URL');
    $t->assertContains('!$app->make(\'auth\')->isLoggedIn()', $fc, 'guard only applies to anonymous visitors');
    $t->assertContains("\VoiceHubPay\Http\Response::redirect(\$guestRedirect, 302)", $fc, 'anonymous requests get a 302 to the configured URL');
    // Functional prefixes must pass through so the site keeps working.
    $t->assertContains("'/login'", $fc, '/login stays reachable when logged out');
    $t->assertContains("'/register'", $fc, '/register stays reachable when logged out');
    $t->assertContains("'/auth/'", $fc, 'auth (password + social) flow stays reachable when logged out');
    $t->assertContains("'/payments/'", $fc, 'payment notify + return callbacks stay reachable');
    $t->assertContains("'/webhook/'", $fc, 'afdian webhook stays reachable');
    $t->assertContains("'/logout'", $fc, 'logout stays reachable');
    // Order / API / checkout areas are NOT exempt: anonymous access to them is
    // redirected to the configured URL (the visitor must log in first). The auth
    // entry in the passthrough array is directly followed by the payments entry,
    // proving no order/api/checkout routes sit in the exempt list.
    $t->assertContains("'/auth/',\n        '/payments/'", $fc, 'passthrough list goes /auth/ directly to /payments/ (order/API/checkout are NOT exempted)');
    $t->assertContains("str_starts_with(\$path, '/install')", $fc, 'install wizard is gated on install state (regression: only reachable while not installed)');
    $t->assertContains('isInstalled', $fc, 'front controller gates /install on installed state');

    // The setting surface: admins can save it from the general settings page.
    $gs = (string) file_get_contents($t->basePath . '/views/admin/settings/general.php');
    $t->assertContains('name="auth_redirect_url"', $gs, 'general settings form exposes the field');
    $sc = (string) file_get_contents($t->basePath . '/src/Controllers/Admin/SettingsController.php');
    $t->assertContains("'AUTH_REDIRECT_URL' => ", $sc, 'saveGeneral persists the setting');
    // Regression: the general settings page must render *persisted* values, not
    // defaults. The old guard (`config->get('')`) always evaluated to null, so
    // the form was fed an empty settings array and showed defaults after saving.
    $t->assertContains('settings()->all()', $sc, 'general action passes the persisted settings store to the view');
    $t->assertFalse(str_contains($sc, "get('')"), 'general action must not gate settings on the always-null empty-key get');

    return ['assertions' => $t->assertions()];
};