<?php

declare(strict_types=1);

use VoiceHubPay\Config\Config;
use VoiceHubPay\Database\Database;
use VoiceHubPay\Services\AfdianService;
use VoiceHubPay\Services\OrderService;
use VoiceHubPay\Services\VoiceHubService;

require __DIR__ . '/../src/bootstrap.php';

$config = Config::fromEnv(dirname(__DIR__));
$orders = new OrderService(new Database($config), new VoiceHubService($config));
$afdian = new AfdianService($config);
$count = 0;

foreach ($afdian->pollOrders() as $order) {
    $orders->upsertAndDispatch($order);
    $count++;
}

echo 'Synced ' . $count . ' Afdian orders' . PHP_EOL;
