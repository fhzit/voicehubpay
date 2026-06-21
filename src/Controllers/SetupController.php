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

        $settings = $this->config->settings()->all() + $this->defaults();
        return $this->view('setup', [
            'settings' => $settings,
            'isConfigured' => $this->config->isConfigured(),
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
            'OAUTH_AUTHORIZE_URL', 'OAUTH_TOKEN_URL', 'OAUTH_USERINFO_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'OAUTH_REDIRECT_URI', 'OAUTH_SCOPES', 'OAUTH_ALLOWED_EMAILS', 'OAUTH_TOKEN_TYPE',
            'AFDIAN_USER_ID', 'AFDIAN_API_TOKEN', 'AFDIAN_API_BASE', 'AFDIAN_ORDER_ENDPOINT', 'AFDIAN_WEBHOOK_SECRET', 'AFDIAN_POLL_LIMIT',
            'VOICEHUB_API_BASE', 'VOICEHUB_TICKET_ENDPOINT', 'VOICEHUB_API_TOKEN', 'VOICEHUB_AUTH_SCHEME',
        ];
        $settings = [];
        foreach ($keys as $key) {
            $settings[$key] = trim((string) ($post[$key] ?? ''));
        }
        $settings['DATA_DB_CONNECTION'] = in_array($settings['DATA_DB_CONNECTION'], ['sqlite', 'pgsql'], true) ? $settings['DATA_DB_CONNECTION'] : 'sqlite';
        $settings['DATA_DB_PORT'] = $settings['DATA_DB_PORT'] ?: '5432';
        $settings['AFDIAN_POLL_LIMIT'] = $settings['AFDIAN_POLL_LIMIT'] ?: '20';
        $settings['OAUTH_SCOPES'] = $settings['OAUTH_SCOPES'] ?: 'openid profile email';
        $settings['OAUTH_TOKEN_TYPE'] = $settings['OAUTH_TOKEN_TYPE'] ?: 'Bearer';
        $settings['VOICEHUB_AUTH_SCHEME'] = $settings['VOICEHUB_AUTH_SCHEME'] ?: 'Bearer';
        $settings['AFDIAN_API_BASE'] = $settings['AFDIAN_API_BASE'] ?: 'https://afdian.com';
        $settings['AFDIAN_ORDER_ENDPOINT'] = $settings['AFDIAN_ORDER_ENDPOINT'] ?: '/api/open/query-order';
        $settings['VOICEHUB_TICKET_ENDPOINT'] = $settings['VOICEHUB_TICKET_ENDPOINT'] ?: '/api/song-tickets';
        $settings['DATA_DB_DATABASE'] = $settings['DATA_DB_DATABASE'] ?: 'storage/voicehubpay.sqlite';
        return $settings;
    }

    private function defaults(): array
    {
        return [
            'APP_URL' => 'http://127.0.0.1:8080',
            'APP_KEY' => 'generate',
            'DATA_DB_CONNECTION' => 'sqlite',
            'DATA_DB_DATABASE' => 'storage/voicehubpay.sqlite',
            'DATA_DB_HOST' => '127.0.0.1',
            'DATA_DB_PORT' => '5432',
            'OAUTH_SCOPES' => 'openid profile email',
            'OAUTH_TOKEN_TYPE' => 'Bearer',
            'AFDIAN_API_BASE' => 'https://afdian.com',
            'AFDIAN_ORDER_ENDPOINT' => '/api/open/query-order',
            'AFDIAN_POLL_LIMIT' => '20',
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
