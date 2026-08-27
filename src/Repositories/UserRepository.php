<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

use VoiceHubPay\Security\PasswordHasher;

final class UserRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByUsername(string $username): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findByEmail(string $email): ?array
    {
        if ($email === '') {
            return null;
        }
        $stmt = $this->pdo()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Create a user; returns the new user row.
     */
    public function create(array $data): array
    {
        $now = $this->now();
        $username = (string) ($data['username'] ?? '');
        if ($username === '') {
            throw new \InvalidArgumentException('username is required');
        }
        $passwordHash = isset($data['password']) && $data['password'] !== ''
            ? PasswordHasher::hash((string) $data['password'])
            : null;
        $stmt = $this->pdo()->prepare('INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $username,
            $passwordHash,
            (string) ($data['display_name'] ?? ''),
            (string) ($data['avatar_url'] ?? ''),
            (string) ($data['email'] ?? ''),
            (string) ($data['role'] ?? 'user'),
            (string) ($data['status'] ?? 'active'),
            $now,
            $now,
        ]);
        $id = (int) $this->pdo()->lastInsertId();
        return $this->findById($id);
    }

    public function update(int $id, array $fields): void
    {
        $allowed = ['username', 'password_hash', 'display_name', 'avatar_url', 'email', 'role', 'status', 'last_login_at'];
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
        $stmt = $this->pdo()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function setPassword(int $id, string $password): void
    {
        $this->update($id, ['password_hash' => PasswordHasher::hash($password)]);
    }

    public function touchLastLogin(int $id): void
    {
        $this->update($id, ['last_login_at' => $this->now()]);
    }

    public function countUsers(): int
    {
        return (int) $this->pdo()->query('SELECT COUNT(*) FROM users')->fetchColumn();
    }

    /**
     * Search users (admin list). Supports optional q + pagination.
     */
    public function search(string $q = '', string $status = '', int $page = 1, int $perPage = 20): array
    {
        $where = [];
        $params = [];
        if ($q !== '') {
            $where[] = '(username LIKE ? OR display_name LIKE ? OR email LIKE ?)';
            $like = '%' . $q . '%';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }
        if ($status !== '') {
            $where[] = 'status = ?';
            $params[] = $status;
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $countStmt = $this->pdo()->prepare('SELECT COUNT(*) FROM users ' . $whereSql);
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = max(0, ($page - 1) * $perPage);
        $sql = 'SELECT * FROM users ' . $whereSql . ' ORDER BY id DESC LIMIT ' . (int) $perPage . ' OFFSET ' . (int) $offset;
        $stmt = $this->pdo()->prepare($sql);
        $stmt->execute($params);
        return ['items' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'perPage' => $perPage];
    }

    public function setStatus(int $id, string $status): void
    {
        $this->update($id, ['status' => $status]);
    }

    /**
     * Generate a guaranteed-unique username (used for social logins).
     */
    public function uniqueUsername(string $prefix, string $seed): string
    {
        $base = $prefix . substr(preg_replace('/[^a-zA-Z0-9_]/', '', $seed) ?: '', 0, 24);
        $candidate = $base;
        $i = 1;
        while ($this->findByUsername($candidate) !== null) {
            $candidate = $base . '_' . $i;
            $i++;
            if ($i > 100) {
                $candidate = $prefix . '_' . bin2hex(random_bytes(6));
            }
        }
        return $candidate;
    }
}
