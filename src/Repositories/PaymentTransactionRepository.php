<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class PaymentTransactionRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM payment_transactions WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByMerchantOrderNo(string $orderNo): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM payment_transactions WHERE merchant_order_no = ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$orderNo]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByGatewayTradeNo(string $tradeNo): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM payment_transactions WHERE gateway_trade_no = ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$tradeNo]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function listForOrder(int $orderId): array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY id DESC');
        $stmt->execute([$orderId]);
        return $stmt->fetchAll();
    }

    /**
     * Create/update a payment transaction for an order. Returns the row.
     */
    public function upsert(array $data): array
    {
        $existing = $this->findByMerchantOrderNo((string) $data['merchant_order_no']);
        $now = $this->now();
        if ($existing) {
            $fields = ['gateway', 'order_id', 'gateway_trade_no', 'api_trade_no', 'amount_cents', 'status', 'pay_type', 'pay_url', 'confirmation_source', 'raw_notify_payload'];
            $sets = [];
            $params = [];
            foreach ($fields as $field) {
                if (!array_key_exists($field, $data)) {
                    continue;
                }
                $sets[] = "$field = ?";
                $params[] = $data[$field];
            }
            if ($data['status'] ?? '' === 'paid') {
                $sets[] = 'paid_at = ?';
                $params[] = $now;
            }
            $sets[] = 'updated_at = ?';
            $params[] = $now;
            $params[] = $existing['id'];
            $stmt = $this->pdo()->prepare('UPDATE payment_transactions SET ' . implode(', ', $sets) . ' WHERE id = ?');
            $stmt->execute($params);
            return $this->findById((int) $existing['id']);
        }

        $stmt = $this->pdo()->prepare('INSERT INTO payment_transactions (order_id, gateway, merchant_order_no, gateway_trade_no, api_trade_no, amount_cents, status, pay_type, pay_url, confirmation_source, raw_notify_payload, created_at, updated_at, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $data['order_id'],
            $data['gateway'] ?? 'sg65',
            $data['merchant_order_no'],
            $data['gateway_trade_no'] ?? null,
            $data['api_trade_no'] ?? null,
            (int) ($data['amount_cents'] ?? 0),
            $data['status'] ?? 'pending',
            $data['pay_type'] ?? null,
            $data['pay_url'] ?? null,
            $data['confirmation_source'] ?? 'callback',
            $data['raw_notify_payload'] ?? null,
            $now,
            $now,
            ($data['status'] ?? '') === 'paid' ? $now : null,
        ]);
        return $this->findById((int) $this->pdo()->lastInsertId());
    }

    public function markPaid(int $id, string $gatewayTradeNo, string $apiTradeNo, string $confirmationSource): void
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('UPDATE payment_transactions SET status = ?, gateway_trade_no = COALESCE(?, gateway_trade_no), api_trade_no = COALESCE(?, api_trade_no), confirmation_source = ?, paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ?');
        $stmt->execute(['paid', $gatewayTradeNo, $apiTradeNo, $confirmationSource, $now, $now, $id]);
    }

    public function listAdmin(string $payType = '', string $status = '', string $q = '', int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if ($payType !== '') {
            $where[] = 'pt.pay_type = ?';
            $params[] = $payType;
        }
        if ($status !== '') {
            $where[] = 'pt.status = ?';
            $params[] = $status;
        }
        if ($q !== '') {
            $where[] = '(pt.merchant_order_no LIKE ? OR pt.gateway_trade_no LIKE ?)';
            $like = '%' . $q . '%';
            $params[] = $like;
            $params[] = $like;
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM payment_transactions pt ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT pt.*, o.order_no, o.amount_due_cents FROM payment_transactions pt JOIN orders o ON o.id = pt.order_id ' . $whereSql . ' ORDER BY pt.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }
}
