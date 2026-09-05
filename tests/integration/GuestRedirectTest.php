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

    // 备案号 (ICP filing no.): admin sets it; site/account footers render it
    // centered, linking to the MIIT lookup, only when configured.
    $t->assertContains('icp_beian_no', $gs, 'general settings form exposes the ICP beian field');
    $t->assertContains("'ICP_BEIAN_NO' => ", $sc, 'saveGeneral persists the ICP beian no');
    $shopFooter = (string) file_get_contents($t->basePath . '/views/layouts/shop.php');
    $t->assertContains('ICP_BEIAN_NO', $shopFooter, 'shop footer reads the ICP beian setting');
    $t->assertContains('https://beian.miit.gov.cn/', $shopFooter, 'footer link targets the MIIT beian system');
    $accFooter = (string) file_get_contents($t->basePath . '/views/layouts/account.php');
    $t->assertContains('https://beian.miit.gov.cn/', $accFooter, 'account footer also links the MIIT beian system');

    // 统计代码 (site analytics snippet): admin sets it; head of public layouts
    // echo it raw so arbitrary HTML/JS runs, only when configured.
    $t->assertContains('site_stat_code', $gs, 'general settings form exposes the stat-code field');
    $t->assertContains("'SITE_STAT_CODE' => ", $sc, 'saveGeneral persists the stat code');
    $shopHead = (string) file_get_contents($t->basePath . '/views/layouts/shop.php');
    $t->assertContains('SITE_STAT_CODE', $shopHead, 'shop head reads the stat-code setting');
    $t->assertContains('<?= $__stat ?>', $shopHead, 'stat code echoed raw (unescaped) so HTML/JS executes');
    $t->assertContains('</head>', $shopHead, 'stat code injected before </head>');

    // 首页热门服务开关: admin can toggle it from the general settings page;
    // the homepage renders the section only when it is enabled (default on),
    // so when off there is no hot-product card and thus no direct buy link.
    $t->assertContains('name="show_hot"', $gs, 'general settings form exposes the show-hot toggle');
    $t->assertContains("'HOT_SERVICES_ENABLED' => ", $sc, 'saveGeneral persists the hot-services toggle');
    $home = (string) file_get_contents($t->basePath . '/views/shop/home.php');
    $t->assertContains("<?php if (\$showHot): ?>", $home, 'home view gates the hot-services section on $showHot');
    $t->assertContains('HOT_SERVICES_ENABLED', (string) file_get_contents($t->basePath . '/src/Controllers/HomeController.php'), 'HomeController reads the hot-services setting');

    return ['assertions' => $t->assertions()];
};