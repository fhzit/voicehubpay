/**
 * Legacy schema bootstrap for tables the incremental repositories do not create.
 *
 * `migrateAuthSchema()` (auth-legacy) and `migrateShopSchema()` (shop-legacy)
 * only create the tables their own repositories touch. The PHP build also
 * ships `social_identities`, `audit_logs` and `analytics_daily` — the account
 * pages read the first one on every request, and the admin audit/analytics
 * screens read the others. Without them `/account` 500s with
 * `no such table: social_identities` as soon as a user is logged in.
 *
 * Each statement is `IF NOT EXISTS`, so running this on an existing deployment
 * is a no-op.
 */

import type { Database } from "../../../packages/db/src/index.js";

function dialectSql(dialect: "sqlite" | "pgsql"): string[] {
  const pk = dialect === "pgsql" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const ts = dialect === "pgsql" ? "TIMESTAMPTZ" : "TEXT";
  return [
    `CREATE TABLE IF NOT EXISTS social_identities (
      id ${pk},
      user_id BIGINT NOT NULL,
      provider VARCHAR(16) NOT NULL,
      social_uid VARCHAR(128) NOT NULL,
      nickname VARCHAR(128) NOT NULL DEFAULT '',
      avatar_url VARCHAR(512) NOT NULL DEFAULT '',
      created_at ${ts} NOT NULL,
      updated_at ${ts} NOT NULL,
      UNIQUE (provider, social_uid)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_social_user ON social_identities (user_id)`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id ${pk},
      user_id BIGINT NULL,
      action VARCHAR(64) NOT NULL,
      object_type VARCHAR(32) NOT NULL DEFAULT '',
      object_id VARCHAR(128) NOT NULL DEFAULT '',
      ip VARCHAR(64) NOT NULL DEFAULT '',
      user_agent VARCHAR(512) NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at ${ts} NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_logs (object_type, object_id)`,
    `CREATE TABLE IF NOT EXISTS analytics_daily (
      id ${pk},
      date ${dialect === "pgsql" ? "DATE" : "TEXT"} NOT NULL,
      channel VARCHAR(16) NOT NULL,
      revenue_cents BIGINT NOT NULL DEFAULT 0,
      paid_orders BIGINT NOT NULL DEFAULT 0,
      sold_units BIGINT NOT NULL DEFAULT 0,
      fulfilled_units BIGINT NOT NULL DEFAULT 0,
      failed_units BIGINT NOT NULL DEFAULT 0,
      voicehub_success BIGINT NOT NULL DEFAULT 0,
      voicehub_failed BIGINT NOT NULL DEFAULT 0,
      manual_completed BIGINT NOT NULL DEFAULT 0,
      new_users BIGINT NOT NULL DEFAULT 0,
      updated_at ${ts} NOT NULL DEFAULT ${dialect === "pgsql" ? "now()" : "''"},
      UNIQUE (date, channel)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily (date)`,
  ];
}

/** Create the PHP-parity tables that the incremental schemas miss. */
export async function ensureLegacySchema(db: Database): Promise<void> {
  for (const statement of dialectSql(db.dialect)) {
    await db.query(statement);
  }
}
