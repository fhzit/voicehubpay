<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class CategoryRepository extends Repository
{
    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM categories WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findBySlug(string $slug): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM categories WHERE slug = ?');
        $stmt->execute([$slug]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function listActive(): array
    {
        return $this->pdo()->query("SELECT * FROM categories WHERE status = 'active' ORDER BY sort_order ASC, id ASC")->fetchAll();
    }

    public function listAll(): array
    {
        return $this->pdo()->query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.sort_order ASC, c.id ASC')->fetchAll();
    }

    public function create(string $name, string $slug, int $sortOrder = 0, string $status = 'active'): array
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO categories (name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$name, $slug, $status, $sortOrder, $now, $now]);
        return $this->findById((int) $this->pdo()->lastInsertId());
    }

    public function update(int $id, array $fields): void
    {
        $allowed = ['name', 'slug', 'status', 'sort_order'];
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
        $stmt = $this->pdo()->prepare('UPDATE categories SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    }

    public function setStatus(int $id, string $status): void
    {
        $this->update($id, ['status' => $status]);
    }

    public function delete(int $id): bool
    {
        // Only allow deletion when no products reference the category.
        $stmt = $this->pdo()->prepare('SELECT COUNT(*) FROM products WHERE category_id = ?');
        $stmt->execute([$id]);
        if ((int) $stmt->fetchColumn() > 0) {
            return false;
        }
        $stmt = $this->pdo()->prepare('DELETE FROM categories WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function uniqueSlug(string $name, ?int $ignoreId = null): string
    {
        $base = strtolower(trim((string) preg_replace('/[^a-zA-Z0-9\-]+/', '-', $name), '-'));
        if ($base === '') {
            $base = 'cat-' . substr(bin2hex(random_bytes(4)), 0, 8);
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
        $stmt = $this->pdo()->prepare('SELECT id FROM categories WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1');
        $stmt->execute([$slug, $ignoreId, $ignoreId]);
        return $stmt->fetchColumn() !== false;
    }
}
