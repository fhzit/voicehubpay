-- 013_analytics_daily.sql (PostgreSQL)
CREATE TABLE IF NOT EXISTS analytics_daily (
    id BIGSERIAL PRIMARY KEY,
    date VARCHAR(10) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    revenue_cents INTEGER NOT NULL DEFAULT 0,
    paid_orders INTEGER NOT NULL DEFAULT 0,
    sold_units INTEGER NOT NULL DEFAULT 0,
    fulfilled_units INTEGER NOT NULL DEFAULT 0,
    failed_units INTEGER NOT NULL DEFAULT 0,
    voicehub_success INTEGER NOT NULL DEFAULT 0,
    voicehub_failed INTEGER NOT NULL DEFAULT 0,
    manual_completed INTEGER NOT NULL DEFAULT 0,
    new_users INTEGER NOT NULL DEFAULT 0,
    updated_at VARCHAR(64) NOT NULL DEFAULT '',
    CONSTRAINT uq_analytics_date_channel UNIQUE (date, channel)
);

CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily (date);
