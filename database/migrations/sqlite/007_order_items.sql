-- 007_order_items.sql (SQLite)
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name_snapshot VARCHAR(128) NOT NULL,
    product_price_cents_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_mode_snapshot VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_code_source_snapshot VARCHAR(32) NOT NULL DEFAULT 'inventory',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
