import { describe, expect, it } from 'vitest';
import { centsFromDecimal } from '../src/index.js';
import { createSqliteDatabase } from '../../db/src/index.js';
import { applyMigrations, migrationFiles, migrationVersion } from '../../db/src/migrations.js';
import { SqliteCatalogRepository } from '../../db/src/catalog.js';

describe('catalog and stock reservation vertical slice', () => {
  it('lists typed products with integer-cent prices', async () => {
    const db = createSqliteDatabase(':memory:');
    await applyMigrations({ exec: async (sql) => { if (sql.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) { await db.query('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, filename TEXT NOT NULL)'); return; } if (sql.startsWith('INSERT INTO schema_migrations')) return; await db.query(sql); } }, [{ version: 17, filename: '017_catalog_stock_reservations.sql', sql: `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents >= 0), status TEXT NOT NULL DEFAULT 'draft')` }, { version: 18, filename: '018_inventory_baseline.sql', sql: `CREATE TABLE inventory_cards (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'available', reserved_order_id INTEGER, reserved_until TEXT)` }, { version: 19, filename: '019_inventory_index.sql', sql: `CREATE INDEX idx_inventory_product_status ON inventory_cards(product_id,status)` }]);
    const catalog = new SqliteCatalogRepository(db);
    const id = await catalog.createProduct({ name: 'Credits', slug: 'credits', description: '', priceCents: centsFromDecimal('3.50'), status: 'active' });
    expect(await catalog.getProduct(id)).toMatchObject({ name: 'Credits', priceCents: 350, status: 'active' });
    await db.close();
  });

  it('reserves stock atomically without exceeding available quantity', async () => {
    const db = createSqliteDatabase(':memory:');
    await db.query('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT \'\', price_cents INTEGER NOT NULL CHECK(price_cents >= 0), status TEXT NOT NULL DEFAULT \'draft\')');
    await db.query('CREATE TABLE inventory_cards (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT \'available\', reserved_order_id INTEGER, reserved_until TEXT)');
    const catalog = new SqliteCatalogRepository(db);
    const id = await catalog.createProduct({ name: 'Credits', slug: 'credits', priceCents: 350, status: 'active' });
    for (let i = 0; i < 2; i++) await db.query('INSERT INTO inventory_cards(product_id,status) VALUES (?,?)', [id, 'available']);
    expect(await catalog.reserveStock(id, 41, 2, '2030-01-01T00:00:00Z')).toBe(2);
    expect(await catalog.reserveStock(id, 42, 1, '2030-01-01T00:00:00Z')).toBe(0);
    expect(await db.query<{ id: number }>('SELECT id FROM inventory_cards WHERE status = \'reserved\' AND reserved_order_id = ?', [41])).toMatchObject({ rowCount: 0 });
    expect((await db.query<{ id: number }>('SELECT id FROM inventory_cards WHERE status = \'reserved\' AND reserved_order_id = ?', [41])).rows).toHaveLength(2);
    await db.close();
  });

  it('registers the next ordered migration identifier', () => {
    expect(migrationFiles('sqlite')).toHaveLength(17);
    expect(migrationVersion('pgsql', '017_catalog_stock_reservations.sql')).toBe(17);
  });
});
