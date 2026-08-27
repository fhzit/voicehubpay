<?php

declare(strict_types=1);

namespace VoiceHubPay\Config;

use PDO;

/**
 * Persists application settings in storage/settings.sqlite (key/value).
 */
final class SettingsRepository
{
    private PDO $pdo;

    public function __construct(private readonly string $basePath)
    {
        $database = $this->basePath . '/storage/settings.sqlite';
        if (!is_dir(dirname($database))) {
            mkdir(dirname($database), 0775, true);
        }

        $this->pdo = new PDO('sqlite:' . $database, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->pdo->exec('PRAGMA journal_mode = WAL');
        $this->migrate();
    }

    public function all(): array
    {
        $rows = $this->pdo->query('SELECT key, value FROM app_settings')->fetchAll();
        $settings = [];
        foreach ($rows as $row) {
            $settings[$row['key']] = $row['value'];
        }
        return $settings;
    }

    public function get(string $key, ?string $default = null): ?string
    {
        $stmt = $this->pdo->prepare('SELECT value FROM app_settings WHERE key = ?');
        $stmt->execute([$key]);
        $value = $stmt->fetchColumn();
        if ($value === false || $value === '') {
            return $default;
        }
        return (string) $value;
    }

    public function has(string $key): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM app_settings WHERE key = ?');
        $stmt->execute([$key]);
        return $stmt->fetchColumn() !== false;
    }

    public function set(string $key, string|int|float|bool|null $value): void
    {
        $this->setMany([$key => $value]);
    }

    public function setMany(array $settings): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
        $now = gmdate('c');
        foreach ($settings as $key => $value) {
            $stmt->execute([(string) $key, (string) $value, $now]);
        }
    }

    public function delete(string $key): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM app_settings WHERE key = ?');
        $stmt->execute([$key]);
    }

    public function isConfigured(): bool
    {
        return $this->get('APP_CONFIGURED', '0') === '1';
    }

    private function migrate(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS app_settings (
            key VARCHAR(128) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at VARCHAR(64) NOT NULL
        )');
    }
}
