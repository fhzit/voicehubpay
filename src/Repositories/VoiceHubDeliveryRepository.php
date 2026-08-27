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
        try {
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
        } catch (\PDOException $e) {
            // Concurrent create: the unique idempotency key is the arbiter.
            if ((string) $e->getCode() !== '23000' && (string) $e->getCode() !== '23505') {
                throw $e;
            }
            $existing = $this->findByIdempotencyKey((string) $data['idempotency_key']);
            if ($existing !== null) {
                return ['created' => false, 'delivery' => $existing];
            }
            throw $e;
        }
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

    /**
     * Atomically claim a delivery before issuing the external HTTP request.
     * A stale processing lease may be reclaimed after $leaseSeconds so a
     * crashed worker cannot block the delivery forever.
     */
    public function claimForProcessing(int $id, string $requestPayload, int $maxAttempts, bool $force = false, int $leaseSeconds = 300): bool
    {
        $now = $this->now();
        $staleBefore = gmdate('c', time() - max(30, $leaseSeconds));
        if ($force) {
            $sql = "UPDATE voicehub_deliveries SET status = 'processing', attempts = attempts + 1, request_payload = ?, last_error = NULL, updated_at = ? WHERE id = ? AND (status != 'processing' OR updated_at < ?)";
            $params = [$requestPayload, $now, $id, $staleBefore];
        } else {
            $sql = "UPDATE voicehub_deliveries SET status = 'processing', attempts = attempts + 1, request_payload = ?, last_error = NULL, updated_at = ? WHERE id = ? AND attempts < ? AND (status IN ('pending','failed') OR (status = 'processing' AND updated_at < ?))";
            $params = [$requestPayload, $now, $id, max(1, $maxAttempts), $staleBefore];
        }
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount() === 1;
    }

    public function markSuccess(int $id, string $responsePayload): void
    {
        $this->update($id, ['status' => 'success', 'response_payload' => $responsePayload, 'success_at' => $this->now(), 'last_error' => null]);
    }

    public function markFailed(int $id, string $error, string $responsePayload = ''): void
    {
        $this->update($id, ['status' => 'failed', 'last_error' => mb_substr($error, 0, 1000), 'response_payload' => $responsePayload !== '' ? $responsePayload : null]);
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
