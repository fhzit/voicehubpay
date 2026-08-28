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
    // (first social login requires signup; after completing it, the same
    // identity must resolve to that one account and NO duplicate identity row)
    $s1 = $auth->loginWithSocial('qq', ['openid' => 'QQ-UID-1', 'nickname' => '甲']);
    $t->assertTrue(!empty($s1['needs_signup']), 'first QQ login requires signup');
    $s1u = $auth->completeSocialSignup($s1['profile'], 'user_q1', 'password123', 'password123');
    $t->assertTrue($s1u['ok'], 'QQ signup ok');
    $s2 = $auth->loginWithSocial('qq', ['openid' => 'QQ-UID-1', 'nickname' => '完全不同的名字']);
    $t->assertTrue($s2['ok']);
    $t->assertTrue(empty($s2['needs_signup']), 'existing identity does not re-trigger signup');
    $t->assertSame((int) $s1u['user']['id'], (int) $s2['user']['id'], 'same identity same account');

    $count = (int) $pdo->query("SELECT COUNT(*) FROM social_identities WHERE provider='qq' AND social_uid='QQ-UID-1'")->fetchColumn();
    $t->assertSame(1, $count, 'one identity row');

    // --- username / nickname / social-completion (账号资料) ---
    // change username
    $renamed = $auth->changeUsername((int) $s1u['user']['id'], 'alice_new');
    $t->assertTrue($renamed['ok']);
    $t->assertSame('alice_new', (string) $renamed['user']['username'], 'username changed');
    // duplicate username rejected
    $dup = $auth->changeUsername((int) $s1u['user']['id'], 'alice'); // alice exists
    $t->assertFalse($dup['ok'], 'duplicate username rejected');
    // invalid username rejected
    $bad = $auth->changeUsername((int) $s1u['user']['id'], '!bad name');
    $t->assertFalse($bad['ok'], 'invalid username rejected');
    // nickname update
    $nick = $auth->updateNickname((int) $s1u['user']['id'], '新昵称');
    $t->assertTrue($nick['ok']);
    $t->assertSame('新昵称', (string) $nick['user']['display_name'], 'nickname updated');

    // New social signup flow: first-time social does NOT create an account; it
    // returns needs_signup + profile, then completeSocialSignup requires a
    // username (pre-filled from nickname) and password.
    $s3 = $auth->loginWithSocial('wx', ['openid' => 'WX-UID-1', 'nickname' => '微信用户']);
    $t->assertTrue($s3['ok']);
    $t->assertTrue(!empty($s3['needs_signup']), 'new social login requires signup');
    $t->assertNull($s3['user'], 'no account auto-created on first social login');
    $t->assertSame('微信用户', (string) ($s3['profile']['nickname'] ?? ''), 'profile carries nickname for default username');

    // Creating with an explicit username + password binds social and sets pw.
    $s3done = $auth->completeSocialSignup($s3['profile'], 'wechat_user', 'password123', 'password123');
    $t->assertTrue($s3done['ok'], 'social signup ok');
    $t->assertSame('wechat_user', (string) $s3done['user']['username'], 'username set on social signup');
    $t->assertTrue(!empty($s3done['user']['password_hash']), 'password set on social signup');
    $t->assertTrue(!empty($s3done['user']['display_name']), 'nickname used as display name');

    // After binding, the same social identity now logs in directly (no signup).
    $repeat = $auth->loginWithSocial('wx', ['openid' => 'WX-UID-1', 'nickname' => '微信用户']);
    $t->assertTrue($repeat['ok']);
    $t->assertTrue(empty($repeat['needs_signup']), 'existing social identity logs in without signup');
    $t->assertSame((int) $s3done['user']['id'], (int) $repeat['user']['id'], 'same account returned');

    // default username from nickname when the field is left empty (unique-ified)
    $s4 = $auth->loginWithSocial('wx', ['openid' => 'WX-UID-2', 'nickname' => '小A']);
    $s4done = $auth->completeSocialSignup($s4['profile'], '', 'password123', 'password123');
    $t->assertTrue($s4done['ok'], 'empty username defaults to nickname');
    $t->assertTrue(str_starts_with((string) $s4done['user']['username'], '小A'), 'username derived from nickname');

    // validation: mismatch + short password rejected
    $s5 = $auth->loginWithSocial('qq', ['openid' => 'QQ-UID-VALID', 'nickname' => '企鹅']);
    $t->assertTrue(!empty($s5['needs_signup']), 'fresh qq identity needs signup');
    $t->assertFalse($auth->completeSocialSignup($s5['profile'], 'penguin', '12345678', 'different')['ok'], 'password mismatch rejected');
    $t->assertFalse($auth->completeSocialSignup($s5['profile'], 'penguin', 'short', 'short')['ok'], 'short password rejected');

    return ['assertions' => $t->assertions()];
};
