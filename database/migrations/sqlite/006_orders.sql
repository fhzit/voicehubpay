-- 006_orders.sql (SQLite)
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'shop',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    order_status VARCHAR(24) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    payment_gateway VARCHAR(16) NOT NULL DEFAULT '',
    payment_confirmation_source VARCHAR(16) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NULL,
    paid_at TEXT NULL,
    fulfilled_at TEXT NULL,
    cancelled_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
