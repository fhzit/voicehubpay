/**
 * Shared harness for the admin route tests: in-memory SQLite with the legacy
 * schema, the real legacy repositories and a cookie-authenticated session.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  AfdianOrderRepository,
  AuditLogRepository,
  CategoryRepository,
  CryptoService,
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  ProductRepository,
  SocialIdentityRepository,
  UserRepository,
  VoiceHubDeliveryRepository,
} from "../../../packages/db/src/legacy/index.js";
import { PasswordHasher, SqliteSessionStore } from "../src/auth-legacy/index.js";
import { registerAdminRoutes } from "../src/admin/index.js";
import type { AdminConfigPort, AdminDependencies, AdminSettingsPort } from "../src/admin/types.js";

export const CSRF = "test-csrf-token";

export class TestAdminConfig implements AdminConfigPort {
  readonly settings: AdminSettingsPort;
  values: Record<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = { SITE_NAME: "VoiceHubPay Test", SITE_URL: "https://shop.example.test", ...values };
    this.settings = {
      all: () => ({ ...this.values }),
      saveMany: (next: Record<string, string>) => {
        this.values = { ...this.values, ...next };
      },
      remove: (keys: readonly string[]) => {
        for (const key of keys) delete this.values[key];
      },
    };
  }

  get(key: string, fallback = ""): string {
    const value = this.values[key];
    return value === undefined || value === "" ? fallback : value;
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.get(key, "");
    if (value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }

  int(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.get(key, ""), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  authUrl(route: string): string {
    return route;
  }

  appUrl(): string {
    return this.get("SITE_URL", "http://localhost").replace(/\/+$/, "");
  }

  secret(key: string, fallback = ""): string {
    return this.get(key, fallback);
  }

  setSecret(key: string, value: string): void {
    this.values[key] = value;
  }
}

export interface AdminHarness {
  db: Database;
  app: FastifyInstance;
  deps: AdminDependencies;
  sessions: SqliteSessionStore;
  config: TestAdminConfig;
  basePath: string;
  login(userId: number): Promise<string>;
  seedUser(overrides?: Record<string, unknown>): Promise<number>;
  seedProduct(overrides?: Record<string, unknown>): Promise<number>;
  seedOrder(userId: number, productId: number, overrides?: Record<string, unknown>): Promise<{ orderId: number; orderNo: string; unitId: number }>;
  form(payload: Record<string, string>): { payload: string; headers: Record<string, string> };
}

export async function createHarness(): Promise<AdminHarness> {
  const basePath = mkdtempSync(path.join(tmpdir(), "admin-test-"));
  const db = createSqliteDatabase(":memory:");
  await migrate(db);
  const crypto = new CryptoService(basePath);
  const sessions = new SqliteSessionStore(db);
  await sessions.ensureSchema();
  const config = new TestAdminConfig();

  const deps: AdminDependencies = {
    products: new ProductRepository(db),
    categories: new CategoryRepository(db),
    inventory: new InventoryRepository(db),
    orders: new OrderRepository(db),
    payments: new PaymentTransactionRepository(db),
    users: new UserRepository(db),
    audit: new AuditLogRepository(db),
    voicehubDeliveries: new VoiceHubDeliveryRepository(db),
    afdianOrders: new AfdianOrderRepository(db),
    config,
    sessions,
    crypto,
    social: new SocialIdentityRepository(db),
    db,
    clock: { now: () => Math.floor(Date.now() / 1000) },
  };

  const app = Fastify({ logger: false });
  registerAdminRoutes(app, deps);
  await app.ready();

  let cookie: string | null = null;
  let sessionCounter = 0;

  const harness: AdminHarness = {
    db,
    app,
    deps,
    sessions,
    config,
    basePath,
    async login(userId: number): Promise<string> {
      sessionCounter += 1;
      const id = `session-${sessionCounter}-${Math.random().toString(36).slice(2, 10)}`;
      await sessions.create(id, { user_id: userId, csrf_token: CSRF, admin_last_seen_at: Math.floor(Date.now() / 1000) });
      cookie = `vh_legacy_session=${id}`;
      return cookie;
    },
    async seedUser(overrides: Record<string, unknown> = {}): Promise<number> {
      const username = String(overrides["username"] ?? `user-${Math.random().toString(36).slice(2, 8)}`);
      const passwordHash = overrides["password"] !== undefined
        ? await PasswordHasher.hash(String(overrides["password"]))
        : (overrides["password_hash"] as string | null | undefined) ?? null;
      const now = "2026-01-01T00:00:00+00:00";
      await db.query(
        "INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          username,
          passwordHash,
          String(overrides["display_name"] ?? username),
          "",
          String(overrides["email"] ?? ""),
          String(overrides["role"] ?? "user"),
          String(overrides["status"] ?? "active"),
          now,
          now,
        ],
      );
      const row = (await db.query("SELECT id FROM users WHERE username = ?", [username])).rows[0];
      return Number(row?.["id"]);
    },
    async seedProduct(overrides: Record<string, unknown> = {}): Promise<number> {
      const now = "2026-01-01T00:00:00+00:00";
      const slug = String(overrides["slug"] ?? `product-${Math.random().toString(36).slice(2, 8)}`);
      await db.query(
        `INSERT INTO products (category_id, name, slug, description, cover_image, price_cents, status, delivery_mode, voicehub_enabled, voicehub_code_source, stock_enabled, min_quantity, max_quantity, quantity_step, low_stock_threshold, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          overrides["category_id"] ?? null,
          String(overrides["name"] ?? "测试卡密"),
          slug,
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
          Number(overrides["low_stock_threshold"] ?? 0),
          Number(overrides["sort_order"] ?? 0),
          now,
          now,
        ],
      );
      const row = (await db.query("SELECT id FROM products WHERE slug = ?", [slug])).rows[0];
      return Number(row?.["id"]);
    },
    async seedOrder(userId: number, productId: number, overrides: Record<string, unknown> = {}) {
      const now = "2026-01-01T00:00:00+00:00";
      const orderNo = String(overrides["order_no"] ?? `20260101000000${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`);
      await db.query(
        `INSERT INTO orders (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency, order_status, payment_status, fulfillment_status, payment_gateway, payment_confirmation_source, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNo,
          userId,
          String(overrides["source"] ?? "shop"),
          Number(overrides["amount_due_cents"] ?? 1990),
          Number(overrides["amount_paid_cents"] ?? 0),
          "CNY",
          String(overrides["order_status"] ?? "active"),
          String(overrides["payment_status"] ?? "unpaid"),
          String(overrides["fulfillment_status"] ?? "pending"),
          "",
          "",
          now,
          now,
          (overrides["expires_at"] as string | null | undefined) ?? null,
        ],
      );
      const orderId = Number((await db.query("SELECT id FROM orders WHERE order_no = ?", [orderNo])).rows[0]?.["id"]);
      await db.query(
        "INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [orderId, productId, "测试卡密", 1990, 1, "card", "inventory", now],
      );
      const orderItemId = Number((await db.query("SELECT id FROM order_items WHERE order_id = ?", [orderId])).rows[0]?.["id"]);
      await db.query(
        "INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, status, voicehub_status, voicehub_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
        [orderId, orderItemId, 1, `${orderNo}-001`, "pending", "not_required", now, now],
      );
      const unitId = Number((await db.query("SELECT id FROM fulfillment_units WHERE order_id = ?", [orderId])).rows[0]?.["id"]);
      return { orderId, orderNo, unitId };
    },
    form(payload: Record<string, string>) {
      const body = new URLSearchParams(payload).toString();
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (cookie !== null) headers["cookie"] = cookie;
      return { payload: body, headers };
    },
  };
  return harness;
}

async function migrate(db: Database): Promise<void> {
  const now = "2026-01-01T00:00:00+00:00";
  void now;
  await db.query(`CREATE TABLE users (
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
  await db.query(`CREATE TABLE social_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider VARCHAR(16) NOT NULL,
    social_uid VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url VARCHAR(512) NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, social_uid))`);
  await db.query(`CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE products (
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
  await db.query(`CREATE TABLE inventory_cards (
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
  await db.query(`CREATE TABLE orders (
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
  await db.query(`CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name_snapshot VARCHAR(128) NOT NULL,
    product_price_cents_snapshot INTEGER NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_mode_snapshot VARCHAR(32) NOT NULL DEFAULT 'card',
    voicehub_code_source_snapshot VARCHAR(32) NOT NULL DEFAULT 'inventory',
    created_at TEXT NOT NULL)`);
  await db.query(`CREATE TABLE fulfillment_units (
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
  await db.query(`CREATE TABLE payment_transactions (
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
  await db.query(`CREATE TABLE voicehub_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type VARCHAR(32) NOT NULL,
    source_id INTEGER NULL,
    source_order_no VARCHAR(128) NOT NULL,
    fulfillment_unit_id INTEGER NULL,
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
  await db.query(`CREATE TABLE afdian_orders (
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
  await db.query(`CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(128) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL)`);
}
