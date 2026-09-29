import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  it('executes migration DDL once and checks versions through the portable query path', async () => {
    const db = createSqliteDatabase(':memory:');
    let calls = 0;
    const executor = {
      exec: async (sql: string) => { calls++; if (sql.includes(';')) db.query(sql); else await db.query(sql); },
      query: (sql: string) => db.query<{ version: number }>(sql),
    };
    const migration = { version: 1, filename: '001_test.sql', sql: 'CREATE TABLE safe (id INTEGER)' };
    await applyMigrations(executor, [migration]);
    const callsAfterFirst = calls;
    await applyMigrations(executor, [migration]);
    expect(calls).toBe(callsAfterFirst + 1); // only CREATE TABLE IF NOT EXISTS tracker
    expect((await db.query('SELECT * FROM schema_migrations')).rows).toHaveLength(1);
    await db.close();
  });
  it('executes the complete checked-in SQLite baseline against the legacy schema and tolerates a repeat run', async () => {
    const db = createSqliteDatabase(':memory:');
    const executor = {
      exec: async (sql: string) => {
        if (sql.includes(';')) {
        const statements = sql.split(';').map((part) => part.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim()).filter(Boolean);
        for (const statement of statements) await db.query(statement);
        } else await db.query(sql);
      },
      query: (sql: string) => db.query<{ version: number }>(sql),
    };
    const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
    const baseline = migrationFiles('sqlite').slice(0, 16);
    const migrations = await Promise.all(baseline.map(async (filename, index) => ({
      version: index + 1,
      filename,
      sql: await readFile(resolve(root, 'database/migrations/sqlite', filename), 'utf8'),
    })));
    migrations.push({ version: 17, filename: '017_catalog_stock_reservations.sql', sql: await readFile(resolve(root, 'packages/db/migrations/sqlite/017_catalog_stock_reservations.sql'), 'utf8') });
    try {
      await applyMigrations(executor, migrations);
      await applyMigrations(executor, migrations);
      const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(versions.rows.map((row) => row.version)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
      expect((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((row) => row.name)).toContain('inventory_cards');
      expect((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).rows.map((row) => row.name)).toContain('idx_inventory_available_product_id');
    } finally { await db.close(); }
  });
  it('executes the complete checked-in PostgreSQL baseline against the legacy schema and repeats safely', async () => {
    const db = createSqliteDatabase(':memory:');
    const executor = {
      exec: async (sql: string) => {
        const compatible = sql
          .replace(/BIGSERIAL/g, 'INTEGER')
          .replace(/BIGINT/g, 'INTEGER')
          .replace(/\bBOOLEAN\b/g, 'INTEGER')
          .replace(/\bTRUE\b/g, '1')
          .replace(/ADD COLUMN IF NOT EXISTS/g, 'ADD COLUMN')
          .replace(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g, 'CREATE $1INDEX IF NOT EXISTS');
        const statements = compatible.split(';').map((part) => part.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim()).filter(Boolean);
        for (const statement of statements) await db.query(statement);
      },
      query: (sql: string) => db.query<{ version: number }>(sql),
    };
    const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
    const baseline = migrationFiles('pgsql').slice(0, 16);
    const migrations = await Promise.all(baseline.map(async (filename, index) => ({
      version: index + 1,
      filename,
      sql: await readFile(resolve(root, 'database/migrations/pgsql', filename), 'utf8'),
    })));
    migrations.push({ version: 17, filename: '017_catalog_stock_reservations.sql', sql: await readFile(resolve(root, 'packages/db/migrations/pgsql/017_catalog_stock_reservations.sql'), 'utf8') });
    try {
      await applyMigrations(executor, migrations);
      await applyMigrations(executor, migrations);
      expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM schema_migrations')).rows[0]?.count).toBe(17);
      expect((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).rows.map((row) => row.name)).toContain('idx_inventory_available_product_id');
    } finally { await db.close(); }
  });
  it('exposes ordered SQLite/Postgres baseline identifiers', () => {
    expect(migrationFiles('sqlite')).toHaveLength(17);
    expect(migrationFiles('pgsql')).toEqual(migrationFiles('sqlite'));
    expect(migrationVersion('pgsql', '016_afdian_add_remark.sql')).toBe(16);
    expect(migrationVersion('pgsql', '017_catalog_stock_reservations.sql')).toBe(17);
  });
});
