<?php

declare(strict_types=1);

namespace VoiceHubPay\Fulfillment;

use VoiceHubPay\App;
use VoiceHubPay\Integrations\VoiceHubApiClient;
use VoiceHubPay\Repositories\InventoryRepository;
use VoiceHubPay\Repositories\OrderRepository;
use VoiceHubPay\Repositories\VoiceHubDeliveryRepository;

/**
 * Fulfillment orchestration: prepares paid orders, drives the VoiceHub worker,
 * and supports admin manual actions on units.
 */
final class FulfillmentService
{
    private OrderRepository $orders;
    private InventoryRepository $inventory;
    private VoiceHubDeliveryRepository $deliveries;
    private VoiceHubApiClient $voicehub;

    public function __construct(private readonly App $app)
    {
        $this->orders = $app->make('orders');
        $this->inventory = $app->make('inventory');
        $this->deliveries = $app->make('deliveries');
        $this->voicehub = $app->make('voicehub');
    }

    /**
     * Payment confirmed: mark cards sold, create VoiceHub delivery rows
     * (idempotency-key guarded), detect paid_stockout, recalc status.
     */
    public function preparePaidOrder(int $orderId): void
    {
        $order = $this->orders->findById($orderId);
        if ($order === null || $order['payment_status'] !== 'paid') {
            return;
        }
        $pdo = $this->app->db->pdo();
        $pdo->beginTransaction();
        try {
            $this->inventory->markSoldForOrder($orderId);
            $units = $this->orders->units($orderId);
            $stockout = 0;
            foreach ($units as $unit) {
                if ($unit['voicehub_status'] === 'pending') {
                    $this->ensureDelivery((int) $order['id'], $order['order_no'], $unit);
                }
                // Manual mode / no code yet handled by admin.
                if (in_array($unit['status'], ['pending', 'processing'], true)
                    && $unit['delivery_code_ciphertext'] === null
                    && $unit['voicehub_code_ciphertext'] === null
                    && ($order['source'] ?? '') === 'shop') {
                    // paid_stockout: reservation was released before payment.
                    $this->orders->updateUnit((int) $unit['id'], [
                        'status' => 'failed',
                        'voicehub_status' => 'failed',
                        'voicehub_last_error' => 'paid_stockout: 库存已被释放，等待管理员人工处理',
                        'manual_note' => 'paid_stockout',
                    ]);
                    $stockout++;
                    continue;
                }
                // Pure inventory card (no VoiceHub push): the card secret was
                // already attached at order creation, so it is delivered now.
                if ($unit['voicehub_status'] === 'not_required'
                    && $unit['delivery_code_ciphertext'] !== null
                    && in_array($unit['status'], ['pending', 'processing'], true)) {
                    $this->orders->updateUnit((int) $unit['id'], [
                        'status' => 'success',
                        'voicehub_status' => 'not_required',
                        'fulfilled_at' => gmdate('c'),
                    ]);
                }
            }
            if ($stockout > 0) {
                $this->orders->update($orderId, ['order_status' => 'manual_review']);
            }
            $this->orders->recalcFulfillmentStatus($orderId);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Create the VoiceHub delivery row for a unit if absent.
     */
    public function ensureDelivery(int $orderId, string $orderNo, array $unit): ?array
    {
        $voicehubCipher = $unit['voicehub_code_ciphertext'];
        if ($voicehubCipher === null) {
            return null;
        }
        $code = $this->app->crypto->decrypt($voicehubCipher);
        $codeHash = $unit['voicehub_code_hash'] ?: $this->app->crypto->hash($code);
        $unitNo = (string) $unit['unit_no'];

        // Determine idempotency key + code_source from the actual source.
        $sourceOrder = $this->orders->findById($orderId);
        $item = $this->orders->items($orderId)[0] ?? null;
        $isShopInventory = $item !== null
            && in_array($item['delivery_mode_snapshot'], ['card', 'card_and_voicehub'], true)
            && !empty($item['voicehub_code_source_snapshot'])
            && $item['voicehub_code_source_snapshot'] === 'inventory';

        if ($isShopInventory) {
            $idempotency = 'shop:' . $orderNo . ':' . $unitNo . ':' . $codeHash;
            $deliverySource = 'inventory';
        } else {
            $idempotency = 'shop:' . $orderNo . ':' . $unitNo;
            $deliverySource = 'shop_order_no';
        }

        $result = $this->deliveries->createIfAbsent([
            'source_type' => 'shop',
            'source_id' => $orderId,
            'source_order_no' => $orderNo,
            'fulfillment_unit_id' => (int) $unit['id'],
            'code_ciphertext' => $voicehubCipher,
            'code_hash' => $codeHash,
            'code_source' => $deliverySource,
            'idempotency_key' => $idempotency,
            'status' => 'pending',
        ]);
        return $result['delivery'];
    }

    /**
     * Process a single unit: one VoiceHub HTTP request (one code).
     * Returns the delivery row.
     */
    public function processUnit(array $order, array $unit, bool $force = false): array
    {
        $delivery = $this->deliveries->findByUnitId((int) $unit['id']);

        if ($delivery === null) {
            $delivery = $this->ensureDelivery((int) $order['id'], (string) $order['order_no'], $unit);
        }
        if ($delivery === null) {
            // No voicehub code to push — nothing to do.
            return $unit;
        }

        // Already successful: default prohibits ordinary re-push.
        if (!$force && $delivery['status'] === 'success') {
            $this->orders->updateUnit((int) $unit['id'], [
                'status' => 'success',
                'voicehub_status' => 'success',
                'voicehub_attempts' => (int) $delivery['attempts'],
                'voicehub_last_error' => null,
                'fulfilled_at' => gmdate('c'),
            ]);
            return $delivery;
        }

        // Respect retry cap unless forced.
        $maxAttempts = max(1, $this->app->config->int('VOICEHUB_RETRIES', 3));
        if (!$force && (int) $delivery['attempts'] >= $maxAttempts) {
            return $delivery;
        }

        $code = $this->app->crypto->decrypt($delivery['code_ciphertext']);
        $payload = json_encode(['codes' => [$code], 'note' => 'voicehubpay'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        if (!$this->deliveries->claimForProcessing((int) $delivery['id'], $payload, $maxAttempts, $force)) {
            // Another worker/admin request owns the active processing lease, or
            // the retry cap was reached. Never issue a duplicate HTTP request.
            return $this->deliveries->findById((int) $delivery['id']) ?? $delivery;
        }
        $delivery = $this->deliveries->findById((int) $delivery['id']) ?? $delivery;
        $this->orders->updateUnit((int) $unit['id'], [
            'status' => 'processing',
            'voicehub_status' => 'processing',
            'voicehub_attempts' => (int) $delivery['attempts'],
        ]);

        try {
            $response = $this->voicehub->createTicket($code, [
                'source_type' => $delivery['source_type'],
                'source_order_no' => $delivery['source_order_no'],
                'unit_no' => $unit['unit_no'] ?? '',
                'amount' => $order['amount_due_cents'] ?? '',
            ]);
            $this->deliveries->markSuccess((int) $delivery['id'], json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}');
            $this->orders->updateUnit((int) $unit['id'], [
                'status' => 'success',
                'voicehub_status' => 'success',
                'voicehub_attempts' => (int) $this->deliveries->findById((int) $delivery['id'])['attempts'],
                'voicehub_last_error' => null,
                'fulfilled_at' => gmdate('c'),
            ]);
            $delivery = $this->deliveries->findById((int) $delivery['id']);
        } catch (\Throwable $e) {
            $this->deliveries->markFailed((int) $delivery['id'], $e->getMessage());
            $this->orders->updateUnit((int) $unit['id'], [
                'status' => 'failed',
                'voicehub_status' => 'failed',
                'voicehub_attempts' => (int) $this->deliveries->findById((int) $delivery['id'])['attempts'],
                'voicehub_last_error' => $e->getMessage(),
            ]);
            $delivery = $this->deliveries->findById((int) $delivery['id']);
        }

        $this->orders->recalcFulfillmentStatus((int) $order['id']);
        return $delivery;
    }

    /**
     * Process a whole order (worker entry). Returns counts.
     */
    public function processOrder(int $orderId): array
    {
        $order = $this->orders->findById($orderId);
        if ($order === null || $order['payment_status'] !== 'paid') {
            return ['processed' => 0, 'success' => 0, 'failed' => 0, 'skipped' => 0];
        }
        $beforeStatus = (string) ($order['fulfillment_status'] ?? '');
        $units = $this->orders->units($orderId);
        $processed = 0;
        $success = 0;
        $failed = 0;
        $skipped = 0;
        foreach ($units as $unit) {
            $needsPush = in_array($unit['voicehub_status'], ['pending', 'processing', 'failed'], true)
                && $unit['voicehub_code_ciphertext'] !== null;
            if (!$needsPush) {
                $skipped++;
                continue;
            }
            $delivery = $this->deliveries->findByUnitId((int) $unit['id']);
            if ($delivery !== null && $delivery['status'] === 'success') {
                $skipped++;
                continue;
            }
            $this->processUnit($order, $unit);
            $processed++;
            $after = $this->orders->findUnit((int) $unit['id']);
            if ($after !== null && $after['voicehub_status'] === 'success') {
                $success++;
            } else {
                $failed++;
            }
        }
        $this->orders->recalcFulfillmentStatus($orderId);
        // Notify the buyer once when the whole order flips to fully fulfilled.
        try {
            $afterOrder = $this->orders->findById($orderId);
            if ($afterOrder !== null && $afterOrder['fulfillment_status'] === 'success' && $beforeStatus !== 'success') {
                $this->notifyOrderFulfilled($afterOrder);
            }
        } catch (\Throwable $e) {
            error_log('[mail fulfilled] ' . $e->getMessage());
        }
        return ['processed' => $processed, 'success' => $success, 'failed' => $failed, 'skipped' => $skipped];
    }

    private function notifyOrderFulfilled(array $order): void
    {
        $app = $this->app;
        $userId = (int) ($order['user_id'] ?? 0);
        if ($userId <= 0) {
            return;
        }
        $user = $app->make('users')->findById($userId);
        if ($user === null) {
            return;
        }
        $to = (string) ($user['email'] ?? '');
        if ($to === '') {
            return;
        }
        $itemName = '';
        try {
            $stmt = $this->db()->prepare('SELECT product_name_snapshot FROM order_items WHERE order_id = ? ORDER BY id ASC LIMIT 1');
            $stmt->execute([(int) $order['id']]);
            $row = $stmt->fetch();
            $itemName = $row !== false ? (string) ($row['product_name_snapshot'] ?? '') : '';
        } catch (\Throwable) {
        }
        $app->make('mailer')->orderFulfilled((string) $order['order_no'], $itemName, $to);
    }

    private function db(): \PDO
    {
        return $this->app->db->pdo();
    }

    /**
     * Worker: process all paid orders awaiting fulfillment.
     */
    public function processPendingOrders(int $limit = 50): array
    {
        $orders = $this->orders->listPendingFulfillment($limit);
        $summary = ['orders' => count($orders), 'processed' => 0, 'success' => 0, 'failed' => 0];
        foreach ($orders as $order) {
            $result = $this->processOrder((int) $order['id']);
            $summary['processed'] += $result['processed'];
            $summary['success'] += $result['success'];
            $summary['failed'] += $result['failed'];
        }
        return $summary;
    }

    /**
     * Admin: retry a specific failed (or any retryable) unit.
     */
    public function retryUnit(int $unitId, bool $force = false): array
    {
        $unit = $this->orders->findUnit($unitId);
        if ($unit === null) {
            throw new \InvalidArgumentException('发放单元不存在。');
        }
        $order = $this->orders->findById((int) $unit['order_id']);
        if ($order === null) {
            throw new \InvalidArgumentException('订单不存在。');
        }
        return $this->processUnit($order, $unit, $force);
    }

    /**
     * Admin: manual completion of a unit. Never fakes voicehub success.
     */
    public function manualCompleteUnit(int $unitId, string $note): void
    {
        $unit = $this->orders->findUnit($unitId);
        if ($unit === null) {
            throw new \InvalidArgumentException('发放单元不存在。');
        }
        $this->orders->updateUnit($unitId, [
            'status' => 'manual_completed',
            'manual_note' => $note,
            'fulfilled_at' => gmdate('c'),
        ]);
        $this->orders->recalcFulfillmentStatus((int) $unit['order_id']);
    }

    /**
     * Admin: assign an externally provided card secret to a unit.
     */
    public function assignManualCode(int $unitId, string $secret): void
    {
        $unit = $this->orders->findUnit($unitId);
        if ($unit === null) {
            throw new \InvalidArgumentException('发放单元不存在。');
        }
        $secret = trim($secret);
        if ($secret === '') {
            throw new \InvalidArgumentException('卡密不能为空。');
        }
        $cipher = $this->app->crypto->encrypt($secret);
        $hash = $this->app->crypto->hash($secret);
        $voicehub = $this->orders->findById((int) $unit['order_id']);
        $item = $this->orders->items((int) $unit['order_id'])[0] ?? null;
        $needsVoicehub = $item !== null && !empty($item['delivery_mode_snapshot']) && $item['delivery_mode_snapshot'] === 'card_and_voicehub';

        $this->orders->updateUnit($unitId, [
            'status' => 'pending',
            'delivery_code_ciphertext' => $cipher,
            'delivery_code_hash' => $hash,
            'voicehub_code_ciphertext' => $needsVoicehub ? $cipher : null,
            'voicehub_code_hash' => $needsVoicehub ? $hash : null,
            'voicehub_status' => $needsVoicehub ? 'pending' : 'not_required',
            'manual_note' => 'admin_assigned_code',
        ]);
        $this->orders->recalcFulfillmentStatus((int) $unit['order_id']);
    }
}
