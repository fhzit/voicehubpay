<?php

declare(strict_types=1);

namespace VoiceHubPay\Http;

final class Response
{
    public function __construct(private readonly string $body, private readonly int $status = 200, private readonly array $headers = [])
    {
    }

    public static function text(string $body, int $status = 200): self
    {
        return new self($body, $status, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public static function json(array $data, int $status = 200): self
    {
        return new self(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}', $status, ['Content-Type' => 'application/json; charset=utf-8']);
    }

    public static function html(string $body, int $status = 200): self
    {
        return new self($body, $status, ['Content-Type' => 'text/html; charset=utf-8']);
    }

    public static function redirect(string $location, int $status = 302): self
    {
        return new self('', $status, ['Location' => $location]);
    }

    public function body(): string
    {
        return $this->body;
    }

    public function status(): int
    {
        return $this->status;
    }

    public function headers(): array
    {
        return $this->headers;
    }

    public static function notFound(string $message = 'Not Found'): self
    {
        return new self($message, 404, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public static function serverError(string $message = 'Internal Server Error'): self
    {
        return new self($message, 500, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public function withFlash(string $message, string $type = 'success'): self
    {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
        return $this;
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $this->body;
    }
}
