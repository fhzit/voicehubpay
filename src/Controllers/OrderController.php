<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Payments\PaymentService;
use VoiceHubPay\Shop\ShopService;

final class OrderController extends Controller
{
    /**
     * POST /orders — create a shop order. Session is re-validated server-side.
     */
    public function create(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $productId = $request->int('product_id');
        $quantity = $request->int('quantity', 1);
        $redirectUrl = '/product/' . $request->string('slug', '');

        try {
            $shop = new ShopService($this->app);
            $order = $shop->createOrder((int) $user['id'], $productId, $quantity);
            return $this->redirect('/checkout/' . $order['order_no']);
        } catch (\InvalidArgumentException $e) {
            return $this->redirect($redirectUrl)->withFlash($e->getMessage(), 'error');
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'insufficient_stock') {
                return $this->redirect($redirectUrl)->withFlash('库存不足，请选择更少的数量或稍后再试。', 'error');
            }
            return $this->redirect($redirectUrl)->withFlash('订单创建失败，请稍后重试。', 'error');
        }
    }

    public function checkout(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->orderWithItems($orderNo);
        $user = $this->currentUser();
        if ($order === null || !$this->owns($order, $user)) {
            return $this->app->make('controllers.error')->notFound($request);
        }

        $sg65 = $this->app->make('sg65');
        $enabledTypes = $sg65->enabledPayTypes();
        $defaultType = $sg65->defaultPayType();
        $paymentEnabled = $sg65->isEnabled();
        $method = (string) $this->app->config->get('SG65_DEFAULT_METHOD', 'jump');

        return $this->render('checkout/checkout', [
            'order' => $order,
            'enabled_types' => $enabledTypes,
            'default_type' => $defaultType,
            'payment_enabled' => $paymentEnabled,
            'method' => $method,
        ], 'shop');
    }

    /**
     * POST /orders/{orderNo}/pay — create a SG65 payment.
     */
    public function pay(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->findByOrderNo($orderNo);
        $user = $this->currentUser();
        if ($order === null || !$this->owns($order, $user)) {
            return $this->json(['ok' => false, 'error' => '订单不存在。'], 404);
        }
        $payType = $request->string('pay_type', 'alipay');

        try {
            $payment = new PaymentService($this->app);
            $result = $payment->createPayment($order, $payType, $request->ip());
            $this->audit((int) $user['id'], 'payment.create', 'order', (string) $order['order_no'], ['type' => $payType], $request);
            // jump method: redirect to pay_info.
            return $this->redirect($result['pay_info']);
        } catch (\InvalidArgumentException | \RuntimeException $e) {
            return $this->redirect('/checkout/' . $orderNo)->withFlash($e->getMessage(), 'error');
        }
    }

    public function show(Request $request, array $params): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $orderNo = (string) ($params['orderNo'] ?? '');
        $order = $this->app->make('orders')->orderWithItems($orderNo);
        $user = $this->currentUser();
        if ($order === null || !$this->owns($order, $user)) {
            return $this->app->make('controllers.error')->notFound($request);
        }

        $payments = $this->app->make('payments')->listForOrder((int) $order['id']);
        $crypto = $this->app->crypto;
        $units = [];
        foreach ($order['units'] as $unit) {
            $units[] = [
                'unit' => $unit,
                'masked' => $unit['delivery_code_ciphertext'] !== null ? $crypto->mask($crypto->decrypt($unit['delivery_code_ciphertext'])) : '',
                'voicehub_status' => $unit['voicehub_status'],
            ];
        }
        $stats = $this->app->make('orders')->countUnitsByStatus((int) $order['id']);

        return $this->render('account/order-detail', [
            'order' => $order,
            'units' => $units,
            'payments' => $payments,
            'unit_stats' => $stats,
        ], 'account');
    }

    private function owns(array $order, ?array $user): bool
    {
        return $user !== null && (int) $order['user_id'] === (int) $user['id'];
    }
}
