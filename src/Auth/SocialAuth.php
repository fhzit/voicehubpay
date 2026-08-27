<?php

declare(strict_types=1);

namespace VoiceHubPay\Auth;

use VoiceHubPay\App;

/**
 * QQ / WeChat OAuth2 login providers (standard OAuth2 code flow).
 */
final class SocialAuth
{
    public function __construct(private readonly App $app)
    {
    }

    /**
     * Build the authorize URL for a provider. Stores state in session.
     */
    public function authorizeUrl(string $provider, string $redirectAfter = '/'): string
    {
        $provider = $provider === 'wx' ? 'wx' : 'qq';
        $state = bin2hex(random_bytes(16));
        $_SESSION['social_state'] = $state;
        $_SESSION['social_provider'] = $provider;
        $_SESSION['social_redirect'] = $redirectAfter;

        $callback = $this->app->config->appUrl() . '/auth/social/callback?provider=' . $provider;

        if ($provider === 'qq') {
            $appId = (string) $this->app->config->secret('QQ_APP_ID', $this->app->config->get('QQ_APP_ID', ''));
            return 'https://graph.qq.com/oauth2.0/authorize?' . http_build_query([
                'response_type' => 'code',
                'client_id' => $appId,
                'redirect_uri' => $callback,
                'state' => $state,
                'scope' => 'get_user_info',
            ]);
        }

        // WeChat
        $appId = (string) $this->app->config->secret('WX_APP_ID', $this->app->config->get('WX_APP_ID', ''));
        return 'https://open.weixin.qq.com/connect/qrconnect?' . http_build_query([
            'appid' => $appId,
            'redirect_uri' => $callback,
            'response_type' => 'code',
            'scope' => 'snsapi_login',
            'state' => $state,
        ]) . '#wechat_redirect';
    }

    /**
     * Exchange code for a normalized profile.
     * Returns ['openid' => ..., 'nickname' => ..., 'avatar_url' => ...]
     *
     * @throws \RuntimeException on failure
     */
    public function exchangeCode(string $provider, string $code): array
    {
        $provider = $provider === 'wx' ? 'wx' : 'qq';
        $callback = $this->app->config->appUrl() . '/auth/social/callback?provider=' . $provider;

        if ($provider === 'qq') {
            return $this->exchangeQq($code, $callback);
        }
        return $this->exchangeWx($code, $callback);
    }

    private function exchangeQq(string $code, string $callback): array
    {
        $appId = (string) $this->app->config->secret('QQ_APP_ID', $this->app->config->get('QQ_APP_ID', ''));
        $appKey = (string) $this->app->config->secret('QQ_APP_KEY', $this->app->config->get('QQ_APP_KEY', ''));
        if ($appId === '' || $appKey === '') {
            throw new \RuntimeException('QQ 登录未配置。');
        }

        $tokenBody = $this->httpGet('https://graph.qq.com/oauth2.0/token?' . http_build_query([
            'grant_type' => 'authorization_code',
            'client_id' => $appId,
            'client_secret' => $appKey,
            'code' => $code,
            'redirect_uri' => $callback,
        ]), 'application/x-www-form-urlencoded');
        parse_str($tokenBody, $token);
        $accessToken = (string) ($token['access_token'] ?? '');
        if ($accessToken === '') {
            throw new \RuntimeException('QQ 授权失败（未取得 access_token）。');
        }

        // openid endpoint returns: callback( {"client_id":"...","openid":"..."} );
        $meBody = $this->httpGet('https://graph.qq.com/oauth2.0/me?access_token=' . urlencode($accessToken));
        if (preg_match('/\{"client_id":\s*"([^"]+)",\s*"openid":\s*"([^"]+)"\}/', $meBody, $m)) {
            $openid = $m[2];
        } else {
            $json = json_decode($meBody, true);
            $openid = (string) ($json['openid'] ?? '');
        }
        if ($openid === '') {
            throw new \RuntimeException('QQ 授权失败（未取得 openid）。');
        }

        $nickname = '';
        $avatar = '';
        try {
            $info = $this->httpGetJson('https://graph.qq.com/user/get_user_info?' . http_build_query([
                'access_token' => $accessToken,
                'oauth_consumer_key' => $appId,
                'openid' => $openid,
            ]));
            $nickname = (string) ($info['nickname'] ?? '');
            $avatar = (string) ($info['figureurl_qq_2'] ?? $info['figureurl_qq_1'] ?? $info['figureurl'] ?? '');
        } catch (\Throwable) {
            // userinfo is best-effort
        }

        return ['openid' => $openid, 'nickname' => $nickname, 'avatar_url' => $avatar];
    }

    private function exchangeWx(string $code, string $callback): array
    {
        $appId = (string) $this->app->config->secret('WX_APP_ID', $this->app->config->get('WX_APP_ID', ''));
        $appSecret = (string) $this->app->config->secret('WX_APP_KEY', $this->app->config->get('WX_APP_KEY', ''));
        if ($appId === '' || $appSecret === '') {
            throw new \RuntimeException('微信登录未配置。');
        }

        $token = $this->httpGetJson('https://api.weixin.qq.com/sns/oauth2/access_token?' . http_build_query([
            'appid' => $appId,
            'secret' => $appSecret,
            'code' => $code,
            'grant_type' => 'authorization_code',
        ]));
        $accessToken = (string) ($token['access_token'] ?? '');
        $openid = (string) ($token['openid'] ?? '');
        if ($accessToken === '' || $openid === '') {
            throw new \RuntimeException('微信授权失败：' . ($token['errmsg'] ?? 'unknown'));
        }

        $nickname = '';
        $avatar = '';
        try {
            $info = $this->httpGetJson('https://api.weixin.qq.com/sns/userinfo?' . http_build_query([
                'access_token' => $accessToken,
                'openid' => $openid,
                'lang' => 'zh_CN',
            ]));
            $nickname = (string) ($info['nickname'] ?? '');
            $avatar = (string) ($info['headimgurl'] ?? '');
        } catch (\Throwable) {
            // best-effort
        }

        return ['openid' => $openid, 'nickname' => $nickname, 'avatar_url' => $avatar];
    }

    private function httpGet(string $url): string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            // OAuth endpoints are fixed HTTPS hosts; do not follow redirects to
            // an unexpected scheme/host and risk forwarding bearer parameters.
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_USERAGENT => 'VoiceHubPay/1.0',
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false || $status >= 400) {
            throw new \RuntimeException('HTTP ' . $status . ($error ? ': ' . $error : ''));
        }
        return (string) $body;
    }

    private function httpGetJson(string $url): array
    {
        $body = $this->httpGet($url);
        $json = json_decode($body, true);
        if (!is_array($json)) {
            throw new \RuntimeException('Invalid JSON response');
        }
        return $json;
    }
}
