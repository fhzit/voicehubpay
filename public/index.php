<?php

declare(strict_types=1);

use VoiceHubPay\Config\Config;
use VoiceHubPay\Controllers\AdminController;
use VoiceHubPay\Controllers\AuthController;
use VoiceHubPay\Controllers\SetupController;
use VoiceHubPay\Controllers\WebhookController;
use VoiceHubPay\Database\Database;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Services\AfdianService;
use VoiceHubPay\Services\OrderService;
use VoiceHubPay\Services\VoiceHubService;

require __DIR__ . '/../src/bootstrap.php';

$config = Config::fromEnv(dirname(__DIR__));
$db = new Database($config);
$orderService = new OrderService($db, new VoiceHubService($config));
$afdianService = new AfdianService($config);
$request = Request::capture();

$auth = new AuthController($config);
$setup = new SetupController($config);
$admin = new AdminController($config, $db, $afdianService, $orderService);
$webhook = new WebhookController($config, $afdianService, $orderService);

$route = [$request->method(), rtrim($request->path(), '/') ?: '/'];

if (!$config->isConfigured() && !in_array($route, [['GET', '/setup'], ['POST', '/setup']], true)) {
    Response::redirect('/setup')->send();
    exit;
}

try {
    $response = match ($route) {
        ['GET', '/setup'] => $setup->show($request),
        ['POST', '/setup'] => $setup->save($request),
        ['GET', '/'] => $admin->dashboard($request),
        ['GET', '/orders'] => $admin->orders($request),
        ['POST', '/orders/retry'] => $admin->retry($request),
        ['POST', '/sync/afdian'] => $admin->syncAfdian($request),
        ['GET', '/auth/login'] => $auth->login($request),
        ['GET', '/auth/callback'] => $auth->callback($request),
        ['POST', '/auth/logout'] => $auth->logout(),
        ['POST', '/webhook/afdian'] => $webhook->afdian($request),
        default => Response::text('Not found', 404),
    };
} catch (Throwable $exception) {
    error_log((string) $exception);
    $response = Response::text('Internal server error', 500);
}

$response->send();
