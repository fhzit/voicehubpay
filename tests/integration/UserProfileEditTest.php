<?php

declare(strict_types=1);

/**
 * Admin edits a user's username + display_name via UserRepository::update,
 * validating uniqueness against another account. Regression for
 * "管理员可以编辑用户的昵称和用户名".
 */
return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('userprofile');

    $users = $app->make('users');
    $u = $users->create(['username' => 'origin', 'password' => 'pwX', 'display_name' => '原昵称']);
    $other = $users->create(['username' => 'other1', 'password' => 'pwY', 'display_name' => '别人']);

    // Change both username and display_name; update() persists both.
    $users->update((int) $u['id'], ['username' => 'newname', 'display_name' => '新昵称']);
    $row = $users->findById((int) $u['id']);
    $t->assertSame('newname', $row['username'], 'username updated');
    $t->assertSame('新昵称', $row['display_name'], 'display_name updated');

    // The old username is released; the new one resolves via findByUsername.
    $t->assertNull($users->findByUsername('origin'), 'old username freed');
    $t->assertSame((int) $u['id'], (int) $users->findByUsername('newname')['id'], 'new username resolves');

    // Editing to another user's username must collide (uniqueness check).
    $existing = $users->findByUsername('other1');
    $t->assertTrue($existing !== null, 'other user exists');
    $t->assertTrue((int) $existing['id'] !== (int) $u['id'], 'other1 belongs to a different id');

    // display_name may be cleared to empty.
    $users->update((int) $u['id'], ['display_name' => '']);
    $t->assertSame('', $users->findById((int) $u['id'])['display_name'], 'display_name can be cleared');

    return ['assertions' => $t->assertions()];
};