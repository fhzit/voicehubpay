/**
 * Schema bootstrap for the tables the admin panel reads that the shop/auth
 * migrations do not create yet (`categories`, `audit_logs`).
 *
 * Idempotent and dialect-aware; `index.ts` should call it once at boot next to
 * `migrateShopSchema`.
 */

import type { AdminDatabasePort } from "./types.js";

export async function ensureAdminSchema(db: AdminDatabasePort): Promise<void> {
  const pg = db.dialect === "pgsql";
  const pk = pg ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const fk = pg ? "BIGINT" : "INTEGER";
  const ts = "VARCHAR(64)";

  await db.query(`CREATE TABLE IF NOT EXISTS categories (
    id ${pk},
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at ${ts} NOT NULL,
    updated_at ${ts} NOT NULL)`);

  await db.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id ${pk},
    user_id ${fk} NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(128) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at ${ts} NOT NULL)`);

  await db.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_categories_status ON categories (status)");
}
