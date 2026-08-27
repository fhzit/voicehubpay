-- 014_auth_throttle.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS auth_throttle (
    throttle_key VARCHAR(191) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start BIGINT NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    updated_at VARCHAR(64) NOT NULL DEFAULT ''
);
