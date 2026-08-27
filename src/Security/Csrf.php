<?php

declare(strict_types=1);

namespace VoiceHubPay\Security;

/**
 * CSRF token generation/validation. All state-changing forms must carry
 * a valid token. External callbacks (SG65 notify/return, Afdian webhook)
 * are exempt and handled at the router level.
 */
final class Csrf
{
    public static function token(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return (string) $_SESSION['csrf_token'];
    }

    public static function field(): string
    {
        return '<input type="hidden" name="_csrf" value="' . htmlspecialchars(self::token(), ENT_QUOTES, 'UTF-8') . '">';
    }

    public static function verify(?string $token): bool
    {
        $expected = $_SESSION['csrf_token'] ?? null;
        if ($token === null || $expected === null) {
            return false;
        }
        return hash_equals((string) $expected, $token);
    }
}
