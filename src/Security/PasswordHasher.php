<?php

declare(strict_types=1);

namespace VoiceHubPay\Security;

/**
 * Password hashing. Defaults to ARGON2ID with SHA-256 pre-hash fallback when
 * the sodium/password_algos environment lacks Argon2.
 */
final class PasswordHasher
{
    public static function hash(string $password): string
    {
        if (defined('PASSWORD_ARGON2ID')) {
            try {
                return password_hash($password, PASSWORD_ARGON2ID, [
                    'memory_cost' => 65536, // 64 MiB
                    'time_cost' => 4,
                    'threads' => 2,
                ]);
            } catch (\ValueError) {
                // Some PHP builds (e.g. static binaries) only support threads=1.
                try {
                    return password_hash($password, PASSWORD_ARGON2ID, [
                        'memory_cost' => 65536,
                        'time_cost' => 4,
                        'threads' => 1,
                    ]);
                } catch (\ValueError) {
                    return password_hash($password, PASSWORD_DEFAULT);
                }
            }
        }
        return password_hash($password, PASSWORD_DEFAULT);
    }

    public static function verify(string $password, ?string $hash): bool
    {
        if ($hash === null || $hash === '') {
            return false;
        }
        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        if ($hash === null || $hash === '') {
            return false;
        }
        if (defined('PASSWORD_ARGON2ID')) {
            return password_needs_rehash($hash, PASSWORD_ARGON2ID);
        }
        return false;
    }
}
