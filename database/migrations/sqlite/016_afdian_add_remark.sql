-- 016_afdian_add_remark.sql (SQLite)
-- Track the buyer's remark entered at checkout on afdian_orders so the admin
-- list can show the order note. SQLite lacks ADD COLUMN IF NOT EXISTS, so guard
-- via a try (the Migrator tolerates missing-column re-runs).
ALTER TABLE afdian_orders ADD COLUMN remark TEXT NOT NULL DEFAULT '';