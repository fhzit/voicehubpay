<?php

declare(strict_types=1);

namespace VoiceHubPay\Payments;

use VoiceHubPay\App;
use VoiceHubPay\Fulfillment\FulfillmentService;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Repositories\OrderRepository;
use VoiceHubPay\Repositories\PaymentTransactionRepository;
use VoiceHubPay\Support\Money;

/**
 * SG65 payment orchestration: create / notify / query-backfill / reconcile.
 *
 * Payment and fulfillment are DECOUPLED: the notify handler confirms payment
 * and returns success immediately; VoiceHub pushing happens in the worker.
 */
final class PaymentService
{
    private Sg65Client $sg65;
    private OrderRepository $orders;
    private PaymentTransactionRepository $transactions;
    private FulfillmentService $fulfillment;

    public function __construct(private readonly App $app)
    {
        $this->sg65 = $app->make('sg65');
        $this->orders = $app->make('orders');
        $this->transactions = $app->make('payments');
        $this->fulfillment = $app->make('fulfillment');
    }

    /**
     * Create a SG65 payment for an order. Returns ['pay_info' => string].
     *
     * @throws \InvalidArgumentException | \RuntimeException
     */
    public function createPayment(array $order, string $payType, string $clientIp): array
    {
        if (!$this->sg65->isEnabled()) {
            throw new \RuntimeException('支付功能暂未开启。');
        }
        if (!in_array($payType, ['alipay', 'wxpay', 'qqpay'], true)) {
            throw new \InvalidArgumentException('不支持的支付方式。');
        }
        if (!$this->sg65->isPayTypeEnabled($payType)) {
            throw new \InvalidArgumentException('该支付方式未开启。');
        }
        if ($order['payment_status'] === 'paid') {
            throw new \InvalidArgumentException('订单已支付，请勿重复支付。');
        }
        if ($order['payment_status'] === 'pending') {
            // Re-entry is allowed — reuse the flow to create a fresh payment.
        }

        $appUrl = $this->app->config->appUrl();
        $items = $this->orders->items((int) $order['id']);
        $name = $items[0]['product_name_snapshot'] ?? '数字商品';
        if ($order['amount_due_cents'] > 0 && (count($items) > 1 || ($items[0]['quantity'] ?? 1) > 1)) {
            $name .= ' 等';
        }

        $method = (string) $this->app->config->get('SG65_DEFAULT_METHOD', 'jump');
        $params = [
            'pid' => $this->sg65->pid(),
            'method' => $method,
            'type' => $payType,
            'out_trade_no' => (string) $order['order_no'],
            'notify_url' => $appUrl . '/payments/sg65/notify',
            'return_url' => $appUrl . '/payments/sg65/return',
            'name' => mb_substr($name, 0, 64),
            'money' => Money::format((int) $order['amount_due_cents']),
            'clientip' => $clientIp,
            'timestamp' => (string) time(),
        ];

        $response = $this->sg65->create($params);
        $this->assertResponse($response);

        $payInfo = (string) ($response['pay_info'] ?? $response['data']['pay_info'] ?? '');
        $tradeNo = (string) ($response['trade_no'] ?? $response['data']['trade_no'] ?? '');
        if ($payInfo === '') {
            throw new \RuntimeException('支付创建失败：未返回跳转地址。');
        }

        $this->transactions->upsert([
            'order_id' => (int) $order['id'],
            'gateway' => 'sg65',
            'merchant_order_no' => (string) $order['order_no'],
            'gateway_trade_no' => $tradeNo !== '' ? $tradeNo : null,
            'amount_cents' => (int) $order['amount_due_cents'],
            'status' => 'pending',
            'pay_type' => $payType,
            'pay_url' => $payInfo,
            'confirmation_source' => 'callback',
        ]);

        return ['pay_info' => $payInfo, 'trade_no' => $tradeNo];
    }

    /**
     * Handle SG65 GET notify. Returns plain-text body ("success").
     */
    public function handleNotify(array $query): string
    {
        if (!$this->sg65->isEnabled()) {
            return 'disabled';
        }
        if (!Sg65Signer::verify($query, $this->sg65->platformPublicKey())) {
            return 'verify_failed';
        }
        if (($query['pid'] ?? '') !== $this->sg65->pid()) {
            return 'pid_mismatch';
        }
        if (($query['trade_status'] ?? '') !== 'TRADE_SUCCESS') {
            return 'not_success';
        }
        $orderNo = (string) ($query['out_trade_no'] ?? '');
        $order = $orderNo !== '' ? $this->orders->findByOrderNo($orderNo) : null;
        if ($order === null) {
            return 'order_not_found';
        }

        try {
            $paidCents = Money::toCents((string) ($query['money'] ?? ''));
        } catch (\InvalidArgumentException) {
            return 'bad_money';
        }
        if ($paidCents !== (int) $order['amount_due_cents']) {
            return 'amount_mismatch';
        }

        $tradeNo = (string) ($query['trade_no'] ?? '');
        $apiTradeNo = (string) ($query['api_trade_no'] ?? '');
        $payType = (string) ($query['type'] ?? '');

        $tx = $this->transactions->upsert([
            'order_id' => (int) $order['id'],
            'gateway' => 'sg65',
            'merchant_order_no' => $orderNo,
            'gateway_trade_no' => $tradeNo !== '' ? $tradeNo : null,
            'api_trade_no' => $apiTradeNo !== '' ? $apiTradeNo : null,
            'amount_cents' => $paidCents,
            'status' => 'paid',
            'pay_type' => in_array($payType, ['alipay', 'wxpay', 'qqpay'], true) ? $payType : null,
            'confirmation_source' => 'callback',
            'raw_notify_payload' => json_encode($query, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
        if ($tx !== null) {
            $this->transactions->markPaid((int) $tx['id'], $tradeNo, $apiTradeNo, 'callback');
        }

        // Idempotent payment confirmation.
        $this->confirmPaid($order, 'sg65', 'callback');
        return 'success';
    }

    /**
     * Confirm an order as paid. Idempotent; never blocks on VoiceHub.
     */
    public function confirmPaid(array $order, string $gateway, string $confirmationSource): void
    {
        if ($order['payment_status'] === 'paid') {
            return;
        }
        $this->orders->markPaid((int) $order['id'], (int) $order['amount_due_cents'], $gateway, $confirmationSource);
        try {
            $this->fulfillment->preparePaidOrder((int) $order['id']);
        } catch (\Throwable $e) {
            error_log('[fulfillment prepare] ' . $e->getMessage());
        }
        // Best-effort quick trigger (must not block the notify response).
        try {
            $this->fulfillment->processOrder((int) $order['id']);
        } catch (\Throwable $e) {
            error_log('[fulfillment quick] ' . $e->getMessage());
        }
    }

    /**
     * Active query of SG65 and safe backfill (source = query).
     *
     * @return array status descriptor
     */
    public function queryAndBackfill(array $order, ?string $tradeNo = null): array
    {
        $params = [];
        if ($tradeNo !== null && $tradeNo !== '') {
            $params['trade_no'] = $tradeNo;
        } else {
            $params['out_trade_no'] = (string) $order['order_no'];
        }
        $response = $this->sg65->query($params);

        // SG65 status: 0 unpaid, 1 paid, 2 refunded, 3 frozen, 4 pre-auth.
        $status = (int) ($response['status'] ?? $response['data']['status'] ?? $response['data']['order']['status'] ?? -1);
        if ($status === 1 && $this->verifyBackfill($response, $order)) {
            $tradeNoR = (string) ($response['trade_no'] ?? $response['data']['trade_no'] ?? $response['data']['order']['trade_no'] ?? '');
            $this->confirmPaid($order, 'sg65', 'query');
            return ['paid' => true, 'status' => $status];
        }
        return ['paid' => false, 'status' => $status];
    }

    private function verifyBackfill(array $response, array $order): bool
    {
        if (!Sg65Signer::verify($response, $this->sg65->platformPublicKey())) {
            return false;
        }
        if (($response['pid'] ?? '') !== '' && ($response['pid'] ?? '') !== $this->sg65->pid()) {
            return false;
        }
        $orderNo = (string) ($response['out_trade_no'] ?? $response['data']['out_trade_no'] ?? $response['data']['order']['out_trade_no'] ?? '');
        if ($orderNo === '' || $orderNo !== (string) $order['order_no']) {
            return false;
        }
        $money = (string) ($response['money'] ?? $response['data']['money'] ?? $response['data']['order']['money'] ?? '');
        if ($money === '') {
            return false;
        }
        try {
            if (Money::toCents($money) !== (int) $order['amount_due_cents']) {
                return false;
            }
        } catch (\InvalidArgumentException) {
            return false;
        }
        return true;
    }

    /**
     * Reconcile: fetch recent merchant orders and backfill missed payments.
     * limit capped at 50.
     */
    public function reconcile(int $limit = 50, int $offset = 0): array
    {
        $limit = max(1, min($limit, 50));
        $response = $this->sg65->merchantOrders([
            'offset' => (string) $offset,
            'limit' => (string) $limit,
        ]);
        $this->assertResponse($response);

        $backfilled = 0;
        $orders = $response['data']['orders'] ?? $response['data']['list'] ?? $response['data'] ?? [];
        if (is_array($orders)) {
            // Normalize possible nested shapes.
            if (isset($orders['out_trade_no']) || isset($orders['order'])) {
                $orders = [$orders];
            }
            foreach ($orders as $merchantOrder) {
                $row = is_array($merchantOrder) ? $merchantOrder : [];
                $outTradeNo = (string) ($row['out_trade_no'] ?? '');
                $status = (int) ($row['status'] ?? -1);
                if ($outTradeNo === '' || $status !== 1) {
                    continue;
                }
                $order = $this->orders->findByOrderNo($outTradeNo);
                if ($order === null || $order['payment_status'] === 'paid') {
                    continue;
                }
                // The merchant list is discovery-only. Confirm every candidate
                // through the signed single-order query, including order number
                // and amount verification, before changing local payment state.
                $tradeNo = (string) ($row['trade_no'] ?? '');
                $verified = $this->queryAndBackfill($order, $tradeNo !== '' ? $tradeNo : null);
                if ($verified['paid']) {
                    $backfilled++;
                }
            }
        }
        return ['backfilled' => $backfilled, 'checked' => count($orders)];
    }

    private function assertResponse(array $response): void
    {
        $code = (int) ($response['code'] ?? -1);
        if ($code !== 0) {
            $msg = (string) ($response['msg'] ?? $response['message'] ?? 'unknown error');
            throw new \RuntimeException('SG65 返回错误：' . $msg);
        }
    }
}
