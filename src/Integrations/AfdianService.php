<?php

declare(strict_types=1);

namespace VoiceHubPay\Integrations;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Support\Money;

/**
 * Afdian OpenAPI client: webhook signature verification + API polling.
 *
 * The Afdian order number (out_trade_no) is always preserved verbatim as a
 * TEXT value. The AfdianOrderProcessor turns it directly into the VoiceHub
 * code — never into a shop order, never with -001 suffixes.
 */
final class AfdianService
{
    private const WEBHOOK_PUBLIC_KEY = <<<'PEM'
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----
PEM;

    public function __construct(private readonly App $app)
    {
    }

    public function isEnabled(): bool
    {
        return $this->app->config->bool('AFDIAN_ENABLED', true);
    }

    public function verifyWebhook(Request $request): bool
    {
        $payload = $request->json();
        $order = $payload['data']['order'] ?? null;
        if (!is_array($order)) {
            return false;
        }

        $signature = (string) ($payload['sign'] ?? $payload['data']['sign'] ?? $order['sign'] ?? '');
        if ($signature === '') {
            return $this->app->config->get('AFDIAN_WEBHOOK_REQUIRE_SIGNATURE', '1') !== '1';
        }

        $signString = $this->webhookSignString($order);
        $publicKey = openssl_get_publickey(self::WEBHOOK_PUBLIC_KEY);
        if ($publicKey === false) {
            throw new \RuntimeException('Afdian public key is invalid');
        }
        return openssl_verify($signString, base64_decode($signature, true) ?: '', $publicKey, OPENSSL_ALGO_SHA256) === 1;
    }

    public function normalizeWebhookOrder(array $payload): ?array
    {
        if (($payload['data']['type'] ?? 'order') !== 'order') {
            return null;
        }
        $order = $payload['data']['order'] ?? $payload['order'] ?? null;
        return is_array($order) ? $this->normalizeOrder($order) : null;
    }

    public function pollOrders(): array
    {
        $userId = $this->required('AFDIAN_USER_ID');
        $token = $this->app->config->secret('AFDIAN_API_TOKEN', $this->app->config->get('AFDIAN_API_TOKEN', ''));
        if ($token === '') {
            throw new \RuntimeException('AFDIAN_API_TOKEN is required');
        }
        $base = rtrim((string) $this->app->config->get('AFDIAN_API_BASE', 'https://ifdian.net'), '/');
        $path = (string) $this->app->config->get('AFDIAN_ORDER_ENDPOINT', '/api/open/query-order');
        $orders = [];
        $limit = $this->app->config->int('AFDIAN_POLL_LIMIT', 20);
        $perPage = max(1, min($this->app->config->int('AFDIAN_POLL_PER_PAGE', min($limit, 50)), 100));
        $page = 1;
        $totalPage = 1;

        do {
            $params = ['page' => $page, 'per_page' => $perPage];
            $payload = $this->signedPayload($userId, $token, $params);
            $response = $this->httpRequest($base . $path, $payload);
            if (($response['ec'] ?? null) !== 200) {
                throw new \RuntimeException('Afdian polling failed: ' . ($response['em'] ?? 'unknown error'));
            }

            $data = $response['data'] ?? [];
            $list = is_array($data) ? ($data['list'] ?? []) : [];
            $totalPage = (int) ($data['total_page'] ?? $totalPage);
            foreach ($list as $rawOrder) {
                if (!is_array($rawOrder)) {
                    continue;
                }
                $normalized = $this->normalizeOrder($rawOrder);
                if ($normalized) {
                    $orders[] = $normalized;
                }
            }
            $page++;
        } while (count($orders) < $limit && $page <= $totalPage && !empty($list));

        return array_slice($orders, 0, $limit);
    }

    /**
     * Resolve a buyer's display name from the AffDian sponsor endpoint.
     *
     * The order/webhook payloads do not carry the buyer's username — only the
     * public user_id (and user_private_id). Their display name is available
     * via query-sponsor (data.list[].user.name). We look the name up per
     * order's user_id and cache it in settings keyed by AFDIAN_SPONSOR_CACHE to
     * avoid hammering the endpoint on every admin page render.
     *
     * Returns '' when unknown or the API is unavailable.
     */
    public function sponsorName(string $userId): string
    {
        if ($userId === '') {
            return '';
        }
        $cache = $this->sponsorCache();
        if (isset($cache[$userId]) && $cache[$userId] !== '') {
            return $cache[$userId];
        }
        $name = $this->fetchSponsorName($userId);
        if ($name !== '') {
            $cache[$userId] = $name;
            $this->persistSponsorCache($cache);
        }
        return $name;
    }

    private function sponsorCache(): array
    {
        $raw = (string) $this->app->config->get('AFDIAN_SPONSOR_CACHE', '{}');
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function persistSponsorCache(array $cache): void
    {
        $this->app->config->settings()->set('AFDIAN_SPONSOR_CACHE', json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private function fetchSponsorName(string $userId): string
    {
        $token = $this->app->config->secret('AFDIAN_API_TOKEN', $this->app->config->get('AFDIAN_API_TOKEN', ''));
        if ($token === '') {
            return '';
        }
        $base = rtrim((string) $this->app->config->get('AFDIAN_API_BASE', 'https://ifdian.net'), '/');
        $path = (string) $this->app->config->get('AFDIAN_SPONSOR_ENDPOINT', '/api/open/query-sponsor');
        try {
            $response = $this->httpRequest($base . $path, $this->signedPayload($this->required('AFDIAN_USER_ID'), $token, ['page' => 1, 'per_page' => 20, 'user_id' => $userId]));
            $data = $response['data'] ?? [];
            $list = is_array($data) ? ($data['list'] ?? []) : [];
            foreach ($list as $sponsor) {
                if (!is_array($sponsor)) {
                    continue;
                }
                $u = $sponsor['user'] ?? null;
                if (is_array($u) && (string) ($u['user_id'] ?? '') === $userId) {
                    return (string) trim((string) ($u['name'] ?? ''));
                }
            }
        } catch (\Throwable) {
            // Sponsor API is best-effort; fall back to empty name.
        }
        return '';
    }

    private function signedPayload(string $userId, string $token, array $params): array
    {
        $paramsJson = json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($paramsJson === false) {
            throw new \RuntimeException('Failed to encode Afdian params');
        }
        $timestamp = time();
        $payload = [
            'user_id' => $userId,
            'params' => $paramsJson,
            'ts' => $timestamp,
        ];
        $payload['sign'] = md5($token . $this->apiKvString($payload));
        return $payload;
    }

    private function apiKvString(array $payload): string
    {
        ksort($payload);
        $string = '';
        foreach ($payload as $key => $value) {
            $string .= $key . $value;
        }
        return $string;
    }

    private function webhookSignString(array $order): string
    {
        return (string) ($order['out_trade_no'] ?? '')
            . (string) ($order['user_id'] ?? '')
            . (string) ($order['plan_id'] ?? '')
            . (string) ($order['total_amount'] ?? '');
    }

    /**
     * Normalize a raw Afdian order into the internal shape.
     * out_trade_no is preserved VERBATIM as TEXT.
     */
    private function normalizeOrder(array $order): ?array
    {
        $outTradeNo = (string) ($order['out_trade_no'] ?? $order['order_no'] ?? $order['order_id'] ?? '');
        if ($outTradeNo === '') {
            return null;
        }

        $amountRaw = (string) ($order['total_amount'] ?? $order['amount'] ?? $order['show_amount'] ?? '0');
        try {
            $amountCents = Money::toCents($amountRaw);
        } catch (\InvalidArgumentException) {
            $amountCents = (int) round((float) $amountRaw * 100);
        }

        $skuDetail = '';
        if (isset($order['sku_detail']) && is_array($order['sku_detail'])) {
            $skuParts = [];
            foreach ($order['sku_detail'] as $sku) {
                $name = (string) ($sku['name'] ?? '');
                $count = (string) ($sku['count'] ?? '');
                $skuParts[] = $name !== '' ? ($name . ' x' . $count) : '';
            }
            $skuDetail = implode(', ', array_filter($skuParts));
        } elseif (is_string($order['sku_detail'] ?? null)) {
            $skuDetail = $order['sku_detail'];
        }

        return [
            'out_trade_no' => $outTradeNo,
            'trade_no' => (string) ($order['trade_no'] ?? ''),
            'user_id' => (string) ($order['user_private_id'] ?? $order['user_id'] ?? $order['buyer_id'] ?? ''),
            'buyer_name' => (string) trim((string) ($order['user_name'] ?? $order['name'] ?? $order['buyer_name'] ?? '')),
            'plan_id' => (string) ($order['plan_id'] ?? ''),
            'sku_detail' => $skuDetail,
            'amount_cents' => $amountCents,
            'status' => ((string) ($order['status'] ?? '2')) === '2' ? 'paid' : (string) ($order['status'] ?? 'unknown'),
            'raw' => $order,
        ];
    }

    private function httpRequest(string $url, array $payload): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_TIMEOUT => 20,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new \RuntimeException('Afdian polling failed: ' . ($error ?: 'unknown'));
        }
        if ($status >= 400) {
            throw new \RuntimeException('Afdian polling failed with HTTP ' . $status);
        }
        $decoded = json_decode((string) $body, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function required(string $key): string
    {
        $value = $this->app->config->get($key);
        if (!$value) {
            throw new \RuntimeException($key . ' is required');
        }
        return $value;
    }
}
