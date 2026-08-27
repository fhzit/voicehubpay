-- 005_inventory_cards.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS inventory_cards (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    secret_hash VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'available',
    reserved_order_id BIGINT NULL,
    reserved_until VARCHAR(64) NULL,
    sold_order_id BIGINT NULL,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    sold_at VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory_cards (product_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reserved ON inventory_cards (status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_inventory_hash ON inventory_cards (secret_hash);
