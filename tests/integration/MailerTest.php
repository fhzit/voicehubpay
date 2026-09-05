<?php

declare(strict_types=1);

// SMTP/notification mail regression coverage. Uses the real App container and
// a fresh test DB; validates config plumbing, email capture on signup, the
// SMTP settings page, and that the mailer service is wired without throwing.
return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('mailer');

    // The `mailer` service must be resolvable from the shared container.
    $mailer = $app->make('mailer');
    $t->assertTrue($mailer instanceof \VoiceHubPay\Support\Mailer, 'mailer service resolves to Mailer');
    // Reset any SMTP settings that may have leaked into the shared
    // storage/settings.sqlite (settings are not isolated to the tmp DB), so the
    // "unconfigured" assertions below are deterministic.
    $app->config->settings()->setMany([
        'SMTP_ENABLED' => '0',
        'SMTP_HOST' => '', 'SMTP_PORT' => '', 'SMTP_ENCRYPTION' => '',
        'SMTP_USERNAME' => '', 'SMTP_PASSWORD' => '',
        'SMTP_FROM' => '', 'SMTP_FROM_NAME' => '',
        'NOTIFY_EMAIL' => '',
    ]);
    $app->config->reloadSettings();
    $t->assertFalse($mailer->isConfigured(), 'Mailer reports unconfigured when SMTP host/from empty');
    $t->assertFalse($mailer->send('x@example.com', 's', '<p>x</p>'), 'send() no-ops (false) when SMTP disabled, never throws');

    // Config round-trip: SMTP settings persist and are read back.
    $app->config->settings()->setMany([
        'SMTP_ENABLED' => '1',
        'SMTP_HOST' => 'smtp.qq.com',
        'SMTP_PORT' => '465',
        'SMTP_ENCRYPTION' => 'ssl',
        'SMTP_USERNAME' => 'noreply@example.com',
        'SMTP_FROM' => 'noreply@example.com',
        'SMTP_FROM_NAME' => '发卡商城',
        'NOTIFY_EMAIL' => 'admin@example.com',
        'SITE_NAME' => '测试站',
    ]);
    $app->config->reloadSettings();
    $mailer2 = $app->make('mailer');
    $t->assertTrue($mailer2->isConfigured(), 'Mailer configured after SMTP_HOST + SMTP_FROM set');
    $t->assertTrue($mailer2->isEnabled(), 'Mailer enabled when SMTP_ENABLED=1');
    $t->assertSame('smtp.qq.com', (string) $app->config->get('SMTP_HOST'), 'SMTP host persisted');

    // Email is captured at password registration.
    $auth = $app->make('auth');
    $r = $auth->register('seller_a', 'password123', 'password123', '店主', true, 'buyer@example.com');
    $t->assertTrue((bool) $r['ok'], 'password register accepts an email');
    $t->assertSame('buyer@example.com', (string) $r['user']['email'], 'email stored on the new user');

    // Invalid email is rejected.
    $r2 = $auth->register('seller_b', 'password123', 'password123', '', false, 'not-an-email');
    $t->assertFalse((bool) $r2['ok'], 'invalid email format rejected');

    // updateEmail persists and validates.
    $up = $auth->updateEmail((int) $r['user']['id'], 'new@example.com');
    $t->assertTrue((bool) $up['ok'], 'updateEmail stores a valid address');
    $t->assertSame('new@example.com', (string) $up['user']['email'], 'email updated on user');
    $bad = $auth->updateEmail((int) $r['user']['id'], 'nope');
    $t->assertFalse((bool) $bad['ok'], 'updateEmail rejects an invalid address');

    // SMTP settings admin page + controller surface.
    $view = (string) file_get_contents($t->basePath . '/views/admin/settings/smtp.php');
    $t->assertContains('name="smtp_host"', $view, 'smtp page has host field');
    $t->assertContains('name="smtp_password"', $view, 'smtp page has password field');
    $t->assertContains('name="notify_email"', $view, 'smtp page has admin notify email field');
    $t->assertContains('/admin/settings/smtp/test', $view, 'smtp page wires the test-send button');
    $ctrl = (string) file_get_contents($t->basePath . '/src/Controllers/Admin/SettingsController.php');
    $t->assertContains('function smtp(', $ctrl, 'SettingsController has smtp() getter');
    $t->assertContains('function saveSmtp(', $ctrl, 'SettingsController has saveSmtp()');
    $t->assertContains('function testSmtp(', $ctrl, 'SettingsController has testSmtp()');
    $t->assertContains("'SMTP_HOST' =>", $ctrl, 'saveSmtp persists SMTP_HOST');
    $t->assertContains("'NOTIFY_EMAIL' =>", $ctrl, 'saveSmtp persists NOTIFY_EMAIL');

    // Routes are wired.
    $fc = (string) file_get_contents($t->basePath . '/public/index.php');
    $t->assertContains("'/admin/settings/smtp'", $fc, 'smtp GET+POST routes wired');
    $t->assertContains("'/admin/settings/smtp/test'", $fc, 'smtp test route wired');

    // The buyer-facing profile page can edit email.
    $profile = (string) file_get_contents($t->basePath . '/views/account/profile.php');
    $t->assertContains('name="email"', $profile, 'profile page has an email field');

    // SmtpMailer bug guard: every smtpRead() call must pass an ARRAY of
    // acceptable reply codes (the signature is array), never a bare int which
    // would throw a TypeError at runtime on the live SMTP handshake.
    $smtp = (string) file_get_contents($t->basePath . '/src/Support/SmtpMailer.php');
    $t->assertContains('private function smtpRead(array $expect)', $smtp, 'smtpRead requires an array of expected codes');
    $t->assertContains('smtpRead([220]); // greeting', $smtp, 'greeting read passes [220]');
    $t->assertContains('$this->smtpRead([250]);', $smtp, 'end-of-data read passes [250]');
    $t->assertFalse(str_contains($smtp, 'smtpRead(220);'), 'no bare-int smtpRead(220)');
    $t->assertFalse(str_contains($smtp, 'smtpRead(250);'), 'no bare-int smtpRead(250)');

    // Root-cause guard: the mailer must read the SMTP password through the
    // SecretStore (decrypt path), never the raw settings getter — the stored
    // value is encrypted (v1:...), so a raw read would send the ciphertext as
    // the password and get a 535 login failure.
    $mailClass = (string) file_get_contents($t->basePath . '/src/Support/Mailer.php');
    $t->assertContains("secretStore()->get('SMTP_PASSWORD', '')", $mailClass, 'Mailer decrypts SMTP_PASSWORD via SecretStore');
    $t->assertFalse(str_contains($mailClass, "config->get('SMTP_PASSWORD'"), 'Mailer never reads SMTP_PASSWORD via raw settings getter');

    return ['assertions' => $t->assertions()];
};