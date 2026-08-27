<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class InventoryRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM inventory_cards WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function countAvailable(int $productId): int
    {
        $stmt = $this->pdo()->prepare("SELECT COUNT(*) FROM inventory_cards WHERE product_id = ? AND status = 'available'");
        $stmt->execute([$productId]);
        return (int) $stmt->fetchColumn();
    }

    public function countByStatus(int $productId, string $status): int
    {
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM inventory_cards WHERE product_id = ? AND status = ?');
        $stmt->execute([$productId, $status]);
        return (int) $stmt->fetchColumn();
    }

    public function stats(int $productId): array
    {
        $stmt = $this->pdo()->prepare("SELECT status, COUNT(*) AS c FROM inventory_cards WHERE product_id = ? GROUP BY status");
        $stmt->execute([$productId]);
        $stats = ['available' => 0, 'reserved' => 0, 'sold' => 0, 'disabled' => 0];
        foreach ($stmt->fetchAll() as $row) {
            $stats[$row['status']] = (int) $row['c'];
        }
        return $stats;
    }

    public function totalStats(): array
    {
        $stats = ['available' => 0, 'reserved' => 0, 'sold' => 0, 'disabled' => 0];
        foreach ($this->pdo()->query("SELECT status, COUNT(*) AS c FROM inventory_cards GROUP BY status")->fetchAll() as $row) {
            $stats[$row['status']] = (int) $row['c'];
        }
        return $stats;
    }

    /**
     * Import card secrets (already normalized) for a product, encrypted.
     * Returns [total, imported, duplicates, invalid].
     */
    public function import(int $productId, array $secrets, \VoiceHubPay\Security\CryptoService $crypto): array
    {
        // Build hash set of existing secrets for dedup.
        $existing = $this->pdo()->prepare('SELECT secret_hash FROM inventory_cards WHERE product_id = ?');
        $existing->execute([$productId]);
        $hashes = [];
        foreach ($existing->fetchAll() as $row) {
            $hashes[$row['secret_hash']] = true;
        }

        $total = count($secrets);
        $imported = 0;
        $duplicates = 0;
        $invalid = 0;
        $now = $this->now();
        $insert = $this->pdo()->prepare('INSERT INTO inventory_cards (product_id, secret_ciphertext, secret_hash, status, created_at, updated_at) VALUES (?, ?, ?, \'available\', ?, ?)');

        foreach ($secrets as $secret) {
            $secret = trim((string) $secret);
            if ($secret === '') {
                $invalid++;
                continue;
            }
            $hash = $crypto->hash($secret);
            if (isset($hashes[$hash])) {
                $duplicates++;
                continue;
            }
            $hashes[$hash] = true;
            $insert->execute([$productId, $crypto->encrypt($secret), $hash, $now, $now]);
            $imported++;
        }
        return ['total' => $total, 'imported' => $imported, 'duplicates' => $duplicates, 'invalid' => $invalid];
    }

    /**
     * Atomically reserve up to $quantity available cards for an order.
     *
     * Throws \RuntimeException("insufficient_stock") when not enough are
     * available. Returns the reserved card rows (with plaintext secrets when
     * $withSecrets is true).
     *
     * @return array<int, array>
     */
    public function reserve(int $productId, int $quantity, int $orderId, string $reservedUntil, bool $withSecrets = false): array
    {
        $pdo = $this->pdo();
        $driver = $this->driver();

        // Support both standalone use and calls from an already-open
        // transaction (ShopService wraps order+item+reserve atomically).
        $ownsTransaction = !$pdo->inTransaction();
        if ($ownsTransaction) {
            $pdo->beginTransaction();
        }
        try {
            $lockSql = $driver === 'pgsql' ? "SELECT id FROM inventory_cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ? FOR UPDATE" : "SELECT id FROM inventory_cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ?";
            $select = $pdo->prepare($lockSql);
            $select->execute([$productId, $quantity]);
            $ids = array_column($select->fetchAll(), 'id');

            if (count($ids) < $quantity) {
                throw new \RuntimeException('insufficient_stock');
            }

            $in = implode(',', array_fill(0, count($ids), '?'));
            $placeholders = array_merge([$orderId, $reservedUntil, $this->now()], $ids);
            $update = $pdo->prepare("UPDATE inventory_cards SET status = 'reserved', reserved_order_id = ?, reserved_until = ?, updated_at = ? WHERE id IN ($in)");
            $update->execute($placeholders);

            if ($ownsTransaction) {
                $pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($ownsTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        // Fetch reserved rows.
        $in = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $pdo->prepare("SELECT * FROM inventory_cards WHERE id IN ($in) ORDER BY id");
        $stmt->execute($ids);
        $rows = $stmt->fetchAll();
        if ($withSecrets) {
            foreach ($rows as &$row) {
                $row['secret_plain'] = $this->app->crypto->decrypt($row['secret_ciphertext']);
            }
        }
        return $rows;
    }

    /**
     * Release reservations that have expired AND belong to unpaid orders.
     * Never touches reserved cards of paid orders.
     */
    public function releaseExpired(string $nowIso): int
    {
        $pdo = $this->pdo();
        $stmt = $pdo->prepare("SELECT ic.id FROM inventory_cards ic LEFT JOIN orders o ON o.id = ic.reserved_order_id WHERE ic.status = 'reserved' AND ic.reserved_until IS NOT NULL AND ic.reserved_until < ? AND (o.id IS NULL OR o.payment_status != 'paid')");
        $stmt->execute([$nowIso]);
        $ids = array_column($stmt->fetchAll(), 'id');
        if ($ids === []) {
            return 0;
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $params = array_merge([$this->now()], $ids);
        $update = $pdo->prepare("UPDATE inventory_cards SET status = 'available', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE id IN ($in)");
        $update->execute($params);
        return count($ids);
    }

    /**
     * Release a specific reservation (used when cancelling an unpaid order).
     */
    public function releaseForOrder(int $orderId): int
    {
        $stmt = $this->pdo()->prepare("UPDATE inventory_cards SET status = 'available', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE reserved_order_id = ? AND status = 'reserved'");
        $stmt->execute([$this->now(), $orderId]);
        return $stmt->rowCount();
    }

    /**
     * Mark reserved cards as sold for a paid order. Returns count.
     */
    public function markSoldForOrder(int $orderId): int
    {
        $stmt = $this->pdo()->prepare("UPDATE inventory_cards SET status = 'sold', sold_order_id = ?, sold_at = ?, updated_at = ? WHERE reserved_order_id = ? AND status = 'reserved'");
        $stmt->execute([$orderId, $this->now(), $this->now(), $orderId]);
        return $stmt->rowCount();
    }

    public function setDisabled(int $id, bool $disabled): void
    {
        $stmt = $this->pdo()->prepare("UPDATE inventory_cards SET status = ?, updated_at = ? WHERE id = ?");
        $stmt->execute([$disabled ? 'disabled' : 'available', $this->now(), $id]);
    }

    public function listForProduct(int $productId, string $status = '', string $q = '', int $page = 1, int $perPage = 20): array
    {
        $where = ['product_id = ?'];
        $params = [$productId];
        if ($status !== '') {
            $where[] = 'status = ?';
            $params[] = $status;
        }
        $whereSql = 'WHERE ' . implode(' AND ', $where);
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM inventory_cards ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT * FROM inventory_cards ' . $whereSql . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    /**
     * Admin-wide inventory list with product names.
     */
    public function listAll(string $q = '', int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if ($q !== '') {
            $where[] = 'p.name LIKE ?';
            $params[] = '%' . $q . '%';
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM inventory_cards ic JOIN products p ON p.id = ic.product_id ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT ic.*, p.name AS product_name FROM inventory_cards ic JOIN products p ON p.id = ic.product_id ' . $whereSql . ' ORDER BY ic.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function lowStockProducts(int $limit = 20): array
    {
        $sql = "SELECT p.*,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved
                FROM products p
                WHERE p.status = 'active' AND p.stock_enabled = 1
                  AND (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') <= p.low_stock_threshold
                ORDER BY stock_available ASC LIMIT " . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }
}
