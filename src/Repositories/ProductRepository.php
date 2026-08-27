<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class ProductRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM products WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findBySlug(string $slug): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM products WHERE slug = ?');
        $stmt->execute([$slug]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function activeCount(): int
    {
        return (int) $this->pdo()->query("SELECT COUNT(*) FROM products WHERE status = 'active'")->fetchColumn();
    }

    /**
     * Public storefront listing with filters/sort/pagination + live stock.
     */
    public function listPublic(array $filters = [], int $page = 1, int $perPage = 12): array
    {
        $where = ["p.status = 'active'"];
        $params = [];
        if (!empty($filters['category_id'])) {
            $where[] = 'p.category_id = ?';
            $params[] = (int) $filters['category_id'];
        }
        if (!empty($filters['q'])) {
            $where[] = '(p.name LIKE ? OR p.description LIKE ?)';
            $like = '%' . $filters['q'] . '%';
            $params[] = $like;
            $params[] = $like;
        }
        $orderMap = [
            'price' => 'p.price_cents ASC',
            'newest' => 'p.id DESC',
        ];
        $order = $orderMap[$filters['sort'] ?? ''] ?? 'p.sort_order ASC, p.id DESC';
        $whereSql = 'WHERE ' . implode(' AND ', $where);

        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM products p ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = max(0, ($page - 1) * $perPage);
        $sql = "SELECT p.*,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'sold') AS stock_sold
                FROM products p " . $whereSql . ' ORDER BY ' . $order . ' LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function listHot(int $limit = 8): array
    {
        $sql = "SELECT p.*,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available
                FROM products p
                WHERE p.status = 'active'
                ORDER BY (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') DESC, p.sort_order ASC, p.id DESC
                LIMIT " . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }

    /**
     * Admin listing with filters + pagination + stats.
     */
    public function listAdmin(string $q = '', string $status = '', ?int $categoryId = null, int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if ($q !== '') {
            $where[] = 'p.name LIKE ?';
            $params[] = '%' . $q . '%';
        }
        if ($status !== '') {
            $where[] = 'p.status = ?';
            $params[] = $status;
        }
        if ($categoryId !== null) {
            $where[] = 'p.category_id = ?';
            $params[] = $categoryId;
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM products p ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = max(0, ($page - 1) * $perPage);
        $sql = "SELECT p.*,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved,
                    (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'sold') AS stock_sold,
                    (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS sold_units,
                    (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS paid_orders,
                    (SELECT COALESCE(SUM(oi.quantity * oi.product_price_cents_snapshot), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS revenue_cents
                FROM products p " . $whereSql . ' ORDER BY p.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function create(array $data): array
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO products (category_id, name, slug, description, cover_image, price_cents, status, delivery_mode, voicehub_enabled, voicehub_code_source, stock_enabled, min_quantity, max_quantity, quantity_step, low_stock_threshold, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $data['category_id'] ?? null,
            $data['name'],
            $data['slug'],
            $data['description'] ?? '',
            $data['cover_image'] ?? '',
            (int) ($data['price_cents'] ?? 0),
            $data['status'] ?? 'draft',
            $data['delivery_mode'] ?? 'card',
            !empty($data['voicehub_enabled']) ? 1 : 0,
            $data['voicehub_code_source'] ?? 'inventory',
            !empty($data['stock_enabled']) ? 1 : 0,
            (int) ($data['min_quantity'] ?? 1),
            (int) ($data['max_quantity'] ?? 99),
            (int) ($data['quantity_step'] ?? 1),
            (int) ($data['low_stock_threshold'] ?? 0),
            (int) ($data['sort_order'] ?? 0),
            $now,
            $now,
        ]);
        return $this->findById((int) $this->pdo()->lastInsertId());
    }

    public function update(int $id, array $data): void
    {
        $allowed = ['category_id', 'name', 'slug', 'description', 'cover_image', 'price_cents', 'status', 'delivery_mode', 'voicehub_enabled', 'voicehub_code_source', 'stock_enabled', 'min_quantity', 'max_quantity', 'quantity_step', 'low_stock_threshold', 'sort_order'];
        $sets = [];
        $params = [];
        foreach ($data as $key => $value) {
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
        $stmt = $this->pdo()->prepare('UPDATE products SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function setStatus(int $id, string $status): void
    {
        $this->update($id, ['status' => $status]);
    }

    /**
     * Soft delete: only fully delete when no order references the product,
     * otherwise disable.
     */
    public function deleteOrDisable(int $id): string
    {
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM order_items WHERE product_id = ?');
        $stmt->execute([$id]);
        $hasOrders = (int) $stmt->fetchColumn() > 0;
        if ($hasOrders) {
            $this->setStatus($id, 'disabled');
            return 'disabled';
        }
        $stmt = $this->pdo()->prepare('DELETE FROM products WHERE id = ?');
        $stmt->execute([$id]);
        return 'deleted';
    }

    public function uniqueSlug(string $name, ?int $ignoreId = null): string
    {
        $base = strtolower(trim((string) preg_replace('/[^a-zA-Z0-9\-]+/', '-', $name), '-'));
        if ($base === '') {
            $base = 'product-' . substr(bin2hex(random_bytes(4)), 0, 8);
        }
        $candidate = $base;
        $i = 2;
        while ($this->slugExists($candidate, $ignoreId)) {
            $candidate = $base . '-' . $i;
            $i++;
        }
        return $candidate;
    }

    private function slugExists(string $slug, ?int $ignoreId): bool
    {
        $stmt = $this->pdo()->prepare('SELECT id FROM products WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1');
        $stmt->execute([$slug, $ignoreId, $ignoreId]);
        return $stmt->fetchColumn() !== false;
    }
}
