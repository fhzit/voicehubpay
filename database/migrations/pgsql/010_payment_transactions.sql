-- 010_payment_transactions.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL,
    gateway VARCHAR(16) NOT NULL DEFAULT 'sg65',
    merchant_order_no VARCHAR(96) NOT NULL,
    gateway_trade_no VARCHAR(128) NULL,
    api_trade_no VARCHAR(128) NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    pay_type VARCHAR(16) NULL,
    pay_url TEXT NULL,
    confirmation_source VARCHAR(16) NOT NULL DEFAULT 'callback',
    raw_notify_payload TEXT NULL,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    paid_at VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_pt_order ON payment_transactions (order_id);
CREATE INDEX IF NOT EXISTS idx_pt_merchant ON payment_transactions (merchant_order_no);
CREATE INDEX IF NOT EXISTS idx_pt_trade ON payment_transactions (gateway_trade_no);
