<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Auth\SessionAuth;
use VoiceHubPay\Config\Config;
use VoiceHubPay\Database\Database;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Services\AfdianService;
use VoiceHubPay\Services\OrderService;

final class AdminController
{
    public function __construct(
        private readonly Config $config,
        private readonly Database $db,
        private readonly AfdianService $afdian,
        private readonly OrderService $orders,
    ) {
    }

    public function dashboard(Request $request): Response
    {
        if ($redirect = SessionAuth::requireUser()) {
            return $redirect;
        }
        return $this->view('dashboard', [
            'user' => SessionAuth::user(),
            'stats' => $this->orders->stats(),
            'orders' => $this->orders->list(10),
            'dbDriver' => $this->db->driver(),
            'config' => $this->config,
        ]);
    }

    public function orders(Request $request): Response
    {
        if ($redirect = SessionAuth::requireUser()) {
            return $redirect;
        }
        return $this->view('orders', [
            'user' => SessionAuth::user(),
            'orders' => $this->orders->list(100),
        ]);
    }

    public function retry(Request $request): Response
    {
        if ($redirect = SessionAuth::requireUser()) {
            return $redirect;
        }
        $orderNo = (string) ($request->post['order_no'] ?? '');
        if ($orderNo !== '') {
            $this->orders->dispatch($orderNo);
        }
        return Response::redirect('/orders');
    }

    public function syncAfdian(Request $request): Response
    {
        if ($redirect = SessionAuth::requireUser()) {
            return $redirect;
        }
        $count = 0;
        foreach ($this->afdian->pollOrders() as $order) {
            $this->orders->upsertAndDispatch($order);
            $count++;
        }
        $_SESSION['flash'] = '已同步 ' . $count . ' 个爱发电订单';
        return Response::redirect('/');
    }

    private function view(string $name, array $data): Response
    {
        extract($data, EXTR_SKIP);
        ob_start();
        require $this->config->basePath . '/views/' . $name . '.php';
        $content = ob_get_clean();
        ob_start();
        require $this->config->basePath . '/views/layouts/app.php';
        return Response::html((string) ob_get_clean());
    }
}
