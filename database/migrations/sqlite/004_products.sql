-- 004_products.sql (SQLite)
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NULL,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    cover_image VARCHAR(512) NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_enabled INTEGER NOT NULL DEFAULT 0,
    voicehub_code_source VARCHAR(32) NOT NULL DEFAULT 'inventory',
    stock_enabled INTEGER NOT NULL DEFAULT 1,
    min_quantity INTEGER NOT NULL DEFAULT 1,
    max_quantity INTEGER NOT NULL DEFAULT 99,
    quantity_step INTEGER NOT NULL DEFAULT 1,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products (status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_sort ON products (sort_order);
