import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { createSqliteAuthRepositories, createSqliteOrderStatusRepository, migrateAuthSchema } from "../src/sqlite-auth.js";

test("SQLite-backed order status requires a session and hides other users' orders", async () => {
  const db = createSqliteDatabase(":memory:");
  await migrateAuthSchema(db);
  await db.query("CREATE TABLE orders (id INTEGER PRIMARY KEY, order_no TEXT, user_id TEXT, amount_due_cents INTEGER, amount_paid_cents INTEGER, order_status TEXT, payment_status TEXT, fulfillment_status TEXT, created_at TEXT)");
  await db.query("INSERT INTO server_auth_users (id,email,password_hash) VALUES (?,?,?)", ["user-a", "a@example.test", "hash"]);
  await db.query("INSERT INTO orders VALUES (1,'ORD-1','user-a',1200,0,'active','unpaid','pending','2026-01-01T00:00:00.000Z'),(2,'ORD-2','user-b',900,0,'active','unpaid','pending','2026-01-01T00:00:00.000Z')");
  const auth = { ...createSqliteAuthRepositories(db), passwords: { verify: async () => true } };
  const app = buildApp({ auth, commerce: { auth, products: { listProducts: async () => [], getProduct: async () => null, createProduct: async () => 1 }, orders: createSqliteOrderStatusRepository(db) } });
  try {
    assert.equal((await app.inject({ method: "GET", url: "/api/orders/1" })).statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@example.test", password: "x" } });
    const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
    const owned = await app.inject({ method: "GET", url: "/api/orders/1", headers: { cookie } });
    assert.equal(owned.statusCode, 200, owned.body);
    assert.equal(owned.json().orderNo, "ORD-1");
    assert.equal((await app.inject({ method: "GET", url: "/api/orders/2", headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); await db.close(); }
});
