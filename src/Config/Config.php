<?php

declare(strict_types=1);

namespace VoiceHubPay\Config;

use VoiceHubPay\Security\SecretStore;

/**
 * Application configuration facade.
 *
 * Reads in order: settings.sqlite (persistent UI settings) -> .env -> $_ENV -> $_SERVER.
 * Sensitive values (merchant keys, tokens, AppKeys) are stored encrypted and are
 * only decrypted through SecretStore; this class returns the raw stored value.
 */
final class Config
{
    private ?SettingsRepository $settingsRepository = null;
    private array $settings = [];

    public function __construct(private readonly array $values, public readonly string $basePath)
    {
    }

    public static function fromEnv(string $basePath): self
    {
        $envFile = $basePath . '/.env';
        if (is_file($envFile)) {
            foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                    continue;
                }
                [$key, $value] = explode('=', $line, 2);
                $_ENV[trim($key)] = trim($value, " \t\n\r\0\x0B\"'");
            }
        }

        $config = new self($_ENV + $_SERVER, $basePath);
        $config->loadSettings();
        return $config;
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $value = $this->settings[$key] ?? $this->values[$key] ?? getenv($key);
        if ($value === false || $value === '') {
            return $default;
        }
        return (string) $value;
    }

    public function int(string $key, int $default): int
    {
        $value = $this->get($key);
        if ($value === null || $value === '') {
            return $default;
        }
        return (int) $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->get($key);
        if ($value === null) {
            return $default;
        }
        return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
    }

    public function path(string $path): string
    {
        if (str_starts_with($path, '/')) {
            return $path;
        }
        return $this->basePath . '/' . $path;
    }

    public function settings(): SettingsRepository
    {
        if (!$this->settingsRepository instanceof SettingsRepository) {
            $this->settingsRepository = new SettingsRepository($this->basePath);
        }
        return $this->settingsRepository;
    }

    public function secretStore(): SecretStore
    {
        return new SecretStore($this->basePath, $this->settings());
    }

    /**
     * Get a decrypted secret value (master-key encrypted at rest).
     */
    public function secret(string $key, ?string $default = null): ?string
    {
        return $this->secretStore()->get($key, $default);
    }

    public function reloadSettings(): void
    {
        $this->settings = $this->settings()->all();
    }

    public function isConfigured(): bool
    {
        return $this->settings()->get('APP_CONFIGURED', '0') === '1';
    }

    public function isInstalled(): bool
    {
        $lock = $this->basePath . '/storage/install.lock';
        return is_file($lock) && $this->settings()->get('APP_CONFIGURED', '0') === '1';
    }

    public function appUrl(): string
    {
        return rtrim((string) $this->get('SITE_URL', $this->get('APP_URL', '')), '/');
    }

    public function timezone(): string
    {
        return (string) $this->get('APP_TIMEZONE', 'Asia/Shanghai');
    }

    private function loadSettings(): void
    {
        try {
            $this->reloadSettings();
        } catch (\Throwable) {
            $this->settings = [];
        }
    }
}
