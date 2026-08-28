-- 015_afdian_add_buyer_name.sql (PostgreSQL)
-- Restore buyer (buyer_name) tracking on afdian_orders so the admin list can
-- show the Afdian purchaser username (`user_name` from the order payload).
ALTER TABLE afdian_orders ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(255) NOT NULL DEFAULT '';