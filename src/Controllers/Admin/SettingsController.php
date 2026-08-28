<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Payments\Sg65Client;
use VoiceHubPay\Payments\Sg65Signer;
use VoiceHubPay\Security\SecretStore;

final class SettingsController extends Controller
{
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    // ------------------------------------------------------------- general

    public function general(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        return $this->render('admin/settings/general', ['settings' => $this->app->config->settings()->all()], 'admin');
    }

    public function saveGeneral(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $siteName = trim($request->string('site_name'));
        $siteUrl = trim($request->string('site_url'));
        if ($siteName === '' || $siteUrl === '') {
            return $this->redirect('/admin/settings/general')->withFlash('站点名称和 URL 不能为空。', 'error');
        }
        $parts = parse_url($siteUrl);
        if (!is_array($parts) || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true) || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return $this->redirect('/admin/settings/general')->withFlash('站点 URL 必须是无账号、查询参数和片段的 HTTP(S) 根地址。', 'error');
        }
        $tz = $request->string('timezone', 'Asia/Shanghai');
        try {
            new \DateTimeZone($tz);
        } catch (\Throwable) {
            return $this->redirect('/admin/settings/general')->withFlash('无效的时区。', 'error');
        }
        $authRedirectUrl = trim($request->string('auth_redirect_url'));
        if ($authRedirectUrl !== '') {
            $rp = parse_url($authRedirectUrl);
            if (!is_array($rp) || !in_array(strtolower((string) ($rp['scheme'] ?? '')), ['http', 'https'], true) || ($rp['host'] ?? '') === '') {
                return $this->redirect('/admin/settings/general')->withFlash('访客重定向地址必须是无账号、查询参数和片段的 HTTP(S) 根地址，或留空。', 'error');
            }
        }
        $this->app->config->settings()->setMany([
            'SITE_NAME' => $siteName,
            'SITE_URL' => rtrim($siteUrl, '/'),
            'APP_URL' => rtrim($siteUrl, '/'),
            'SITE_LOGO' => $request->string('site_logo'),
            'APP_TIMEZONE' => $tz,
            'REGISTRATION_ENABLED' => $request->int('registration', 0) === 1 ? '1' : '0',
            'ORDER_TTL_MINUTES' => (string) max(5, $request->int('order_ttl', 30)),
            'PAGE_SIZE' => (string) max(5, $request->int('page_size', 20)),
            'AUTH_REDIRECT_URL' => $authRedirectUrl,
        ]);
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.general', 'settings', 'general', ['site' => $siteName], $request);
        return $this->redirect('/admin/settings/general')->withFlash('基础设置已保存。');
    }

    // -------------------------------------------------------------- payment

    public function payment(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $config = $this->app->config;
        $secretStore = new SecretStore($config->basePath, $config->settings());
        $appUrl = $config->appUrl();
        return $this->render('admin/settings/payment', [
            'settings' => $config->settings()->all(),
            'private_key_configured' => $secretStore->isConfigured('SG65_MERCHANT_PRIVATE_KEY'),
            'public_key_configured' => $secretStore->isConfigured('SG65_PLATFORM_PUBLIC_KEY'),
            'notify_url' => $appUrl . '/payments/sg65/notify',
            'return_url' => $appUrl . '/payments/sg65/return',
        ], 'admin');
    }

    public function savePayment(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $secretStore = new SecretStore($this->app->config->basePath, $this->app->config->settings());
        $pid = trim($request->string('sg65_pid'));
        if ($pid === '') {
            return $this->redirect('/admin/settings/payment')->withFlash('商户 ID 不能为空。', 'error');
        }
        $allowedTypes = ['alipay', 'wxpay', 'qqpay'];
        $postedTypes = $request->post['sg65_types'] ?? ['alipay'];
        $postedTypes = is_array($postedTypes) ? $postedTypes : [$postedTypes];
        $enabledTypes = array_values(array_intersect($allowedTypes, array_map('strval', $postedTypes)));
        if ($enabledTypes === []) {
            $enabledTypes = ['alipay'];
        }
        $defaultType = $request->string('sg65_default_type', 'alipay');
        if (!in_array($defaultType, $enabledTypes, true)) {
            $defaultType = $enabledTypes[0];
        }
        $this->app->config->settings()->setMany([
            'SG65_ENABLED' => $request->int('sg65_enabled', 0) === 1 ? '1' : '0',
            'SG65_PID' => $pid,
            'SG65_DEFAULT_PAYMENT_TYPE' => $defaultType,
            'SG65_DEFAULT_METHOD' => $request->string('sg65_default_method', 'jump') === 'web' ? 'web' : 'jump',
            'SG65_ENABLED_TYPES' => implode(',', $enabledTypes),
        ]);
        // Secrets: only overwrite when a new value is provided (not placeholder).
        $privateKey = trim($request->string('sg65_merchant_private_key'));
        if ($privateKey !== '' && $privateKey !== '••••••••') {
            $secretStore->set('SG65_MERCHANT_PRIVATE_KEY', $privateKey);
        }
        $publicKey = trim($request->string('sg65_platform_public_key'));
        if ($publicKey !== '' && $publicKey !== '••••••••') {
            $secretStore->set('SG65_PLATFORM_PUBLIC_KEY', $publicKey);
        }
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.payment', 'settings', 'payment', ['pid' => $pid], $request);
        return $this->redirect('/admin/settings/payment')->withFlash('支付设置已保存。');
    }

    public function testPayment(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        try {
            $sg65 = new Sg65Client($this->app);
            $response = $sg65->merchantInfo();
            $this->audit($this->adminUserId(), 'settings.payment_test', 'settings', 'payment', ['ok' => true], $request);
            return $this->json(['ok' => true, 'data' => $response]);
        } catch (\Throwable $e) {
            return $this->json(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }

    // ----------------------------------------------------------------- auth

    public function auth(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $config = $this->app->config;
        $secretStore = new SecretStore($config->basePath, $config->settings());
        $social = new \VoiceHubPay\Auth\SocialAuth($this->app);
        return $this->render('admin/settings/auth', [
            'settings' => $config->settings()->all(),
            'aggregate_key_placeholder' => $secretStore->placeholder('AGGREGATE_OAUTH_APP_KEY'),
            'qq_callback' => $social->callbackUrl('qq'),
            'wx_callback' => $social->callbackUrl('wx'),
        ], 'admin');
    }

    public function saveAuth(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $secretStore = new SecretStore($this->app->config->basePath, $this->app->config->settings());
        $appId = trim($request->string('aggregate_app_id'));
        $endpoint = trim($request->string('aggregate_endpoint')) ?: 'https://a.idcfx.net/connect.php';
        $parts = parse_url($endpoint);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https' || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass']) || trim((string) ($parts['path'] ?? ''), '/') === '') {
            return $this->redirect('/admin/settings/auth')->withFlash('聚合登录接口必须是包含路径的 HTTPS URL。', 'error');
        }
        $appKeyInput = trim($request->string('aggregate_app_key'));
        $appKey = $appKeyInput !== '' && $appKeyInput !== '••••••••'
            ? $appKeyInput
            : trim((string) $secretStore->get('AGGREGATE_OAUTH_APP_KEY', ''));
        $qqEnabled = $request->int('qq_enabled', 0) === 1;
        $wxEnabled = $request->int('wx_enabled', 0) === 1;
        if (($qqEnabled || $wxEnabled) && ($appId === '' || $appKey === '')) {
            return $this->redirect('/admin/settings/auth')->withFlash('启用 QQ/微信聚合登录前，请完整填写 AppID 和 AppKey。', 'error');
        }
        $this->app->config->settings()->setMany([
            'REGISTRATION_ENABLED' => $request->int('registration_enabled', 0) === 1 ? '1' : '0',
            'QQ_LOGIN_ENABLED' => $qqEnabled ? '1' : '0',
            'WX_LOGIN_ENABLED' => $wxEnabled ? '1' : '0',
            'AGGREGATE_OAUTH_APP_ID' => $appId,
            'AGGREGATE_OAUTH_ENDPOINT' => 'https://' . $parts['host'] . (isset($parts['port']) ? ':' . (int) $parts['port'] : '') . rtrim((string) $parts['path'], '/'),
        ]);
        if ($appKeyInput !== '' && $appKeyInput !== '••••••••') {
            $secretStore->set('AGGREGATE_OAUTH_APP_KEY', $appKeyInput);
        }
        foreach (['QQ_APP_ID', 'QQ_APP_KEY', 'WX_APP_ID', 'WX_APP_KEY'] as $legacyKey) {
            $this->app->config->settings()->delete($legacyKey);
        }
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.auth', 'settings', 'auth', [], $request);
        return $this->redirect('/admin/settings/auth')->withFlash('登录设置已保存。');
    }

    // ------------------------------------------------------------- voicehub

    public function voicehub(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $config = $this->app->config;
        $secretStore = new SecretStore($config->basePath, $config->settings());
        $deliveries = $this->app->make('deliveries');
        return $this->render('admin/settings/voicehub', [
            'settings' => $config->settings()->all(),
            'token_placeholder' => $secretStore->placeholder('VOICEHUB_API_TOKEN'),
            'last_success' => $this->recentDelivery('success'),
            'last_failure' => $this->recentDelivery('failed'),
            'stats' => $deliveries->stats(),
        ], 'admin');
    }

    public function saveVoicehub(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $secretStore = new SecretStore($this->app->config->basePath, $this->app->config->settings());
        $base = rtrim(trim($request->string('voicehub_api_base')), '/');
        if ($base !== '' && !$this->validHttpBaseUrl($base)) {
            return $this->redirect('/admin/settings/voicehub')->withFlash('VoiceHub Base URL 必须是无账号、查询参数和片段的 HTTP(S) 地址。', 'error');
        }
        $endpoint = trim($request->string('voicehub_ticket_endpoint')) ?: '/api/open/card-codes';
        if (!str_starts_with($endpoint, '/') || str_starts_with($endpoint, '//') || str_contains($endpoint, '://')) {
            return $this->redirect('/admin/settings/voicehub')->withFlash('VoiceHub Endpoint 必须是以单个 / 开头的相对路径。', 'error');
        }
        $this->app->config->settings()->setMany([
            'VOICEHUB_ENABLED' => $request->int('voicehub_enabled', 0) === 1 ? '1' : '0',
            'VOICEHUB_API_BASE' => $base,
            'VOICEHUB_TICKET_ENDPOINT' => $endpoint,
            'VOICEHUB_TIMEOUT' => (string) max(5, $request->int('voicehub_timeout', 20)),
            'VOICEHUB_RETRIES' => (string) max(1, $request->int('voicehub_retries', 3)),
        ]);
        $token = trim($request->string('voicehub_api_token'));
        if ($token !== '' && $token !== '••••••••') {
            $secretStore->set('VOICEHUB_API_TOKEN', $token);
        }
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.voicehub', 'settings', 'voicehub', [], $request);
        return $this->redirect('/admin/settings/voicehub')->withFlash('VoiceHub 设置已保存。');
    }

    public function testVoicehub(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        // Never issue a real ticket during a connectivity test: just verify
        // base URL + token reach the endpoint (OPTIONS/HEAD-safe GET is not
        // guaranteed, so we only check DNS/TLS reachability here).
        $base = rtrim((string) $this->app->config->get('VOICEHUB_API_BASE', ''), '/');
        $token = $this->app->config->secret('VOICEHUB_API_TOKEN', '');
        if ($base === '' || $token === '') {
            return $this->json(['ok' => false, 'error' => '请先保存 Base URL 与 API Key。'], 400);
        }
        $ch = curl_init($base . '/');
        curl_setopt_array($ch, [
            CURLOPT_NOBODY => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['x-api-key: ' . $token],
        ]);
        curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        // Any HTTP response (even 401/404) means the host is reachable.
        $reachable = $status > 0;
        $this->audit($this->adminUserId(), 'settings.voicehub_test', 'settings', 'voicehub', ['reachable' => $reachable], $request);
        return $this->json([
            'ok' => $reachable,
            'error' => $reachable ? '' : ($error ?: '无法连接 VoiceHub'),
            'http_status' => $status,
            'note' => '仅测试连通性，未发放正式券。',
        ]);
    }

    // -------------------------------------------------------------- afdian

    public function afdian(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $config = $this->app->config;
        $secretStore = new SecretStore($config->basePath, $config->settings());
        $afdian = $this->app->make('afdianOrders');
        return $this->render('admin/settings/afdian', [
            'settings' => $config->settings()->all(),
            'token_placeholder' => $secretStore->placeholder('AFDIAN_API_TOKEN'),
            'webhook_url' => $config->appUrl() . '/webhook/afdian',
            'last_webhook' => $afdian->lastWebhookAt(),
            'last_poll' => $afdian->lastPollAt(),
        ], 'admin');
    }

    public function saveAfdian(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $secretStore = new SecretStore($this->app->config->basePath, $this->app->config->settings());
        $base = rtrim(trim($request->string('afdian_api_base')), '/') ?: 'https://ifdian.net';
        if (!$this->validHttpBaseUrl($base)) {
            return $this->redirect('/admin/settings/afdian')->withFlash('爱发电 API Base 必须是无账号、查询参数和片段的 HTTP(S) 地址。', 'error');
        }
        $endpoint = trim($request->string('afdian_order_endpoint')) ?: '/api/open/query-order';
        if (!str_starts_with($endpoint, '/') || str_starts_with($endpoint, '//') || str_contains($endpoint, '://')) {
            return $this->redirect('/admin/settings/afdian')->withFlash('爱发电 Endpoint 必须是以单个 / 开头的相对路径。', 'error');
        }
        $this->app->config->settings()->setMany([
            'AFDIAN_ENABLED' => $request->int('afdian_enabled', 0) === 1 ? '1' : '0',
            'AFDIAN_USER_ID' => trim($request->string('afdian_user_id')),
            'AFDIAN_API_BASE' => $base,
            'AFDIAN_ORDER_ENDPOINT' => $endpoint,
            'AFDIAN_WEBHOOK_REQUIRE_SIGNATURE' => $request->int('afdian_require_signature', 1) === 1 ? '1' : '0',
            'AFDIAN_POLL_LIMIT' => (string) max(1, $request->int('afdian_poll_limit', 20)),
            'AFDIAN_POLL_PER_PAGE' => (string) max(1, min(100, $request->int('afdian_poll_per_page', 50))),
        ]);
        $token = trim($request->string('afdian_api_token'));
        if ($token !== '' && $token !== '••••••••') {
            $secretStore->set('AFDIAN_API_TOKEN', $token);
        }
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.afdian', 'settings', 'afdian', [], $request);
        return $this->redirect('/admin/settings/afdian')->withFlash('爱发电设置已保存。');
    }

    public function testAfdian(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        try {
            $afdian = $this->app->make('afdian');
            // Ask for one page; if credentials are valid we get ec=200.
            $orders = $afdian->pollOrders();
            $this->audit($this->adminUserId(), 'settings.afdian_test', 'settings', 'afdian', ['ok' => true], $request);
            return $this->json(['ok' => true, 'orders_returned' => count($orders)]);
        } catch (\Throwable $e) {
            return $this->json(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }

    // ------------------------------------------------------------- security

    public function security(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $config = $this->app->config;
        $crypto = new \VoiceHubPay\Security\CryptoService($config->basePath);
        return $this->render('admin/settings/security', [
            'settings' => $config->settings()->all(),
            'master_key_configured' => $crypto->masterKeyConfigured(),
            'https' => isset($_SERVER['HTTPS']) && ($_SERVER['HTTPS'] === 'on' || $_SERVER['HTTPS'] === '1'),
            'session_name' => session_name(),
            'csrf_enabled' => true,
        ], 'admin');
    }

    public function saveSecurity(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $this->app->config->settings()->setMany([
            'SECURITY_FORCE_HTTPS' => $request->int('force_https', 0) === 1 ? '1' : '0',
            'SECURITY_ADMIN_SESSION_MINUTES' => (string) max(10, $request->int('admin_session_minutes', 120)),
        ]);
        $this->app->config->reloadSettings();
        $this->audit($this->adminUserId(), 'settings.security', 'settings', 'security', [], $request);
        return $this->redirect('/admin/settings/security')->withFlash('安全设置已保存。');
    }

    // -------------------------------------------------------------- helpers

    private function validHttpBaseUrl(string $url): bool
    {
        $parts = parse_url($url);
        return is_array($parts)
            && in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            && ($parts['host'] ?? '') !== ''
            && !isset($parts['user'], $parts['pass'], $parts['query'], $parts['fragment']);
    }

    private function recentDelivery(string $status): ?array
    {
        $stmt = $this->app->db->pdo()->prepare('SELECT * FROM voicehub_deliveries WHERE status = ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$status]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        $row['code_masked'] = $this->app->crypto->mask($this->app->crypto->decrypt($row['code_ciphertext']));
        return $row;
    }
}
