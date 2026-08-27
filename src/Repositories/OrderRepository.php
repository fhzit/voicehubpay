<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class OrderRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM orders WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByOrderNo(string $orderNo): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM orders WHERE order_no = ?');
        $stmt->execute([$orderNo]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function create(array $data): array
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO orders (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency, order_status, payment_status, fulfillment_status, payment_gateway, payment_confirmation_source, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $data['order_no'],
            $data['user_id'],
            $data['source'] ?? 'shop',
            (int) ($data['amount_due_cents'] ?? 0),
            (int) ($data['amount_paid_cents'] ?? 0),
            $data['currency'] ?? 'CNY',
            $data['order_status'] ?? 'active',
            $data['payment_status'] ?? 'unpaid',
            $data['fulfillment_status'] ?? 'pending',
            $data['payment_gateway'] ?? '',
            $data['payment_confirmation_source'] ?? '',
            $now,
            $now,
            $data['expires_at'] ?? null,
        ]);
        return $this->findById((int) $this->pdo()->lastInsertId());
    }

    public function update(int $id, array $fields): void
    {
        $allowed = ['order_status', 'payment_status', 'fulfillment_status', 'payment_gateway', 'payment_confirmation_source', 'amount_paid_cents', 'expires_at', 'paid_at', 'fulfilled_at', 'cancelled_at'];
        $sets = [];
        $params = [];
        foreach ($fields as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                continue;
            }
            $sets[] = "$key = ?";
            $params[] = $value;
        }
        if ($sets === []) {
            return;
        }
        $sets[] = 'updated_at = ?';
        $params[] = $this->now();
        $params[] = $id;
        $stmt = $this->pdo()->prepare('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function markPaid(int $id, int $amountPaidCents, string $gateway, string $confirmationSource): void
    {
        $this->update($id, [
            'payment_status' => 'paid',
            'amount_paid_cents' => $amountPaidCents,
            'payment_gateway' => $gateway,
            'payment_confirmation_source' => $confirmationSource,
            'paid_at' => $this->now(),
        ]);
    }

    public function items(int $orderId): array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
        $stmt->execute([$orderId]);
        return $stmt->fetchAll();
    }

    public function addItem(array $data): int
    {
        $stmt = $this->pdo()->prepare('INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $data['order_id'],
            $data['product_id'],
            $data['product_name_snapshot'],
            (int) ($data['product_price_cents_snapshot'] ?? 0),
            (int) ($data['quantity'] ?? 1),
            $data['delivery_mode_snapshot'] ?? 'card',
            $data['voicehub_code_source_snapshot'] ?? 'inventory',
            $this->now(),
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    public function addUnit(array $data): int
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, inventory_card_id, delivery_code_ciphertext, delivery_code_hash, voicehub_code_ciphertext, voicehub_code_hash, status, voicehub_status, voicehub_attempts, voicehub_last_error, manual_note, created_at, updated_at, fulfilled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NULL)');
        $stmt->execute([
            $data['order_id'],
            $data['order_item_id'],
            $data['unit_index'],
            $data['unit_no'],
            $data['inventory_card_id'] ?? null,
            $data['delivery_code_ciphertext'] ?? null,
            $data['delivery_code_hash'] ?? null,
            $data['voicehub_code_ciphertext'] ?? null,
            $data['voicehub_code_hash'] ?? null,
            $data['status'] ?? 'pending',
            $data['voicehub_status'] ?? 'not_required',
            $now,
            $now,
        ]);
        return (int) $this->pdo()->lastInsertId();
    }

    public function units(int $orderId): array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM fulfillment_units WHERE order_id = ? ORDER BY unit_index');
        $stmt->execute([$orderId]);
        return $stmt->fetchAll();
    }

    public function findUnit(int $unitId): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM fulfillment_units WHERE id = ?');
        $stmt->execute([$unitId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateUnit(int $unitId, array $fields): void
    {
        $allowed = ['status', 'voicehub_status', 'voicehub_attempts', 'voicehub_last_error', 'manual_note', 'delivery_code_ciphertext', 'delivery_code_hash', 'voicehub_code_ciphertext', 'voicehub_code_hash', 'inventory_card_id', 'fulfilled_at'];
        $sets = [];
        $params = [];
        foreach ($fields as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                continue;
            }
            $sets[] = "$key = ?";
            $params[] = $value;
        }
        if ($sets === []) {
            return;
        }
        $sets[] = 'updated_at = ?';
        $params[] = $this->now();
        $params[] = $unitId;
        $stmt = $this->pdo()->prepare('UPDATE fulfillment_units SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function countUnitsByStatus(int $orderId): array
    {
        $stmt = $this->pdo()->prepare('SELECT status, COUNT(*) AS c FROM fulfillment_units WHERE order_id = ? GROUP BY status');
        $stmt->execute([$orderId]);
        $stats = ['pending' => 0, 'processing' => 0, 'success' => 0, 'failed' => 0, 'manual_completed' => 0];
        foreach ($stmt->fetchAll() as $row) {
            $stats[$row['status']] = (int) $row['c'];
        }
        return $stats;
    }

    /**
     * Recompute the order-level fulfillment_status from its units.
     */
    public function recalcFulfillmentStatus(int $orderId): void
    {
        $units = $this->units($orderId);
        if ($units === []) {
            return;
        }
        $total = count($units);
        $success = 0;
        $failed = 0;
        $manual = 0;
        foreach ($units as $unit) {
            if ($unit['status'] === 'success') {
                $success++;
            } elseif ($unit['status'] === 'manual_completed') {
                $manual++;
            } elseif ($unit['status'] === 'failed') {
                $failed++;
            }
        }
        $order = $this->findById($orderId);
        if ($order === null || ($order['payment_status'] ?? '') !== 'paid') {
            return;
        }
        if ($failed === $total) {
            $status = 'failed';
        } elseif ($manual === $total) {
            $status = 'manual_completed';
        } elseif ($success + $manual === $total) {
            $status = 'success';
        } elseif ($success + $manual > 0) {
            $status = 'partial';
        } elseif ($failed > 0) {
            $status = 'partial';
        } else {
            $status = 'processing';
        }
        $this->update($orderId, ['fulfillment_status' => $status, 'fulfilled_at' => in_array($status, ['success', 'failed', 'manual_completed'], true) ? $this->now() : null]);
    }

    /**
     * User-facing order list.
     */
    public function listForUser(int $userId, string $status = '', string $q = '', int $page = 1, int $perPage = 20): array
    {
        $where = ['user_id = ?'];
        $params = [$userId];
        if ($status !== '') {
            $map = [
                'unpaid' => "payment_status IN ('unpaid','pending')",
                'paid' => "payment_status = 'paid' AND fulfillment_status IN ('pending','processing','partial')",
                'completed' => "payment_status = 'paid' AND fulfillment_status IN ('success','manual_completed')",
                'abnormal' => "payment_status = 'paid' AND fulfillment_status IN ('failed')",
            ];
            $where[] = $map[$status] ?? "payment_status = '$status'";
        }
        if ($q !== '') {
            $where[] = 'order_no LIKE ?';
            $params[] = '%' . $q . '%';
        }
        $whereSql = 'WHERE ' . implode(' AND ', $where);
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM orders ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT * FROM orders ' . $whereSql . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function listForUserLatest(int $userId, int $limit = 5): array
    {
        $sql = "SELECT o.*, oi.product_name_snapshot AS first_item_name, oi.quantity AS item_quantity,
                (SELECT COUNT(*) FROM order_items oi2 WHERE oi2.order_id = o.id) AS item_count
                FROM orders o
                LEFT JOIN order_items oi ON oi.order_id = o.id
                WHERE o.user_id = ? AND oi.id = (SELECT MIN(oi3.id) FROM order_items oi3 WHERE oi3.order_id = o.id)
                ORDER BY o.id DESC LIMIT " . (int) $limit;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    /**
     * Admin order list with filters + user info.
     */
    public function listAdmin(array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['order_no'])) {
            $where[] = 'o.order_no LIKE ?';
            $params[] = '%' . $filters['order_no'] . '%';
        }
        if (!empty($filters['username'])) {
            $where[] = 'u.username LIKE ?';
            $params[] = '%' . $filters['username'] . '%';
        }
        if (!empty($filters['product'])) {
            $where[] = 'EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id AND oi2.product_name_snapshot LIKE ?)';
            $params[] = '%' . $filters['product'] . '%';
        }
        if (!empty($filters['payment_status'])) {
            $where[] = 'o.payment_status = ?';
            $params[] = $filters['payment_status'];
        }
        if (!empty($filters['fulfillment_status'])) {
            $where[] = 'o.fulfillment_status = ?';
            $params[] = $filters['fulfillment_status'];
        }
        if (!empty($filters['abnormal'])) {
            $where[] = "o.payment_status = 'paid' AND o.fulfillment_status = 'failed'";
        }
        if (!empty($filters['from'])) {
            $where[] = 'o.created_at >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'o.created_at <= ?';
            $params[] = $filters['to'];
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = "SELECT o.*, u.username, u.display_name,
                    (SELECT product_name_snapshot FROM order_items oi3 WHERE oi3.order_id = o.id ORDER BY oi3.id ASC LIMIT 1) AS first_item_name,
                    (SELECT SUM(oi4.quantity) FROM order_items oi4 WHERE oi4.order_id = o.id) AS item_count
                FROM orders o LEFT JOIN users u ON u.id = o.user_id " . $whereSql . ' ORDER BY o.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    /**
     * Orders awaiting fulfillment (paid, not terminal), newest first.
     */
    public function listPendingFulfillment(int $limit = 50): array
    {
        $sql = "SELECT * FROM orders WHERE payment_status = 'paid' AND fulfillment_status IN ('pending','processing','partial') ORDER BY id ASC LIMIT " . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }

    public function isOwner(int $orderId, int $userId): bool
    {
        $stmt = $this->pdo()->prepare('SELECT 1 FROM orders WHERE id = ? AND user_id = ? LIMIT 1');
        $stmt->execute([$orderId, $userId]);
        return $stmt->fetchColumn() !== false;
    }

    public function orderWithItems(string $orderNo): ?array
    {
        $order = $this->findByOrderNo($orderNo);
        if ($order === null) {
            return null;
        }
        $order['items'] = $this->items((int) $order['id']);
        $order['units'] = $this->units((int) $order['id']);
        return $order;
    }
}
