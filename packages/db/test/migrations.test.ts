import { describe, expect, it } from 'vitest';
import { applyMigrations, migrationFiles, migrationVersion } from '../src/migrations.js';
import { createSqliteDatabase } from '../src/index.js';

describe('migration baseline inventory', () => {
  it('executes multi-statement SQLite migrations and records them idempotently', async () => {
    const db = createSqliteDatabase(':memory:');
    const migration = { version: 1, filename: '001_test.sql', sql: 'CREATE TABLE first (id INTEGER); CREATE TABLE second (id INTEGER);' };
    const executor = { exec: (sql: string) => db.query(sql).then(() => undefined), query: (sql: string) => db.query(sql) };
    await applyMigrations(executor, [migration]);
    await applyMigrations(executor, [migration]);
    expect((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map((row) => row.name)).toContain('second');
    expect((await db.query('SELECT * FROM schema_migrations')).rows).toHaveLength(1);
    await db.close();
  });
  it('exposes ordered SQLite/Postgres baseline identifiers', () => {
    expect(migrationFiles('sqlite')).toHaveLength(17);
    expect(migrationFiles('pgsql')).toEqual(migrationFiles('sqlite'));
    expect(migrationVersion('pgsql', '016_afdian_add_remark.sql')).toBe(16);
    expect(migrationVersion('pgsql', '017_catalog_stock_reservations.sql')).toBe(17);
  });
});
