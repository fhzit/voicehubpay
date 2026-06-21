<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Auth\SessionAuth;
use VoiceHubPay\Config\Config;
use VoiceHubPay\Database\Database;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class SetupController
{
    public function __construct(private readonly Config $config)
    {
    }

    public function show(Request $request): Response
    {
        if ($this->config->isConfigured() && ($redirect = SessionAuth::requireUser())) {
            return $redirect;
        }

        $settings = $this->config->settings()->all() + $this->defaults($request);
        return $this->view('setup', [
            'settings' => $settings,
            'isConfigured' => $this->config->isConfigured(),
            'oauthRedirectUri' => $settings['OAUTH_REDIRECT_URI'] ?? '',
            'user' => SessionAuth::user(),
        ]);
    }

    public function save(Request $request): Response
    {
        if ($this->config->isConfigured() && ($redirect = SessionAuth::requireUser())) {
            return $redirect;
        }

        $settings = $this->normalize($request->post);
        if (!empty($settings['APP_KEY']) && $settings['APP_KEY'] === 'generate') {
            $settings['APP_KEY'] = bin2hex(random_bytes(32));
        }
        $settings['APP_CONFIGURED'] = '1';
        $this->config->settings()->setMany($settings);
        $this->config->reloadSettings();
        $_SESSION['flash'] = '设置已保存';

        try {
            $this->runDataMigrations();
            $_SESSION['flash'] .= '，数据表已初始化';
        } catch (\Throwable $exception) {
            $_SESSION['flash'] .= '，但数据表初始化失败：' . $exception->getMessage();
        }

        return Response::redirect('/');
    }

    private function normalize(array $post): array
    {
        $keys = [
            'APP_URL', 'APP_KEY',
            'DATA_DB_CONNECTION', 'DATA_DB_DATABASE', 'DATA_DB_HOST', 'DATA_DB_PORT', 'DATA_DB_USERNAME', 'DATA_DB_PASSWORD',
            'OAUTH_AUTHORIZE_URL', 'OAUTH_TOKEN_URL', 'OAUTH_USERINFO_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OAUTH_REDIRECT_URI', 'OAUTH_SCOPES', 'OAUTH_ALLOWED_IDENTIFIERS', 'OAUTH_ALLOWED_EMAILS', 'OAUTH_TOKEN_TYPE',
            'AFDIAN_USER_ID', 'AFDIAN_API_TOKEN', 'AFDIAN_API_BASE', 'AFDIAN_ORDER_ENDPOINT', 'AFDIAN_WEBHOOK_REQUIRE_SIGNATURE', 'AFDIAN_POLL_LIMIT', 'AFDIAN_POLL_PER_PAGE',
            'VOICEHUB_API_BASE', 'VOICEHUB_TICKET_ENDPOINT', 'VOICEHUB_API_TOKEN', 'VOICEHUB_AUTH_SCHEME',
        ];
        $settings = [];
        foreach ($keys as $key) {
            $settings[$key] = trim((string) ($post[$key] ?? ''));
        }
        $settings['DATA_DB_CONNECTION'] = in_array($settings['DATA_DB_CONNECTION'], ['sqlite', 'pgsql'], true) ? $settings['DATA_DB_CONNECTION'] : 'sqlite';
        $settings['DATA_DB_PORT'] = $settings['DATA_DB_PORT'] ?: '5432';
        $settings['AFDIAN_POLL_LIMIT'] = $settings['AFDIAN_POLL_LIMIT'] ?: '20';
        $settings['AFDIAN_POLL_PER_PAGE'] = $settings['AFDIAN_POLL_PER_PAGE'] ?: '50';
        $settings['AFDIAN_WEBHOOK_REQUIRE_SIGNATURE'] = $settings['AFDIAN_WEBHOOK_REQUIRE_SIGNATURE'] === '0' ? '0' : '1';
        $settings['OAUTH_SCOPES'] = $settings['OAUTH_SCOPES'] ?: 'openid profile email';
        $settings['OAUTH_TOKEN_TYPE'] = $settings['OAUTH_TOKEN_TYPE'] ?: 'Bearer';
        $settings['VOICEHUB_AUTH_SCHEME'] = $settings['VOICEHUB_AUTH_SCHEME'] ?: 'Bearer';
        $settings['AFDIAN_API_BASE'] = $settings['AFDIAN_API_BASE'] ?: 'https://ifdian.net';
        $settings['AFDIAN_ORDER_ENDPOINT'] = $settings['AFDIAN_ORDER_ENDPOINT'] ?: '/api/open/query-order';
        $settings['VOICEHUB_TICKET_ENDPOINT'] = $settings['VOICEHUB_TICKET_ENDPOINT'] ?: '/api/song-tickets';
        $settings['DATA_DB_DATABASE'] = $settings['DATA_DB_DATABASE'] ?: 'storage/voicehubpay.sqlite';
        return $settings;
    }

    private function defaults(Request $request): array
    {
        $appUrl = $this->defaultAppUrl($request);
        return [
            'APP_URL' => $appUrl,
            'APP_KEY' => 'generate',
            'DATA_DB_CONNECTION' => 'sqlite',
            'DATA_DB_DATABASE' => 'storage/voicehubpay.sqlite',
            'DATA_DB_HOST' => '127.0.0.1',
            'DATA_DB_PORT' => '5432',
            'OAUTH_SCOPES' => 'openid profile email',
            'OAUTH_TOKEN_TYPE' => 'Bearer',
            'OAUTH_REDIRECT_URI' => $appUrl . '/auth/callback',
            'AFDIAN_API_BASE' => 'https://ifdian.net',
            'AFDIAN_ORDER_ENDPOINT' => '/api/open/query-order',
            'AFDIAN_WEBHOOK_REQUIRE_SIGNATURE' => '1',
            'AFDIAN_POLL_LIMIT' => '20',
            'AFDIAN_POLL_PER_PAGE' => '50',
            'VOICEHUB_TICKET_ENDPOINT' => '/api/song-tickets',
            'VOICEHUB_AUTH_SCHEME' => 'Bearer',
        ];
    }

    private function runDataMigrations(): void
    {
        $pdo = (new Database($this->config))->pdo();
        foreach (glob($this->config->basePath . '/database/migrations/*.php') ?: [] as $migration) {
            $fn = require $migration;
            $fn($pdo);
        }
    }

    private function defaultAppUrl(Request $request): string
    {
        $host = (string) ($request->server['HTTP_X_FORWARDED_HOST'] ?? $request->server['HTTP_HOST'] ?? '127.0.0.1:8080');
        $proto = (string) ($request->server['HTTP_X_FORWARDED_PROTO'] ?? '');
        if ($proto === '') {
            $https = strtolower((string) ($request->server['HTTPS'] ?? ''));
            $proto = ($https === 'on' || $https === '1') ? 'https' : 'http';
        }
        return rtrim($proto . '://' . $host, '/');
    }

    private function view(string $name, array $data): Response
    {
        extract($data, EXTR_SKIP);
        ob_start();
        require $this->config->basePath . '/views/' . $name . '.php';
        $content = ob_get_clean();
        ob_start();
        require $this->config->basePath . '/views/layouts/app.php';
        return Response::html((string) ob_get_clean());
    }
}
