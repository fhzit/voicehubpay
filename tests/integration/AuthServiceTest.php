<?php

declare(strict_types=1);

use VoiceHubPay\App;
use VoiceHubPay\Auth\AuthService;
use VoiceHubPay\Security\LoginThrottle;
use VoiceHubPay\Http\Request;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // CLI has no active session; bootstrap skips it. Start one so
    // session_regenerate_id(true) works as in a real request.
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    [$app, $pdo] = $t->freshApp('auth');

    $auth = new AuthService($app);

    // registration
    $r = $auth->register('alice', 'password123', 'password123', '爱丽丝', true);
    $t->assertTrue($r['ok']);
    $t->assertTrue(isset($r['user']['id']));

    // validation: short password, mismatch, duplicates, agreement
    $t->assertFalse($auth->register('bob', 'short', 'short', '', true)['ok']);
    $t->assertFalse($auth->register('bob', 'password123', 'different', '', true)['ok']);
    $t->assertFalse($auth->register('alice', 'password123', 'password123', '', true)['ok'], 'duplicate username');
    $t->assertFalse($auth->register('bob', 'password123', 'password123', '', false)['ok'], 'needs agreement');
    $t->assertFalse($auth->register('x', 'password123', 'password123', '', true)['ok'], 'username too short');

    // login with password
    $req = Request::capture();
    $login = $auth->loginWithPassword('alice', 'password123', $req);
    $t->assertTrue($login['ok']);

    // session regenerated + user bound
    $auth->loginUser($login['user']);
    $t->assertTrue($auth->isLoggedIn());
    $t->assertSame((int) $login['user']['id'], (int) $auth->user()['id']);

    // wrong password
    $bad = $auth->loginWithPassword('alice', 'wrong-password', $req);
    $t->assertFalse($bad['ok']);

    // login throttle: 5 failures lock
    $throttle = new LoginThrottle($pdo);
    for ($i = 0; $i < 5; $i++) {
        $throttle->recordFailure('user:alice');
    }
    $t->assertTrue($throttle->isLocked('user:alice'));
    $locked = $auth->loginWithPassword('alice', 'password123', $req);
    $t->assertFalse($locked['ok'], 'throttled even with correct password');
    $t->assertContains('尝试次数过多', $locked['error']);
    $throttle->clear('user:alice');
    $t->assertFalse($throttle->isLocked('user:alice'));

    // disabled account cannot log in
    $app->make('users')->setStatus((int) $login['user']['id'], 'disabled');
    $dis = $auth->loginWithPassword('alice', 'password123', $req);
    $t->assertFalse($dis['ok']);
    $t->assertContains('禁用', $dis['error']);

    // social identity uniqueness: same provider+uid -> same account, no merge by nickname
    $s1 = $auth->loginWithSocial('qq', ['openid' => 'QQ-UID-1', 'nickname' => '甲']);
    $s2 = $auth->loginWithSocial('qq', ['openid' => 'QQ-UID-1', 'nickname' => '完全不同的名字']);
    $t->assertTrue($s1['ok'] && $s2['ok']);
    $t->assertSame((int) $s1['user']['id'], (int) $s2['user']['id'], 'same identity same account');

    $count = (int) $pdo->query("SELECT COUNT(*) FROM social_identities WHERE provider='qq' AND social_uid='QQ-UID-1'")->fetchColumn();
    $t->assertSame(1, $count, 'one identity row');

    return ['assertions' => $t->assertions()];
};
