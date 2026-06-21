<?php

declare(strict_types=1);

namespace VoiceHubPay\Services;

final class HttpJsonClient
{
    public function request(string $method, string $url, array $headers = [], ?array $json = null): array
    {
        $ch = curl_init($url);
        $headerLines = array_merge(['Accept: application/json'], $headers);
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_TIMEOUT => 20,
        ];
        if ($json !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
        }
        curl_setopt_array($ch, $options);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new \RuntimeException($error ?: 'HTTP request failed');
        }

        $decoded = json_decode((string) $body, true);
        return ['status' => $status, 'body' => is_array($decoded) ? $decoded : ['raw' => $body]];
    }
}
