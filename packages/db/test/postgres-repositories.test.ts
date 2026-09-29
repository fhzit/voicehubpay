import { describe, expect, it } from 'vitest';
import { PostgresCatalogRepository } from '../src/catalog.js';
import { PostgresOrderRepository } from '../src/orders.js';
import type { Database, QueryResult } from '../src/index.js';

type Call = { sql: string; parameters: readonly unknown[] };
function mockDb(handler: (sql: string, parameters: readonly unknown[]) => QueryResult<Record<string, unknown>>) {
  const calls: Call[] = [];
  const db: Database = {
    dialect: 'pgsql',
    async query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) { calls.push({ sql, parameters }); return handler(sql, parameters) as QueryResult<Row>; },
    async transaction<T>(work: (tx: Database) => Promise<T>) { calls.push({ sql: 'BEGIN TX', parameters: [] }); return work(db); },
    async close() {},
  };
  return { db, calls };
}
const ok = (rows: Record<string, unknown>[] = [], rowCount = 1) => ({ rows, rowCount });

describe('Postgres repositories', () => {
  it('supports product create/read/list via RETURNING and maps cents', async () => {
    const { db, calls } = mockDb(sql => sql.startsWith('INSERT') ? ok([{ id: 5 }]) : sql.includes('ORDER BY') ? ok([{ id: 5, name: 'Credits', slug: 'credits', description: '', price_cents: 350, status: 'active' }]) : ok([{ id: 5, name: 'Credits', slug: 'credits', description: '', price_cents: 350, status: 'active' }]));
    const repo = new PostgresCatalogRepository(db);
    expect(await repo.createProduct({ name: 'Credits', slug: 'credits', priceCents: 350, status: 'active' })).toBe(5);
    expect(await repo.getProduct(5)).toMatchObject({ id: 5, priceCents: 350 });
    expect((await repo.listProducts())[0]?.slug).toBe('credits');
    expect(calls[0]?.sql).toContain('RETURNING id');
  });

  it('reserves catalog stock inside a transaction using SKIP LOCKED and atomic update', async () => {
    const { db, calls } = mockDb(sql => sql.includes('SELECT id FROM inventory_cards') ? ok([{ id: 2 }, { id: 3 }]) : ok([], 2));
    expect(await new PostgresCatalogRepository(db).reserveStock(1, 9, 2, '2030')).toBe(2);
    expect(calls[0]?.sql).toBe('BEGIN TX');
    expect(calls[1]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(calls[2]?.sql).toContain('UPDATE inventory_cards');
  });

  it('creates order and reserves stock with row locks, preserving rollback on stock shortage', async () => {
    const { db, calls } = mockDb(sql => {
      if (sql.includes('FROM products')) return ok([{ id: 1, name: 'Credits', price_cents: 350, status: 'active' }]);
      if (sql.includes('FROM inventory_cards')) return ok([{ id: 7 }]);
      if (sql.startsWith('INSERT INTO orders')) return ok([{ id: 11 }]);
      return ok([], 1);
    });
    const order = await new PostgresOrderRepository(db).createOrder({ orderNo: 'o-11', userId: 4, items: [{ productId: 1, quantity: 1 }], reservedUntil: '2030' });
    expect(order.amountDueCents).toBe(350);
    expect(calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
    expect(calls.some(call => call.sql.includes('RETURNING id'))).toBe(true);

    const shortage = mockDb(sql => sql.includes('FROM products') ? ok([{ id: 1, name: 'Credits', price_cents: 350, status: 'active' }]) : sql.includes('FROM inventory_cards') ? ok([]) : sql.startsWith('INSERT INTO orders') ? ok([{ id: 12 }]) : ok([], 1));
    await expect(new PostgresOrderRepository(shortage.db).createOrder({ orderNo: 'o-fail', userId: 4, items: [{ productId: 1, quantity: 1 }], reservedUntil: '2030' })).rejects.toThrow(/stock/i);
    expect(shortage.calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
  });
});
