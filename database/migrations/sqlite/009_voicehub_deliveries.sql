-- 009_voicehub_deliveries.sql (SQLite)
CREATE TABLE IF NOT EXISTS voicehub_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type VARCHAR(16) NOT NULL,
    source_id INTEGER NULL,
    source_order_no VARCHAR(96) NOT NULL,
    fulfillment_unit_id INTEGER NULL,
    code_ciphertext TEXT NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    code_source VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    request_payload TEXT NULL,
    response_payload TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    success_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_vhd_status ON voicehub_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_vhd_source ON voicehub_deliveries (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_vhd_unit ON voicehub_deliveries (fulfillment_unit_id);
