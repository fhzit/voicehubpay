export type DatabaseDialect = 'sqlite' | 'pgsql';
export interface SqlExecutor {
  exec(sql: string): void | Promise<void>;
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface Migration { readonly version: number; readonly filename: string }

const migrationNames = [
  'users', 'social_identities', 'categories', 'products', 'inventory_cards', 'orders',
  'order_items', 'fulfillment_units', 'voicehub_deliveries', 'payment_transactions',
  'afdian_orders', 'audit_logs', 'analytics_daily', 'auth_throttle',
  'afdian_add_buyer_name', 'afdian_add_remark', 'catalog_stock_reservations',
] as const;

/** List the existing dual-SQL baseline; does not imply legacy data migration. */
export const migrationFiles = (_dialect: DatabaseDialect): string[] =>
  migrationNames.map((name, index) => `${String(index + 1).padStart(3, '0')}_${name}.sql`);

export function migrationVersion(_dialect: DatabaseDialect, filename: string): number {
  const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(filename);
  if (!match) throw new RangeError(`Invalid migration filename: ${filename}`);
  const version = Number(match[1]);
  if (migrationFiles('sqlite')[version - 1] !== filename) throw new RangeError(`Unknown migration: ${filename}`);
  return version;
}

/** Apply caller-loaded SQL, recording a version only after its SQL succeeds. */
export async function applyMigrations(
  db: SqlExecutor,
  migrations: readonly (Migration & { readonly sql: string })[],
): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, filename TEXT NOT NULL)');
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) throw new RangeError('Invalid migration version');
    const existing = await db.query(`SELECT version FROM schema_migrations WHERE version = ${migration.version}`);
    if (existing.rows.length > 0) continue;
    await db.exec(migration.sql);
    await db.exec(`INSERT INTO schema_migrations (version, filename) VALUES (${migration.version}, '${migration.filename.replaceAll("'", "''")}')`);
  }
}
