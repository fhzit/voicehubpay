import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  AuditLogRepository,
  CryptoService,
  InventoryRepository,
  ProductRepository,
} from "../../../packages/db/src/legacy/index.js";
import { generateCodes } from "../../../packages/db/src/legacy/code-generator.js";
import { insertGeneratedCodes } from "../../../packages/db/src/legacy/inventory-repository.js";
import { registerInventoryGenerateRoutes, type InventoryGenerateDependencies } from "../src/admin-inventory-generate.js";
import { SESSION_COOKIE } from "../src/auth-legacy/session-manager.js";
import type { SessionStore } from "../src/auth-legacy/types.js";

/**
 * In-memory SQLite fixture mirroring the legacy schema tables this route
 * touches (users, products, inventory_cards, audit_logs, sessions).
 */
async function migrateSchema(db: Database): Promise<void> {
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

function sqliteSessions(db: Database): SessionStore {
  return {
    async load(id) {
      const row = (await db.query("SELECT data FROM sessions WHERE session_id = ?", [id])).rows[0];
      if (row === undefined) return null;
      try {
        return JSON.parse(String(row["data"] ?? "{}")) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
    async create(id, data) {
      await db.query(
        "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [id, JSON.stringify(data), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
      );
    },
    async save(id, data) {
      await db.query("UPDATE sessions SET data = ? WHERE session_id = ?", [JSON.stringify(data), id]);
    },
    async destroy(id) {
      await db.query("DELETE FROM sessions WHERE session_id = ?", [id]);
    },
  };
}

const ADMIN_SESSION = "admin-session";
const CSRF_TOKEN = "csrf-token-123";

interface Harness {
  app: FastifyInstance;
  db: Database;
  crypto: CryptoService;
  audit: AuditLogRepository;
  inventory: InventoryRepository;
  cookie: string;
  close(): Promise<void>;
}

async function createHarness(options: { role?: string } = {}): Promise<Harness> {
  const db = createSqliteDatabase(":memory:");
  await migrateSchema(db);
  const now = "2026-01-01T00:00:00+00:00";
  await db.query(
    "INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["admin", null, "管理员", "", "", options.role ?? "admin", "active", now, now],
  );
  await db.query(
    "INSERT INTO products (name, slug, price_cents, status, delivery_mode, stock_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["卡密商品", "card-product", 1000, "active", "card", 1, now, now],
  );
  await db.query(
    "INSERT INTO products (name, slug, price_cents, status, delivery_mode, stock_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["直充商品", "voicehub-product", 1000, "active", "voicehub", 0, now, now],
  );
  await db.query("INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)", [
    ADMIN_SESSION,
    JSON.stringify({ user_id: 1, csrf_token: CSRF_TOKEN }),
    now,
    now,
  ]);

  const crypto = new CryptoService(mkdtempSync(join(tmpdir(), "vhp-inventory-generate-")));
  const audit = new AuditLogRepository(db);
  const deps: InventoryGenerateDependencies = {
    db,
    products: new ProductRepository(db),
    users: {
      async findById(id) {
        return (await db.query("SELECT * FROM users WHERE id = ?", [id])).rows[0] ?? null;
      },
    },
    sessions: sqliteSessions(db),
    audit,
    crypto,
    clock: { now: () => 1_760_000_000 },
    secureCookies: false,
  };
  const app = Fastify({ logger: false });
  registerInventoryGenerateRoutes(app, deps);
  await app.ready();

  return {
    app,
    db,
    crypto,
    audit,
    inventory: new InventoryRepository(db),
    cookie: `${SESSION_COOKIE}=${ADMIN_SESSION}`,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

function form(payload: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString();
}

test("unauthenticated POST /admin/inventory/generate redirects (302) to login", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  const response = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 5, _csrf: CSRF_TOKEN }),
  });

  assert.equal(response.statusCode, 302);
  assert.match(String(response.headers.location), /^\/login\?redirect=/);
  const count = await harness.db.query("SELECT COUNT(*) AS n FROM inventory_cards");
  assert.equal(Number(count.rows[0]?.n), 0);
});

test("a logged-in non-admin is rejected with 403", async (t) => {
  const harness = await createHarness({ role: "user" });
  t.after(async () => harness.close());

  const response = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 5, _csrf: CSRF_TOKEN }),
  });

  assert.equal(response.statusCode, 403);
  const count = await harness.db.query("SELECT COUNT(*) AS n FROM inventory_cards");
  assert.equal(Number(count.rows[0]?.n), 0);
});

test("a missing CSRF token is rejected and writes nothing", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  const missing = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 5 }),
  });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.headers["x-flash-type"], "error");

  const wrong = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 5, _csrf: "not-the-token" }),
  });
  assert.equal(wrong.statusCode, 403);

  const count = await harness.db.query("SELECT COUNT(*) AS n FROM inventory_cards");
  assert.equal(Number(count.rows[0]?.n), 0);
});

test("generates cards, encrypts them like an import, audits and redirects 303 with flash", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  const response = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({
      product_id: 1,
      count: 5,
      mode: "random",
      length: 12,
      charset: "alnum",
      prefix: "VH-",
      suffix: "",
      note: "首发生成",
      _csrf: CSRF_TOKEN,
    }),
  });

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/admin/inventory?product_id=1");
  assert.equal(response.headers["x-flash-type"], "success");
  const flash = Buffer.from(String(response.headers["x-flash-message"]), "base64").toString("utf8");
  assert.match(flash, /新增 5 条/);
  assert.match(flash, /重复跳过 0 条/);

  const rows = (await harness.db.query("SELECT * FROM inventory_cards WHERE product_id = 1 ORDER BY id")).rows;
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.status, "available");
    assert.equal(row.product_id, 1);
    const ciphertext = String(row.secret_ciphertext);
    assert.match(ciphertext, /^v1:/);
    const plaintext = harness.crypto.decrypt(ciphertext);
    assert.match(plaintext, /^VH-[A-Za-z0-9]{12}$/);
    assert.equal(row.secret_hash, harness.crypto.hash(plaintext));
    assert.equal(typeof row.created_at, "string");
    assert.equal(row.reserved_order_id, null);
  }

  const auditRows = (await harness.db.query("SELECT * FROM audit_logs WHERE action = 'inventory.generate'")).rows;
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].user_id, 1);
  assert.equal(auditRows[0].object_type, "product");
  assert.equal(auditRows[0].object_id, "1");
  const metadata = JSON.parse(String(auditRows[0].metadata));
  assert.equal(metadata.requested, 5);
  assert.equal(metadata.inserted, 5);
  assert.equal(metadata.duplicates, 0);

  // The reserved/sold pipeline must be able to read the generated card back.
  const reserved = await harness.inventory.reserve(1, 1, 4242, "2030-01-01T00:00:00+00:00", true, harness.crypto);
  assert.equal(reserved.length, 1);
  assert.match(String(reserved[0].secret_plain), /^VH-[A-Za-z0-9]{12}$/);
});

test("duplicate codes are skipped and never inserted twice", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  // Saturate the 2^4 = 16 code space for product 1 up front.
  const allCodes = generateCodes({ count: 16, mode: "pattern", length: 4, charset: "custom", customCharset: "AB" });
  const seeded = await insertGeneratedCodes(harness.db, { productId: 1, codes: allCodes, crypto: harness.crypto });
  assert.deepEqual(seeded, { inserted: 16, duplicates: 0 });

  const response = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({
      product_id: 1,
      count: 8,
      mode: "pattern",
      length: 4,
      charset: "custom",
      custom_charset: "AB",
      _csrf: CSRF_TOKEN,
    }),
  });

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/admin/inventory?product_id=1");
  const flash = Buffer.from(String(response.headers["x-flash-message"]), "base64").toString("utf8");
  assert.match(flash, /新增 0 条/);
  assert.match(flash, /重复跳过 8 条/);

  const rows = (await harness.db.query("SELECT * FROM inventory_cards WHERE product_id = 1")).rows;
  assert.equal(rows.length, 16);
});

test("invalid parameters and non-stock products redirect with an error flash and write nothing", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  const badCount = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 0, _csrf: CSRF_TOKEN }),
  });
  assert.equal(badCount.statusCode, 303);
  assert.equal(badCount.headers["x-flash-type"], "error");

  const badLength = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 1, count: 2, length: 3, _csrf: CSRF_TOKEN }),
  });
  assert.equal(badLength.statusCode, 303);

  const noStock = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 2, count: 2, _csrf: CSRF_TOKEN }),
  });
  assert.equal(noStock.statusCode, 303);
  assert.equal(noStock.headers.location, "/admin/inventory?product_id=2");

  const missingProduct = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ product_id: 999, count: 2, _csrf: CSRF_TOKEN }),
  });
  assert.equal(missingProduct.statusCode, 303);

  const count = await harness.db.query("SELECT COUNT(*) AS n FROM inventory_cards");
  assert.equal(Number(count.rows[0]?.n), 0);
});

test("JSON bodies and the X-CSRF-Token header are accepted", async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());

  const response = await harness.app.inject({
    method: "POST",
    url: "/admin/inventory/generate",
    headers: { cookie: harness.cookie, "x-csrf-token": CSRF_TOKEN },
    payload: { product_id: 1, count: 3, mode: "random", length: 8 },
  });

  assert.equal(response.statusCode, 303);
  const count = await harness.db.query("SELECT COUNT(*) AS n FROM inventory_cards");
  assert.equal(Number(count.rows[0]?.n), 3);
});
