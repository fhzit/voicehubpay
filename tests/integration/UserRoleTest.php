<?php

declare(strict_types=1);

use VoiceHubPay\Auth\AuthService;
use VoiceHubPay\Http\Request;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    [$app, $pdo] = $t->freshApp('userrole');

    $users = $app->make('users');

    // Seed: two admins + two normal users, oldest admin (lowest id) is super.
    $u1 = $users->create(['username' => 'admin1', 'password' => 'pw1', 'role' => 'admin']);
    $u2 = $users->create(['username' => 'admin2', 'password' => 'pw2', 'role' => 'admin']);
    $n1 = $users->create(['username' => 'norm1', 'password' => 'pw3', 'role' => 'user']);
    $n2 = $users->create(['username' => 'norm2', 'password' => 'pw4', 'role' => 'user']);

    // Lowest-id admin is the super admin.
    $t->assertSame((int) $u1['id'], (int) $users->superAdminId());
    $t->assertTrue($users->isSuperAdmin((int) $u1['id']));
    $t->assertFalse($users->isSuperAdmin((int) $u2['id']));

    // Normal users are never super.
    $t->assertFalse($users->isSuperAdmin((int) $n1['id']));

    // No admins at all => null.
    $users->setRole((int) $u1['id'], 'user');
    $users->setRole((int) $u2['id'], 'user');
    $t->assertNull($users->superAdminId());

    // Re-promote the older one; it becomes super again.
    $users->setRole((int) $u1['id'], 'admin');
    $t->assertSame((int) $u1['id'], (int) $users->superAdminId());
    $users->setRole((int) $u2['id'], 'admin');
    $t->assertSame((int) $u1['id'], (int) $users->superAdminId(), 'oldest admin stays super');

    // setRole round-trip on a normal user.
    $users->setRole((int) $n1['id'], 'admin');
    $t->assertSame('admin', $users->findById((int) $n1['id'])['role']);
    $users->setRole((int) $n1['id'], 'user');
    $t->assertSame('user', $users->findById((int) $n1['id'])['role']);

    // AuthService::isSuperAdmin reflects the logged-in user.
    $auth = new AuthService($app);
    $req = Request::capture();
    $login = $auth->loginWithPassword('admin1', 'pw1', $req);
    $t->assertTrue($login['ok']);
    $auth->loginUser($login['user']);
    $t->assertTrue($auth->isAdmin());
    $t->assertTrue($auth->isSuperAdmin(), 'admin1 is super admin');

    $login2 = $auth->loginWithPassword('admin2', 'pw2', $req);
    $auth->loginUser($login2['user']);
    $t->assertTrue($auth->isAdmin());
    $t->assertFalse($auth->isSuperAdmin(), 'admin2 is an admin but not super');

    // --- delete(user) physically removes the account ---
    // Seed a disposable user with a password + an OAuth binding.
    $del = $users->create(['username' => 'delme', 'password' => 'pwX', 'display_name' => '要删除']);
    $delId = (int) $del['id'];
    $app->make('social')->bind($delId, 'qq', 'delme-qq-uid', 'QQ昵称');

    // Login works while active.
    $loginD = $auth->loginWithPassword('delme', 'pwX', $req);
    $t->assertTrue($loginD['ok'], 'active user can log in');

    // Must be disabled before delete is permitted, like the UI flow.
    $users->setStatus($delId, 'disabled');

    // Delete: physically remove the row + its OAuth bindings.
    $users->delete($delId);
    $t->assertNull($users->findById($delId), 'row is physically removed (account no longer in the user list)');
    $t->assertSame([], $app->make('social')->listForUser($delId), 'social identities physically removed');

    // Deleted user cannot log in (no row exists).
    $loginX = $auth->loginWithPassword('delme', 'pwX', $req);
    $t->assertFalse($loginX['ok'], 'deleted user cannot log in');

    return [];
};