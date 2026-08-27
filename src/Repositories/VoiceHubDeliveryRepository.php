<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class VoiceHubDeliveryRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM voicehub_deliveries WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByIdempotencyKey(string $key): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM voicehub_deliveries WHERE idempotency_key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByUnitId(int $unitId): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM voicehub_deliveries WHERE fulfillment_unit_id = ? ORDER BY id DESC LIMIT 1');
        $stmt->execute([$unitId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Create a delivery if it does not exist (idempotency-key guarded).
     * Returns ['created' => bool, 'delivery' => array].
     */
    public function createIfAbsent(array $data): array
    {
        $existing = $this->findByIdempotencyKey((string) $data['idempotency_key']);
        if ($existing) {
            return ['created' => false, 'delivery' => $existing];
        }
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO voicehub_deliveries (source_type, source_id, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, request_payload, response_payload, created_at, updated_at, success_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, NULL)');
        $stmt->execute([
            $data['source_type'],
            $data['source_id'] ?? null,
            $data['source_order_no'],
            $data['fulfillment_unit_id'] ?? null,
            $data['code_ciphertext'],
            $data['code_hash'],
            $data['code_source'],
            $data['idempotency_key'],
            $data['status'] ?? 'pending',
            $now,
            $now,
        ]);
        $delivery = $this->findById((int) $this->pdo()->lastInsertId());
        return ['created' => true, 'delivery' => $delivery];
    }

    public function update(int $id, array $fields): void
    {
        $allowed = ['status', 'attempts', 'last_error', 'request_payload', 'response_payload', 'success_at'];
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
        $stmt = $this->pdo()->prepare('UPDATE voicehub_deliveries SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function markProcessing(int $id, string $requestPayload): void
    {
        $this->update($id, ['status' => 'processing', 'request_payload' => $requestPayload]);
    }

    public function markSuccess(int $id, string $responsePayload): void
    {
        $this->update($id, ['status' => 'success', 'response_payload' => $responsePayload, 'success_at' => $this->now(), 'last_error' => null]);
    }

    public function markFailed(int $id, string $error, string $responsePayload = ''): void
    {
        $delivery = $this->findById($id);
        $attempts = $delivery ? ((int) $delivery['attempts'] + 1) : 1;
        $this->update($id, ['status' => 'failed', 'attempts' => $attempts, 'last_error' => mb_substr($error, 0, 1000), 'response_payload' => $responsePayload !== '' ? $responsePayload : null]);
    }

    public function incrementAttempt(int $id): void
    {
        $stmt = $this->pdo()->prepare('UPDATE voicehub_deliveries SET attempts = attempts + 1, updated_at = ? WHERE id = ?');
        $stmt->execute([$this->now(), $id]);
    }

    public function stats(): array
    {
        $rows = $this->pdo()->query('SELECT status, COUNT(*) AS c FROM voicehub_deliveries GROUP BY status')->fetchAll();
        $stats = ['pending' => 0, 'processing' => 0, 'success' => 0, 'failed' => 0];
        foreach ($rows as $row) {
            $stats[$row['status']] = (int) $row['c'];
        }
        return $stats;
    }

    public function countTodayByStatus(string $status, ?string $tz = 'Asia/Shanghai'): int
    {
        $date = (new \DateTimeImmutable('now', new \DateTimeZone($tz)))->format('Y-m-d');
        $from = (new \DateTimeImmutable($date . ' 00:00:00', new \DateTimeZone($tz)))->setTimezone(new \DateTimeZone('UTC'))->format('c');
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM voicehub_deliveries WHERE status = ? AND created_at >= ?');
        $stmt->execute([$status, $from]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * List deliveries with filters (admin + failure center).
     */
    public function list(array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['status'])) {
            $where[] = 'vd.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['code_source'])) {
            $where[] = 'vd.code_source = ?';
            $params[] = $filters['code_source'];
        }
        if (!empty($filters['q'])) {
            $where[] = 'vd.source_order_no LIKE ?';
            $params[] = '%' . $filters['q'] . '%';
        }
        if (!empty($filters['only_failed'])) {
            $where[] = "vd.status = 'failed'";
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM voicehub_deliveries vd ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT vd.*, fu.order_id, o.order_no AS shop_order_no FROM voicehub_deliveries vd LEFT JOIN fulfillment_units fu ON fu.id = vd.fulfillment_unit_id LEFT JOIN orders o ON o.id = fu.order_id ' . $whereSql . ' ORDER BY vd.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function recentFailures(int $limit = 10): array
    {
        $sql = "SELECT vd.*, fu.order_id, o.order_no AS shop_order_no FROM voicehub_deliveries vd LEFT JOIN fulfillment_units fu ON fu.id = vd.fulfillment_unit_id LEFT JOIN orders o ON o.id = fu.order_id WHERE vd.status = 'failed' ORDER BY vd.id DESC LIMIT " . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }

    public function countFailedRetryable(): int
    {
        return (int) $this->pdo()->query("SELECT COUNT(*) FROM voicehub_deliveries WHERE status = 'failed'")->fetchColumn();
    }
}
