-- 014_auth_throttle.sql (SQLite)
CREATE TABLE IF NOT EXISTS auth_throttle (
    throttle_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT ''
);
