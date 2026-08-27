<?php

declare(strict_types=1);

use VoiceHubPay\Security\PasswordHasher;
use VoiceHubPay\Security\CryptoService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    // password hashing: hash/verify/needs-rehash
    $hash = PasswordHasher::hash('S3cr3t-密码');
    $t->assertTrue(str_starts_with($hash, '$argon2id$'), 'argon2id prefix');
    $t->assertTrue(PasswordHasher::verify('S3cr3t-密码', $hash));
    $t->assertFalse(PasswordHasher::verify('wrong', $hash));
    $t->assertFalse(PasswordHasher::verify('S3cr3t-密码', null), 'verify null');
    $t->assertFalse(PasswordHasher::verify('S3cr3t-密码', 'not-a-hash'));
    $t->assertFalse(PasswordHasher::needsRehash(''));
    $t->assertTrue(PasswordHasher::needsRehash('$2y$10$legacy.bcrypt.hash'), 'legacy bcrypt rehashed to argon2id');

    // crypto: round-trip + masking + hashing on an isolated key
    $crypto = $t->freshCrypto();
    $secret = 'SG82-ABCD-EFGH-A1J2';
    $ct = $crypto->encrypt($secret);
    $t->assertTrue($ct !== $secret, 'ciphertext differs from plaintext');
    $t->assertSame($secret, $crypto->decrypt($ct));
    $t->assertTrue(str_starts_with($ct, 'v1:'), 'ciphertext prefixed');
    $t->assertFalse(str_contains($ct, $secret), 'plaintext never in ciphertext');

    // masking: show first 4 + last 2 only
    $masked = $crypto->mask($secret);
    $t->assertSame('SG82', substr($masked, 0, 4));
    $t->assertSame('J2', substr($masked, -2));
    $t->assertFalse(str_contains($masked, 'ABCD'), 'middle hidden');

    // hashing is stable, different values differ
    $h1 = $crypto->hash($secret);
    $h2 = $crypto->hash($secret);
    $t->assertSame($h1, $h2);
    $t->assertSame(64, strlen($h1), 'sha256 hex');
    $t->assertFalse($h1 === $crypto->hash('other'));

    // tampered ciphertext must not decrypt silently (decrypt may throw)
    $pos = (int) floor(strlen($ct) / 2);
    $tampered = substr($ct, 0, $pos) . ($ct[$pos] === 'a' ? 'b' : 'a') . substr($ct, $pos + 1);
    $t->assertTrue($tampered !== $ct, 'tamper changed payload');
    $t->assertThrows(\RuntimeException::class, static fn () => $crypto->decrypt($tampered), 'tampered rejects');

    return ['assertions' => $t->assertions()];
};
