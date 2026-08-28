-- 016_afdian_add_remark.sql (PostgreSQL)
-- Track the buyer's remark entered at checkout on afdian_orders so the admin
-- list can show the order note.
ALTER TABLE afdian_orders ADD COLUMN IF NOT EXISTS remark TEXT NOT NULL DEFAULT '';