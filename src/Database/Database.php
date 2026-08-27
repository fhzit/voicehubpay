<?php

declare(strict_types=1);

namespace VoiceHubPay\Database;

use PDO;
use VoiceHubPay\Config\Config;

/**
 * PDO factory for the business database (SQLite or PostgreSQL).
 */
final class Database
{
    private ?PDO $pdo = null;

    public function __construct(private readonly Config $config)
    {
    }

    public function pdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $connection = $this->config->get('DATA_DB_CONNECTION', $this->config->get('DB_CONNECTION', 'sqlite'));
        if ($connection === 'sqlite') {
            $this->ensureDriver('sqlite', 'pdo_sqlite / sqlite3');
            $database = $this->config->path($this->config->get('DATA_DB_DATABASE', $this->config->get('DB_DATABASE', 'storage/voicehubpay.sqlite')));
            if (!is_dir(dirname($database))) {
                mkdir(dirname($database), 0775, true);
            }
            $dsn = 'sqlite:' . $database;
            $username = null;
            $password = null;
        } elseif ($connection === 'pgsql') {
            $this->ensureDriver('pgsql', 'pdo_pgsql / pgsql');
            $dsn = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s',
                $this->config->get('DATA_DB_HOST', $this->config->get('DB_HOST', '127.0.0.1')),
                $this->config->get('DATA_DB_PORT', $this->config->get('DB_PORT', '5432')),
                $this->config->get('DATA_DB_DATABASE', $this->config->get('DB_DATABASE', 'voicehubpay'))
            );
            $username = $this->config->get('DATA_DB_USERNAME', $this->config->get('DB_USERNAME'));
            $password = $this->config->get('DATA_DB_PASSWORD', $this->config->get('DB_PASSWORD'));
        } else {
            throw new \RuntimeException('Unsupported DATA_DB_CONNECTION: ' . $connection);
        }

        $this->pdo = new PDO($dsn, $username, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        if ($connection === 'sqlite') {
            $this->pdo->exec('PRAGMA journal_mode = WAL');
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA busy_timeout = 10000');
        }

        return $this->pdo;
    }

    public function driver(): string
    {
        return $this->pdo()->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    public function driverIsPgsql(): bool
    {
        return $this->driver() === 'pgsql';
    }

    /**
     * Connection descriptor used by the maintenance screen.
     */
    public function describe(): array
    {
        $driver = $this->driver();
        if ($driver === 'pgsql') {
            return [
                'type' => 'PostgreSQL',
                'dsn' => sprintf(
                    'pgsql:host=%s;port=%s;dbname=%s',
                    $this->config->get('DATA_DB_HOST', '127.0.0.1'),
                    $this->config->get('DATA_DB_PORT', '5432'),
                    $this->config->get('DATA_DB_DATABASE', 'voicehubpay')
                ),
            ];
        }
        return ['type' => 'SQLite', 'dsn' => 'sqlite:' . $this->config->path($this->config->get('DATA_DB_DATABASE', 'storage/voicehubpay.sqlite'))];
    }

    private function ensureDriver(string $driver, string $extensionHint): void
    {
        if (!in_array($driver, PDO::getAvailableDrivers(), true)) {
            throw new \RuntimeException(sprintf(
                'PDO driver "%s" is not enabled. Enable %s in the 1Panel PHP runtime, then restart PHP/OpenResty.',
                $driver,
                $extensionHint
            ));
        }
    }
}
