-- 002_social_identities.sql (SQLite)
CREATE TABLE IF NOT EXISTS social_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider VARCHAR(16) NOT NULL,
    social_uid VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, social_uid)
);

CREATE INDEX IF NOT EXISTS idx_social_user ON social_identities (user_id);
