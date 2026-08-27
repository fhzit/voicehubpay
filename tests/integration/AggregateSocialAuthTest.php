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

    return ['assertions' => $t->assertions()];
};
