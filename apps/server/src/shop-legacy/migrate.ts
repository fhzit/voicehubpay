import type { Database } from "../../../../packages/db/src/index.js";

/**
 * Create the legacy-schema tables required by the shop/payment module
 * (subset of database/migrations 004,005,006,007,008,010 + the PHP `sessions`
 * table used by SessionManager/Csrf). Idempotent — safe to run against an
 * existing database of either dialect. SQLite uses INTEGER PRIMARY KEY
 * AUTOINCREMENT; PostgreSQL uses BIGSERIAL. Timestamps stay VARCHAR (ISO
 * strings) in both dialects to match the PHP legacy schema.
 */
export async function migrateShopSchema(db: Database): Promise<void> {
  const pg = db.dialect === "pgsql";
  const pk = pg ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const fk = pg ? "BIGINT" : "INTEGER";
  const ts = "VARCHAR(64)";
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id ${pk},
    category_id ${fk} NULL,
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
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS inventory_cards (
    id ${pk},
    product_id ${fk} NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    secret_hash VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'available',
    reserved_order_id ${fk} NULL,
    reserved_until ${ts} NULL,
    sold_order_id ${fk} NULL,
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL,
    sold_at ${ts} NULL)`);
  await db.query("CREATE INDEX IF NOT EXISTS idx_inventory_product_status ON inventory_cards (product_id, status)");
  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    id ${pk},
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id ${fk} NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'shop',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    order_status VARCHAR(24) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    payment_gateway VARCHAR(16) NOT NULL DEFAULT '',
    payment_confirmation_source VARCHAR(16) NOT NULL DEFAULT '',
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL,
    expires_at ${ts} NULL,
    paid_at ${ts} NULL,
    fulfilled_at ${ts} NULL,
    cancelled_at ${ts} NULL)`);
  await db.query("CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id)");
  await db.query(`CREATE TABLE IF NOT EXISTS order_items (
    id ${pk},
    order_id ${fk} NOT NULL,
    product_id ${fk} NOT NULL,
    product_name_snapshot VARCHAR(128) NOT NULL,
    product_price_cents_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_mode_snapshot VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_code_source_snapshot VARCHAR(32) NOT NULL DEFAULT 'inventory',
    created_at ${ts} NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS fulfillment_units (
    id ${pk},
    order_id ${fk} NOT NULL,
    order_item_id ${fk} NOT NULL,
    unit_index INTEGER NOT NULL DEFAULT 1,
    unit_no VARCHAR(96) NOT NULL,
    inventory_card_id ${fk} NULL,
    delivery_code_ciphertext TEXT NULL,
    delivery_code_hash VARCHAR(128) NULL,
    voicehub_code_ciphertext TEXT NULL,
    voicehub_code_hash VARCHAR(128) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    voicehub_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    manual_note TEXT NULL,
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL,
    fulfilled_at ${ts} NULL)`);
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_units_order_index ON fulfillment_units (order_id, unit_index)");
  await db.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id ${pk},
    order_id ${fk} NOT NULL,
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
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL,
    paid_at ${ts} NULL)`);
  await db.query("CREATE INDEX IF NOT EXISTS idx_pt_order ON payment_transactions (order_id)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_pt_merchant ON payment_transactions (merchant_order_no)");
  await db.query(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id ${pk},
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL,
    last_login_at ${ts} NULL)`);
}
