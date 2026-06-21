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
        $allowed = array_filter(array_map('trim', explode(',', $config->get('OAUTH_ALLOWED_EMAILS', '') ?? '')));
        $email = $user['email'] ?? null;
        if ($allowed && (!$email || !in_array($email, $allowed, true))) {
            throw new \RuntimeException('OAuth user is not allowed');
        }
        $_SESSION['user'] = [
            'sub' => (string) ($user['sub'] ?? $user['id'] ?? $email ?? 'unknown'),
            'email' => $email,
            'name' => $user['name'] ?? $email ?? 'OAuth user',
        ];
    }

    public static function logout(): void
    {
        unset($_SESSION['user']);
        session_regenerate_id(true);
    }
}
