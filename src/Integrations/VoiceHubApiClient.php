<?php

declare(strict_types=1);

namespace VoiceHubPay\Integrations;

use VoiceHubPay\App;

/**
 * VoiceHub API client.
 *
 * HARD RULE: one VoiceHub HTTP request per single code. Even though the API
 * field is "codes", the array MUST always contain exactly one element.
 */
final class VoiceHubApiClient
{
    public function __construct(private readonly App $app)
    {
    }

    public function isEnabled(): bool
    {
        return $this->app->config->bool('VOICEHUB_ENABLED', false);
    }

    public function endpoint(): string
    {
        $base = rtrim((string) $this->app->config->get('VOICEHUB_API_BASE', ''), '/');
        $path = (string) $this->app->config->get('VOICEHUB_TICKET_ENDPOINT', '/api/open/card-codes');
        return $base . $path;
    }

    /**
     * Push a single code to VoiceHub. Returns the parsed response body.
     *
     * @throws \RuntimeException when VoiceHub is not configured or rejects the request
     */
    public function createTicket(string $code, array $meta = []): array
    {
        $base = rtrim((string) $this->app->config->get('VOICEHUB_API_BASE', ''), '/');
        $token = $this->app->config->secret('VOICEHUB_API_TOKEN', $this->app->config->get('VOICEHUB_API_TOKEN', ''));
        if ($base === '' || $token === '') {
            throw new \RuntimeException('VoiceHub 未配置。');
        }
        if ($code === '') {
            throw new \RuntimeException('VoiceHub code 不能为空。');
        }

        $payload = [
            // Exactly ONE code per request — enforced by construction.
            'codes' => [$code],
            'note' => $this->note($code, $meta),
        ];

        $headers = [
            'x-api-key: ' . $token,
            'Accept: application/json',
            'Content-Type: application/json',
        ];

        $timeout = max(5, $this->app->config->int('VOICEHUB_TIMEOUT', 20));
        $ch = curl_init($base . $this->endpointPath());
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new \RuntimeException('VoiceHub 请求失败：' . ($error ?: 'unknown'));
        }
        $decoded = json_decode((string) $body, true);
        $parsed = is_array($decoded) ? $decoded : ['raw' => (string) $body];

        if ($status >= 400 || (($parsed['success'] ?? true) !== true && ($parsed['code'] ?? 0) !== 0)) {
            // The ticket already exists in VoiceHub: the code was delivered
            // before, so treat it as a completed delivery instead of an error.
            if ($this->isAlreadyExists($parsed)) {
                return $parsed;
            }
            throw new \RuntimeException('VoiceHub 拒绝发券（HTTP ' . $status . '）：' . json_encode($parsed, JSON_UNESCAPED_UNICODE));
        }
        return $parsed;
    }

    /**
     * Detect a VoiceHub "ticket already exists" rejection. VoiceHub returns a
     * 400 with a message like "这些点歌券已经存在，无需重复创建" when the code
     * was already created there earlier; that is a completed delivery, not a
     * failure, so we report success instead of surfacing an error.
     */
    private function isAlreadyExists(array $parsed): bool
    {
        $message = is_string($parsed['message'] ?? null)
            ? $parsed['message']
            : (is_string($parsed['error'] ?? null) ? $parsed['error'] : '');
        return preg_match('/点歌券已经存在|无需重复创建|已存在|already exists|already created/i', $message) === 1;
    }

    private function endpointPath(): string
    {
        return (string) $this->app->config->get('VOICEHUB_TICKET_ENDPOINT', '/api/open/card-codes');
    }

    private function note(string $code, array $meta): string
    {
        $parts = [
            'voicehubpay',
            'source=' . ($meta['source_type'] ?? 'shop'),
            'order=' . ($meta['source_order_no'] ?? ''),
            'unit=' . ($meta['unit_no'] ?? ''),
            'amount=' . ($meta['amount'] ?? ''),
        ];
        return implode(' | ', array_filter($parts, static fn (string $part): bool => !str_ends_with($part, '=')));
    }
}
