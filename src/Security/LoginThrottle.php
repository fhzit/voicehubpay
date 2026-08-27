<?php

declare(strict_types=1);

namespace VoiceHubPay\Security;

use PDO;

/**
 * Lightweight login rate limiting (per username + per IP), persisted in the
 * main database. Prevents password brute-force.
 */
final class LoginThrottle
{
    private const MAX_ATTEMPTS = 5;
    private const WINDOW_SECONDS = 900; // 15 min
    private const LOCK_SECONDS = 900;

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensureTable(): void
    {
        $driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $sql = $driver === 'pgsql'
            ? 'CREATE TABLE IF NOT EXISTS auth_throttle (throttle_key VARCHAR(191) PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start BIGINT NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0, updated_at VARCHAR(64) NOT NULL)'
            : 'CREATE TABLE IF NOT EXISTS auth_throttle (throttle_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)';
        $this->pdo->exec($sql);
    }

    public function isLocked(string $key): bool
    {
        $this->ensureTable();
        $stmt = $this->pdo->prepare('SELECT locked_until FROM auth_throttle WHERE throttle_key = ?');
        $stmt->execute([$key]);
        $until = (int) $stmt->fetchColumn();
        return $until > time();
    }

    public function recordFailure(string $key): void
    {
        $this->ensureTable();
        $now = time();
        $stmt = $this->pdo->prepare('SELECT attempts, window_start, locked_until FROM auth_throttle WHERE throttle_key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        $attempts = 1;
        $windowStart = $now;
        if ($row) {
            $attempts = (int) $row['attempts'] + 1;
            $windowStart = ((int) $row['window_start'] > 0) ? (int) $row['window_start'] : $now;
            if ($now - $windowStart > self::WINDOW_SECONDS) {
                $attempts = 1;
                $windowStart = $now;
            }
        }
        $lockedUntil = $attempts >= self::MAX_ATTEMPTS ? $now + self::LOCK_SECONDS : 0;
        $upsert = $this->pdo->prepare('INSERT INTO auth_throttle (throttle_key, attempts, window_start, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(throttle_key) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, locked_until = excluded.locked_until, updated_at = excluded.updated_at');
        $upsert->execute([$key, $attempts, $windowStart, $lockedUntil, gmdate('c')]);
    }

    public function clear(string $key): void
    {
        $this->ensureTable();
        $stmt = $this->pdo->prepare('DELETE FROM auth_throttle WHERE throttle_key = ?');
        $stmt->execute([$key]);
    }

    public function remaining(string $key): int
    {
        $this->ensureTable();
        $stmt = $this->pdo->prepare('SELECT attempts FROM auth_throttle WHERE throttle_key = ?');
        $stmt->execute([$key]);
        $attempts = (int) $stmt->fetchColumn();
        return max(0, self::MAX_ATTEMPTS - $attempts);
    }
}
