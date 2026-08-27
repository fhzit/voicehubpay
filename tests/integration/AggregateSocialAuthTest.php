<?php

declare(strict_types=1);

use VoiceHubPay\Auth\SocialAuth;
use VoiceHubPay\Security\SecretStore;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app] = $t->freshApp('aggregate-auth');
    $app->config->settings()->setMany([
        'APP_URL' => 'https://shop.example.test',
        'SITE_URL' => 'https://shop.example.test',
        'AGGREGATE_OAUTH_APP_ID' => 'app-123',
        'AGGREGATE_OAUTH_ENDPOINT' => 'https://a.idcfx.net/connect.php',
    ]);
    (new SecretStore($app->config->basePath, $app->config->settings()))->set('AGGREGATE_OAUTH_APP_KEY', 'key-456');
    $app->config->reloadSettings();

    $social = new SocialAuth($app);
    $t->assertSame('https://shop.example.test/auth/social/callback?provider=qq', $social->callbackUrl('qq'));
    $t->assertSame('https://shop.example.test/auth/social/callback?provider=wx', $social->callbackUrl('wx'));

    $source = file_get_contents($t->basePath . '/src/Auth/SocialAuth.php') ?: '';
    $t->assertContains("'act' => 'login'", $source, 'aggregate login action');
    $t->assertContains("'act' => 'callback'", $source, 'aggregate callback action');
    $t->assertContains("'state' => \$state", $source, 'aggregate SDK passes a state parameter for CSRF');
    $t->assertContains('hash_equals($expectedState, $state)', file_get_contents($t->basePath . '/src/Controllers/AuthController.php') ?: '', 'callback keeps one-time state validation');
    $t->assertContains("'social_uid'", $source, 'aggregate social uid mapping');
    $t->assertContains("'faceimg'", $source, 'aggregate avatar mapping');
    $t->assertFalse(str_contains($source, 'graph.qq.com'), 'direct QQ OAuth removed');
    $t->assertFalse(str_contains($source, 'api.weixin.qq.com'), 'direct WeChat OAuth removed');
    $t->assertFalse(str_contains($source, 'open.weixin.qq.com'), 'direct WeChat authorize removed');
    $t->assertFalse(str_contains($source, 'QQ_APP_ID'), 'legacy QQ credentials removed');
    $t->assertFalse(str_contains($source, 'WX_APP_ID'), 'legacy WeChat credentials removed');

    $settingsView = file_get_contents($t->basePath . '/views/admin/settings/auth.php') ?: '';
    $controllerSource = file_get_contents($t->basePath . '/src/Controllers/AuthController.php') ?: '';
    $t->assertContains('hash_equals($expectedState, $state)', $controllerSource, 'aggregate callback keeps one-time state validation');
    $t->assertContains("social_provider", $controllerSource, 'aggregate callback binds state to provider');
    $t->assertContains('name="aggregate_app_id"', $settingsView);
    $t->assertContains('name="aggregate_app_key"', $settingsView);
    $t->assertContains('name="aggregate_endpoint"', $settingsView);
    $t->assertFalse(str_contains($settingsView, 'name="qq_app_id"'));
    $t->assertFalse(str_contains($settingsView, 'name="wx_app_id"'));

    // Bug 2: a logged-in user can bind a social identity to their account.
    $service = file_get_contents($t->basePath . '/src/Auth/AuthService.php') ?: '';
    $t->assertContains('bindToCurrentUser', $service, 'bind-to-current-user service method exists');
    $t->assertContains("social_bind_mode", $controllerSource, 'bind mode flag is set when logged in');
    $t->assertContains('bindToCurrentUser', $controllerSource, 'callback routes to bind in bind mode');
    $connView = file_get_contents($t->basePath . '/views/account/connections.php') ?: '';
    $t->assertContains('/auth/social/', $connView, 'connections page offers a bind button');

    // Bug 3: unauthenticated users can register via QQ/WeChat.
    $registerView = file_get_contents($t->basePath . '/views/auth/register.php') ?: '';
    $t->assertContains('/auth/social/qq', $registerView, 'register page offers QQ auth');
    $t->assertContains('/auth/social/wx', $registerView, 'register page offers WeChat auth');

    // Bug 4: product cards are actually emitted (not discarded) on shop pages.
    foreach (['/views/shop/products.php', '/views/shop/home.php'] as $v) {
        $shopView = file_get_contents($t->basePath . $v) ?: '';
        $t->assertFalse(str_contains($shopView, '<?php $__app->view->partial('), "$v no longer discards partial output");
        $t->assertContains("view->partial('partials/product-card'", $shopView, "$v renders product cards");
    }

    // Bug 1: legacy openSource fallback validates the target table exists.
    $mig = file_get_contents($t->basePath . '/src/Migration/Legacy/LegacyMigrationService.php') ?: '';
    $t->assertContains("tableExists(\$targetPdo, 'afdian_orders_legacy')", $mig, 'openSource fallback guards against missing table');

    return ['assertions' => $t->assertions()];
};
