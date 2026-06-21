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
        $endpoint = $this->config->get('VOICEHUB_TICKET_ENDPOINT', '/api/song-tickets');
        $payload = [
            'source' => 'afdian',
            'order_no' => $order['order_no'],
            'user_id' => $order['afdian_user_id'] ?: $order['buyer_name'],
            'amount' => max(1, (int) floor((float) $order['amount'])),
            'metadata' => [
                'buyer_name' => $order['buyer_name'] ?? '',
                'afdian_status' => $order['status'] ?? '',
                'raw' => $order['raw'] ?? [],
            ],
        ];
        $headers = ['Authorization: ' . $this->config->get('VOICEHUB_AUTH_SCHEME', 'Bearer') . ' ' . $this->required('VOICEHUB_API_TOKEN')];
        $response = $this->http->request('POST', $base . $endpoint, $headers, $payload);
        if ($response['status'] >= 400) {
            throw new \RuntimeException('VoiceHub ticket creation failed with HTTP ' . $response['status'] . ': ' . json_encode($response['body'], JSON_UNESCAPED_UNICODE));
        }
        return $response['body'];
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
