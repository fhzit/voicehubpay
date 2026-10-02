import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSqliteDatabase, InventoryRepository, CryptoService } from "../../../packages/db/src/index.js";
import { ShopService } from "../src/shop-legacy/shop-service.js";
import { createShopLegacyDependencies, EnvShopConfig, migrateShopSchema } from "../src/shop-legacy/index.js";

/** Seconds-based clock that the test advances manually. */
let nowSeconds = Math.floor(Date.UTC(2025, 9, 9, 13, 0, 0) / 1000);
const clock = { now: () => nowSeconds };

async function boot() {
  const basePath = mkdtempSync(join(tmpdir(), "expire-"));
  const db = createSqliteDatabase(":memory:");
  await migrateShopSchema(db);
  const config = new EnvShopConfig({ ORDER_TTL_MINUTES: "30" });
  const deps = createShopLegacyDependencies(db, config, { basePath });
  const now = "2025-10-09T13:00:00+00:00";
  const product = (await db.query(
    "INSERT INTO products (name, slug, price_cents, status, delivery_mode, stock_enabled, min_quantity, max_quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 99, ?, ?) RETURNING id",
    ["Carded", "carded", 2500, "active", "card", 1, now, now],
  )).rows[0];
  const user = (await db.query(
    "INSERT INTO users (username, created_at, updated_at) VALUES (?, ?, ?) RETURNING id",
    ["buyer", now, now],
  )).rows[0];
  const inventory = new InventoryRepository(db);
  const crypto = new CryptoService(basePath);
  await inventory.import(Number(product["id"]), ["CARD-1", "CARD-2", "CARD-3"], crypto);
  const shop = new ShopService({ ...deps, clock });
  return { db, deps, inventory, crypto, shop, productId: Number(product["id"]), userId: Number(user["id"]) };
}

test("expireUnpaidOrders cancels expired unpaid orders and releases their cards", async () => {
  const t = await boot();
  const order = await t.shop.createOrder(t.userId, t.productId, 2);
  // 2 of 3 cards reserved.
  assert.equal(await t.inventory.countAvailable(t.productId), 1);

  // Before expiry the sweep must not touch the order.
  nowSeconds += 10 * 60;
  assert.equal(await t.shop.expireUnpaidOrders(), 0);
  assert.equal(String((await t.deps.orders.findById(Number(order["id"])))!["order_status"]), "active");
  assert.equal(await t.inventory.countAvailable(t.productId), 1);

  // Past the 30-minute TTL the sweep cancels the order and frees the cards.
  nowSeconds += 21 * 60;
  assert.equal(await t.shop.expireUnpaidOrders(), 1);
  const row = (await t.deps.orders.findById(Number(order["id"])))!;
  assert.equal(row["order_status"], "cancelled");
  assert.equal(row["payment_status"], "unpaid");
  assert.ok(row["cancelled_at"] !== null && row["cancelled_at"] !== undefined);
  assert.equal(await t.inventory.countAvailable(t.productId), 3, "both reserved cards are released");

  // Pending payment transactions are cancelled too.
  const txs = (await t.db.query("SELECT status FROM payment_transactions WHERE order_id = ?", [order["id"]])).rows;
  for (const tx of txs) assert.equal(tx["status"], "cancelled");

  // Idempotent: a second sweep finds nothing new.
  assert.equal(await t.shop.expireUnpaidOrders(), 0);
});

test("sweep never cancels paid orders even if past expiry", async () => {
  const t = await boot();
  const order = await t.shop.createOrder(t.userId, t.productId, 1);
  await t.deps.orders.markPaid(Number(order["id"]), 2500, "sg65", "callback");
  await t.inventory.markSoldForOrder(Number(order["id"]));

  nowSeconds += 60 * 60;
  assert.equal(await t.shop.expireUnpaidOrders(), 0);
  const row = (await t.deps.orders.findById(Number(order["id"])))!;
  assert.equal(row["order_status"], "active");
  assert.equal(row["payment_status"], "paid");
  // Sold cards untouched.
  const sold = (await t.db.query("SELECT COUNT(*) AS n FROM inventory_cards WHERE status = 'sold' AND sold_order_id = ?", [order["id"]])).rows[0];
  assert.equal(Number(sold["n"]), 1);
});
