<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

/**
 * Fulfillment unit queries (user card vault + admin order detail).
 */
final class FulfillmentUnitRepository extends Repository
{
    /**
     * Cards visible to a user: delivered units of the user's paid orders.
     */
    public function listForUser(int $userId, string $status = '', string $q = '', int $page = 1, int $perPage = 10): array
    {
        $where = ['o.user_id = ?', 'o.payment_status = ?'];
        $params = [$userId, 'paid'];
        if ($status === 'completed') {
            $where[] = "fu.status IN ('success','manual_completed')";
        } elseif ($status === 'processing') {
            $where[] = "fu.status IN ('pending','processing')";
        }
        if ($q !== '') {
            $where[] = '(oi.product_name_snapshot LIKE ? OR o.order_no LIKE ?)';
            $like = '%' . $q . '%';
            $params[] = $like;
            $params[] = $like;
        }
        $whereSql = 'WHERE ' . implode(' AND ', $where);
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id JOIN order_items oi ON oi.id = fu.order_item_id ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT fu.*, o.order_no, o.amount_paid_cents, oi.product_name_snapshot, oi.delivery_mode_snapshot, oi.voicehub_code_source_snapshot, oi.product_price_cents_snapshot FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id JOIN order_items oi ON oi.id = fu.order_item_id ' . $whereSql . ' ORDER BY fu.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function countDeliveredForUser(int $userId): int
    {
        $stmt = $this->pdo()->prepare("SELECT COUNT(*) FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = 'paid' AND fu.status IN ('success','manual_completed')");
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    public function countProcessingForUser(int $userId): int
    {
        $stmt = $this->pdo()->prepare("SELECT COUNT(*) FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = 'paid' AND fu.status IN ('pending','processing')");
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    public function countForUser(int $userId): int
    {
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = \'paid\'');
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }
}
