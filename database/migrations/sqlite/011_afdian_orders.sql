-- 011_afdian_orders.sql (SQLite)
-- NOTE: if a legacy afdian_orders table exists, the Migrator renames it to
-- afdian_orders_legacy before this migration runs (see Migrator::prepareLegacy).
CREATE TABLE IF NOT EXISTS afdian_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    out_trade_no VARCHAR(128) NOT NULL UNIQUE,
    trade_no VARCHAR(128) NOT NULL DEFAULT '',
    user_id VARCHAR(128) NOT NULL DEFAULT '',
    plan_id VARCHAR(128) NOT NULL DEFAULT '',
    sku_detail TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(64) NOT NULL DEFAULT 'paid',
    raw_payload TEXT NOT NULL DEFAULT '',
    voicehub_status VARCHAR(64) NOT NULL DEFAULT 'pending',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT NULL,
    processed_at TEXT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_afdian_voicehub_status ON afdian_orders (voicehub_status);
CREATE INDEX IF NOT EXISTS idx_afdian_created ON afdian_orders (created_at);
