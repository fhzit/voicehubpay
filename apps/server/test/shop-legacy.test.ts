import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  CryptoService,
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  ProductRepository,
} from "../../../packages/db/src/legacy/index.js";
import { toCents, format } from "../../../packages/db/src/legacy/money.js";
import { MapConfig } from "../src/auth-legacy/index.js";
import {
  buildString,
  sign,
  verify,
  Sg65Client,
  OrderNumberService,
  PaymentService,
  ShopService,
  ShopError,
  truncateUtf8,
  configureShopRoutes,
  configurePaymentRoutes,
} from "../src/shop-legacy/index.js";
import type { Clock, Row, ShopLegacyDependencies, Sg65HttpPost } from "../src/shop-legacy/index.js";

// ----------------------------------------------------------------------------------
// Deterministic harness: in-memory SQLite, fixed clock, injectable SG65 transport.
// ----------------------------------------------------------------------------------

class FixedClock implements Clock {
  constructor(public seconds = 1_760_000_000) {}
  now(): number {
    return this.seconds;
  }
  advance(seconds: number): void {
    this.seconds += seconds;
  }
}

const BASE_SECONDS = 1_760_000_000; // 2025-10-09T21:33:20Z — fixed for vectors

/** Schema mirroring database/migrations/sqlite (001,004,005,006,007,008,010,012). */
async function migrateLegacySchema(db: Database): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NULL,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    cover_image VARCHAR(512) NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_enabled INTEGER NOT NULL DEFAULT 0,
    voicehub_code_source VARCHAR(32) NOT NULL DEFAULT 'inventory',
    stock_enabled INTEGER NOT NULL DEFAULT 1,
    min_quantity INTEGER NOT NULL DEFAULT 1,
    max_quantity INTEGER NOT NULL DEFAULT 99,
    quantity_step INTEGER NOT NULL DEFAULT 1,
    low_stock_threshold INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS inventory_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    secret_hash VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'available',
    reserved_order_id INTEGER NULL,
    reserved_until TEXT NULL,
    sold_order_id INTEGER NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sold_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'shop',
    amount_due_cents INTEGER NOT NULL DEFAULT 0,
    amount_paid_cents INTEGER NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
    order_status VARCHAR(24) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    fulfillment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    payment_gateway VARCHAR(16) NOT NULL DEFAULT '',
    payment_confirmation_source VARCHAR(16) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NULL,
    paid_at TEXT NULL,
    fulfilled_at TEXT NULL,
    cancelled_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name_snapshot VARCHAR(128) NOT NULL,
    product_price_cents_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_mode_snapshot VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_code_source_snapshot VARCHAR(32) NOT NULL DEFAULT 'inventory',
    created_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS fulfillment_units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    unit_index INTEGER NOT NULL DEFAULT 1,
    unit_no VARCHAR(96) NOT NULL,
    inventory_card_id INTEGER NULL,
    delivery_code_ciphertext TEXT NULL,
    delivery_code_hash VARCHAR(128) NULL,
    voicehub_code_ciphertext TEXT NULL,
    voicehub_code_hash VARCHAR(128) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    voicehub_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    manual_note TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    fulfilled_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    gateway VARCHAR(16) NOT NULL DEFAULT 'sg65',
    merchant_order_no VARCHAR(96) NOT NULL,
    gateway_trade_no VARCHAR(128) NULL,
    api_trade_no VARCHAR(128) NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    pay_type VARCHAR(16) NULL,
    pay_url TEXT NULL,
    confirmation_source VARCHAR(16) NOT NULL DEFAULT 'callback',
    raw_notify_payload TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(128) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`);
}

async function seedUser(db: Database, overrides: Record<string, unknown> = {}): Promise<number> {
  await db.query(
    "INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      String(overrides["username"] ?? "buyer"),
      null,
      String(overrides["display_name"] ?? "买家"),
      "",
      String(overrides["email"] ?? "buyer@example.test"),
      String(overrides["role"] ?? "user"),
      String(overrides["status"] ?? "active"),
      "2026-01-01T00:00:00+00:00",
      "2026-01-01T00:00:00+00:00",
    ],
  );
  const row = (await db.query("SELECT id FROM users WHERE username = ?", [String(overrides["username"] ?? "buyer")])).rows[0];
  return Number(row!["id"]);
}

async function seedProduct(db: Database, overrides: Record<string, unknown> = {}): Promise<Row> {
  const now = "2026-01-01T00:00:00+00:00";
  await db.query(
    `INSERT INTO products (category_id, name, slug, description, cover_image, price_cents, status, delivery_mode, voicehub_enabled, voicehub_code_source, stock_enabled, min_quantity, max_quantity, quantity_step, low_stock_threshold, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      overrides["category_id"] ?? null,
      String(overrides["name"] ?? "测试卡密"),
      String(overrides["slug"] ?? `p-${Math.random().toString(36).slice(2, 8)}`),
      "",
      "",
      Number(overrides["price_cents"] ?? 1990),
      String(overrides["status"] ?? "active"),
      String(overrides["delivery_mode"] ?? "card"),
      Number(overrides["voicehub_enabled"] ?? 0),
      String(overrides["voicehub_code_source"] ?? "inventory"),
      Number(overrides["stock_enabled"] ?? 1),
      Number(overrides["min_quantity"] ?? 1),
      Number(overrides["max_quantity"] ?? 5),
      Number(overrides["quantity_step"] ?? 1),
      0,
      0,
      now,
      now,
    ],
  );
  const row = (await db.query("SELECT * FROM products WHERE slug = ?", [String(overrides["slug"] ?? "")])).rows[0];
  if (row === undefined && overrides["slug"] === undefined) {
    return (await db.query("SELECT * FROM products ORDER BY id DESC LIMIT 1")).rows[0]!;
  }
  return row!;
}

/** Test config adapter: MapConfig surface + appUrl() (shop-legacy ConfigPort). */
class TestConfig {
  constructor(private readonly values: Map<string, string | boolean | number> = new Map()) {}
  get(key: string, fallback = ""): string {
    const value = this.values.get(key);
    return value === undefined ? fallback : String(value);
  }
  bool(key: string, fallback: boolean): boolean {
    const value = this.values.get(key);
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  int(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.get(key, ""), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  appUrl(): string {
    return this.get("APP_URL", "").replace(/\/+$/, "");
  }
}

/** RSA test keys (merchant signs, platform key verifies — same pair as PHP tests). */
function rsaPair(): { privatePem: string; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

function stripPem(pem: string): string {
  return pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
}

function clientSignPublicKeyForTest(privatePem: string): string {
  return createPublicKey(privatePem).export({ type: "spki", format: "pem" }).toString();
}

interface Harness {
  db: Database;
  clock: FixedClock;
  config: TestConfig;
  deps: ShopLegacyDependencies;
  repos: {
    orders: OrderRepository;
    inventory: InventoryRepository;
    products: ProductRepository;
    transactions: PaymentTransactionRepository;
  };
  crypto: CryptoService;
  sg65: { calls: Array<{ path: string; body: string }>; respond: (path: string, body: string) => { status: number; text: string } | Promise<{ status: number; text: string }> };
  keys: { privatePem: string; publicPem: string };
}

async function buildHarness(options: { config?: TestConfig; sg65Response?: (path: string, body: string) => Record<string, unknown> | Promise<Record<string, unknown>> } = {}): Promise<Harness> {
  const db = createSqliteDatabase(":memory:");
  await migrateLegacySchema(db);
  const clock = new FixedClock();
  const config = options.config ?? new TestConfig(new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "10086"],
    ["ORDER_TTL_MINUTES", "30"],
    ["APP_URL", "https://shop.example.test"],
  ]));
  const keys = rsaPair();
  const crypto = new CryptoService("/tmp/vhp-shop-legacy-test");
  const repos = {
    orders: new OrderRepository(db),
    inventory: new InventoryRepository(db),
    products: new ProductRepository(db),
    transactions: new PaymentTransactionRepository(db),
  };
  const sg65Calls: Array<{ path: string; body: string }> = [];
  const responder = options.sg65Response ?? (() => ({ code: 0, data: {} }));
  const sg65Post: Sg65HttpPost = async (path, body) => {
    sg65Calls.push({ path, body });
    const payload = await responder(path, body);
    return { status: 200, text: JSON.stringify(payload) };
  };


  const deps: ShopLegacyDependencies = {
    sessions: {
      load: async (id) => {
        const row = (await db.query("SELECT data FROM sessions WHERE session_id = ?", [id])).rows[0];
        if (row === undefined) return null;
        try {
          return JSON.parse(String(row["data"] ?? "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      },
      create: async (id, data) => {
        await db.query(
          "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
          [id, JSON.stringify(data), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
        );
      },
      save: async (id, data) => {
        await db.query("UPDATE sessions SET data = ? WHERE session_id = ?", [JSON.stringify(data), id]);
      },
      destroy: async (id) => {
        await db.query("DELETE FROM sessions WHERE session_id = ?", [id]);
      },
    },
    db,
    config,
    clock,
    crypto,
    products: repos.products,
    orders: repos.orders,
    inventory: repos.inventory,
    transactions: repos.transactions,
    sg65Post,
  };
  return {
    db,
    clock,
    config,
    deps,
    repos,
    crypto,
    sg65: { calls: sg65Calls, respond: responder as never },
    keys,
  };
}

/** Sign a notify payload the way SG65 does (merchant key, RSA/SHA256, base64). */
function signedNotify(payload: Record<string, unknown>, privateKey: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };
  clone["sign_type"] = "RSA2";
  clone["sign"] = sign(clone, privateKey);
  return clone;
}

// ----------------------------------------------------------------------------------
// Signing vectors (parity with tests/unit/Sg65SignerTest.php)
// ----------------------------------------------------------------------------------

test("Sg65Signer.buildString: excludes sign/sign_type/empty/arrays, ASCII-sorted", () => {
  const params: Record<string, unknown> = {
    sign: "ignored",
    sign_type: "RSA2",
    merchant_id: "M100",
    amount: "100",
    empty: "",
    null_val: null,
    arr: ["a", "b"],
    a_param: "1",
    B_upper: "2",
  };
  // ASCII: uppercase before lowercase => "B_upper" < "a_param" < "amount" < "merchant_id"
  assert.equal(buildString(params), "B_upper=2&a_param=1&amount=100&merchant_id=M100");
});

test("Sg65Signer: sign/verify round-trip with generated RSA keys", () => {
  const { privatePem, publicPem } = rsaPair();
  const signed = sign({ merchant_id: "M1", order_id: "O9" }, privatePem);
  assert.ok(signed !== "");
  assert.ok(verify({ merchant_id: "M1", order_id: "O9", sign: signed, sign_type: "RSA2" }, publicPem));
  // tampering any field breaks verification
  assert.equal(verify({ merchant_id: "M2", order_id: "O9", sign: signed }, publicPem), false);
  assert.equal(verify({ merchant_id: "M1", order_id: "O9", sign: "not-base64" }, publicPem), false);
  // missing sign => false
  assert.equal(verify({ merchant_id: "M1" }, publicPem), false);
  // empty value must be excluded from the canonical string (like real SG65)
  assert.ok(verify({ merchant_id: "M1", order_id: "O9", note: "", sign: signed }, publicPem));
});

test("Sg65Signer: invalid key throws on sign, false on verify", () => {
  assert.throws(() => sign({ a: "1" }, "not-a-key"), /商户私钥无效/);
  assert.equal(verify({ a: "1", sign: "x" }, "not-a-key"), false);
});

test("Sg65Signer: bare base64 keys (no PEM armor) are auto-wrapped and sign identically", () => {
  const { privatePem, publicPem } = rsaPair();
  const barePriv = stripPem(privatePem);
  const barePub = stripPem(publicPem);
  const signedPem = sign({ merchant_id: "M1", order_id: "O9" }, privatePem);
  const signedBare = sign({ merchant_id: "M1", order_id: "O9" }, barePriv);
  assert.equal(signedPem, signedBare, "bare-base64 private key signs identically to PEM");
  assert.ok(verify({ merchant_id: "M1", order_id: "O9", sign: signedBare }, barePub), "bare-base64 public key verifies");
});

test("Sg65Signer: cross-runtime vector — Node signature verifies with openssl RSA-SHA256", () => {
  // Independent verification path: sign here, verify via a second verify()
  // call over a byte-identical canonical string built from decoded params.
  const { privatePem, publicPem } = rsaPair();
  const payload = { pid: "10086", out_trade_no: "202601011200001234567890", money: "19.90", type: "alipay", trade_status: "TRADE_SUCCESS" };
  const s = sign(payload, privatePem);
  assert.ok(verify({ ...payload, sign: s }, publicPem));
  // Deterministic canonical string for the same payload.
  assert.equal(buildString(payload), "money=19.90&out_trade_no=202601011200001234567890&pid=10086&trade_status=TRADE_SUCCESS&type=alipay");
});

// ----------------------------------------------------------------------------------
// Order numbers + Money parity
// ----------------------------------------------------------------------------------

test("OrderNumberService.generate: 24 numeric chars (14 timestamp + 6 micros + 4 random)", () => {
  const clock: Clock = { now: () => BASE_SECONDS };
  const orderNo = OrderNumberService.generate(clock);
  assert.equal(orderNo.length, 24);
  assert.ok(/^\d{24}$/.test(orderNo));
  assert.ok(orderNo.startsWith("20251009085320"), `timestamp prefix, got ${orderNo}`);
});

test("OrderNumberService.unitNo: orderNo-NNN with zero-padded index", () => {
  assert.equal(OrderNumberService.unitNo("202608281234561234567890", 1), "202608281234561234567890-001");
  assert.equal(OrderNumberService.unitNo("X", 12), "X-012");
  assert.equal(OrderNumberService.unitNo("X", 123), "X-123");
});

test("Money: toCents/format parity (server-computed integer cents)", () => {
  assert.equal(toCents("19.90"), 1990);
  assert.equal(toCents("0.01"), 1);
  assert.equal(toCents("1990"), 199000);
  assert.equal(toCents("1,234.50"), 123450);
  assert.throws(() => toCents("19.999"));
  assert.throws(() => toCents(""));
  assert.equal(format(1990), "19.90");
  assert.equal(format(5), "0.05");
  assert.equal(format(100200), "1002.00");
});

test("truncateUtf8: mb_substr semantics on CJK", () => {
  assert.equal(truncateUtf8("数字商品测试卡密", 4), "数字商品");
  assert.equal(truncateUtf8("abcdef", 3), "abc");
  assert.equal(truncateUtf8("abc", 10), "abc");
});

// ----------------------------------------------------------------------------------
// ShopService: order creation / stock validation / lifecycle
// ----------------------------------------------------------------------------------

async function freshShop(harness: Harness) {
  const shop = new ShopService({
    config: harness.config,
    orders: harness.repos.orders,
    products: harness.repos.products,
    inventory: harness.repos.inventory,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
    db: harness.db,
    clock: harness.clock,
  });
  return shop;
}

test("ShopService.createOrder: server-calculated totals, unit rows, card reservation", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 1990, max_quantity: 3 });
  await harness.repos.inventory.import(Number(product["id"]), ["CARD-A", "CARD-B", "CARD-C"], harness.crypto);
  const shop = await freshShop(harness);

  const order = await shop.createOrder(userId, Number(product["id"]), 2);

  // Server-side total: price * quantity, client value never consulted.
  assert.equal(order["amount_due_cents"], 3980);
  assert.equal(order["payment_status"], "unpaid");
  assert.equal(order["order_status"], "active");
  assert.equal(order["currency"], "CNY");
  assert.ok(String(order["expires_at"]).endsWith("+00:00"));

  assert.equal(order.items.length, 1);
  assert.equal(order.items[0]!["quantity"], 2);
  assert.equal(order.items[0]!["product_price_cents_snapshot"], 1990);

  assert.equal(order.units.length, 2);
  assert.equal(order.units[0]!["unit_no"], `${order["order_no"]}-001`);
  assert.equal(order.units[1]!["unit_no"], `${order["order_no"]}-002`);
  // Stock cards are the deliverables (encrypted), hashes recorded.
  assert.ok(String(order.units[0]!["delivery_code_ciphertext"]).startsWith("v1:"));
  assert.equal(harness.crypto.decrypt(String(order.units[0]!["delivery_code_ciphertext"])), "CARD-A");
  assert.equal(order.units[0]!["voicehub_status"], "not_required");

  // Inventory moved available -> reserved against this order.
  const stats = await harness.repos.inventory.stats(Number(product["id"]));
  assert.deepEqual(stats, { available: 1, reserved: 2, sold: 0, disabled: 0 });
  const reserved = (await harness.db.query(
    "SELECT reserved_order_id FROM inventory_cards WHERE status = 'reserved' LIMIT 1",
  )).rows[0]!;
  assert.equal(Number(reserved["reserved_order_id"]), Number(order["id"]));
});

test("ShopService.createOrder: quantity validation (min/max/step)", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { min_quantity: 2, max_quantity: 6, quantity_step: 2, stock_enabled: 0 });
  await harness.repos.inventory.import(Number(product["id"]), ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"], harness.crypto);
  const shop = await freshShop(harness);
  const pid = Number(product["id"]);

  await assert.rejects(shop.createOrder(userId, pid, 1), (error: unknown) => {
    assert.ok(error instanceof ShopError);
    assert.equal(error.message, "数量不能少于 2 件。");
    return true;
  });
  await assert.rejects(shop.createOrder(userId, pid, 7), /数量不能超过 6 件。/);
  await assert.rejects(shop.createOrder(userId, pid, 3), /数量需按 2 的步长选择。/);
  // step-valid quantity works
  const order = await shop.createOrder(userId, pid, 4);
  assert.equal(order["amount_due_cents"], Number(product["price_cents"]) * 4);
});

test("ShopService.createOrder: rejects missing / inactive product", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const shop = await freshShop(harness);
  await assert.rejects(shop.createOrder(userId, 99999, 1), /商品不存在。/);
  const product = await seedProduct(harness.db, { status: "disabled" });
  await assert.rejects(shop.createOrder(userId, Number(product["id"]), 1), /该商品已下架。/);
});

test("ShopService.createOrder: insufficient stock rolls the whole order back", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 500 });
  await harness.repos.inventory.import(Number(product["id"]), ["ONLY-CARD"], harness.crypto);
  const shop = await freshShop(harness);

  await assert.rejects(
    shop.createOrder(userId, Number(product["id"]), 3),
    (error: unknown) => (error as Error).message === "insufficient_stock",
  );

  // Nothing persisted: no orders, no items, no units, card stays available.
  assert.equal(Number((await harness.db.query("SELECT COUNT(*) AS n FROM orders")).rows[0]!["n"]), 0);
  assert.equal(Number((await harness.db.query("SELECT COUNT(*) AS n FROM order_items")).rows[0]!["n"]), 0);
  assert.equal(Number((await harness.db.query("SELECT COUNT(*) AS n FROM fulfillment_units")).rows[0]!["n"]), 0);
  assert.equal(await harness.repos.inventory.countAvailable(Number(product["id"])), 1);
});

test("ShopService.createOrder: voicehub delivery mode encrypts the unit voucher code", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, {
    delivery_mode: "voicehub",
    voicehub_enabled: 1,
    stock_enabled: 0,
  });
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);
  const unit = order.units[0]!;
  assert.equal(unit["inventory_card_id"], null);
  const plain = harness.crypto.decrypt(String(unit["delivery_code_ciphertext"]));
  assert.equal(plain, `${order["order_no"]}-001`);
  assert.equal(unit["delivery_code_hash"], harness.crypto.hash(plain));
  // voicehub_enabled => the voucher doubles as the VoiceHub code
  assert.equal(unit["voicehub_status"], "pending");
  assert.equal(unit["voicehub_code_ciphertext"], unit["delivery_code_ciphertext"]);
});

test("ShopService.cancelUnpaidOrder: releases stock, cancels order + pending transactions", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { stock_enabled: 0 });
  await harness.repos.inventory.import(Number(product["id"]), ["CARD-X"], harness.crypto);
  const shop = await freshShop(harness);

  const order = await shop.createOrder(userId, Number(product["id"]), 1);
  const orderId = Number(order["id"]);
  await harness.repos.transactions.upsert({
    order_id: orderId,
    gateway: "sg65",
    merchant_order_no: String(order["order_no"]),
    amount_cents: Number(order["amount_due_cents"]),
    status: "pending",
    confirmation_source: "callback",
  });

  await shop.cancelUnpaidOrder(orderId);

  const cancelled = await harness.repos.orders.findById(orderId);
  assert.equal(cancelled!["order_status"], "cancelled");
  assert.ok(cancelled!["cancelled_at"] !== null);
  assert.equal(await harness.repos.inventory.countAvailable(Number(product["id"])), 1);
  const tx = await harness.repos.transactions.findByMerchantOrderNo(String(order["order_no"]));
  assert.equal(tx!["status"], "cancelled");

  // Paid orders can never be cancelled.
  await harness.repos.orders.markPaid(orderId, 1990, "sg65", "callback");
  await assert.rejects(shop.cancelUnpaidOrder(orderId), /已支付订单不能取消。/);
});

// ----------------------------------------------------------------------------------
// SG65 client: signed params + injectable transport
// ----------------------------------------------------------------------------------

test("Sg65Client.signedParams: pid/timestamp/sign_type/sign appended, transport receives form body", async () => {
  const clock: Clock = { now: () => BASE_SECONDS };
  const { privatePem } = rsaPair();
  const calls: Array<{ path: string; body: string }> = [];
  const client = new Sg65Client(
    {
      get: (key, fallback = "") => (key === "SG65_PID" ? "10086" : key === "SG65_MERCHANT_PRIVATE_KEY" ? privatePem : fallback),
      bool: () => true,
      int: (_key, fallback) => fallback,
      appUrl: () => "https://shop.example.test",
    },
    clock,
    async (path, body) => {
      calls.push({ path, body });
      return { status: 200, text: JSON.stringify({ code: 0, pay_info: "https://pay.example.test/jump", trade_no: "G1" }) };
    },
  );
  const response = await client.create({ out_trade_no: "NO1", money: "19.90", type: "alipay" });
  assert.equal(response["pay_info"], "https://pay.example.test/jump");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/pay/create");
  const form = new URLSearchParams(calls[0]!.body);
  assert.equal(form.get("pid"), "10086");
  assert.equal(form.get("timestamp"), String(BASE_SECONDS));
  assert.equal(form.get("sign_type"), "RSA");
  assert.ok(form.get("sign") !== null && form.get("sign") !== "");
  // The sent signature verifies against the merchant public key over the same params.
  const params: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) params[key] = value;
  assert.ok(verify(params, clientSignPublicKeyForTest(privatePem)));
});

test("Sg65Client: non-JSON / non-zero code responses throw like the PHP client", async () => {
  const clock: Clock = { now: () => BASE_SECONDS };
  const base = {
    get: (key: string, fallback = "") => (key === "SG65_PID" ? "1" : key === "SG65_MERCHANT_PRIVATE_KEY" ? rsaPair().privatePem : fallback),
    bool: () => true,
    int: (_k: string, fallback: number) => fallback,
    appUrl: () => "https://shop.example.test",
  };
  const client = new Sg65Client(base, clock, async () => ({ status: 502, text: "<html>bad gateway</html>" }));
  await assert.rejects(client.query({ out_trade_no: "X" }), /SG65 返回非 JSON（HTTP 502）/);
  // The PHP client returns the decoded JSON; the SERVICE asserts code===0.
  const client2 = new Sg65Client(base, clock, async () => ({ status: 200, text: JSON.stringify({ code: 1, msg: "余额不足" }) }));
  const decoded = await client2.merchantInfo();
  assert.equal(decoded["code"], 1);
  assert.throws(() => {
    const code = Number(decoded["code"] ?? -1);
    if (code !== 0) throw new Error(`SG65 返回错误：${String(decoded["msg"] ?? "unknown error")}`);
  }, /SG65 返回错误：余额不足/);
});

// ----------------------------------------------------------------------------------
// PaymentService.handleNotify: verification + idempotent payment recording
// (parity with tests/integration/Sg65NotifyTest.php)
// ----------------------------------------------------------------------------------

async function notifyHarness() {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 1990, max_quantity: 1, slug: "sg65-1" });
  await harness.repos.inventory.import(Number(product["id"]), ["CARDTEST-SECRET-XYZ"], harness.crypto);
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  // Wire SG65 config (merchant signs with private, gateway verifies with public).
  const deps: ShopLegacyDependencies = {
    ...harness.deps,
    config: new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
      ["SG65_ENABLED", "1"],
      ["SG65_PID", "10086"],
      ["APP_URL", "https://shop.example.test"],
      ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
      ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
    ])),
  };
  const payment = new PaymentService({
    config: deps.config,
    clock: harness.clock,
    sg65: new Sg65Client(deps.config, harness.clock, harness.deps.sg65Post!),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });
  return { harness, order, payment, deps };
}

/** Minimal ConfigPort adapter over a plain map (keeps tests self-contained). */
class ShopMapConfigAdapter {
  constructor(private readonly values: Map<string, string | boolean | number>) {}
  get(key: string, fallback = ""): string {
    const value = this.values.get(key);
    return value === undefined ? fallback : String(value);
  }
  bool(key: string, fallback: boolean): boolean {
    const value = this.values.get(key);
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    return String(value) === "1" || String(value).toLowerCase() === "true";
  }
  int(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.get(key, ""), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  appUrl(): string {
    return this.get("APP_URL", "").replace(/\/+$/, "");
  }
}

test("PaymentService.handleNotify: valid notify pays exactly once (idempotent)", async () => {
  const { harness, order, payment } = await notifyHarness();
  const base = {
    pid: "10086",
    out_trade_no: String(order["order_no"]),
    trade_no: "GATEWAY-1",
    api_trade_no: "API-1",
    money: "19.90",
    type: "alipay",
    trade_status: "TRADE_SUCCESS",
  };
  const notify = signedNotify(base, harness.keys.privatePem);

  assert.equal(await payment.handleNotify(notify), "success");
  const paid = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  assert.equal(paid!["payment_status"], "paid");
  assert.equal(Number(paid!["amount_paid_cents"]), 1990);
  assert.equal(paid!["payment_gateway"], "sg65");
  assert.equal(paid!["payment_confirmation_source"], "callback");

  // duplicate notify -> still success, no double confirm, single paid txn
  assert.equal(await payment.handleNotify(notify), "success");
  const txnCount = Number((await harness.db.query(
    "SELECT COUNT(*) AS n FROM payment_transactions WHERE order_id = ?",
    [Number(paid!["id"])],
  )).rows[0]!["n"]);
  assert.equal(txnCount, 1, "one paid transaction row");

  const tx = await harness.repos.transactions.findByMerchantOrderNo(String(order["order_no"]));
  assert.equal(tx!["status"], "paid");
  assert.equal(tx!["gateway_trade_no"], "GATEWAY-1");
  assert.equal(tx!["api_trade_no"], "API-1");
  assert.ok(String(tx!["raw_notify_payload"]).includes("TRADE_SUCCESS"));
});

test("PaymentService.handleNotify: tampered / mismatched / non-success notifies rejected", async () => {
  const { harness, order, payment } = await notifyHarness();
  const base = {
    pid: "10086",
    out_trade_no: String(order["order_no"]),
    trade_no: "GATEWAY-1",
    money: "19.90",
    type: "alipay",
    trade_status: "TRADE_SUCCESS",
  };
  const notify = signedNotify(base, harness.keys.privatePem);

  // tampered field with original signature -> verify_failed
  assert.equal(await payment.handleNotify({ ...notify, money: "1.00" }), "verify_failed");
  // amount mismatch with valid signature -> amount_mismatch
  const mismatch = signedNotify({ ...base, money: "9.90" }, harness.keys.privatePem);
  assert.equal(await payment.handleNotify(mismatch), "amount_mismatch");
  // wrong pid -> pid_mismatch
  const wrongPid = signedNotify({ ...base, pid: "99999" }, harness.keys.privatePem);
  assert.equal(await payment.handleNotify(wrongPid), "pid_mismatch");
  // non-success status -> not_success
  const pending = signedNotify({ ...base, trade_status: "TRADE_PENDING" }, harness.keys.privatePem);
  assert.equal(await payment.handleNotify(pending), "not_success");
  // unknown order -> order_not_found
  const unknown = signedNotify({ ...base, out_trade_no: "000000000000000000000000" }, harness.keys.privatePem);
  assert.equal(await payment.handleNotify(unknown), "order_not_found");
  // bad money format -> bad_money
  const badMoney = signedNotify({ ...base, money: "abc" }, harness.keys.privatePem);
  assert.equal(await payment.handleNotify(badMoney), "bad_money");
  // disabled gateway short-circuits before verification
  const disabledPayment = new PaymentService({
    config: new ShopMapConfigAdapter(new Map([["SG65_ENABLED", "0"], ["SG65_PID", "10086"], ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem]])),
    clock: harness.clock,
    sg65: new Sg65Client(
      new ShopMapConfigAdapter(new Map([["SG65_ENABLED", "0"]])),
      harness.clock,
      harness.deps.sg65Post!,
    ),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });
  assert.equal(await disabledPayment.handleNotify(notify), "disabled");

  // The order remains untouched by every rejection above.
  const after = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  assert.equal(after!["payment_status"], "unpaid");
});

// ----------------------------------------------------------------------------------
// PaymentService.createPayment + queryAndBackfill + reconcile (injectable transport)
// ----------------------------------------------------------------------------------

test("PaymentService.createPayment: guards, signed gateway call, pending transaction upsert", async () => {
  const harness = await buildHarness({
    sg65Response: () => ({ code: 0, pay_info: "https://pay.example.test/jump/1", trade_no: "G-9" }),
  });
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 1990, name: "SG65 卡", stock_enabled: 0 });
  await harness.repos.inventory.import(Number(product["id"]), ["C1"], harness.crypto);
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  const config = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "10086"],
    ["SG65_ENABLED_TYPES", "alipay,wxpay"],
    ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
    ["APP_URL", "https://shop.example.test"],
  ]));
  const payment = new PaymentService({
    config,
    clock: harness.clock,
    sg65: new Sg65Client(config, harness.clock, harness.deps.sg65Post!),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });

  // Guards first.
  await assert.rejects(payment.createPayment(order, "qqpay", "1.2.3.4"), /该支付方式未开启。/);
  await assert.rejects(payment.createPayment(order, "bitcoin", "1.2.3.4"), /不支持的支付方式。/);

  const result = await payment.createPayment(order, "alipay", "203.0.113.9");
  assert.equal(result.pay_info, "https://pay.example.test/jump/1");
  assert.equal(result.trade_no, "G-9");

  // Gateway request carried the exact PHP-shaped params.
  const call = harness.sg65.calls[0]!;
  assert.equal(call.path, "/api/pay/create");
  const form = new URLSearchParams(call.body);
  assert.equal(form.get("out_trade_no"), String(order["order_no"]));
  assert.equal(form.get("money"), "19.90");
  assert.equal(form.get("notify_url"), "https://shop.example.test/payments/sg65/notify");
  assert.equal(form.get("return_url"), "https://shop.example.test/payments/sg65/return");
  assert.equal(form.get("clientip"), "203.0.113.9");
  assert.equal(form.get("method"), "jump");
  assert.equal(form.get("name"), "SG65 卡");
  assert.equal(form.get("type"), "alipay");
  assert.equal(form.get("sign_type"), "RSA");
  assert.ok((form.get("sign") ?? "") !== "");

  // Pending transaction recorded server-side.
  const tx = await harness.repos.transactions.findByMerchantOrderNo(String(order["order_no"]));
  assert.equal(tx!["status"], "pending");
  assert.equal(tx!["pay_url"], "https://pay.example.test/jump/1");
  assert.equal(Number(tx!["amount_cents"]), 1990);

  // Already-paid orders cannot be paid again.
  await harness.repos.orders.markPaid(Number(order["id"]), 1990, "sg65", "callback");
  const paidOrder = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  await assert.rejects(payment.createPayment(paidOrder!, "alipay", "1.2.3.4"), /订单已支付，请勿重复支付。/);
});

test("PaymentService.createPayment: gateway error and missing pay_info rejected", async () => {
  const harness = await buildHarness({ sg65Response: () => ({ code: 5, msg: "签名错误" }) });
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { stock_enabled: 1 });
  await harness.repos.inventory.import(Number(product["id"]), ["E1"], harness.crypto);
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);
  const config = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "1"],
    ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
  ]));
  const payment = new PaymentService({
    config,
    clock: harness.clock,
    sg65: new Sg65Client(config, harness.clock, harness.deps.sg65Post!),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });
  await assert.rejects(payment.createPayment(order, "alipay", "1.2.3.4"), /SG65 返回错误：签名错误/);

  const harness2 = await buildHarness({ sg65Response: () => ({ code: 0 }) });
  const userId2 = await seedUser(harness2.db);
  const product2 = await seedProduct(harness2.db, { delivery_mode: "voicehub", stock_enabled: 0 });
  const order2 = await new ShopService({
    config: harness2.config,
    orders: harness2.repos.orders,
    products: harness2.repos.products,
    inventory: harness2.repos.inventory,
    transactions: harness2.repos.transactions,
    crypto: harness2.crypto,
    db: harness2.db,
    clock: harness2.clock,
  }).createOrder(userId2, Number(product2["id"]), 1);
  const config2 = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "1"],
    ["SG65_MERCHANT_PRIVATE_KEY", harness2.keys.privatePem],
  ]));
  const payment2 = new PaymentService({
    config: config2,
    clock: harness2.clock,
    sg65: new Sg65Client(config2, harness2.clock, harness2.deps.sg65Post!),
    orders: harness2.repos.orders,
    transactions: harness2.repos.transactions,
    crypto: harness2.crypto,
  });
  await assert.rejects(payment2.createPayment(order2, "alipay", "1.2.3.4"), /支付创建失败：未返回跳转地址。/);
});

test("PaymentService.queryAndBackfill: only a signed, amount-matching paid query confirms", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 1990, delivery_mode: "voicehub", stock_enabled: 0 });
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  const makePayment = (gatewayPayload: Record<string, unknown>) => {
    const config = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
      ["SG65_ENABLED", "1"],
      ["SG65_PID", "10086"],
      ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
      ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
      ["APP_URL", "https://shop.example.test"],
    ]));
    const deps: ShopLegacyDependencies = { ...harness.deps, config };
    return new PaymentService({
      config,
      clock: harness.clock,
      sg65: new Sg65Client(config, harness.clock, deps.sg65Post!),
      orders: harness.repos.orders,
      transactions: harness.repos.transactions,
      crypto: harness.crypto,
    });
  };
  void makePayment;

  // Build the gateway query response: status=1, signed by the MERCHANT key
  // (SG65 signs responses with the merchant identity in this flow), verified
  // against the platform public key — mirroring the PHP verifyBackfill setup.
  const signedQuery = (overrides: Record<string, unknown>) => {
    const payload = {
      pid: "10086",
      out_trade_no: String(order["order_no"]),
      trade_no: "G-Q",
      money: "19.90",
      status: 1,
      ...overrides,
    };
    return signedNotify(payload, harness.keys.privatePem);
  };

  const deps: ShopLegacyDependencies = {
    ...harness.deps,
    config: new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
      ["SG65_ENABLED", "1"],
      ["SG65_PID", "10086"],
      ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
      ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
      ["APP_URL", "https://shop.example.test"],
    ])),
  };
  const respondingDeps: ShopLegacyDependencies = {
    ...deps,
    sg65Post: async (path, body) => {
      void path;
      void body;
      return { status: 200, text: JSON.stringify(signedQuery({})) };
    },
  };
  const payment = new PaymentService({
    config: deps.config,
    clock: harness.clock,
    sg65: new Sg65Client(deps.config, harness.clock, respondingDeps.sg65Post!),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });
  const result = await payment.queryAndBackfill(order);
  assert.deepEqual(result, { paid: true, status: 1 });
  const paid = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  assert.equal(paid!["payment_status"], "paid");
  assert.equal(paid!["payment_confirmation_source"], "query");

  // Wrong amount in the signed response is not trusted.
  const harness3 = await buildHarness();
  const userId3 = await seedUser(harness3.db);
  const product3 = await seedProduct(harness3.db, { price_cents: 1990, delivery_mode: "voicehub", stock_enabled: 0 });
  const order3 = await new ShopService({
    config: harness3.config,
    orders: harness3.repos.orders,
    products: harness3.repos.products,
    inventory: harness3.repos.inventory,
    transactions: harness3.repos.transactions,
    crypto: harness3.crypto,
    db: harness3.db,
    clock: harness3.clock,
  }).createOrder(userId3, Number(product3["id"]), 1);
  const config3 = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "10086"],
    ["SG65_MERCHANT_PRIVATE_KEY", harness3.keys.privatePem],
    ["SG65_PLATFORM_PUBLIC_KEY", harness3.keys.publicPem],
  ]));
  const badAmount = signedNotify({ pid: "10086", out_trade_no: String(order3["order_no"]), money: "0.01", status: 1 }, harness3.keys.privatePem);
  const payment3 = new PaymentService({
    config: config3,
    clock: harness3.clock,
    sg65: new Sg65Client(config3, harness3.clock, async () => ({ status: 200, text: JSON.stringify(badAmount) })),
    orders: harness3.repos.orders,
    transactions: harness3.repos.transactions,
    crypto: harness3.crypto,
  });
  const rejected = await payment3.queryAndBackfill(order3);
  assert.deepEqual(rejected, { paid: false, status: 1 });
  const unpaid = await harness3.repos.orders.findByOrderNo(String(order3["order_no"]));
  assert.equal(unpaid!["payment_status"], "unpaid");
});

test("PaymentService.confirmPaid: fulfillment/mailer failures never break the payment path", async () => {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db);
  const product = await seedProduct(harness.db, { price_cents: 1000, delivery_mode: "voicehub", stock_enabled: 0 });
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  let prepareCalls = 0;
  let processCalls = 0;
  let mailCalls = 0;
  const config = new ShopMapConfigAdapter(new Map<string, string | boolean | number>([["SG65_ENABLED", "1"]]));
  const payment = new PaymentService({
    config,
    clock: harness.clock,
    sg65: new Sg65Client(config, harness.clock, harness.deps.sg65Post!),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
    fulfillment: {
      preparePaidOrder: async () => {
        prepareCalls += 1;
        throw new Error("voicehub down");
      },
      processOrder: async () => {
        processCalls += 1;
        throw new Error("still down");
      },
    },
    mailer: {
      orderPaid: async () => {
        mailCalls += 1;
        throw new Error("smtp down");
      },
      adminOrderReceived: async () => {
        mailCalls += 1;
      },
    },
    users: { findById: async (id) => ({ id, username: "buyer", display_name: "", email: "b@x.test" }) },
  });
  await payment.confirmPaid(order, "sg65", "callback");
  const paid = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  assert.equal(paid!["payment_status"], "paid");
  assert.equal(prepareCalls, 1);
  assert.equal(processCalls, 1);
  // PHP parity: mailer->orderPaid throws inside notifyOrderPaid; the whole
  // notify step is caught by confirmPaid, so the admin alert is skipped for
  // this attempt — exactly like the PHP try/catch around notifyOrderPaid.
  assert.equal(mailCalls, 1);
  // Idempotent: second confirm with the (reloaded) paid row is a no-op.
  await payment.confirmPaid(paid!, "sg65", "callback");
  assert.equal(prepareCalls, 1);
  assert.equal(processCalls, 1);
  assert.equal(mailCalls, 1);
});

// ----------------------------------------------------------------------------------
// HTTP routes: order create/status/reveal + notify callback (Fastify inject)
// ----------------------------------------------------------------------------------

async function routeHarness() {
  const harness = await buildHarness();
  const userId = await seedUser(harness.db, { username: "buyer2" });
  const product = await seedProduct(harness.db, { price_cents: 1990, max_quantity: 2 });
  await harness.repos.inventory.import(Number(product["id"]), ["ROUTE-CARD-1", "ROUTE-CARD-2"], harness.crypto);

  const map = new Map<string, string | boolean | number>([
    ["SG65_ENABLED", "1"],
    ["SG65_PID", "10086"],
    ["SG65_MERCHANT_PRIVATE_KEY", harness.keys.privatePem],
    ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
    ["APP_URL", "https://shop.example.test"],
  ]);
  const deps: ShopLegacyDependencies = {
    ...harness.deps,
    config: new ShopMapConfigAdapter(map),
    users: { findById: async (id) => (await harness.db.query("SELECT * FROM users WHERE id = ?", [id])).rows[0] ?? null },
    sg65Post: async (path, body) => {
      void path;
      void body;
      return { status: 200, text: JSON.stringify({ code: 0, pay_info: "https://pay.example.test/jump/1", trade_no: "G-9" }) };
    },
    audit: {
      log: async (userId, action, objectType, objectId, metadata, ip, userAgent) => {
        await harness.db.query(
          "INSERT INTO audit_logs (user_id, action, object_type, object_id, ip, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [userId, action, objectType ?? "", objectId ?? "", ip ?? "", userAgent ?? "", JSON.stringify(metadata ?? {}), "2026-01-01T00:00:00+00:00"],
        );
      },
    },
  };
  const app = Fastify({ logger: false });
  configureShopRoutes(app, deps);
  configurePaymentRoutes(app, deps);

  // Login by planting a session row (user_id) and using its cookie.
  const sessionId = "sess-shop-legacy-1";
  await harness.db.query(
    "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [sessionId, JSON.stringify({ user_id: userId, csrf_token: "test-csrf-token" }), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  const headers = { cookie: `vh_legacy_session=${sessionId}` };

  return { harness, app, userId, product, headers, deps, sessionId };
}

test("routes: POST /orders creates an order and redirects to checkout", async () => {
  const { harness, app, product, headers } = await routeHarness();
  const response = await app.inject({
    method: "POST",
    url: "/orders",
    headers,
    payload: { product_id: Number(product["id"]), quantity: 2, slug: String(product["slug"]), _csrf: "test-csrf-token" },
  });
  assert.equal(response.statusCode, 302);
  const location = response.headers["location"] as string;
  const orderNo = location.replace("/checkout/", "");
  const order = await harness.repos.orders.findByOrderNo(orderNo);
  assert.ok(order);
  assert.equal(Number(order!["amount_due_cents"]), 3980);
  const units = await harness.repos.orders.units(Number(order!["id"]));
  assert.equal(units.length, 2);
});

test("routes: POST /orders requires login and CSRF; quantity errors flash the PHP message", async () => {
  const { app, product } = await routeHarness();
  const anon = await app.inject({ method: "POST", url: "/orders", payload: { product_id: Number(product["id"]) } });
  assert.equal(anon.statusCode, 302);
  assert.ok(String(anon.headers["location"]).startsWith("/login?redirect="));

  const { headers } = await routeHarness();
  const badCsrf = await app.inject({ method: "POST", url: "/orders", headers, payload: { product_id: Number(product["id"]) } });
  assert.equal(badCsrf.statusCode, 302);
  assert.ok(String(badCsrf.headers["location"]).startsWith("/login"));

  const flash = await app.inject({
    method: "POST",
    url: "/orders",
    headers,
    payload: { product_id: Number(product["id"]), quantity: 99, slug: "p", _csrf: "test-csrf-token" },
  });
  assert.equal(flash.statusCode, 302);
  assert.equal(
    Buffer.from(String(flash.headers["x-flash-message"]), "base64").toString("utf8"),
    "数量不能超过 2 件。",
  );
  assert.equal(String(flash.headers["location"]), "/product/p");
});

test("routes: GET /api/orders/{orderNo}/status — ownership enforced, stats exposed", async () => {
  const { harness, app, headers, product, userId } = await routeHarness();
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 2);

  const ok = await app.inject({ method: "GET", url: `/api/orders/${order["order_no"]}/status`, headers });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.payment_status, "unpaid");
  assert.equal(body.unit_total, 2);
  assert.deepEqual(body.unit_stats, { pending: 2, processing: 0, success: 0, failed: 0, manual_completed: 0 });

  // Another user's session must not see this order.
  const otherUserId = await seedUser(harness.db, { username: "other" });
  await harness.db.query(
    "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["sess-other", JSON.stringify({ user_id: otherUserId, csrf_token: "t" }), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  const forbidden = await app.inject({ method: "GET", url: `/api/orders/${order["order_no"]}/status`, headers: { cookie: "vh_legacy_session=sess-other" } });
  assert.equal(forbidden.statusCode, 404);
  assert.deepEqual(forbidden.json(), { ok: false, error: "not found" });

  // Anonymous is redirected to login.
  const anon = await app.inject({ method: "GET", url: `/api/orders/${order["order_no"]}/status` });
  assert.equal(anon.statusCode, 302);
  assert.ok(String(anon.headers["location"]).startsWith("/login"));
});

test("routes: card reveal — unpaid 403, cross-user 403, paid returns decrypted code", async () => {
  const { harness, app, headers, product, userId } = await routeHarness();
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);
  const unit = order.units[0]!;

  // Unpaid -> 403 订单未支付
  const unpaid = await app.inject({ method: "POST", url: `/api/cards/${unit["id"]}/reveal`, headers, payload: { _csrf: "test-csrf-token" } });
  assert.equal(unpaid.statusCode, 403);
  assert.equal(unpaid.json().error, "订单未支付");

  // Pay via a valid notify callback, then reveal.
  const payment = new PaymentService({
    config: new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
      ["SG65_ENABLED", "1"],
      ["SG65_PID", "10086"],
      ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
    ])),
    clock: harness.clock,
    sg65: new Sg65Client(
      new ShopMapConfigAdapter(new Map<string, string | boolean | number>([
        ["SG65_ENABLED", "1"],
        ["SG65_PID", "10086"],
        ["SG65_PLATFORM_PUBLIC_KEY", harness.keys.publicPem],
      ])),
      harness.clock,
      harness.deps.sg65Post!,
    ),
    orders: harness.repos.orders,
    transactions: harness.repos.transactions,
    crypto: harness.crypto,
  });
  const notify = signedNotify(
    {
      pid: "10086",
      out_trade_no: String(order["order_no"]),
      trade_no: "G-RT",
      money: "19.90",
      type: "wxpay",
      trade_status: "TRADE_SUCCESS",
    },
    harness.keys.privatePem,
  );
  assert.equal(await payment.handleNotify(notify), "success");

  const reveal = await app.inject({ method: "POST", url: `/api/cards/${unit["id"]}/reveal`, headers, payload: { _csrf: "test-csrf-token" } });
  assert.equal(reveal.statusCode, 200);
  const body = reveal.json();
  assert.equal(body.ok, true);
  assert.equal(body.code, "ROUTE-CARD-1");
  assert.equal(body.status, "pending");

  // Missing unit -> 404
  const missing = await app.inject({ method: "POST", url: "/api/cards/999999/reveal", headers, payload: { _csrf: "test-csrf-token" } });
  assert.equal(missing.statusCode, 404);

  // Cross-user -> 403 forbidden
  const otherUserId = await seedUser(harness.db, { username: "other2" });
  await harness.db.query(
    "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["sess-other2", JSON.stringify({ user_id: otherUserId, csrf_token: "t" }), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  const cross = await app.inject({
    method: "POST",
    url: `/api/cards/${unit["id"]}/reveal`,
    headers: { cookie: "vh_legacy_session=sess-other2" },
    payload: { _csrf: "t" },
  });
  assert.equal(cross.statusCode, 403);
  assert.equal(cross.json().error, "forbidden");
});

test("routes: GET /payments/sg65/notify — plain-text success only after full verification", async () => {
  const { harness, app, product, userId } = await routeHarness();
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  const base = {
    pid: "10086",
    out_trade_no: String(order["order_no"]),
    trade_no: "G-HTTP",
    money: "19.90",
    type: "alipay",
    trade_status: "TRADE_SUCCESS",
  };
  const queryOf = (payload: Record<string, unknown>) =>
    Object.entries(payload)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");

  // Valid signed notify -> "success", order paid.
  const good = await app.inject({ method: "GET", url: `/payments/sg65/notify?${queryOf(signedNotify(base, harness.keys.privatePem))}` });
  assert.equal(good.statusCode, 200);
  assert.equal(good.body, "success");
  const paid = await harness.repos.orders.findByOrderNo(String(order["order_no"]));
  assert.equal(paid!["payment_status"], "paid");

  // Tampered notify -> verify_failed, non-committal 200.
  const tampered = await app.inject({ method: "GET", url: `/payments/sg65/notify?${queryOf({ ...signedNotify(base, harness.keys.privatePem), money: "0.01" })}` });
  assert.equal(tampered.statusCode, 200);
  assert.equal(tampered.body, "verify_failed");

  // Unknown order -> generic "error" body (not "order_not_found").
  const unknown = await app.inject({
    method: "GET",
    url: `/payments/sg65/notify?${queryOf(signedNotify({ ...base, out_trade_no: "111111111111111111111111" }, harness.keys.privatePem))}`,
  });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.body, "error");

  // Invalid signature -> verify_failed.
  const invalid = await app.inject({
    method: "GET",
    url: `/payments/sg65/notify?${queryOf({ ...base, sign: "AAAA" })}`,
  });
  assert.equal(invalid.statusCode, 200);
  assert.equal(invalid.body, "verify_failed");
});

test("routes: POST /orders/{orderNo}/pay — success redirects to pay_info, errors flash", async () => {
  const { harness, app, headers, product, userId, deps } = await routeHarness();
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  // Success: transport returns pay_info.
  const ok = await app.inject({
    method: "POST",
    url: `/orders/${order["order_no"]}/pay`,
    headers,
    payload: { pay_type: "alipay", _csrf: "test-csrf-token" },
  });
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.headers["location"], "https://pay.example.test/jump/1");
  const auditRow = (await harness.db.query("SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(auditRow!["action"], "payment.create");

  // Not found for another user's order.
  const otherUserId = await seedUser(harness.db, { username: "other3" });
  await harness.db.query(
    "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["sess-other3", JSON.stringify({ user_id: otherUserId, csrf_token: "t" }), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  const foreign = await app.inject({
    method: "POST",
    url: `/orders/${order["order_no"]}/pay`,
    headers: { cookie: "vh_legacy_session=sess-other3" },
    payload: { pay_type: "alipay", _csrf: "t" },
  });
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.json(), { ok: false, error: "订单不存在。" });

  void deps;
});

test("routes: GET /payments/sg65/return — public URL, private data (404 for strangers)", async () => {
  const { harness, app, headers, product, userId } = await routeHarness();
  const shop = await freshShop(harness);
  const order = await shop.createOrder(userId, Number(product["id"]), 1);

  const owner = await app.inject({ method: "GET", url: `/payments/sg65/return?out_trade_no=${order["order_no"]}`, headers });
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.json()["template"], "checkout/pay-return");

  const stranger = await app.inject({ method: "GET", url: `/payments/sg65/return?out_trade_no=${order["order_no"]}` });
  assert.equal(stranger.statusCode, 404);

  const guessed = await app.inject({ method: "GET", url: "/payments/sg65/return?out_trade_no=000000000000000000000000", headers });
  assert.equal(guessed.statusCode, 404);
});
