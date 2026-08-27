-- 009_voicehub_deliveries.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS voicehub_deliveries (
    id BIGSERIAL PRIMARY KEY,
    source_type VARCHAR(16) NOT NULL,
    source_id BIGINT NULL,
    source_order_no VARCHAR(96) NOT NULL,
    fulfillment_unit_id BIGINT NULL,
    code_ciphertext TEXT NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    code_source VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    request_payload TEXT NULL,
    response_payload TEXT NULL,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    success_at VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_vhd_status ON voicehub_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_vhd_source ON voicehub_deliveries (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_vhd_unit ON voicehub_deliveries (fulfillment_unit_id);
