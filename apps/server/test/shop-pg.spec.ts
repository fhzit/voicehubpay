import { describe, expect, it } from 'vitest';
import { ShopService } from '../src/shop-legacy/shop-service.js';
import { createShopLegacyDependencies, EnvShopConfig, migrateShopSchema } from '../src/shop-legacy/index.js';
import type { Database, QueryResult } from '../../../packages/db/src/index.js';

/**
 * Dialect-conformance test: run the shop wiring against a mock pgsql Database
 * and assert no SQLite-only SQL (last_insert_rowid, AUTOINCREMENT DDL) leaks
 * into pg queries, and that INSERTs use RETURNING id.
 */
type Call = { sql: string; parameters: readonly unknown[] };

function mockPg() {
  const calls: Call[] = [];
  let nextId = 100;
  let orderNoSeen = false;
  const db: Database = {
    dialect: 'pgsql',
    async query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
      calls.push({ sql, parameters });
      if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('INSERT') && sql.includes('RETURNING id')) return { rows: [{ id: nextId++ }] as unknown as Row[], rowCount: 1 };
      if (sql.startsWith('INSERT')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM products WHERE id = ?') && !sql.includes('inventory')) return { rows: [{ id: 1, name: 'P', slug: 'p', status: 'active', price_cents: 2500, delivery_mode: 'card', voicehub_enabled: 0, stock_enabled: 0, min_quantity: 1, max_quantity: 99, quantity_step: 1 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM orders WHERE order_no')) {
        if (orderNoSeen) return { rows: [{ id: 100, order_no: '202510091333200000000001', user_id: 7, amount_due_cents: 2500, items: [], units: [] }] as unknown as Row[], rowCount: 1 };
        orderNoSeen = true;
        return { rows: [] as unknown as Row[], rowCount: 0 };
      }
      if (sql.includes('FROM orders WHERE id')) return { rows: [{ id: 100, order_no: '202510091333200000000001', user_id: 7, amount_due_cents: 2500 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM inventory_cards') && sql.includes('LIMIT')) return { rows: [{ id: 55 }] as unknown as Row[], rowCount: 1 };
      if (sql.includes('FROM inventory_cards')) return { rows: [{ secret_ciphertext: 'PLAIN-CARD', secret_hash: 'h', status: 'reserved' }] as unknown as Row[], rowCount: 1 };
      return { rows: [] as unknown as Row[], rowCount: 0 };
    },
    async transaction<T>(work: (tx: Database) => Promise<T>) { return work(db); },
    async close() {},
  };
  return { db, calls };
}

describe('shop wiring on PostgreSQL dialect', () => {
  it('migrateShopSchema emits pg DDL (BIGSERIAL, no AUTOINCREMENT)', async () => {
    const { db, calls } = mockPg();
    await migrateShopSchema(db);
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.some(c => c.sql.includes('BIGSERIAL PRIMARY KEY'))).toBe(true);
    expect(calls.some(c => c.sql.includes('AUTOINCREMENT'))).toBe(false);
    expect(calls.some(c => c.sql.includes('BIGINT'))).toBe(true);
  });

  it('createOrder issues RETURNING id inserts, never last_insert_rowid', async () => {
    const { db, calls } = mockPg();
    await migrateShopSchema(db);
    const deps = createShopLegacyDependencies(db, new EnvShopConfig({ ORDER_TTL_MINUTES: '30' }), { basePath: '/tmp/shop-pg-test' });
    const shop = new ShopService({ ...deps, clock: { now: () => Math.floor(new Date('2025-10-09T13:33:20Z').getTime() / 1000) } });
    const order = await shop.createOrder(7, 1, 1);
    expect(String(order['order_no'])).toMatch(/^\d{24}$/);
    expect(order['amount_due_cents']).toBe(2500);
    expect(calls.some(c => c.sql.includes('last_insert_rowid'))).toBe(false);
    expect(calls.some(c => c.sql.startsWith('INSERT INTO orders') && c.sql.includes('RETURNING id'))).toBe(true);
    expect(calls.some(c => c.sql.includes('AUTOINCREMENT'))).toBe(false);
  });
});
