<?php

declare(strict_types=1);

namespace VoiceHubPay\Payments;

use VoiceHubPay\App;

/**
 * SG65 V2 HTTP client (form-encoded requests, JSON responses, UTF-8).
 */
final class Sg65Client
{
    public const BASE_URL = 'https://bbs.sg65.cn';

    public function __construct(private readonly App $app)
    {
    }

    public function isEnabled(): bool
    {
        return $this->app->config->bool('SG65_ENABLED', false);
    }

    public function pid(): string
    {
        return (string) $this->app->config->get('SG65_PID', '');
    }

    public function merchantPrivateKey(): string
    {
        return (string) $this->app->config->secret('SG65_MERCHANT_PRIVATE_KEY', '');
    }

    public function platformPublicKey(): string
    {
        return (string) $this->app->config->secret('SG65_PLATFORM_PUBLIC_KEY', '');
    }

    public function defaultPayType(): string
    {
        $t = (string) $this->app->config->get('SG65_DEFAULT_PAYMENT_TYPE', 'alipay');
        return in_array($t, ['alipay', 'wxpay', 'qqpay'], true) ? $t : 'alipay';
    }

    public function enabledPayTypes(): array
    {
        $raw = (string) $this->app->config->get('SG65_ENABLED_TYPES', 'alipay,wxpay,qqpay');
        $types = array_values(array_filter(array_map('trim', explode(',', $raw))));
        return array_values(array_intersect($types, ['alipay', 'wxpay', 'qqpay']));
    }

    public function isPayTypeEnabled(string $type): bool
    {
        return in_array($type, $this->enabledPayTypes(), true);
    }

    /**
     * 统一下单 /api/pay/create (method=jump recommended).
     *
     * @return array decoded JSON response
     * @throws \RuntimeException
     */
    public function create(array $params): array
    {
        return $this->post('/api/pay/create', $params);
    }

    /**
     * 主动查单 /api/pay/query (by trade_no or out_trade_no).
     */
    public function query(array $params): array
    {
        return $this->post('/api/pay/query', $params);
    }

    /**
     * 商户信息 /api/merchant/info (used by test connection).
     */
    public function merchantInfo(): array
    {
        return $this->post('/api/merchant/info', []);
    }

    /**
     * 商户订单 /api/merchant/orders (对账).
     */
    public function merchantOrders(array $params): array
    {
        return $this->post('/api/merchant/orders', $params);
    }

    /**
     * Build the full signed param set for a request.
     */
    public function signedParams(array $params): array
    {
        $params['pid'] = $this->pid();
        $params['timestamp'] = (string) time();
        $params['sign_type'] = 'RSA';
        $params['sign'] = Sg65Signer::sign($params, $this->merchantPrivateKey());
        return $params;
    }

    private function post(string $path, array $params): array
    {
        $url = self::BASE_URL . $path;
        $body = http_build_query($this->signedParams($params));
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            CURLOPT_TIMEOUT => 20,
        ]);
        $raw = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new \RuntimeException('SG65 请求失败：' . ($error ?: 'unknown'));
        }
        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('SG65 返回非 JSON（HTTP ' . $status . '）');
        }
        return $decoded;
    }
}
