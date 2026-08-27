<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class AfdianOrderRepository extends Repository
{
    public function findByOutTradeNo(string $outTradeNo): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM afdian_orders WHERE out_trade_no = ?');
        $stmt->execute([$outTradeNo]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM afdian_orders WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Insert if absent. Returns ['created' => bool, 'order' => array].
     */
    public function createIfAbsent(array $data): array
    {
        $existing = $this->findByOutTradeNo((string) $data['out_trade_no']);
        if ($existing) {
            return ['created' => false, 'order' => $existing];
        }
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO afdian_orders (out_trade_no, trade_no, user_id, plan_id, sku_detail, amount_cents, status, raw_payload, voicehub_status, voicehub_attempts, voicehub_last_error, created_at, paid_at, processed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL, ?)');
        $stmt->execute([
            $data['out_trade_no'],
            $data['trade_no'] ?? '',
            $data['user_id'] ?? '',
            $data['plan_id'] ?? '',
            $data['sku_detail'] ?? '',
            (int) ($data['amount_cents'] ?? 0),
            $data['status'] ?? 'paid',
            $data['raw_payload'] ?? '[]',
            $data['voicehub_status'] ?? 'pending',
            $now,
            $now,
            $now,
        ]);
        return ['created' => true, 'order' => $this->findById((int) $this->pdo()->lastInsertId())];
    }

    public function update(int $id, array $fields): void
    {
        $allowed = ['trade_no', 'user_id', 'plan_id', 'sku_detail', 'amount_cents', 'status', 'raw_payload', 'voicehub_status', 'voicehub_attempts', 'voicehub_last_error', 'paid_at', 'processed_at'];
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
        $stmt = $this->pdo()->prepare('UPDATE afdian_orders SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function markVoiceHub(int $id, string $status, int $attempts, ?string $error): void
    {
        $this->update($id, [
            'voicehub_status' => $status,
            'voicehub_attempts' => $attempts,
            'voicehub_last_error' => $error,
            'processed_at' => $status === 'success' ? $this->now() : null,
        ]);
    }

    public function stats(): array
    {
        $rows = $this->pdo()->query('SELECT voicehub_status, COUNT(*) AS c FROM afdian_orders GROUP BY voicehub_status')->fetchAll();
        $stats = ['pending' => 0, 'processing' => 0, 'success' => 0, 'failed' => 0];
        foreach ($rows as $row) {
            $stats[$row['voicehub_status']] = (int) $row['c'];
        }
        return $stats;
    }

    public function sumPaid(): int
    {
        return (int) $this->pdo()->query("SELECT COALESCE(SUM(amount_cents), 0) FROM afdian_orders WHERE status = 'paid' OR status = '2'")->fetchColumn();
    }

    public function count(): int
    {
        return (int) $this->pdo()->query('SELECT COUNT(*) FROM afdian_orders')->fetchColumn();
    }

    public function countToday(string $tz = 'Asia/Shanghai'): int
    {
        $date = (new \DateTimeImmutable('now', new \DateTimeZone($tz)))->format('Y-m-d');
        $from = (new \DateTimeImmutable($date . ' 00:00:00', new \DateTimeZone($tz)))->setTimezone(new \DateTimeZone('UTC'))->format('c');
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM afdian_orders WHERE created_at >= ?');
        $stmt->execute([$from]);
        return (int) $stmt->fetchColumn();
    }

    public function sumToday(string $tz = 'Asia/Shanghai'): int
    {
        $date = (new \DateTimeImmutable('now', new \DateTimeZone($tz)))->format('Y-m-d');
        $from = (new \DateTimeImmutable($date . ' 00:00:00', new \DateTimeZone($tz)))->setTimezone(new \DateTimeZone('UTC'))->format('c');
        $stmt = $this->pdo()->prepare("SELECT COALESCE(SUM(amount_cents), 0) FROM afdian_orders WHERE status IN ('paid','2') AND created_at >= ?");
        $stmt->execute([$from]);
        return (int) $stmt->fetchColumn();
    }

    public function listAdmin(string $status = '', string $voicehub = '', string $q = '', int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if ($status !== '') {
            $where[] = 'status = ?';
            $params[] = $status;
        }
        if ($voicehub !== '') {
            $where[] = 'voicehub_status = ?';
            $params[] = $voicehub;
        }
        if ($q !== '') {
            $where[] = '(out_trade_no LIKE ? OR trade_no LIKE ?)';
            $like = '%' . $q . '%';
            $params[] = $like;
            $params[] = $like;
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM afdian_orders ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT * FROM afdian_orders ' . $whereSql . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function listRecent(int $limit = 10): array
    {
        $sql = 'SELECT * FROM afdian_orders ORDER BY id DESC LIMIT ' . (int) $limit;
        return $this->pdo()->query($sql)->fetchAll();
    }

    public function lastWebhookAt(): ?string
    {
        return $this->app->config->get('AFDIAN_LAST_WEBHOOK');
    }

    public function lastPollAt(): ?string
    {
        return $this->app->config->get('AFDIAN_LAST_POLL');
    }
}
