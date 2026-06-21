<?php

declare(strict_types=1);

namespace VoiceHubPay\Auth;

use VoiceHubPay\Config\Config;

final class OAuthClient
{
    public function __construct(private readonly Config $config)
    {
    }

    public function authorizationUrl(string $state): string
    {
        $params = http_build_query([
            'response_type' => 'code',
            'client_id' => $this->config->get('OAUTH_CLIENT_ID'),
            'redirect_uri' => $this->config->get('OAUTH_REDIRECT_URI'),
            'scope' => $this->config->get('OAUTH_SCOPES', 'openid profile email'),
            'state' => $state,
        ]);

        return $this->required('OAUTH_AUTHORIZE_URL') . '?' . $params;
    }

    public function exchangeCode(string $code): array
    {
        $response = $this->postForm($this->required('OAUTH_TOKEN_URL'), [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $this->config->get('OAUTH_REDIRECT_URI'),
            'client_id' => $this->config->get('OAUTH_CLIENT_ID'),
            'client_secret' => $this->config->get('OAUTH_CLIENT_SECRET'),
        ]);

        if (empty($response['access_token'])) {
            throw new \RuntimeException('OAuth token response did not include access_token');
        }

        return $response;
    }

    public function userInfo(string $accessToken): array
    {
        $url = $this->required('OAUTH_USERINFO_URL');
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: ' . $this->config->get('OAUTH_TOKEN_TYPE', 'Bearer') . ' ' . $accessToken, 'Accept: application/json'],
            CURLOPT_TIMEOUT => 15,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $status >= 400) {
            throw new \RuntimeException('OAuth userinfo failed: ' . ($error ?: $body));
        }

        $decoded = json_decode((string) $body, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function postForm(string $url, array $fields): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($fields),
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_TIMEOUT => 15,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $status >= 400) {
            throw new \RuntimeException('OAuth token request failed: ' . ($error ?: $body));
        }

        $decoded = json_decode((string) $body, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function required(string $key): string
    {
        $value = $this->config->get($key);
        if (!$value) {
            throw new \RuntimeException($key . ' is required');
        }
        return $value;
    }
}
