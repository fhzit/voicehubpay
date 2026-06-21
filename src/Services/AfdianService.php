<?php

declare(strict_types=1);

namespace VoiceHubPay\Services;

use VoiceHubPay\Config\Config;
use VoiceHubPay\Http\Request;

final class AfdianService
{
    private HttpJsonClient $http;

    public function __construct(private readonly Config $config)
    {
        $this->http = new HttpJsonClient();
    }

    public function verifyWebhook(Request $request): bool
    {
        $secret = $this->config->get('AFDIAN_WEBHOOK_SECRET');
        if (!$secret) {
            return true;
        }

        $signature = $request->header('X-Afdian-Signature') ?? $request->header('X-Signature');
        if (!$signature) {
            return false;
        }

        $expected = hash_hmac('sha256', $request->body(), $secret);
        return hash_equals($expected, $signature);
    }

    public function normalizeWebhookOrder(array $payload): ?array
    {
        $order = $payload['data']['order'] ?? $payload['data'] ?? $payload['order'] ?? $payload;
        return $this->normalizeOrder($order);
    }

    public function pollOrders(): array
    {
        $userId = $this->required('AFDIAN_USER_ID');
        $token = $this->required('AFDIAN_API_TOKEN');
        $base = rtrim($this->config->get('AFDIAN_API_BASE', 'https://afdian.com'), '/');
        $path = $this->config->get('AFDIAN_ORDER_ENDPOINT', '/api/open/query-order');
        $page = 1;
        $orders = [];
        $limit = $this->config->int('AFDIAN_POLL_LIMIT', 20);

        do {
            $params = ['page' => $page, 'per_page' => min($limit, 100)];
            $payload = $this->signedPayload($userId, $token, $params);
            $response = $this->http->request('POST', $base . $path, [], $payload);
            if ($response['status'] >= 400) {
                throw new \RuntimeException('Afdian polling failed with HTTP ' . $response['status']);
            }
            $list = $response['body']['data']['list'] ?? $response['body']['data']['orders'] ?? [];
            foreach ($list as $rawOrder) {
                $normalized = $this->normalizeOrder($rawOrder);
                if ($normalized) {
                    $orders[] = $normalized;
                }
            }
            $page++;
        } while (count($orders) < $limit && !empty($list));

        return array_slice($orders, 0, $limit);
    }

    private function signedPayload(string $userId, string $token, array $params): array
    {
        $paramsJson = json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $timestamp = time();
        return [
            'user_id' => $userId,
            'params' => $paramsJson,
            'ts' => $timestamp,
            'sign' => md5($token . 'params' . $paramsJson . 'ts' . $timestamp . 'user_id' . $userId),
        ];
    }

    private function normalizeOrder(array $order): ?array
    {
        $orderNo = $order['out_trade_no'] ?? $order['order_no'] ?? $order['order_id'] ?? null;
        if (!$orderNo) {
            return null;
        }

        return [
            'order_no' => (string) $orderNo,
            'afdian_user_id' => (string) ($order['user_id'] ?? $order['user_private_id'] ?? $order['buyer_id'] ?? ''),
            'buyer_name' => (string) ($order['user_name'] ?? $order['name'] ?? $order['buyer_name'] ?? ''),
            'amount' => (float) ($order['total_amount'] ?? $order['amount'] ?? $order['show_amount'] ?? 0),
            'status' => (string) ($order['status'] ?? $order['order_status'] ?? 'paid'),
            'raw' => $order,
        ];
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
