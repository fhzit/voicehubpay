<?php

declare(strict_types=1);

namespace VoiceHubPay\Integrations;

use VoiceHubPay\App;
use VoiceHubPay\Repositories\AfdianOrderRepository;
use VoiceHubPay\Repositories\VoiceHubDeliveryRepository;

/**
 * SINGLE entry point for every Afdian order source: webhook, API poll,
 * admin manual sync and admin retry all route here. No duplicated business
 * logic anywhere else.
 *
 * AFDIAN RULES (immutable):
 *   - VoiceHub code == Afdian out_trade_no, verbatim.
 *   - One Afdian order = one VoiceHub HTTP request. No -001 suffixes.
 *   - Afdian never reads shop inventory or shop order numbers.
 *   - Idempotent: successfully delivered orders are never re-pushed.
 */
final class AfdianOrderProcessor
{
    private AfdianOrderRepository $afdian;
    private VoiceHubDeliveryRepository $deliveries;
    private VoiceHubApiClient $voicehub;

    public function __construct(private readonly App $app)
    {
        $this->afdian = $app->make('afdianOrders');
        $this->deliveries = $app->make('deliveries');
        $this->voicehub = $app->make('voicehub');
    }

    /**
     * Process one normalized Afdian order.
     *
     * @return array ['out_trade_no' => string, 'status' => string, 'created' => bool, 'message' => string]
     */
    public function processNormalizedOrder(array $normalized): array
    {
        $outTradeNo = (string) ($normalized['out_trade_no'] ?? '');
        if ($outTradeNo === '') {
            return ['out_trade_no' => '', 'status' => 'skip', 'created' => false, 'message' => 'missing out_trade_no'];
        }

        $stored = $this->afdian->createIfAbsent([
            'out_trade_no' => $outTradeNo,
            'trade_no' => (string) ($normalized['trade_no'] ?? ''),
            'user_id' => (string) ($normalized['user_id'] ?? ''),
            'buyer_name' => (string) ($normalized['buyer_name'] ?? ''),
            'plan_id' => (string) ($normalized['plan_id'] ?? ''),
            'sku_detail' => (string) ($normalized['sku_detail'] ?? ''),
            'amount_cents' => (int) ($normalized['amount_cents'] ?? 0),
            'status' => (string) ($normalized['status'] ?? 'paid'),
            'raw_payload' => json_encode($normalized['raw'] ?? $normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
        ]);
        $order = $stored['order'];
        $orderId = (int) $order['id'];

        // Only paid Afdian orders are delivered.
        $status = (string) ($order['status'] ?? '');
        if (!in_array($status, ['paid', '2'], true)) {
            return ['out_trade_no' => $outTradeNo, 'status' => 'unpaid', 'created' => $stored['created'], 'message' => 'order not paid'];
        }

        // Idempotency: never re-push a successfully delivered order.
        if ($order['voicehub_status'] === 'success') {
            return ['out_trade_no' => $outTradeNo, 'status' => 'already_success', 'created' => $stored['created'], 'message' => 'already delivered'];
        }

        $code = $outTradeNo; // HARD RULE: code == out_trade_no
        $idempotencyKey = 'afdian:' . $outTradeNo;

        $deliveryResult = $this->deliveries->createIfAbsent([
            'source_type' => 'afdian',
            'source_id' => $orderId,
            'source_order_no' => $outTradeNo,
            'fulfillment_unit_id' => null,
            'code_ciphertext' => $this->app->crypto->encrypt($code),
            'code_hash' => $this->app->crypto->hash($code),
            'code_source' => 'afdian_order_no',
            'idempotency_key' => $idempotencyKey,
            'status' => 'pending',
        ]);
        $delivery = $deliveryResult['delivery'];
        $deliveryId = (int) $delivery['id'];

        // If a previous delivery already succeeded, just mark the order success.
        if ($delivery['status'] === 'success') {
            $this->afdian->markVoiceHub($orderId, 'success', (int) $delivery['attempts'], null);
            return ['out_trade_no' => $outTradeNo, 'status' => 'success', 'created' => $stored['created'], 'message' => 'already delivered'];
        }

        // Respect retry cap unless called via forced retry.
        $maxAttempts = max(1, $this->app->config->int('VOICEHUB_RETRIES', 3));
        if ((int) $delivery['attempts'] >= $maxAttempts) {
            return ['out_trade_no' => $outTradeNo, 'status' => 'failed', 'created' => $stored['created'], 'message' => 'max attempts reached'];
        }

        $payload = json_encode(['codes' => [$code]], JSON_UNESCAPED_UNICODE) ?: '';
        if (!$this->deliveries->claimForProcessing($deliveryId, $payload, $maxAttempts)) {
            $current = $this->deliveries->findById($deliveryId) ?? $delivery;
            return ['out_trade_no' => $outTradeNo, 'status' => (string) $current['status'], 'created' => $stored['created'], 'message' => 'already processing or retry limit reached'];
        }
        $delivery = $this->deliveries->findById($deliveryId) ?? $delivery;

        try {
            $this->afdian->markVoiceHub($orderId, 'processing', (int) $delivery['attempts'], null);
            $response = $this->voicehub->createTicket($code, [
                'source_type' => 'afdian',
                'source_order_no' => $outTradeNo,
                'amount' => $order['amount_cents'] ?? '',
            ]);
            $this->deliveries->markSuccess($deliveryId, json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}');
            $updated = $this->deliveries->findById($deliveryId);
            $this->afdian->markVoiceHub($orderId, 'success', (int) ($updated['attempts'] ?? 1), null);
            return ['out_trade_no' => $outTradeNo, 'status' => 'success', 'created' => $stored['created'], 'message' => 'delivered'];
        } catch (\Throwable $e) {
            $this->deliveries->markFailed($deliveryId, $e->getMessage());
            $updated = $this->deliveries->findById($deliveryId);
            $this->afdian->markVoiceHub($orderId, 'failed', (int) ($updated['attempts'] ?? 1), $e->getMessage());
            return ['out_trade_no' => $outTradeNo, 'status' => 'failed', 'created' => $stored['created'], 'message' => $e->getMessage()];
        }
    }

    /**
     * Webhook entry (POST /webhook/afdian).
     */
    public function processWebhook(AfdianService $afdian, \VoiceHubPay\Http\Request $request): array
    {
        if (!$afdian->verifyWebhook($request)) {
            throw new \InvalidArgumentException('invalid signature');
        }
        $order = $afdian->normalizeWebhookOrder($request->json());
        if ($order === null) {
            throw new \InvalidArgumentException('order not found in payload');
        }
        $this->app->config->settings()->set('AFDIAN_LAST_WEBHOOK', gmdate('c'));
        return $this->processNormalizedOrder($order);
    }

    /**
     * Poll entry (API polling / admin manual sync).
     */
    public function processPoll(AfdianService $afdian, int $limit = 20): array
    {
        $results = [];
        foreach ($afdian->pollOrders() as $order) {
            $results[] = $this->processNormalizedOrder($order);
        }
        $this->app->config->settings()->set('AFDIAN_LAST_POLL', gmdate('c'));
        return $results;
    }

    /**
     * Admin retry of a single Afdian order. Re-pushes only when it failed.
     */
    public function retry(string $outTradeNo, bool $force = false): array
    {
        $order = $this->afdian->findByOutTradeNo($outTradeNo);
        if ($order === null) {
            throw new \InvalidArgumentException('爱发电订单不存在。');
        }
        if (!$force && $order['voicehub_status'] === 'success') {
            return ['out_trade_no' => $outTradeNo, 'status' => 'already_success', 'created' => false, 'message' => 'already delivered'];
        }
        return $this->processNormalizedOrder($order);
    }
}
