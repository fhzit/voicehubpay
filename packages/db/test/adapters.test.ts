import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresDatabase, createSqliteDatabase, type Database } from '../src/index.js';

const databases: Database[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.close())); });

describe('concrete adapters', () => {
  it('executes SQLite queries with positional placeholders and returns rows/counts', async () => {
    const db = createSqliteDatabase(':memory:'); databases.push(db);
    await db.query('CREATE TABLE sample (value TEXT)');
    const inserted = await db.query('INSERT INTO sample VALUES (?)', ['hello']);
    expect(inserted.rowCount).toBe(1);
    expect((await db.query<{ value: string }>('SELECT value FROM sample WHERE value = ?', ['hello'])).rows).toEqual([{ value: 'hello' }]);
  });

  it('commits transactions and rolls back failures in SQLite', async () => {
    const db = createSqliteDatabase(':memory:'); databases.push(db);
    await db.query('CREATE TABLE sample (value TEXT)');
    await db.transaction(async (tx) => { await tx.query('INSERT INTO sample VALUES (?)', ['committed']); });
    await expect(db.transaction(async (tx) => { await tx.query('INSERT INTO sample VALUES (?)', ['rolled back']); throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await db.query<{ value: string }>('SELECT value FROM sample')).rows).toEqual([{ value: 'committed' }]);
  });

  it('translates portable question-mark parameters to PostgreSQL numbered parameters', async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const client = { query: async (sql: string, values?: readonly unknown[]) => { calls.push({ sql, values }); return { rows: [{ value: 'ok' }], rowCount: 1 }; }, release() {} };
    const pool = { connect: async () => client, query: client.query, end: async () => {} };
    const db = createPostgresDatabase(pool as never); databases.push(db);
    const result = await db.query<{ value: string }>("SELECT '?' AS literal, value FROM sample WHERE id = ? AND name = ?", [7, 'x']);
    expect(calls[0]).toEqual({ sql: "SELECT '?' AS literal, value FROM sample WHERE id = $1 AND name = $2", values: [7, 'x'] });
    expect(result).toEqual({ rows: [{ value: 'ok' }], rowCount: 1 });
  });
});
