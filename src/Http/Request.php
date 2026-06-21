<?php

declare(strict_types=1);

namespace VoiceHubPay\Http;

final class Request
{
    public function __construct(
        private readonly string $method,
        private readonly string $path,
        public readonly array $query,
        public readonly array $post,
        public readonly array $server,
        private readonly string $body,
    ) {
    }

    public static function capture(): self
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        return new self($_SERVER['REQUEST_METHOD'] ?? 'GET', $uri, $_GET, $_POST, $_SERVER, file_get_contents('php://input') ?: '');
    }

    public function method(): string
    {
        return strtoupper($this->method);
    }

    public function path(): string
    {
        return $this->path;
    }

    public function body(): string
    {
        return $this->body;
    }

    public function json(): array
    {
        $decoded = json_decode($this->body, true);
        return is_array($decoded) ? $decoded : [];
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        return $this->server[$key] ?? null;
    }
}
