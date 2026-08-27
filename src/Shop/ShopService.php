<?php

declare(strict_types=1);

namespace VoiceHubPay\Shop;

use VoiceHubPay\App;
use VoiceHubPay\Repositories\InventoryRepository;
use VoiceHubPay\Repositories\OrderRepository;
use VoiceHubPay\Repositories\ProductRepository;

/**
 * Shop domain service: validates a purchase, atomically reserves inventory,
 * creates the order with order_items and fulfillment_units.
 *
 * All amounts are integer cents computed server-side. The client-supplied
 * total is never trusted.
 */
final class ShopService
{
    private ProductRepository $products;
    private OrderRepository $orders;
    private InventoryRepository $inventory;

    public function __construct(private readonly App $app)
    {
        $this->products = $app->make('products');
        $this->orders = $app->make('orders');
        $this->inventory = $app->make('inventory');
    }

    /**
     * Validate quantity against product rules.
     *
     * @throws \InvalidArgumentException
     */
    public function validateQuantity(array $product, int $quantity): void
    {
        $min = (int) $product['min_quantity'];
        $max = (int) $product['max_quantity'];
        $step = max(1, (int) $product['quantity_step']);
        if ($quantity < $min) {
            throw new \InvalidArgumentException("数量不能少于 {$min} 件。");
        }
        if ($quantity > $max) {
            throw new \InvalidArgumentException("数量不能超过 {$max} 件。");
        }
        if (($quantity - $min) % $step !== 0) {
            throw new \InvalidArgumentException("数量需按 {$step} 的步长选择。");
        }
    }

    /**
     * Max purchasable quantity for a product (limited by available stock when
     * stock is enabled).
     */
    public function maxPurchasable(array $product): int
    {
        $max = (int) $product['max_quantity'];
        if (!empty($product['stock_enabled'])) {
            $available = $this->inventory->countAvailable((int) $product['id']);
            $max = min($max, $available);
        }
        return $max;
    }

    /**
     * Create a shop order.
     *
     * @param int $userId authenticated user
     * @param int $productId product
     * @param int $quantity quantity
     * @return array the created order (with items/units)
     * @throws \InvalidArgumentException on validation errors
     * @throws \RuntimeException on insufficient stock
     */
    public function createOrder(int $userId, int $productId, int $quantity): array
    {
        $product = $this->products->findById($productId);
        if ($product === null) {
            throw new \InvalidArgumentException('商品不存在。');
        }
        if (($product['status'] ?? '') !== 'active') {
            throw new \InvalidArgumentException('该商品已下架。');
        }
        $this->validateQuantity($product, $quantity);

        $priceCents = (int) $product['price_cents'];
        $amountDue = $priceCents * $quantity; // server-side computation

        $orderNo = $this->uniqueOrderNo();
        $ttlMinutes = max(5, $this->app->config->int('ORDER_TTL_MINUTES', 30));
        $expiresAt = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->modify('+' . $ttlMinutes . ' minutes')->format('c');

        $deliveryMode = (string) $product['delivery_mode'];
        $voicehubSource = (string) $product['voicehub_code_source'];
        $needsStock = in_array($deliveryMode, ['card', 'card_and_voicehub'], true);

        $pdo = $this->app->db->pdo();
        $pdo->beginTransaction();
        try {
            $order = $this->orders->create([
                'order_no' => $orderNo,
                'user_id' => $userId,
                'source' => 'shop',
                'amount_due_cents' => $amountDue,
                'amount_paid_cents' => 0,
                'currency' => 'CNY',
                'order_status' => 'active',
                'payment_status' => 'unpaid',
                'fulfillment_status' => 'pending',
                'expires_at' => $expiresAt,
            ]);
            $orderId = (int) $order['id'];

            $itemId = $this->orders->addItem([
                'order_id' => $orderId,
                'product_id' => $product['id'],
                'product_name_snapshot' => (string) $product['name'],
                'product_price_cents_snapshot' => $priceCents,
                'quantity' => $quantity,
                'delivery_mode_snapshot' => $deliveryMode,
                'voicehub_code_source_snapshot' => $voicehubSource,
            ]);

            // Atomic reservation of N available cards when stock is used.
            $cards = [];
            if ($needsStock) {
                $cards = $this->inventory->reserve((int) $product['id'], $quantity, $orderId, $expiresAt, true);
                // reserve() throws when insufficient — transaction rolls back.
            }

            $voicehubEnabled = !empty($product['voicehub_enabled']);

            for ($i = 1; $i <= $quantity; $i++) {
                $unitNo = OrderNumberService::unitNo($orderNo, $i);
                $card = $cards[$i - 1] ?? null;

                $deliveryCipher = null;
                $deliveryHash = null;
                $voicehubCipher = null;
                $voicehubHash = null;
                $voicehubStatus = 'not_required';
                $unitStatus = 'pending';

                if ($deliveryMode === 'card' || $deliveryMode === 'card_and_voicehub') {
                    // Stock card is the deliverable.
                    $deliveryCipher = $card['secret_ciphertext'];
                    $deliveryHash = $card['secret_hash'];
                    if ($voicehubEnabled) {
                        // code_source=inventory: the card secret IS the VoiceHub code.
                        $voicehubCipher = $card['secret_ciphertext'];
                        $voicehubHash = $card['secret_hash'];
                        $voicehubStatus = 'pending';
                    }
                } elseif ($deliveryMode === 'voicehub') {
                    // No stock; deliverable = the shop order voucher code.
                    $deliveryCipher = $this->app->crypto->encrypt($unitNo);
                    $deliveryHash = $this->app->crypto->hash($unitNo);
                    if ($voicehubEnabled) {
                        $voicehubCipher = $deliveryCipher;
                        $voicehubHash = $deliveryHash;
                        $voicehubStatus = 'pending';
                    }
                } // manual: codes assigned later by admin.

                $this->orders->addUnit([
                    'order_id' => $orderId,
                    'order_item_id' => $itemId,
                    'unit_index' => $i,
                    'unit_no' => $unitNo,
                    'inventory_card_id' => $card['id'] ?? null,
                    'delivery_code_ciphertext' => $deliveryCipher,
                    'delivery_code_hash' => $deliveryHash,
                    'voicehub_code_ciphertext' => $voicehubCipher,
                    'voicehub_code_hash' => $voicehubHash,
                    'status' => $unitStatus,
                    'voicehub_status' => $voicehubStatus,
                ]);
            }

            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        return $this->orders->orderWithItems($orderNo);
    }

    /**
     * Cancel an unpaid order: release reservations, mark cancelled.
     */
    public function cancelUnpaidOrder(int $orderId, string $reason = 'user_cancel'): void
    {
        $order = $this->orders->findById($orderId);
        if ($order === null) {
            throw new \InvalidArgumentException('订单不存在。');
        }
        if (in_array($order['payment_status'], ['paid', 'pending'], true)) {
            throw new \InvalidArgumentException('已支付订单不能取消。');
        }
        $this->app->db->pdo()->beginTransaction();
        try {
            $this->inventory->releaseForOrder($orderId);
            $this->orders->update($orderId, [
                'order_status' => 'cancelled',
                'cancelled_at' => gmdate('c'),
            ]);
            $this->app->db->pdo()->commit();
        } catch (\Throwable $e) {
            if ($this->app->db->pdo()->inTransaction()) {
                $this->app->db->pdo()->rollBack();
            }
            throw $e;
        }
    }

    private function uniqueOrderNo(): string
    {
        do {
            $orderNo = OrderNumberService::generate();
        } while ($this->orders->findByOrderNo($orderNo) !== null);
        return $orderNo;
    }
}
