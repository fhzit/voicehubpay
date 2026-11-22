import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  AfdianOrderRepository,
  CryptoService,
  OrderRepository,
  VoiceHubDeliveryRepository,
} from "../../../packages/db/src/legacy/index.js";
import { configureBotQuery, tokenMatches, type BotQueryDependencies } from "../src/bot-query.js";
import { buildApp } from "../src/app.js";

// ----------------------------------------------------------------------------------
// Harness: in-memory SQLite with only the tables the endpoint touches.
// ----------------------------------------------------------------------------------

const SHOP_ORDER_NO = "20261122153000001234";
const UNPAID_ORDER_NO = "20261122160000005678";
const AFDIAN_OUT_TRADE_NO = "AFD20261122001";
const TOKEN = "test-bot-token-0123456789";

/** Schema mirroring database/migrations/sqlite (orders, order_items, fulfillment_units,
 *  afdian_orders, voicehub_deliveries) — only the columns the query path reads. */
async function migrateBotSchema(db: Database): Promise<void> {
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
  await db.query(`CREATE TABLE IF NOT EXISTS afdian_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    out_trade_no VARCHAR(128) NOT NULL UNIQUE,
    trade_no VARCHAR(128) NOT NULL DEFAULT '',
    user_id VARCHAR(128) NOT NULL DEFAULT '',
    buyer_name VARCHAR(128) NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    plan_id VARCHAR(128) NOT NULL DEFAULT '',
    sku_detail TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(64) NOT NULL DEFAULT 'paid',
    raw_payload TEXT NOT NULL DEFAULT '',
    voicehub_status VARCHAR(64) NOT NULL DEFAULT 'pending',
    voicehub_attempts INTEGER NOT NULL DEFAULT 0,
    voicehub_last_error TEXT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT NULL,
    processed_at TEXT NULL,
    updated_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS voicehub_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type VARCHAR(32) NOT NULL,
    source_id BIGINT NULL,
    source_order_no VARCHAR(128) NOT NULL,
    fulfillment_unit_id BIGINT NULL,
    code_ciphertext TEXT NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    code_source VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    request_payload TEXT NULL,
    response_payload TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    success_at TEXT NULL)`);
}

interface Harness {
  db: Database;
  crypto: CryptoService;
  app: FastifyInstance;
  deps: BotQueryDependencies;
}

async function buildHarness(token = TOKEN): Promise<Harness> {
  const db = createSqliteDatabase(":memory:");
  await migrateBotSchema(db);
  const crypto = new CryptoService(mkdtempSync(join(tmpdir(), "vhp-bot-query-")));
  const deps: BotQueryDependencies = {
    orders: new OrderRepository(db),
    afdianOrders: new AfdianOrderRepository(db),
    deliveries: new VoiceHubDeliveryRepository(db),
    crypto,
    token,
  };
  const app = Fastify({ logger: false });
  configureBotQuery(app, deps);
  return { db, crypto, app, deps };
}

interface UnitSeed {
  index: number;
  unitNo: string;
  code?: string | null;
  voicehubCode?: string | null;
  status?: string;
  voicehubStatus?: string;
  voicehubError?: string | null;
  fulfilledAt?: string | null;
}

async function seedUnit(
  db: Database,
  crypto: CryptoService,
  orderId: number,
  itemId: number,
  unit: UnitSeed,
): Promise<void> {
  const now = "2026-11-22T07:30:00.000Z";
  const deliveryCipher = unit.code === undefined || unit.code === null ? null : crypto.encrypt(unit.code);
  const deliveryHash = unit.code === undefined || unit.code === null ? null : crypto.hash(unit.code);
  const voicehubCipher = unit.voicehubCode === undefined || unit.voicehubCode === null ? null : crypto.encrypt(unit.voicehubCode);
  const voicehubHash = unit.voicehubCode === undefined || unit.voicehubCode === null ? null : crypto.hash(unit.voicehubCode);
  await db.query(
    `INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, inventory_card_id, delivery_code_ciphertext, delivery_code_hash, voicehub_code_ciphertext, voicehub_code_hash, status, voicehub_status, voicehub_attempts, voicehub_last_error, manual_note, created_at, updated_at, fulfilled_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?)`,
    [
      orderId, itemId, unit.index, unit.unitNo,
      deliveryCipher, deliveryHash, voicehubCipher, voicehubHash,
      unit.status ?? "success", unit.voicehubStatus ?? "not_required",
      unit.voicehubError ?? null, now, now, unit.fulfilledAt ?? null,
    ],
  );
}

/**
 * Fixtures:
 *   SHOP_ORDER_NO  paid, 4 units — voicehub voucher -001, stock card -002,
 *                  manual unit -003 with no code (must be omitted), and
 *                  -009 with no hash (prefix fallback only).
 *   UNPAID_ORDER_NO unpaid, 1 unit with a voucher code already issued.
 *   AFDIAN_OUT_TRADE_NO paid Afdian order + one voicehub_deliveries row.
 */
async function seedFixtures(harness: Harness): Promise<void> {
  const { db, crypto } = harness;
  const createdAt = "2026-11-22T07:30:00.000Z";
  const paidAt = "2026-11-22T07:31:00.000Z";
  const fulfilledAt = "2026-11-22T07:32:00.000Z";

  await db.query(
    `INSERT INTO orders (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency, order_status, payment_status, fulfillment_status, created_at, updated_at, expires_at, paid_at, fulfilled_at)
     VALUES (?, 1, 'shop', 990, 990, 'CNY', 'active', 'paid', 'success', ?, ?, ?, ?, ?)`,
    [SHOP_ORDER_NO, createdAt, paidAt, "2026-11-22T08:00:00.000Z", paidAt, fulfilledAt],
  );
  const shopOrderId = Number((await db.query("SELECT id FROM orders WHERE order_no = ?", [SHOP_ORDER_NO])).rows[0]!["id"]);
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at)
     VALUES (?, 7, '点歌券', 330, 4, 'voicehub', 'inventory', ?)`,
    [shopOrderId, createdAt],
  );
  const itemId = Number((await db.query("SELECT id FROM order_items WHERE order_id = ?", [shopOrderId])).rows[0]!["id"]);

  // VoiceHub voucher: delivery + voicehub hashes both set, delivered.
  await seedUnit(db, crypto, shopOrderId, itemId, {
    index: 1,
    unitNo: `${SHOP_ORDER_NO}-001`,
    code: `${SHOP_ORDER_NO}-001`,
    voicehubCode: `${SHOP_ORDER_NO}-001`,
    voicehubStatus: "success",
    fulfilledAt,
  });
  // Stock card: voicehub not required => kind=card.
  await seedUnit(db, crypto, shopOrderId, itemId, {
    index: 2,
    unitNo: `${SHOP_ORDER_NO}-002`,
    code: "CARD-SECRET-7788",
    voicehubStatus: "not_required",
    fulfilledAt,
  });
  // Manual unit: no code yet => must not appear in coupons.
  await seedUnit(db, crypto, shopOrderId, itemId, {
    index: 3,
    unitNo: `${SHOP_ORDER_NO}-003`,
    code: null,
    status: "pending",
    voicehubStatus: "not_required",
  });
  // No hashes at all => only reachable through the "<orderNo>-NNN" prefix fallback.
  await seedUnit(db, crypto, shopOrderId, itemId, {
    index: 4,
    unitNo: `${SHOP_ORDER_NO}-004`,
    code: null,
    status: "pending",
    voicehubStatus: "not_required",
  });

  await db.query(
    `INSERT INTO orders (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency, order_status, payment_status, fulfillment_status, created_at, updated_at, expires_at, paid_at, fulfilled_at)
     VALUES (?, 2, 'shop', 990, 0, 'CNY', 'active', 'unpaid', 'pending', ?, ?, ?, NULL, NULL)`,
    [UNPAID_ORDER_NO, createdAt, createdAt, "2026-11-22T08:00:00.000Z"],
  );
  const unpaidOrderId = Number((await db.query("SELECT id FROM orders WHERE order_no = ?", [UNPAID_ORDER_NO])).rows[0]!["id"]);
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at)
     VALUES (?, 7, '点歌券', 990, 1, 'voicehub', 'inventory', ?)`,
    [unpaidOrderId, createdAt],
  );
  const unpaidItemId = Number((await db.query("SELECT id FROM order_items WHERE order_id = ?", [unpaidOrderId])).rows[0]!["id"]);
  await seedUnit(db, crypto, unpaidOrderId, unpaidItemId, {
    index: 1,
    unitNo: `${UNPAID_ORDER_NO}-001`,
    code: `${UNPAID_ORDER_NO}-001`,
    voicehubCode: `${UNPAID_ORDER_NO}-001`,
    status: "pending",
    voicehubStatus: "pending",
  });

  await db.query(
    `INSERT INTO afdian_orders (out_trade_no, trade_no, user_id, buyer_name, remark, plan_id, sku_detail, amount_cents, status, raw_payload, voicehub_status, voicehub_attempts, voicehub_last_error, created_at, paid_at, processed_at, updated_at)
     VALUES (?, 'TRADE-9988', 'af-user-1', '爱发电买家', '', 'plan-42', '点歌券x1', 990, 'paid', '[]', 'success', 1, NULL, ?, ?, ?, ?)`,
    [AFDIAN_OUT_TRADE_NO, createdAt, paidAt, fulfilledAt, fulfilledAt],
  );
  const afdianId = Number((await db.query("SELECT id FROM afdian_orders WHERE out_trade_no = ?", [AFDIAN_OUT_TRADE_NO])).rows[0]!["id"]);
  await db.query(
    `INSERT INTO voicehub_deliveries (source_type, source_id, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, request_payload, response_payload, created_at, updated_at, success_at)
     VALUES ('afdian', ?, ?, NULL, ?, ?, 'afdian_order_no', ?, 'success', 1, NULL, NULL, NULL, ?, ?, ?)`,
    [
      afdianId, AFDIAN_OUT_TRADE_NO,
      crypto.encrypt(AFDIAN_OUT_TRADE_NO), crypto.hash(AFDIAN_OUT_TRADE_NO),
      `afdian:${AFDIAN_OUT_TRADE_NO}`, createdAt, fulfilledAt, fulfilledAt,
    ],
  );
}

async function query(
  harness: Harness,
  body: unknown,
  headers: Record<string, string> = { "x-bot-token": TOKEN },
): Promise<{ status: number; json: () => Record<string, unknown> }> {
  const response = await harness.app.inject({ method: "POST", url: "/api/bot/coupon-query", headers, payload: body as never });
  return { status: response.statusCode, json: () => response.json() as Record<string, unknown> };
}

// ----------------------------------------------------------------------------------
// Auth + validation
// ----------------------------------------------------------------------------------

test("bot-query: 未配置 BOT_QUERY_TOKEN 时返回 503 BOT_QUERY_DISABLED", async () => {
  const harness = await buildHarness("");
  try {
    await seedFixtures(harness);
    const res = await query(harness, { query: SHOP_ORDER_NO }, {});
    assert.equal(res.status, 503);
    assert.deepEqual(res.json(), { ok: false, error: "BOT_QUERY_DISABLED" });
  } finally {
    await harness.app.close();
  }
});

test("bot-query: 缺失/错误令牌返回 401，正确令牌放行后不再 401", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    const missing = await query(harness, { query: SHOP_ORDER_NO }, {});
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.json(), { ok: false, error: "UNAUTHORIZED" });

    const wrongSameLength = await query(harness, { query: SHOP_ORDER_NO }, { "x-bot-token": `${TOKEN.slice(0, -1)}X` });
    assert.equal(wrongSameLength.status, 401);

    const wrongLength = await query(harness, { query: SHOP_ORDER_NO }, { "x-bot-token": "short" });
    assert.equal(wrongLength.status, 401);

    const wrongBearer = await query(harness, { query: SHOP_ORDER_NO }, { authorization: `Bearer ${TOKEN}-nope` });
    assert.equal(wrongBearer.status, 401);

    const ok = await query(harness, { query: SHOP_ORDER_NO }, { authorization: `Bearer ${TOKEN}` });
    assert.equal(ok.status, 200);

    // Constant-time comparison still answers true/false correctly.
    assert.equal(tokenMatches(TOKEN, TOKEN), true);
    assert.equal(tokenMatches(TOKEN, `${TOKEN}x`), false);
  } finally {
    await harness.app.close();
  }
});

test("bot-query: 非法 query 返回 400 INVALID_QUERY", async () => {
  const harness = await buildHarness();
  try {
    const bodies: unknown[] = [
      {},
      { query: "" },
      { query: "   " },
      { query: "abc12" }, // 只有 5 个字符
      { query: "abc def1" }, // 含空白
      { query: "abc\tdef1" }, // 含控制字符
      { query: `1${"a".repeat(128)}` }, // 超过 128
      { query: 123456 },
      { query: ["20261122153000001234"] },
      null,
    ];
    for (const body of bodies) {
      const res = await query(harness, body);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      assert.deepEqual(res.json(), { ok: false, error: "INVALID_QUERY" });
    }
    // 券码允许纯字母、中文与自定义标点前缀：不应被字符集拦截（查无此券 → 404）。
    for (const candidate of ["ABCDEFGH", "点歌券券券券", "VH.2026/ABCD"]) {
      const res = await query(harness, { query: candidate });
      assert.equal(res.status, 404, `expected 404 for ${candidate}`);
      assert.deepEqual(res.json(), { ok: false, error: "NOT_FOUND" });
    }
    // 前后空白会被 trim，不额外报错（仍走查询并 404）。
    const trimmed = await query(harness, { query: "  20261122153000001234  " });
    assert.equal(trimmed.status, 404);
  } finally {
    await harness.app.close();
  }
});

// ----------------------------------------------------------------------------------
// Shop orders
// ----------------------------------------------------------------------------------

test("bot-query: 商城订单号返回订单、商品项与每张券（card/voicehub 区分，无券码的 unit 省略）", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    const res = await query(harness, { query: SHOP_ORDER_NO });
    assert.equal(res.status, 200);
    const body = res.json() as Record<string, unknown>;

    assert.equal(body["ok"], true);
    assert.equal(body["found_by"], "shop_order");
    assert.equal(body["source"], "shop");

    const order = body["order"] as Record<string, unknown>;
    assert.equal(order["order_no"], SHOP_ORDER_NO);
    assert.equal(order["source"], "shop");
    assert.equal(order["amount_cents"], 990);
    assert.equal(order["amount_paid_cents"], 990);
    assert.equal(order["currency"], "CNY");
    assert.equal(order["payment_status"], "paid");
    assert.equal(order["order_status"], "active");
    assert.equal(order["fulfillment_status"], "success");
    assert.equal(order["created_at"], "2026-11-22T07:30:00.000Z");
    assert.equal(order["paid_at"], "2026-11-22T07:31:00.000Z");
    assert.equal(order["fulfilled_at"], "2026-11-22T07:32:00.000Z");
    assert.equal(order["expires_at"], "2026-11-22T08:00:00.000Z");
    assert.equal(order["afdian"], null);
    assert.deepEqual(order["items"], [
      { name: "点歌券", quantity: 4, unit_price_cents: 330, delivery_mode: "voicehub" },
    ]);

    const coupons = body["coupons"] as Array<Record<string, unknown>>;
    assert.equal(coupons.length, 2, "unit -003 (无券码) 与 -009 (无哈希) 都不出现在 coupons");

    assert.deepEqual(coupons[0], {
      code: `${SHOP_ORDER_NO}-001`,
      masked_code: harness.crypto.mask(`${SHOP_ORDER_NO}-001`),
      unit_no: `${SHOP_ORDER_NO}-001`,
      kind: "voicehub",
      unit_status: "success",
      voicehub_status: "success",
      voicehub_error: null,
      delivered_at: "2026-11-22T07:32:00.000Z",
    });

    assert.deepEqual(coupons[1], {
      code: "CARD-SECRET-7788",
      masked_code: "CARD**********88",
      unit_no: `${SHOP_ORDER_NO}-002`,
      kind: "card",
      unit_status: "success",
      voicehub_status: "not_required",
      voicehub_error: null,
      delivered_at: "2026-11-22T07:32:00.000Z",
    });

    // 明文只在鉴权响应里出现，掩码单独给出且不可还原。
    for (const coupon of coupons) {
      assert.equal(typeof coupon["code"], "string");
      assert.notEqual(coupon["masked_code"], coupon["code"]);
      assert.ok(String(coupon["masked_code"]).startsWith(String(coupon["code"]).slice(0, 4)));
      assert.ok(String(coupon["masked_code"]).endsWith(String(coupon["code"]).slice(-2)));
    }
    // 金额一律整数分（没有浮点/字符串）。
    assert.equal(Number.isInteger(order["amount_cents"]), true);
    assert.equal(Number.isInteger((order["items"] as Array<Record<string, unknown>>)[0]!["unit_price_cents"]), true);
  } finally {
    await harness.app.close();
  }
});

test("bot-query: 券码反查订单（delivery_code_hash / voicehub_code_hash 两条哈希列都命中）", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);

    const stockCard = await query(harness, { query: "CARD-SECRET-7788" });
    assert.equal(stockCard.status, 200);
    const stockBody = stockCard.json() as Record<string, unknown>;
    assert.equal(stockBody["found_by"], "coupon_code");
    assert.equal(stockBody["source"], "shop");
    assert.equal((stockBody["order"] as Record<string, unknown>)["order_no"], SHOP_ORDER_NO);
    const stockCoupons = stockBody["coupons"] as Array<Record<string, unknown>>;
    assert.equal(stockCoupons.length, 2, "券码反查返回该订单的全部券");
    assert.equal(stockCoupons[1]!["code"], "CARD-SECRET-7788");

    const voucher = await query(harness, { query: `${SHOP_ORDER_NO}-001` });
    assert.equal(voucher.status, 200);
    const voucherBody = voucher.json() as Record<string, unknown>;
    assert.equal(voucherBody["found_by"], "coupon_code");
    assert.equal((voucherBody["order"] as Record<string, unknown>)["order_no"], SHOP_ORDER_NO);
    assert.equal((voucherBody["coupons"] as Array<Record<string, unknown>>)[0]!["code"], `${SHOP_ORDER_NO}-001`);

    // 大小写与库存记录不同也能反查到同一订单（原文 → 大写 → 小写）。
    const lower = await query(harness, { query: "card-secret-7788" });
    assert.equal(lower.status, 200);
    assert.equal(((lower.json() as Record<string, unknown>)["order"] as Record<string, unknown>)["order_no"], SHOP_ORDER_NO);

    // 哈希是 SHA-256 的明文十六进制摘要，不是明文本身。
    assert.equal(harness.crypto.hash("CARD-SECRET-7788").length, 64);
  } finally {
    await harness.app.close();
  }
});

test("bot-query: 无哈希的 <orderNo>-NNN 仍能按前缀订单号回退", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    const res = await query(harness, { query: `${SHOP_ORDER_NO}-004` });
    assert.equal(res.status, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body["found_by"], "coupon_code");
    assert.equal((body["order"] as Record<string, unknown>)["order_no"], SHOP_ORDER_NO);
    assert.equal((body["coupons"] as Array<Record<string, unknown>>).length, 2);
  } finally {
    await harness.app.close();
  }
});

test("bot-query: 未支付订单同样返回（payment_status=unpaid，券为 pending）", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    const res = await query(harness, { query: UNPAID_ORDER_NO });
    assert.equal(res.status, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body["found_by"], "shop_order");
    const order = body["order"] as Record<string, unknown>;
    assert.equal(order["order_no"], UNPAID_ORDER_NO);
    assert.equal(order["payment_status"], "unpaid");
    assert.equal(order["amount_paid_cents"], 0);
    assert.equal(order["paid_at"], null);
    assert.equal(order["fulfilled_at"], null);
    const coupons = body["coupons"] as Array<Record<string, unknown>>;
    assert.equal(coupons.length, 1);
    assert.equal(coupons[0]!["kind"], "voicehub");
    assert.equal(coupons[0]!["voicehub_status"], "pending");
    assert.equal(coupons[0]!["unit_status"], "pending");
    assert.equal(coupons[0]!["delivered_at"], null);
  } finally {
    await harness.app.close();
  }
});

// ----------------------------------------------------------------------------------
// Afdian orders
// ----------------------------------------------------------------------------------

test("bot-query: 爱发电订单返回 out_trade_no、sku_detail 商品项、afdian 子对象与发货券", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    const res = await query(harness, { query: AFDIAN_OUT_TRADE_NO }, { authorization: `Bearer ${TOKEN}` });
    assert.equal(res.status, 200);
    const body = res.json() as Record<string, unknown>;
    assert.equal(body["ok"], true);
    assert.equal(body["found_by"], "afdian_order");
    assert.equal(body["source"], "afdian");

    const order = body["order"] as Record<string, unknown>;
    assert.equal(order["order_no"], AFDIAN_OUT_TRADE_NO);
    assert.equal(order["source"], "afdian");
    assert.equal(order["amount_cents"], 990);
    assert.equal(order["amount_paid_cents"], 990);
    assert.equal(order["currency"], "CNY");
    assert.equal(order["payment_status"], "paid");
    assert.equal(order["fulfillment_status"], "success");
    assert.equal(order["created_at"], "2026-11-22T07:30:00.000Z");
    assert.equal(order["paid_at"], "2026-11-22T07:31:00.000Z");
    assert.equal(order["fulfilled_at"], null);
    assert.equal(order["expires_at"], null);
    assert.deepEqual(order["items"], [
      { name: "点歌券x1", quantity: 1, unit_price_cents: 990, delivery_mode: "voicehub" },
    ]);
    assert.deepEqual(order["afdian"], {
      trade_no: "TRADE-9988",
      plan_id: "plan-42",
      sku_detail: "点歌券x1",
    });

    assert.deepEqual(body["coupons"], [
      {
        code: AFDIAN_OUT_TRADE_NO,
        masked_code: harness.crypto.mask(AFDIAN_OUT_TRADE_NO),
        unit_no: "",
        kind: "voicehub",
        unit_status: "success",
        voicehub_status: "success",
        voicehub_error: null,
        delivered_at: "2026-11-22T07:32:00.000Z",
      },
    ]);

    // 券码反查同一笔爱发电订单（voicehub_deliveries.code_hash）。
    const byCode = await query(harness, { query: AFDIAN_OUT_TRADE_NO });
    assert.equal(byCode.status, 200);
    assert.equal((byCode.json() as Record<string, unknown>)["found_by"], "afdian_order");
  } finally {
    await harness.app.close();
  }
});

// ----------------------------------------------------------------------------------
// Not found
// ----------------------------------------------------------------------------------

test("bot-query: 未知订单号/券码返回 404 NOT_FOUND", async () => {
  const harness = await buildHarness();
  try {
    await seedFixtures(harness);
    for (const unknown of ["99999999999999999999", "NOSUCHCODE1", "20261122999999999999-777"]) {
      const res = await query(harness, { query: unknown });
      assert.equal(res.status, 404, `expected 404 for ${unknown}`);
      assert.deepEqual(res.json(), { ok: false, error: "NOT_FOUND" });
    }
  } finally {
    await harness.app.close();
  }
});

// ----------------------------------------------------------------------------------
// buildApp wiring
// ----------------------------------------------------------------------------------

test("bot-query: buildApp 注册路由（未配置令牌 503 / 配置后按令牌查询）", async () => {
  const harness = await buildHarness();
  const disabled = buildApp({ botQuery: { ...harness.deps, token: "" } });
  const enabled = buildApp({ botQuery: harness.deps });
  try {
    await seedFixtures(harness);

    const off = await disabled.inject({
      method: "POST",
      url: "/api/bot/coupon-query",
      headers: { "x-bot-token": TOKEN },
      payload: { query: SHOP_ORDER_NO },
    });
    assert.equal(off.statusCode, 503);
    assert.deepEqual(off.json(), { ok: false, error: "BOT_QUERY_DISABLED" });

    const on = await enabled.inject({
      method: "POST",
      url: "/api/bot/coupon-query",
      headers: { "x-bot-token": TOKEN },
      payload: { query: SHOP_ORDER_NO },
    });
    assert.equal(on.statusCode, 200);
    assert.equal(on.json().found_by, "shop_order");
  } finally {
    await disabled.close();
    await enabled.close();
    await harness.app.close();
  }
});
