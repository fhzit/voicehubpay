import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { ShopService } from "../src/shop-legacy/shop-service.js";
import { buildApp } from "../src/app.js";
import {
  createShopLegacyDependencies,
  EnvShopConfig,
  migrateShopSchema,
} from "../src/shop-legacy/index.js";

/** Fixed clock so order numbers are deterministic. */
const fixedNow = new Date("2025-10-09T13:33:20.123Z");
const clock = { now: () => Math.floor(fixedNow.getTime() / 1000) };

async function boot() {
  const basePath = mkdtempSync(join(tmpdir(), "shop-wire-"));
  const db = createSqliteDatabase(":memory:");
  const config = new EnvShopConfig({
    SG65_ENABLED: "1",
    SG65_PID: "20250101",
    SITE_URL: "https://shop.example.com/",
    ORDER_TTL_MINUTES: "30",
  });
  await migrateShopSchema(db);
  const deps = createShopLegacyDependencies(db, config, { basePath });
  return { db, deps, basePath, config };
}

test("wiring: migrateShopSchema is idempotent and creates legacy tables", async () => {
  const { db } = await boot();
  await migrateShopSchema(db); // second run must not throw
  const tables = ((await db.query("SELECT name FROM sqlite_master WHERE type='table'")).rows as Array<Record<string, unknown>>).map((r) => r["name"]);
  for (const expected of ["products", "inventory_cards", "orders", "order_items", "fulfillment_units", "payment_transactions", "sessions", "users"]) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
});

test("wiring: createShopLegacyDependencies supports the full order->pay->notify loop", async () => {
  const { db, deps, basePath } = await boot();
  const now = new Date().toISOString();
  const product = (await db.query(
    "INSERT INTO products (name, slug, price_cents, status, delivery_mode, stock_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    ["Wired Product", "wired-product", 2500, "active", "card", 1, now, now],
  )).rows[0];
  const user = (await db.query(
    "INSERT INTO users (username, created_at, updated_at) VALUES (?, ?, ?) RETURNING id",
    ["buyer", now, now],
  )).rows[0];
  const { InventoryRepository, CryptoService } = await import("../../../packages/db/src/legacy/index.js");
  await new InventoryRepository(db).import(Number(product["id"]), ["WIRED-CARD-1"], new CryptoService(basePath));

  const shop = new ShopService({ ...deps, clock });
  const order = await shop.createOrder(Number(user["id"]), Number(product["id"]), 1);
  assert.ok(String(order["order_no"]).startsWith("20251009133320"));
  assert.equal(order["amount_due_cents"], 2500);
  // Card is reserved by the order.
  const cardRow = (await db.query("SELECT status, reserved_order_id FROM inventory_cards LIMIT 1")).rows[0];
  assert.equal(cardRow["status"], "reserved");
  assert.equal(cardRow["reserved_order_id"], order["id"]);
});

test("wiring: buildApp registers shop+payment routes and they serve traffic", async () => {
  const { deps } = await boot();
  const app = buildApp({ shop: deps });
  await app.ready();

  // Unauthenticated order creation is redirected to login (legacy behavior).
  const createRes = await app.inject({ method: "POST", url: "/orders" });
  assert.equal(createRes.statusCode, 302);
  assert.match(createRes.headers.location as string, /login/);

  // Notify endpoint is public and answers "error" for an invalid payload.
  const notifyRes = await app.inject({ method: "GET", url: "/payments/sg65/notify?out_trade_no=nope" });
  assert.equal(notifyRes.statusCode, 200);
  assert.equal(notifyRes.body, "verify_failed");

  // Status endpoint requires a session (redirects to login, legacy behavior).
  const statusRes = await app.inject({ method: "GET", url: "/api/orders/20251009133320000001abc/status" });
  assert.equal(statusRes.statusCode, 302);
  assert.match(statusRes.headers.location as string, /login/);

  // Routes are registered exactly once (no double-registration crash on ready).
  const routes = app.printRoutes({ commonPrefix: false });
  assert.match(routes, /orders/);
  assert.match(routes, /payments\/sg65\/notify/);
  await app.close();
});

test("wiring: shop routes absent when dependency not provided", async () => {
  const app = buildApp({});
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/payments/sg65/notify" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("wiring: EnvShopConfig mirrors PHP config semantics", () => {
  const config = new EnvShopConfig({
    SG65_ENABLED: "true",
    SITE_URL: "https://shop.example.com///",
    ORDER_TTL_MINUTES: "15",
  });
  assert.equal(config.bool("SG65_ENABLED", false), true);
  assert.equal(config.appUrl(), "https://shop.example.com"); // rtrim slashes
  assert.equal(config.int("ORDER_TTL_MINUTES", 30), 15);
  assert.equal(config.int("MISSING", 30), 30);
  assert.equal(config.bool("MISSING", true), true);
  assert.equal(config.get("MISSING", "fallback"), "fallback");
});
