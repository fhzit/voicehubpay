<?php

declare(strict_types=1);

use VoiceHubPay\Config\Config;
use VoiceHubPay\Database\Database;

require __DIR__ . '/../src/bootstrap.php';

$config = Config::fromEnv(dirname(__DIR__));
$pdo = (new Database($config))->pdo();

foreach (glob(__DIR__ . '/../database/migrations/*.php') ?: [] as $migration) {
    $fn = require $migration;
    $fn($pdo);
    echo 'Migrated ' . basename($migration) . PHP_EOL;
}
