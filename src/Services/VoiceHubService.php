<?php

declare(strict_types=1);

namespace VoiceHubPay\Services;

use VoiceHubPay\Config\Config;

final class VoiceHubService
{
    private HttpJsonClient $http;

    public function __construct(private readonly Config $config)
    {
        $this->http = new HttpJsonClient();
    }

    public function createTicket(array $order): array
    {
        $base = rtrim($this->required('VOICEHUB_API_BASE'), '/');
        $endpoint = $this->config->get('VOICEHUB_TICKET_ENDPOINT', '/api/open/card-codes');
        $count = max(1, (int) floor((float) $order['amount']));
        $payload = [
            'count' => $count,
            'prefix' => $this->config->get('VOICEHUB_CODE_PREFIX', 'AFD'),
            'length' => $this->config->int('VOICEHUB_CODE_LENGTH', 12),
            'note' => $this->note($order, $count),
        ];
        $charset = trim((string) ($this->config->get('VOICEHUB_CODE_CHARSET', '') ?? ''));
        if ($charset !== '') {
            $payload['charset'] = $charset;
        }

        $headers = ['x-api-key: ' . $this->required('VOICEHUB_API_TOKEN')];
        $response = $this->http->request('POST', $base . $endpoint, $headers, $payload);
        if ($response['status'] >= 400 || (($response['body']['success'] ?? true) !== true)) {
            throw new \RuntimeException('VoiceHub card-code creation failed with HTTP ' . $response['status'] . ': ' . json_encode($response['body'], JSON_UNESCAPED_UNICODE));
        }
        return $response['body'];
    }

    private function note(array $order, int $count): string
    {
        $parts = [
            'voicehubpay',
            'source=afdian',
            'order=' . ($order['order_no'] ?? ''),
            'afdian_user=' . ($order['afdian_user_id'] ?? ''),
            'buyer=' . ($order['buyer_name'] ?? ''),
            'amount=' . ($order['amount'] ?? ''),
            'count=' . $count,
        ];
        return implode(' | ', array_filter($parts, static fn (string $part): bool => !str_ends_with($part, '=')));
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
