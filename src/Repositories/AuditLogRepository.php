<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class AuditLogRepository extends Repository
{
    /**
     * Write an audit entry. Never stores card codes, passwords, keys or tokens.
     */
    public function log(int $userId, string $action, string $objectType = '', string $objectId = '', array $metadata = [], ?string $ip = null, ?string $userAgent = null): void
    {
        // Redact sensitive keys defensively (defense in depth).
        $safe = $this->redact($metadata);
        $stmt = $this->pdo()->prepare('INSERT INTO audit_logs (user_id, action, object_type, object_id, ip, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $userId,
            $action,
            $objectType,
            $objectId,
            (string) ($ip ?? ''),
            (string) ($userAgent ?? ''),
            json_encode($safe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            $this->now(),
        ]);
    }

    private function redact(array $metadata): array
    {
        $blocked = ['password', 'secret', 'key', 'token', 'card', 'code', 'private_key', 'appkey', 'ciphertext'];
        foreach ($metadata as $k => $v) {
            if (is_array($v)) {
                $metadata[$k] = $this->redact($v);
                continue;
            }
            if (!is_scalar($v) && $v !== null) {
                $metadata[$k] = '[complex]';
                continue;
            }
            $lower = strtolower((string) $k);
            foreach ($blocked as $b) {
                if (str_contains($lower, $b)) {
                    $metadata[$k] = '[redacted]';
                    break;
                }
            }
        }
        return $metadata;
    }

    public function list(array $filters = [], int $page = 1, int $perPage = 30): array
    {
        $where = [];
        $params = [];
        if (!empty($filters['action'])) {
            $where[] = 'action = ?';
            $params[] = $filters['action'];
        }
        if (!empty($filters['user_id'])) {
            $where[] = 'user_id = ?';
            $params[] = (int) $filters['user_id'];
        }
        if (!empty($filters['object_type'])) {
            $where[] = 'object_type = ?';
            $params[] = $filters['object_type'];
        }
        if (!empty($filters['q'])) {
            $where[] = '(object_id LIKE ? OR ip LIKE ?)';
            $like = '%' . $filters['q'] . '%';
            $params[] = $like;
            $params[] = $like;
        }
        if (!empty($filters['from'])) {
            $where[] = 'created_at >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'created_at <= ?';
            $params[] = $filters['to'];
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM audit_logs ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();
        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT al.*, u.username FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ' . $whereSql . ' ORDER BY al.id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function distinctActions(): array
    {
        $rows = $this->pdo()->query('SELECT DISTINCT action FROM audit_logs ORDER BY action')->fetchAll();
        return array_column($rows, 'action');
    }
}
