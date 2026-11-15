import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createSqliteDatabase, type Database } from "../../../packages/db/src/index.js";
import {
  EnvShopConfig,
  configurePaymentRoutes,
  configureShopRoutes,
  createShopLegacyDependencies,
  migrateShopSchema,
} from "../src/shop-legacy/index.js";
import type { ShopLegacyDependencies } from "../src/shop-legacy/index.js";
import { renderView } from "../src/render.js";

/**
 * Storefront page-render tests: every page route must answer real HTML
 * (layout + CSS classes), while /api/* keeps its JSON contract and the
 * shared 404/500 handlers stay in place.
 */

const NOW = "2026-01-02T00:00:00+00:00";

async function harness(): Promise<{
  app: FastifyInstance;
  db: Database;
  deps: ShopLegacyDependencies;
  userId: number;
  orderNo: string;
  basePath: string;
}> {
  const basePath = mkdtempSync(join(tmpdir(), "voicehubpay-pages-"));
  const db = createSqliteDatabase(":memory:");
  await migrateShopSchema(db);
  const config = new EnvShopConfig({
    SITE_NAME: "VoiceHubPay",
    SITE_BASE_URL: "https://shop.example.test",
    SG65_ENABLED: "1",
    SG65_ENABLED_TYPES: "alipay,wxpay",
    SG65_DEFAULT_PAYMENT_TYPE: "wxpay",
    ICP_BEIAN_NO: "京ICP备00000000号",
  } as NodeJS.ProcessEnv);

  const deps: ShopLegacyDependencies = {
    ...createShopLegacyDependencies(db, config, { basePath }),
    users: { findById: async (id: number) => (await db.query("SELECT * FROM users WHERE id = ?", [id])).rows[0] ?? null },
  };

  await db.query(
    "INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES ('alice', 'hash', 'Alice', ?, ?)",
    [NOW, NOW],
  );
  const userId = Number((await db.query("SELECT id FROM users WHERE username = 'alice'")).rows[0]!["id"]);
  await db.query(
    "INSERT INTO products (name, slug, description, price_cents, status, delivery_mode, stock_enabled, min_quantity, max_quantity, quantity_step, sort_order, created_at, updated_at) VALUES ('视频加速服务', 'video-pro', '高速稳定的视频加速。', 1990, 'active', 'card', 1, 1, 5, 1, 0, ?, ?)",
    [NOW, NOW],
  );
  const productId = Number((await db.query("SELECT id FROM products WHERE slug = 'video-pro'")).rows[0]!["id"]);
  await db.query(
    "INSERT INTO inventory_cards (product_id, secret_ciphertext, secret_hash, status, created_at, updated_at) VALUES (?, 'v1:abc', 'hash', 'available', ?, ?)",
    [productId, NOW, NOW],
  );

  const orderNo = "202601020000000000000001";
  await db.query(
    "INSERT INTO orders (order_no, user_id, amount_due_cents, amount_paid_cents, payment_status, fulfillment_status, created_at, updated_at, paid_at) VALUES (?, ?, 1990, 1990, 'paid', 'success', ?, ?, ?)",
    [orderNo, userId, NOW, NOW, NOW],
  );
  const orderId = Number((await db.query("SELECT id FROM orders WHERE order_no = ?", [orderNo])).rows[0]!["id"]);
  await db.query(
    "INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, created_at) VALUES (?, ?, '视频加速服务', 1990, 1, 'card', ?)",
    [orderId, productId, NOW],
  );
  const itemId = Number((await db.query("SELECT id FROM order_items WHERE order_id = ?", [orderId])).rows[0]!["id"]);
  const cipher = deps.crypto.encrypt("ABCD-EFGH-1234");
  await db.query(
    "INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, delivery_code_ciphertext, status, voicehub_status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 'success', 'not_required', ?, ?)",
    [orderId, itemId, `${orderNo}-001`, cipher, NOW, NOW],
  );
  await db.query(
    "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ["sess-pages", JSON.stringify({ user_id: userId, csrf_token: "pages-csrf" }), NOW, NOW],
  );

  const app = Fastify({ logger: false });
  configureShopRoutes(app, deps);
  configurePaymentRoutes(app, deps);
  return { app, db, deps, userId, orderNo, basePath };
}

const auth = { cookie: "vh_legacy_session=sess-pages" };

test("GET / renders the storefront home with hot products", async () => {
  const { app, db, basePath } = await harness();
  try {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /text\/html/);
    assert.match(response.body, /<!DOCTYPE html>/);
    assert.match(response.body, /数字服务/);
    assert.match(response.body, /热门服务/);
    assert.match(response.body, /视频加速服务/);
    assert.match(response.body, /<small>¥<\/small>19\.90/);
    assert.match(response.body, /\/assets\/css\/app\.css\?v=/);
    assert.match(response.body, /京ICP备00000000号/);
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("GET /products renders filters, cards and pagination base", async () => {
  const { app, db, basePath } = await harness();
  try {
    const response = await app.inject({ method: "GET", url: "/products?sort=price_asc" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /共 1 项服务/);
    assert.match(response.body, /class="product-card"/);
    assert.match(response.body, /href="\/product\/video-pro"/);
    assert.match(response.body, /class="seg-item active" href="\/products\?sort=price_asc"/);
    assert.match(response.body, /全部分类/);
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("GET /product/:slug renders the buy panel; unknown or draft slugs 404 as HTML", async () => {
  const { app, db, basePath } = await harness();
  try {
    const response = await app.inject({ method: "GET", url: "/product/video-pro", headers: auth });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<h1 class="pdp-title">视频加速服务<\/h1>/);
    assert.match(response.body, /¥19\.90/);
    assert.match(response.body, /库存 1 件/);
    assert.match(response.body, /name="_csrf" value="pages-csrf"/);
    assert.match(response.body, /action="\/orders"/);

    const missing = await app.inject({ method: "GET", url: "/product/nope" });
    assert.equal(missing.statusCode, 404);
    assert.match(String(missing.headers["content-type"]), /text\/html/);
    assert.match(missing.body, /页面不存在/);
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("GET /checkout/:orderNo renders the payment panel for the owner only", async () => {
  const { app, db, orderNo, basePath } = await harness();
  try {
    const anonymous = await app.inject({ method: "GET", url: `/checkout/${orderNo}` });
    assert.equal(anonymous.statusCode, 302);
    assert.match(String(anonymous.headers.location), /\/login\?redirect=/);

    const owner = await app.inject({ method: "GET", url: `/checkout/${orderNo}`, headers: auth });
    assert.equal(owner.statusCode, 200);
    assert.match(owner.body, /确认订单/);
    assert.match(owner.body, new RegExp(orderNo));
    assert.match(owner.body, /微信支付/);
    assert.match(owner.body, /name="pay_type" id="pay_type" value="wxpay"/);
    assert.match(owner.body, /¥19\.90 立即支付/);

    const foreign = await app.inject({ method: "GET", url: "/checkout/does-not-exist", headers: auth });
    assert.equal(foreign.statusCode, 404);
    assert.match(foreign.body, /页面不存在/);
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("GET /orders/:orderNo renders the account order detail with masked codes", async () => {
  const { app, db, orderNo, basePath } = await harness();
  try {
    const response = await app.inject({ method: "GET", url: `/orders/${orderNo}`, headers: auth });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /account-sidebar/);
    assert.match(response.body, /卡密 \/ 发货明细/);
    assert.match(response.body, new RegExp(`${orderNo}-001`));
    assert.match(response.body, /ABCD\*+34/);
    assert.match(response.body, /已支付/);
    assert.match(response.body, /已发货/);
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("404/500 render HTML pages while /api/* keeps JSON envelopes", async () => {
  const { app, db, basePath } = await harness();
  try {
    app.get("/boom", async () => {
      throw new Error("boom");
    });
    app.get("/api/boom", async () => {
      throw new Error("boom");
    });

    const page404 = await app.inject({ method: "GET", url: "/missing-page" });
    assert.equal(page404.statusCode, 404);
    assert.match(String(page404.headers["content-type"]), /text\/html/);
    assert.match(page404.body, /<title>404 · VoiceHubPay<\/title>/);
    assert.match(page404.body, /浏览服务/);

    const api404 = await app.inject({ method: "GET", url: "/api/missing" });
    assert.equal(api404.statusCode, 404);
    const apiBody = api404.json();
    assert.equal(apiBody["error"], "NOT_FOUND");
    assert.equal(typeof apiBody["requestId"], "string");

    const page500 = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(page500.statusCode, 500);
    assert.match(String(page500.headers["content-type"]), /text\/html/);
    assert.match(page500.body, /服务器发生了一个意外错误/);
    assert.match(page500.body, /请求编号/);

    const api500 = await app.inject({ method: "GET", url: "/api/boom" });
    assert.equal(api500.statusCode, 500);
    assert.equal(api500.json()["error"], "INTERNAL_ERROR");
  } finally {
    await app.close();
    await db.close();
    rmSync(basePath, { recursive: true, force: true });
  }
});

test("ported templates render standalone (register, complete-social, 403/500/maintenance)", async () => {
  const site = {
    name: "VoiceHubPay",
    url: "https://shop.example.test",
    auth_register: "/auth/password/register",
    auth_login: "/login",
    stat_code: "",
    icp: "",
  };
  const base = { site, csrf: "token", flash: null, pageTitle: null, nav: "", user: null };
  const cases: Array<[string, Record<string, unknown>, string, RegExp]> = [
    ["auth/register", { registration_enabled: true, qq_enabled: true, wx_enabled: true }, "auth", /创建账户/],
    ["auth/complete-social", { provider: "wx", nickname: "小新", avatar: "" }, "auth", /完善账号/],
    ["errors/403", {}, "shop", /无权访问/],
    ["errors/404", {}, "shop", /页面不存在/],
    ["errors/500", { request_id: "req-123" }, "shop", /req-123/],
    ["errors/maintenance", {}, "shop", /系统维护中/],
  ];
  for (const [view, data, layout, marker] of cases) {
    const html = await renderView(view, { ...base, ...data }, { layout });
    assert.match(html, /<!DOCTYPE html>/, `${view} must render inside its layout`);
    assert.match(html, marker, `${view} must render its copy`);
  }
});
