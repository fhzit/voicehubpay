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
    // dispatch, redirecting (302) to the configured URL, while leaving
    // /login, /register, /install, the social-login flow and external callbacks
    // reachable for anonymous visitors; anything else is redirected.
    $src = $t->basePath . '/public/index.php';
    $fc = (string) file_get_contents($src);
    $t->assertContains("'AUTH_REDIRECT_URL'", $fc, 'front controller reads AUTH_REDIRECT_URL');
    $t->assertContains('!$app->make(\'auth\')->isLoggedIn()', $fc, 'guard only applies to anonymous visitors');
    $t->assertContains("\VoiceHubPay\Http\Response::redirect(\$guestRedirect, 302)", $fc, 'anonymous requests get a 302 to the configured URL');
    $t->assertContains("str_starts_with(\$path, '/login')", $fc, '/login stays reachable when logged out');
    $t->assertContains("str_starts_with(\$path, '/register')", $fc, '/register stays reachable when logged out');
    $t->assertContains("str_starts_with(\$path, '/auth/social')", $fc, 'QQ/WeChat social login flow stays reachable (regression fix)');
    $t->assertContains("str_starts_with(\$path, '/install')", $fc, 'install wizard stays reachable');
    $t->assertContains("'/webhook/afdian'", $fc, 'afdian webhook stays reachable');
    $t->assertContains("str_starts_with(\$path, '/payments/sg65')", $fc, 'SG65 payment callbacks stay reachable');

    // The setting surface: admins can save it from the general settings page.
    $gs = (string) file_get_contents($t->basePath . '/views/admin/settings/general.php');
    $t->assertContains('name="auth_redirect_url"', $gs, 'general settings form exposes the field');
    $sc = (string) file_get_contents($t->basePath . '/src/Controllers/Admin/SettingsController.php');
    $t->assertContains("'AUTH_REDIRECT_URL' => \$authRedirectUrl", $sc, 'saveGeneral persists the setting');

    return ['assertions' => $t->assertions()];
};