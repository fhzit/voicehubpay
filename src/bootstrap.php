<?php

declare(strict_types=1);

/**
 * VoiceHubPay bootstrap: hand-written PSR-4 autoloader + session bootstrap.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'VoiceHubPay\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

if (!defined('VHPAY_BASE_PATH')) {
    define('VHPAY_BASE_PATH', dirname(__DIR__));
}

if (PHP_SAPI !== 'cli') {
    // Secure session defaults (cookie flags applied on session_start via ini).
    if (session_status() !== PHP_SESSION_ACTIVE) {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.cookie_httponly', '1');
        ini_set('session.cookie_samesite', 'Lax');
        $directHttps = in_array(strtolower((string) ($_SERVER['HTTPS'] ?? '')), ['on', '1', 'true'], true);
        $trustProxy = in_array(strtolower((string) ($_SERVER['APP_TRUST_PROXY'] ?? '0')), ['1', 'true', 'yes', 'on'], true);
        $forwardedHttps = $trustProxy && strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0])) === 'https';
        ini_set('session.cookie_secure', ($directHttps || $forwardedHttps) ? '1' : '0');
        session_name('vhpay_session');
        session_start();
    }
}
