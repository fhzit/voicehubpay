import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase, SqliteCatalogRepository } from "../../../packages/db/src/index.js";
import { buildApp } from "../src/app.js";
import { createSqliteAuthRepositories, createSqliteOrderStatusRepository, migrateAuthSchema } from "../src/sqlite-auth.js";

test("SQLite startup repositories serve product list/detail and user-owned order status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "voicehubpay-http-"));
  const db = createSqliteDatabase(join(dir, "test.db"));
  await migrateAuthSchema(db);
  await db.query("CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NULL, name VARCHAR(128) NOT NULL, slug VARCHAR(128) NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', cover_image VARCHAR(512) NOT NULL DEFAULT '', price_cents INTEGER NOT NULL DEFAULT 0, status VARCHAR(16) NOT NULL DEFAULT 'draft', delivery_mode VARCHAR(32) NOT NULL DEFAULT 'card', voicehub_enabled INTEGER NOT NULL DEFAULT 0, voicehub_code_source VARCHAR(32) NOT NULL DEFAULT 'inventory', stock_enabled INTEGER NOT NULL DEFAULT 1, min_quantity INTEGER NOT NULL DEFAULT 1, max_quantity INTEGER NOT NULL DEFAULT 99, quantity_step INTEGER NOT NULL DEFAULT 1, low_stock_threshold INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
  await db.query("CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT, user_id INTEGER, amount_due_cents INTEGER, amount_paid_cents INTEGER, order_status TEXT, payment_status TEXT, fulfillment_status TEXT, created_at TEXT)");
  await db.query("INSERT INTO products (id,name,slug,description,price_cents,status) VALUES (1,'Alpha','alpha','desc',1250,'active'),(2,'Beta','beta','desc',500,'draft')");
  await db.query("INSERT INTO server_auth_users (id,email,password_hash) VALUES ('1','a@example.test','hash')");
  await db.query("INSERT INTO orders VALUES (1,'ORD-A',1,1250,0,'active','unpaid','pending','2026-01-01T00:00:00.000Z'),(2,'ORD-B',2,900,0,'active','unpaid','pending','2026-01-01T00:00:00.000Z')");
  const auth = { ...createSqliteAuthRepositories(db), passwords: { verify: async () => true } };
  const orderStatusRepo = createSqliteOrderStatusRepository(db);
  const app = buildApp({ auth, commerce: { auth, products: new SqliteCatalogRepository(db), orders: orderStatusRepo } });
  try {
    const list = await app.inject({ method: "GET", url: "/api/products" });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json().products.map((p: { id: unknown }) => p.id), [1]);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@example.test", password: "x" } });
    const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    const own = await app.inject({ method: "GET", url: "/api/orders/1", headers: { cookie } });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(own.json().orderNo, "ORD-A");
    assert.equal((await app.inject({ method: "GET", url: "/api/orders/2", headers: { cookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/api/orders", payload: { productId: 1, quantity: 1 } })).statusCode, 501);
  } finally { await app.close(); await db.close(); await rm(dir, { recursive: true, force: true }); }
});
