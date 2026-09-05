<?php

declare(strict_types=1);

namespace VoiceHubPay;

use VoiceHubPay\Config\Config;
use VoiceHubPay\Database\Database;
use VoiceHubPay\Http\View;
use VoiceHubPay\Security\CryptoService;

/**
 * Application service container (lightweight, no framework).
 */
final class App
{
    public readonly Config $config;
    public readonly Database $db;
    public readonly View $view;
    public CryptoService $crypto;

    /** @var array<string, object> */
    private array $services = [];

    public function __construct(string $basePath)
    {
        $this->config = Config::fromEnv($basePath);
        $this->db = new Database($this->config);
        $this->view = new View($basePath);
        $this->crypto = new CryptoService($basePath);
    }

    /**
     * Get or build a shared service by short name.
     */
    public function make(string $name): object
    {
        if (isset($this->services[$name])) {
            return $this->services[$name];
        }
        $service = $this->build($name);
        $this->services[$name] = $service;
        return $service;
    }

    public function has(string $name): bool
    {
        return method_exists($this, 'build' . ucfirst($name)) || class_exists($name);
    }

    private function build(string $name): object
    {
        return match ($name) {
            'auth' => new \VoiceHubPay\Auth\AuthService($this),
            'users' => new \VoiceHubPay\Repositories\UserRepository($this),
            'social' => new \VoiceHubPay\Repositories\SocialIdentityRepository($this),
            'products' => new \VoiceHubPay\Repositories\ProductRepository($this),
            'categories' => new \VoiceHubPay\Repositories\CategoryRepository($this),
            'inventory' => new \VoiceHubPay\Repositories\InventoryRepository($this),
            'orders' => new \VoiceHubPay\Repositories\OrderRepository($this),
            'payments' => new \VoiceHubPay\Repositories\PaymentTransactionRepository($this),
            'units' => new \VoiceHubPay\Repositories\FulfillmentUnitRepository($this),
            'deliveries' => new \VoiceHubPay\Repositories\VoiceHubDeliveryRepository($this),
            'afdian' => new \VoiceHubPay\Integrations\AfdianService($this),
            'afdianOrders' => new \VoiceHubPay\Repositories\AfdianOrderRepository($this),
            'audit' => new \VoiceHubPay\Repositories\AuditLogRepository($this),
            'analytics' => new \VoiceHubPay\Analytics\AnalyticsService($this),
            'shop' => new \VoiceHubPay\Shop\ShopService($this),
            'fulfillment' => new \VoiceHubPay\Fulfillment\FulfillmentService($this),
            'sg65' => new \VoiceHubPay\Payments\Sg65Client($this),
            'payment' => new \VoiceHubPay\Payments\PaymentService($this),
            'voicehub' => new \VoiceHubPay\Integrations\VoiceHubApiClient($this),
            'afdianProcessor' => new \VoiceHubPay\Integrations\AfdianOrderProcessor($this),
            'dashboard' => new \VoiceHubPay\Analytics\DashboardService($this),
            'mailer' => new \VoiceHubPay\Support\Mailer($this->config),
            'controllers.error' => new \VoiceHubPay\Controllers\ErrorController($this),
            default => throw new \RuntimeException('Unknown service: ' . $name),
        };
    }
}
