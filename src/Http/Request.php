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

    public function isMethod(string $method): bool
    {
        return $this->method() === strtoupper($method);
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

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->post[$key] ?? $this->query[$key] ?? $default;
    }

    public function string(string $key, string $default = ''): string
    {
        $value = $this->input($key, $default);
        return is_scalar($value) ? trim((string) $value) : $default;
    }

    public function int(string $key, int $default = 0): int
    {
        $value = $this->input($key, $default);
        return is_scalar($value) ? (int) $value : $default;
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        return $this->server[$key] ?? null;
    }

    public function ip(): string
    {
        // Only trust forwarding headers when the deployment explicitly opts in.
        // Never infer trust from a client-supplied X-Forwarded-Proto header: doing
        // so lets attackers spoof X-Forwarded-For and bypass IP-based throttles.
        $trust = in_array(strtolower((string) ($this->server['APP_TRUST_PROXY'] ?? '0')), ['1', 'true', 'yes', 'on'], true);
        if ($trust) {
            $forwarded = $this->server['HTTP_X_FORWARDED_FOR'] ?? '';
            if ($forwarded !== '') {
                $first = explode(',', (string) $forwarded)[0];
                $first = trim($first);
                if ($first !== '' && filter_var($first, FILTER_VALIDATE_IP)) {
                    return $first;
                }
            }
        }
        return (string) ($this->server['REMOTE_ADDR'] ?? '');
    }

    public function userAgent(): string
    {
        return substr((string) ($this->server['HTTP_USER_AGENT'] ?? ''), 0, 500);
    }

    /**
     * Validate the CSRF token. External callbacks call this with a bypass flag.
     */
    public function csrfValid(): bool
    {
        return \VoiceHubPay\Security\Csrf::verify($this->string('_csrf', ''));
    }
}
