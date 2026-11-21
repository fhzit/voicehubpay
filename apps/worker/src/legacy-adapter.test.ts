import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLegacyWorkerPorts } from "./legacy-adapter.ts";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { applyMigrations, migrationFiles, migrationVersion } from "../../../packages/db/src/migrations.js";

test("fulfillment delivers each pending paid unit once and records successful delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "voicehub-worker-"));
  const dbPath = join(root, "db.sqlite");
  const storage = join(root, "storage");
  await mkdir(storage);
  await writeFile(join(storage, ".masterkey"), "a".repeat(64));
  const db = createSqliteDatabase(dbPath);
  const requests: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const migrations = await Promise.all(migrationFiles("sqlite").map(async (filename) => ({
      filename,
      version: migrationVersion("sqlite", filename),
      sql: await readFile(resolve(projectRoot, filename.startsWith("017_") ? "packages/db/migrations/sqlite" : "database/migrations/sqlite", filename), "utf8"),
    })));
    const executor = {
      exec: async (sql: string) => { await db.query(sql); },
      query: async (sql: string) => ({ rows: (await db.query(sql)).rows }),
    };
    await applyMigrations(executor, migrations);
    await db.query("INSERT INTO orders (order_no, user_id, payment_status, fulfillment_status, amount_due_cents, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["O1", 1, "paid", "pending", 100, "shop", "2026-01-01", "2026-01-01"]);
    await db.query("INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [1, 1, "Song", 100, 1, "voicehub", "shop_order_no", "2026-01-01"]);
    await db.query("INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, status, voicehub_status, voicehub_code_ciphertext, voicehub_code_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [1, 1, 1, "1", "pending", "pending", "CODE1", "hash1", "2026-01-01", "2026-01-01"]);
    await db.close();

    const ports = await createLegacyWorkerPorts({ DATABASE_PATH: dbPath, APP_BASE_PATH: root, VOICEHUB_API_BASE: "https://voicehub.example", VOICEHUB_API_TOKEN: "token" });
    assert.equal(await ports.fulfillment.process(10), 1);
    assert.equal(await ports.fulfillment.process(10), 0);
    assert.deepEqual(requests, [{
      url: "https://voicehub.example/api/open/card-codes",
      body: { codes: ["CODE1"], note: "voicehubpay | source=shop | order=O1 | unit=1 | amount=100" },
    }]);

    const verifyDb = createSqliteDatabase(dbPath);
    try {
      const unit = await verifyDb.query("SELECT status, voicehub_status, voicehub_attempts FROM fulfillment_units WHERE id = 1");
      const delivery = await verifyDb.query("SELECT status, attempts, response_payload FROM voicehub_deliveries WHERE fulfillment_unit_id = 1");
      assert.equal(unit.rows[0]?.status, "success");
      assert.equal(unit.rows[0]?.voicehub_status, "success");
      assert.equal(delivery.rows[0]?.status, "success");
      assert.equal(delivery.rows[0]?.attempts, 1);
      assert.deepEqual(JSON.parse(String(delivery.rows[0]?.response_payload)), { success: true });
    } finally {
      await verifyDb.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("库存卡密订单付款后直接标记已发货，库存卡转为已售", async () => {
  const root = await mkdtemp(join(tmpdir(), "voicehub-card-"));
  const dbPath = join(root, "db.sqlite");
  await mkdir(join(root, "storage"));
  await writeFile(join(root, "storage", ".masterkey"), "a".repeat(64));
  const db = createSqliteDatabase(dbPath);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ success: true }), { status: 200 }); };
  try {
    const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const migrations = await Promise.all(migrationFiles("sqlite").map(async (filename) => ({
      filename,
      version: migrationVersion("sqlite", filename),
      sql: await readFile(resolve(projectRoot, filename.startsWith("017_") ? "packages/db/migrations/sqlite" : "database/migrations/sqlite", filename), "utf8"),
    })));
    await applyMigrations({ exec: async (sql: string) => { await db.query(sql); }, query: async (sql: string) => ({ rows: (await db.query(sql)).rows }) }, migrations);
    // delivery_mode = card + voicehub_code_source = inventory: the stock card IS the deliverable.
    await db.query("INSERT INTO orders (order_no, user_id, payment_status, fulfillment_status, amount_due_cents, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["O2", 1, "paid", "pending", 100, "shop", "2026-01-01", "2026-01-01"]);
    await db.query("INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [1, 1, "Card", 100, 1, "card", "inventory", "2026-01-01"]);
    await db.query("INSERT INTO inventory_cards (product_id, secret_ciphertext, secret_hash, status, reserved_order_id, reserved_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [1, "CIPHER", "hash1", "reserved", 1, "2026-01-02", "2026-01-01", "2026-01-01"]);
    await db.query("INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, inventory_card_id, delivery_code_ciphertext, delivery_code_hash, status, voicehub_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [1, 1, 1, "1", 1, "CIPHER", "hash1", "pending", "not_required", "2026-01-01", "2026-01-01"]);
    await db.close();

    const ports = await createLegacyWorkerPorts({ DATABASE_PATH: dbPath, APP_BASE_PATH: root, VOICEHUB_API_BASE: "https://voicehub.example", VOICEHUB_API_TOKEN: "token" });
    // Delivered on the first sweep, and the order leaves the pending queue.
    assert.equal(await ports.fulfillment.process(10), 1);
    assert.equal(await ports.fulfillment.process(10), 0);
    assert.equal(calls, 0, "库存卡密不应触发 VoiceHub 推送");

    const verify = createSqliteDatabase(dbPath);
    try {
      const unit = (await verify.query("SELECT status, voicehub_status, fulfilled_at FROM fulfillment_units WHERE id = 1")).rows[0];
      assert.equal(unit?.status, "success");
      assert.equal(unit?.voicehub_status, "not_required");
      assert.ok(String(unit?.fulfilled_at ?? "") !== "", "fulfilled_at 应写入");
      const order = (await verify.query("SELECT fulfillment_status FROM orders WHERE id = 1")).rows[0];
      assert.equal(order?.fulfillment_status, "success");
      const card = (await verify.query("SELECT status, sold_order_id FROM inventory_cards WHERE id = 1")).rows[0];
      assert.equal(card?.status, "sold");
      assert.equal(Number(card?.sold_order_id), 1);
    } finally {
      await verify.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Afdian polling rejects negative amounts before storing or delivering", async () => {
  const root = await mkdtemp(join(tmpdir(), "voicehub-afdian-invalid-"));
  const dbPath = join(root, "db.sqlite");
  await mkdir(join(root, "storage"));
  await writeFile(join(root, "storage", ".masterkey"), "a".repeat(64));
  const db = createSqliteDatabase(dbPath);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ec: 200, data: { total_page: 1, list: [{ out_trade_no: "INVALID", total_amount: "-1", status: "2" }] } }), { status: 200 });
  try {
    const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const migrations = await Promise.all(migrationFiles("sqlite").map(async (filename) => ({ filename, version: migrationVersion("sqlite", filename), sql: await readFile(resolve(projectRoot, filename.startsWith("017_") ? "packages/db/migrations/sqlite" : "database/migrations/sqlite", filename), "utf8") })));
    await applyMigrations({ exec: async (sql: string) => { await db.query(sql); }, query: async (sql: string) => ({ rows: (await db.query(sql)).rows }) }, migrations);
    await db.close();
    const ports = await createLegacyWorkerPorts({ DATABASE_PATH: dbPath, APP_BASE_PATH: root, AFDIAN_USER_ID: "user", AFDIAN_API_TOKEN: "secret" });
    await assert.rejects(ports.afdian.poll(20), /invalid amount/i);
    const verify = createSqliteDatabase(dbPath);
    try { assert.equal((await verify.query("SELECT COUNT(*) AS count FROM afdian_orders")).rows[0]?.count, 0); }
    finally { await verify.close(); }
  } finally { globalThis.fetch = originalFetch; await db.close(); await rm(root, { recursive: true, force: true }); }
});

test("Afdian polling stores normalized orders and delivers paid trade number verbatim exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "voicehub-afdian-worker-"));
  const dbPath = join(root, "db.sqlite");
  await mkdir(join(root, "storage"));
  await writeFile(join(root, "storage", ".masterkey"), "a".repeat(64));
  const db = createSqliteDatabase(dbPath);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    if (url === "https://afdian.mock/api/open/query-order") return new Response(JSON.stringify({ ec: 200, data: { total_page: 1, list: [
      { out_trade_no: " 0007-A ", trade_no: "T-7", user_private_id: "U", user_name: "Buyer", remark: "memo", plan_id: "P", sku_detail: [{ name: "Tier", count: 2 }], total_amount: "12.30", status: "2", create_time: 1760000000 },
      { out_trade_no: "UNPAID-1", total_amount: "1", status: "1" },
    ] } }), { status: 200 });
    assert.equal(url, "https://voicehub.mock/api/open/card-codes");
    assert.deepEqual((body.codes as string[]), [" 0007-A "]);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const migrations = await Promise.all(migrationFiles("sqlite").map(async (filename) => ({ filename, version: migrationVersion("sqlite", filename), sql: await readFile(resolve(projectRoot, filename.startsWith("017_") ? "packages/db/migrations/sqlite" : "database/migrations/sqlite", filename), "utf8") })));
    await applyMigrations({ exec: async (sql: string) => { await db.query(sql); }, query: async (sql: string) => ({ rows: (await db.query(sql)).rows }) }, migrations);
    await db.close();
    const ports = await createLegacyWorkerPorts({ DATABASE_PATH: dbPath, APP_BASE_PATH: root, AFDIAN_USER_ID: "user", AFDIAN_API_TOKEN: "secret", AFDIAN_API_BASE: "https://afdian.mock", AFDIAN_POLL_LIMIT: "20", VOICEHUB_API_BASE: "https://voicehub.mock", VOICEHUB_API_TOKEN: "token" });
    assert.equal(await ports.afdian.poll(20), 1);
    assert.equal(await ports.afdian.poll(20), 0);
    const verify = createSqliteDatabase(dbPath);
    try {
      const rows = (await verify.query("SELECT out_trade_no, trade_no, user_id, buyer_name, remark, plan_id, sku_detail, amount_cents, status, voicehub_status, voicehub_attempts FROM afdian_orders ORDER BY out_trade_no")).rows;
      assert.equal(rows.length, 2);
      const paid = rows.find((row) => row.out_trade_no === " 0007-A ");
      assert.deepEqual(paid, { out_trade_no: " 0007-A ", trade_no: "T-7", user_id: "U", buyer_name: "Buyer", remark: "memo", plan_id: "P", sku_detail: "Tier x2", amount_cents: 1230, status: "paid", voicehub_status: "success", voicehub_attempts: 1 });
      assert.equal(rows.find((row) => row.out_trade_no === "UNPAID-1")?.voicehub_attempts, 0);
      const delivery = (await verify.query("SELECT source_order_no, idempotency_key, attempts, status FROM voicehub_deliveries WHERE source_type = 'afdian'")).rows[0];
      assert.deepEqual(delivery, { source_order_no: " 0007-A ", idempotency_key: "afdian: 0007-A ", attempts: 1, status: "success" });
      assert.equal(requests.filter((request) => request.url === "https://voicehub.mock/api/open/card-codes").length, 1);
      assert.equal(requests.filter((request) => request.url.endsWith("query-order")).length, 2);
      const signed = requests.find((request) => request.url.endsWith("query-order"))?.body;
      assert.equal(signed?.user_id, "user"); assert.equal(signed?.params, '{"page":1,"per_page":20}'); assert.match(String(signed?.sign), /^[a-f0-9]{32}$/);
    } finally { await verify.close(); }
  } finally { globalThis.fetch = originalFetch; await db.close(); await rm(root, { recursive: true, force: true }); }
});
