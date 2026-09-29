import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase, type Database } from '../../db/src/index.js';
import { SqliteOrderRepository } from '../../db/src/orders.js';

const dbs: Database[] = [];
afterEach(async () => { await Promise.all(dbs.splice(0).map(db => db.close())); });
async function setup() {
  const db = createSqliteDatabase(':memory:'); dbs.push(db);
  await db.query(`CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active')`);
  await db.query(`CREATE TABLE inventory_cards(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'available', reserved_order_id INTEGER, reserved_until TEXT)`);
  await db.query(`CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, amount_due_cents INTEGER NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY', order_status TEXT NOT NULL DEFAULT 'active', payment_status TEXT NOT NULL DEFAULT 'unpaid', fulfillment_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT)`);
  await db.query(`CREATE TABLE order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name_snapshot TEXT NOT NULL, product_price_cents_snapshot INTEGER NOT NULL, quantity INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  await db.query(`INSERT INTO products VALUES (1,'Credits',350,'active'),(2,'Bonus',125,'active')`);
  return db;
}
describe('order creation', () => {
  it('creates and reserves a multi-product order using server-calculated integer cents', async () => {
    const db = await setup();
    await db.query('INSERT INTO inventory_cards(product_id) VALUES (1),(1),(2)');
    const order = await new SqliteOrderRepository(db).createOrder({ orderNo: 'o-1', userId: 4, items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }], reservedUntil: '2030-01-01T00:00:00Z' });
    expect(order.amountDueCents).toBe(825);
    expect(order.items.map(x => [x.quantity, x.unitPriceCents, x.lineTotalCents])).toEqual([[2,350,700],[1,125,125]]);
    expect((await db.query<{ status: string; reserved_order_id: number }>("SELECT status,reserved_order_id FROM inventory_cards ORDER BY id")).rows).toEqual([{status:'reserved',reserved_order_id:order.id},{status:'reserved',reserved_order_id:order.id},{status:'reserved',reserved_order_id:order.id}]);
  });
  it('rolls back the order and every reservation if any item lacks stock', async () => {
    const db = await setup(); await db.query('INSERT INTO inventory_cards(product_id) VALUES (1),(1),(2)');
    const repo = new SqliteOrderRepository(db);
    await expect(repo.createOrder({ orderNo:'o-fail', userId:4, items:[{productId:1,quantity:2},{productId:2,quantity:2}], reservedUntil:'2030-01-01T00:00:00Z' })).rejects.toThrow(/stock/i);
    expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(0);
    expect((await db.query<{ status:string }>('SELECT status FROM inventory_cards WHERE product_id=1')).rows.every(x=>x.status==='available')).toBe(true);
  });
});
