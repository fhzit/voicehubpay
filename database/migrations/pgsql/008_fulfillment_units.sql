-- 008_fulfillment_units.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS fulfillment_units (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL,
    order_item_id BIGINT NOT NULL,
    unit_index INTEGER NOT NULL DEFAULT 1,
    unit_no VARCHAR(96) NOT NULL,
    inventory_card_id BIGINT NULL,
    delivery_code_ciphertext TEXT NULL,
    delivery_code_hash VARCHAR(128) NULL,
    voicehub_code_ciphertext TEXT NULL,
    voicehub_code_hash VARCHAR(128) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    voicehub_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    manual_note TEXT NULL,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    fulfilled_at VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_units_order ON fulfillment_units (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_order_index ON fulfillment_units (order_id, unit_index);
CREATE INDEX IF NOT EXISTS idx_units_status ON fulfillment_units (status);
CREATE INDEX IF NOT EXISTS idx_units_voicehub_status ON fulfillment_units (voicehub_status);
