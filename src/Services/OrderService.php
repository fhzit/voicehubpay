<?php

declare(strict_types=1);

namespace VoiceHubPay\Services;

use PDO;
use VoiceHubPay\Database\Database;

final class OrderService
{
    public function __construct(private readonly Database $db, private readonly VoiceHubService $voiceHub)
    {
    }

    public function upsertAndDispatch(array $order): array
    {
        $stored = $this->upsert($order);
        if (($stored['voicehub_status'] ?? '') === 'created') {
            return $stored;
        }
        return $this->dispatch($stored['order_no']);
    }

    public function upsert(array $order): array
    {
        $pdo = $this->db->pdo();
        $now = gmdate('c');
        $existing = $this->find($order['order_no']);
        $raw = json_encode($order['raw'] ?? $order, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($existing) {
            $stmt = $pdo->prepare('UPDATE afdian_orders SET afdian_user_id = ?, buyer_name = ?, amount = ?, status = ?, raw_payload = ?, updated_at = ? WHERE order_no = ?');
            $stmt->execute([$order['afdian_user_id'], $order['buyer_name'], $order['amount'], $order['status'], $raw, $now, $order['order_no']]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO afdian_orders (order_no, afdian_user_id, buyer_name, amount, status, voicehub_status, raw_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$order['order_no'], $order['afdian_user_id'], $order['buyer_name'], $order['amount'], $order['status'], 'pending', $raw, $now, $now]);
        }

        return $this->find($order['order_no']);
    }

    public function dispatch(string $orderNo): array
    {
        $order = $this->find($orderNo);
        if (!$order) {
            throw new \RuntimeException('Order not found: ' . $orderNo);
        }
        if ($order['voicehub_status'] === 'created') {
            return $order;
        }

        try {
            $raw = json_decode($order['raw_payload'] ?? '[]', true) ?: [];
            $response = $this->voiceHub->createTicket($order + ['raw' => $raw]);
            $this->markVoiceHub($orderNo, 'created', $response, null);
        } catch (\Throwable $exception) {
            $this->markVoiceHub($orderNo, 'failed', null, $exception->getMessage());
        }

        return $this->find($orderNo);
    }

    public function list(int $limit = 50): array
    {
        $stmt = $this->db->pdo()->prepare('SELECT * FROM afdian_orders ORDER BY created_at DESC LIMIT ?');
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function stats(): array
    {
        $rows = $this->db->pdo()->query('SELECT voicehub_status, COUNT(*) AS count FROM afdian_orders GROUP BY voicehub_status')->fetchAll();
        $stats = ['pending' => 0, 'created' => 0, 'failed' => 0];
        foreach ($rows as $row) {
            $stats[$row['voicehub_status']] = (int) $row['count'];
        }
        return $stats;
    }

    public function find(string $orderNo): ?array
    {
        $stmt = $this->db->pdo()->prepare('SELECT * FROM afdian_orders WHERE order_no = ?');
        $stmt->execute([$orderNo]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function markVoiceHub(string $orderNo, string $status, ?array $response, ?string $error): void
    {
        $stmt = $this->db->pdo()->prepare('UPDATE afdian_orders SET voicehub_status = ?, voicehub_response = ?, last_error = ?, updated_at = ? WHERE order_no = ?');
        $stmt->execute([
            $status,
            $response ? json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
            $error,
            gmdate('c'),
            $orderNo,
        ]);
    }
}
