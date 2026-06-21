<?php

declare(strict_types=1);

namespace VoiceHubPay\Auth;

use VoiceHubPay\Config\Config;
use VoiceHubPay\Http\Response;

final class SessionAuth
{
    public static function user(): ?array
    {
        return $_SESSION['user'] ?? null;
    }

    public static function requireUser(): ?Response
    {
        if (!self::user()) {
            return Response::redirect('/auth/login');
        }
        return null;
    }

    public static function login(array $user, Config $config): void
    {
        $allowed = self::allowedIdentifiers($config);
        $identifiers = self::userIdentifiers($user);
        if ($allowed && !array_intersect($allowed, $identifiers)) {
            throw new \RuntimeException('OAuth user is not allowed');
        }

        $_SESSION['user'] = [
            'sub' => (string) ($user['sub'] ?? $user['id'] ?? $user['email'] ?? $user['name'] ?? 'unknown'),
            'email' => $user['email'] ?? null,
            'name' => $user['name'] ?? $user['email'] ?? $user['sub'] ?? $user['id'] ?? 'OAuth user',
        ];
    }

    public static function logout(): void
    {
        unset($_SESSION['user']);
        session_regenerate_id(true);
    }

    private static function allowedIdentifiers(Config $config): array
    {
        $value = $config->get('OAUTH_ALLOWED_IDENTIFIERS', $config->get('OAUTH_ALLOWED_EMAILS', '') ?? '') ?? '';
        return array_values(array_filter(array_map('trim', explode(',', $value))));
    }

    private static function userIdentifiers(array $user): array
    {
        $values = [];
        foreach (['email', 'name', 'sub', 'id'] as $key) {
            if (isset($user[$key]) && trim((string) $user[$key]) !== '') {
                $values[] = trim((string) $user[$key]);
            }
        }
        return array_values(array_unique($values));
    }
}
