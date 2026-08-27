-- 005_inventory_cards.sql (SQLite)
CREATE TABLE IF NOT EXISTS inventory_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    secret_hash VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'available',
    reserved_order_id INTEGER NULL,
    reserved_until TEXT NULL,
    sold_order_id INTEGER NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sold_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory_cards (product_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_reserved ON inventory_cards (status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_inventory_hash ON inventory_cards (secret_hash);
