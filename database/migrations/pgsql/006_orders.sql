-- 006_orders.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'shop',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    order_status VARCHAR(24) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    payment_gateway VARCHAR(16) NOT NULL DEFAULT '',
    payment_confirmation_source VARCHAR(16) NOT NULL DEFAULT '',
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    expires_at VARCHAR(64) NULL,
    paid_at VARCHAR(64) NULL,
    fulfilled_at VARCHAR(64) NULL,
    cancelled_at VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
