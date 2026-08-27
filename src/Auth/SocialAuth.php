<?php

declare(strict_types=1);

namespace VoiceHubPay\Auth;

use VoiceHubPay\App;

/**
 * 任性聚合登录 client (https://a.idcfx.net/doc.php).
 *
 * QQ and WeChat share one Aggregate AppID/AppKey. The local provider remains
 * qq/wx so existing social identity rows stay compatible.
 */
final class SocialAuth
{
    private const DEFAULT_ENDPOINT = 'https://a.idcfx.net/connect.php';

    public function __construct(private readonly App $app)
    {
    }

    /**
     * Ask the Aggregate API for the provider authorization URL.
     */
    public function authorizeUrl(string $provider, string $redirectAfter = '/'): string
    {
        $provider = $this->provider($provider);
        [$appId, $appKey] = $this->credentials();
        $state = bin2hex(random_bytes(16));
        $_SESSION['social_state'] = $state;
        $_SESSION['social_provider'] = $provider;
        $_SESSION['social_redirect'] = $redirectAfter;

        // Official SDK: send the one-time state as its own login parameter;
        // the menu echoes it back on callback and connect.php compares it.
        $callback = $this->callbackUrl($provider);
        $response = $this->request([
            'act' => 'login',
            'appid' => $appId,
            'appkey' => $appKey,
            'type' => $provider,
            'redirect_uri' => $callback,
            'state' => $state,
        ]);
        $url = trim((string) ($response['url'] ?? ''));
        if ($url === '') {
            throw new \RuntimeException('聚合登录未返回授权地址。');
        }
        $parts = parse_url($url);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https' || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass'])) {
            throw new \RuntimeException('聚合登录返回了无效的授权地址。');
        }
        return $url;
    }

    /**
     * Exchange the Aggregate Authorization Code for normalized profile data.
     *
     * A provider hint is passed through so after SDK-style callbacks that
     * omit `type` we still identify the intended provider; the exact match is
     * validated against the session-bound provider before use.
     */
    public function exchangeCode(string $provider, string $code): array
    {
        $provider = $this->provider($provider);
        [$appId, $appKey] = $this->credentials();
        $response = $this->request([
            'act' => 'callback',
            'appid' => $appId,
            'appkey' => $appKey,
            'type' => $provider,
            'code' => $code,
        ]);
        $socialUid = trim((string) ($response['social_uid'] ?? ''));
        if ($socialUid === '') {
            throw new \RuntimeException('聚合登录未返回 social_uid。');
        }
        $returnedType = (string) ($response['type'] ?? $provider);
        if ($returnedType !== $provider) {
            throw new \RuntimeException('聚合登录返回的登录方式不匹配。');
        }
        return [
            'social_uid' => $socialUid,
            'nickname' => (string) ($response['nickname'] ?? ''),
            'avatar_url' => (string) ($response['faceimg'] ?? ''),
        ];
    }

    public function callbackUrl(string $provider): string
    {
        return $this->app->config->appUrl() . '/auth/social/callback?' . http_build_query(['provider' => $this->provider($provider)]);
    }

    private function credentials(): array
    {
        $appId = trim((string) $this->app->config->get('AGGREGATE_OAUTH_APP_ID', ''));
        $appKey = trim((string) $this->app->config->secret(
            'AGGREGATE_OAUTH_APP_KEY',
            $this->app->config->get('AGGREGATE_OAUTH_APP_KEY', '')
        ));
        if ($appId === '' || $appKey === '') {
            throw new \RuntimeException('任性聚合登录 AppID/AppKey 尚未配置。');
        }
        return [$appId, $appKey];
    }

    private function provider(string $provider): string
    {
        if (!in_array($provider, ['qq', 'wx'], true)) {
            throw new \InvalidArgumentException('不支持的聚合登录方式。');
        }
        return $provider;
    }

    private function endpoint(): string
    {
        $raw = trim((string) $this->app->config->get('AGGREGATE_OAUTH_ENDPOINT', self::DEFAULT_ENDPOINT));
        $parts = parse_url($raw);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https' || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass'])) {
            throw new \RuntimeException('任性聚合登录接口地址必须是 HTTPS URL。');
        }
        $path = rtrim((string) ($parts['path'] ?? ''), '/');
        if ($path === '') {
            throw new \RuntimeException('任性聚合登录接口地址缺少路径。');
        }
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        return 'https://' . $parts['host'] . $port . $path;
    }

    private function request(array $params): array
    {
        $url = $this->endpoint() . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'VoiceHubPay/1.0',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false || $status < 200 || $status >= 300) {
            throw new \RuntimeException('聚合登录接口请求失败（HTTP ' . $status . ($error !== '' ? '）' : '）。'));
        }
        $decoded = json_decode((string) $body, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('聚合登录接口返回了无效 JSON。');
        }
        if ((int) ($decoded['code'] ?? -1) !== 0) {
            throw new \RuntimeException('聚合登录失败：' . (string) ($decoded['msg'] ?? 'unknown error'));
        }
        return $decoded;
    }
}
