<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

use PDO;
use VoiceHubPay\App;

/**
 * Base repository providing PDO access and common helpers.
 */
abstract class Repository
{
    public function __construct(protected readonly App $app)
    {
    }

    protected function pdo(): PDO
    {
        return $this->app->db->pdo();
    }

    protected function driver(): string
    {
        return $this->app->db->driver();
    }

    protected function now(): string
    {
        return gmdate('c');
    }

    protected function isPgsql(): bool
    {
        return $this->driver() === 'pgsql';
    }
}
