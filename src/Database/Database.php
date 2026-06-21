<?php

declare(strict_types=1);

namespace VoiceHubPay\Database;

use PDO;
use VoiceHubPay\Config\Config;

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
            $database = $this->config->path($this->config->get('DATA_DB_DATABASE', $this->config->get('DB_DATABASE', 'storage/voicehubpay.sqlite')));
            if (!is_dir(dirname($database))) {
                mkdir(dirname($database), 0775, true);
            }
            $dsn = 'sqlite:' . $database;
            $username = null;
            $password = null;
        } elseif ($connection === 'pgsql') {
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

        return $this->pdo;
    }

    public function driver(): string
    {
        return $this->pdo()->getAttribute(PDO::ATTR_DRIVER_NAME);
    }
}
