<?php

declare(strict_types=1);

// Secret auth prefix: configured login/register/complete-social paths under a
// custom prefix, hiding the fixed /login /register entry pages so a regulator
// probing standard endpoints cannot discover the service.
return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app] = $t->freshApp('secret-auth-prefix');

    // settings.sqlite is shared (not tmp-isolated), so guarantee a clean slate
    // regardless of any state leaked by a prior/aborted run of this suite.
    $app->config->settings()->set('AUTH_SECRET_PREFIX', '');
    $app->config->reloadSettings();

    // --- Config::authSecretPrefix() / authUrl() normalization ---
    $t->assertSame('', $app->config->authSecretPrefix(), 'no prefix set => empty');
    $t->assertSame('/login', $app->config->authUrl('/login'), 'no prefix => standard login path');
    $t->assertSame('/register', $app->config->authUrl('/register'), 'no prefix => standard register path');

    $app->config->settings()->set('AUTH_SECRET_PREFIX', '/g/82Kf');
    $app->config->reloadSettings();
    $t->assertSame('/g/82Kf', $app->config->authSecretPrefix(), 'prefix normalized to single /-form');
    $t->assertSame('/g/82Kf/login', $app->config->authUrl('/login'), 'login resolved under prefix');
    $t->assertSame('/g/82Kf/register', $app->config->authUrl('/register'), 'register resolved under prefix');
    $t->assertSame('/g/82Kf/complete-social', $app->config->authUrl('/complete-social'), 'complete-social under prefix');

    // trailing-slash + double-slash collapse
    $app->config->settings()->set('AUTH_SECRET_PREFIX', '/pre//fix/');
    $app->config->reloadSettings();
    $t->assertSame('/pre/fix', $app->config->authSecretPrefix(), 'collapses duplicate slashes and trailing slash');

    // "/" and "//" mean "no prefix" (standard paths)
    $app->config->settings()->set('AUTH_SECRET_PREFIX', '//');
    $app->config->reloadSettings();
    $t->assertSame('', $app->config->authSecretPrefix(), '/ / // treated as no secret prefix');
    $app->config->settings()->set('AUTH_SECRET_PREFIX', '');

    // --- Front-controller wiring ---
    $fc = (string) file_get_contents($t->basePath . '/public/index.php');
    // The whitelist must be built from authUrl() so the standard paths are
    // replaced by the prefixed ones when configured.
    $t->assertContains('authUrl(\'/login\')', $fc, 'whitelist login derives from authUrl');
    $t->assertContains('authUrl(\'/register\')', $fc, 'whitelist register derives from authUrl');
    $t->assertContains('authUrl(\'/complete-social\')', $fc, 'whitelist complete-social derives from authUrl');
    // Routes registered from authUrl() too.
    $t->assertContains("\$router->get(\$app->config->authUrl('/login')", $fc, 'login page route honours prefix');
    $t->assertContains("\$router->get(\$app->config->authUrl('/register')", $fc, 'register page route honours prefix');

    // --- Views render the configured auth URLs (nav + cross-links) ---
    $shop = (string) file_get_contents($t->basePath . '/views/layouts/shop.php');
    $t->assertContains("\$__site['auth_login']", $shop, 'shop nav login uses effective auth path');
    $t->assertContains("\$__site['auth_register']", $shop, 'shop nav register uses effective auth path');
    $login = (string) file_get_contents($t->basePath . '/views/auth/login.php');
    $t->assertContains("\$__site['auth_register']", $login, 'login page cross-link uses effective register path');
    $reg = (string) file_get_contents($t->basePath . '/views/auth/register.php');
    $t->assertContains("\$__site['auth_login']", $reg, 'register page cross-link uses effective login path');

    // --- Controller + service redirects honour the prefix ---
    $ac = (string) file_get_contents($t->basePath . '/src/Controllers/AuthController.php');
    $t->assertTrue(str_contains($ac, 'authUrl(\'/login\')') && !str_contains($ac, "redirect('/login')"), 'AuthController redirects use authUrl, not fixed /login');
    $as = (string) file_get_contents($t->basePath . '/src/Auth/AuthService.php');
    $t->assertContains('authUrl(\'/login\')', $as, 'AuthService requireUser redirect honours prefix');
    $ctrl = (string) file_get_contents($t->basePath . '/src/Controllers/Controller.php');
    $t->assertContains("'auth_login' =>", $ctrl, 'Controller injects effective auth_login into __site');

    // --- Admin surface ---
    $gs = (string) file_get_contents($t->basePath . '/views/admin/settings/general.php');
    $t->assertContains('name="auth_secret_prefix"', $gs, 'general settings exposes the secret prefix field');
    $sc = (string) file_get_contents($t->basePath . '/src/Controllers/Admin/SettingsController.php');
    $t->assertContains("'AUTH_SECRET_PREFIX' => ", $sc, 'saveGeneral persists the secret prefix');
    $t->assertContains('normalizeAuthPrefix', $sc, 'saveGeneral validates/normalizes the secret prefix');

    return ['assertions' => $t->assertions()];
};