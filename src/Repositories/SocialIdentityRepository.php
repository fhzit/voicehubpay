<?php

declare(strict_types=1);

namespace VoiceHubPay\Repositories;

final class SocialIdentityRepository extends Repository
{
    public function findByIdentity(string $provider, string $socialUid): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM social_identities WHERE provider = ? AND social_uid = ? LIMIT 1');
        $stmt->execute([$provider, $socialUid]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function listForUser(int $userId): array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM social_identities WHERE user_id = ? ORDER BY provider');
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    public function getProvider(int $userId, string $provider): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM social_identities WHERE user_id = ? AND provider = ? LIMIT 1');
        $stmt->execute([$userId, $provider]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Bind a social identity to a user. Returns the identity row.
     */
    public function bind(int $userId, string $provider, string $socialUid, string $nickname = '', string $avatarUrl = ''): array
    {
        $now = $this->now();
        $stmt = $this->pdo()->prepare('INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $provider, $socialUid, $nickname, $avatarUrl, $now, $now]);
        $id = (int) $this->pdo()->lastInsertId();
        $found = $this->findById($id);
        if (!$found) {
            $stmt2 = $this->pdo()->prepare('SELECT * FROM social_identities WHERE id = ?');
            $stmt2->execute([$id]);
            $found = $stmt2->fetch();
        }
        return $found;
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT * FROM social_identities WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function unbind(int $userId, string $provider): bool
    {
        $stmt = $this->pdo()->prepare('DELETE FROM social_identities WHERE user_id = ? AND provider = ?');
        $stmt->execute([$userId, $provider]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Count a user's total login methods (password present counts as one).
     */
    public function loginMethodCount(array $user): int
    {
        $count = 0;
        if (!empty($user['password_hash'])) {
            $count++;
        }
        $count += count($this->listForUser((int) $user['id']));
        return $count;
    }
}
