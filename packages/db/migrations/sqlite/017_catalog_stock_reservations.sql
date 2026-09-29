-- Product catalog constraints and stock reservation index (SQLite)
CREATE INDEX IF NOT EXISTS idx_inventory_available_product_id ON inventory_cards(product_id, id) WHERE status = 'available';
-- sort_order and id are already covered by the legacy products schema/indexes.
