-- 002_social_identities.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS social_identities (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    provider VARCHAR(16) NOT NULL,
    social_uid VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    CONSTRAINT uq_social_provider_uid UNIQUE (provider, social_uid)
);

CREATE INDEX IF NOT EXISTS idx_social_user ON social_identities (user_id);
