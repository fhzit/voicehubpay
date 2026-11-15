import assert from "node:assert/strict";
import { test } from "node:test";
import { CSRF, createHarness } from "./admin-harness.js";

test("products: create writes the row, redirects with flash and audits the actor", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);

  const res = await h.app.inject({
    method: "POST",
    url: "/admin/products/save",
    ...h.form({
      _csrf: CSRF,
      name: "高级会员月卡",
      price: "9.90",
      slug: "vip-monthly",
      status: "active",
      delivery_mode: "card",
      stock_enabled: "1",
      min_quantity: "1",
      max_quantity: "10",
      quantity_step: "1",
      low_stock_threshold: "2",
      sort_order: "5",
    }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/products");

  const row = (await h.db.query("SELECT * FROM products WHERE slug = ?", ["vip-monthly"])).rows[0];
  assert.ok(row, "product row must exist");
  assert.equal(row?.["name"], "高级会员月卡");
  assert.equal(Number(row?.["price_cents"]), 990);
  assert.equal(row?.["status"], "active");
  assert.equal(Number(row?.["stock_enabled"]), 1);

  const audit = (await h.db.query("SELECT * FROM audit_logs WHERE action = 'product.create'")).rows[0];
  assert.ok(audit, "product.create must be audited");
  assert.equal(Number(audit?.["user_id"]), adminId);
  await h.app.close();
});

test("products: invalid price is rejected without creating a row", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);

  for (const price of ["", "abc", "0"]) {
    const res = await h.app.inject({
      method: "POST",
      url: "/admin/products/save",
      ...h.form({ _csrf: CSRF, name: "坏价格", price, delivery_mode: "card" }),
    });
    assert.equal(res.statusCode, 303);
    assert.match(String(res.headers.location), /^\/admin\/products\/(create|edit)/);
  }
  const count = Number((await h.db.query("SELECT COUNT(*) AS n FROM products")).rows[0]?.["n"]);
  assert.equal(count, 0);
  await h.app.close();
});

test("inventory: manual import stores encrypted cards and reports duplicates", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);
  const productId = await h.seedProduct({ name: "导入测试", delivery_mode: "card" });

  const res = await h.app.inject({
    method: "POST",
    url: "/admin/inventory/import",
    ...h.form({
      _csrf: CSRF,
      product_id: String(productId),
      cards_text: "CARD-1----PASS-1\nCARD-2:PASS-2\nCARD-3\nCARD-1----PASS-1\n",
    }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, `/admin/inventory?product=${productId}`);
  const flash = Buffer.from(String(res.headers["x-flash-message"] ?? ""), "base64").toString("utf8");
  assert.match(flash, /成功 3 条/);
  assert.match(flash, /重复 1 条/);

  const cards = (await h.db.query("SELECT * FROM inventory_cards WHERE product_id = ? ORDER BY id", [productId])).rows;
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.notEqual(card["secret_ciphertext"], "");
    assert.ok(!String(card["secret_ciphertext"]).includes("CARD-"), "plaintext must never be stored");
    assert.equal(card["status"], "available");
  }
  const audit = (await h.db.query("SELECT * FROM audit_logs WHERE action = 'inventory.import'")).rows[0];
  assert.ok(audit);
  await h.app.close();
});

test("inventory: import rejects products that do not use stock", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);
  const productId = await h.seedProduct({ name: "人工发货", delivery_mode: "manual" });

  const res = await h.app.inject({
    method: "POST",
    url: "/admin/inventory/import",
    ...h.form({ _csrf: CSRF, product_id: String(productId), cards_text: "X" }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/inventory/import");
  const count = Number((await h.db.query("SELECT COUNT(*) AS n FROM inventory_cards")).rows[0]?.["n"]);
  assert.equal(count, 0);
  await h.app.close();
});

test("inventory: page ships the generate-cards form with the agreed field names", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  const cookie = await h.login(adminId);
  await h.seedProduct({ name: "生成测试", delivery_mode: "card" });

  const res = await h.app.inject({ method: "GET", url: "/admin/inventory", headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /action="\/admin\/inventory\/generate"/);
  for (const field of ["product_id", "count", "mode", "length", "charset", "custom_charset", "prefix", "suffix", "note"]) {
    assert.match(res.body, new RegExp(`name="${field}"`), `generate form must expose ${field}`);
  }
  assert.match(res.body, /value="alnum"/);
  assert.match(res.body, /value="pattern"/);
  assert.match(res.body, /value="digits" data-alias="numeric"/);
  assert.match(res.body, /\/admin\/inventory\/generate"[\s\S]*name="_csrf"/);
  await h.app.close();
});

test("orders: manual confirm verifies the admin password then marks the order paid", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin", password: "admin-pass-123" });
  await h.login(adminId);
  const buyerId = await h.seedUser({ username: "buyer" });
  const productId = await h.seedProduct({ name: "人工确认商品" });
  const { orderNo } = await h.seedOrder(buyerId, productId);

  const wrong = await h.app.inject({
    method: "POST",
    url: "/admin/orders/manual-confirm",
    ...h.form({ _csrf: CSRF, order_no: orderNo, reason: "线下转账", admin_password: "nope" }),
  });
  assert.equal(wrong.statusCode, 303);
  assert.equal(wrong.headers.location, `/admin/orders/${orderNo}`);
  let order = (await h.db.query("SELECT * FROM orders WHERE order_no = ?", [orderNo])).rows[0];
  assert.equal(order?.["payment_status"], "unpaid");

  const ok = await h.app.inject({
    method: "POST",
    url: "/admin/orders/manual-confirm",
    ...h.form({ _csrf: CSRF, order_no: orderNo, reason: "线下转账", admin_password: "admin-pass-123" }),
  });
  assert.equal(ok.statusCode, 303);
  assert.equal(ok.headers.location, `/admin/orders/${orderNo}`);
  order = (await h.db.query("SELECT * FROM orders WHERE order_no = ?", [orderNo])).rows[0];
  assert.equal(order?.["payment_status"], "paid");
  assert.equal(Number(order?.["amount_paid_cents"]), 1990);
  assert.equal(order?.["payment_confirmation_source"], "manual");
  assert.ok(order?.["paid_at"]);

  const audit = (await h.db.query("SELECT * FROM audit_logs WHERE action = 'order.manual_confirm'")).rows[0];
  assert.ok(audit, "manual confirmation must be audited");
  await h.app.close();
});

test("orders: detail page renders units, payments and the manual operations", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  const cookie = await h.login(adminId);
  const buyerId = await h.seedUser({ username: "buyer" });
  const productId = await h.seedProduct({ name: "详情商品" });
  const { orderNo, orderId } = await h.seedOrder(buyerId, productId);
  await h.db.query(
    "INSERT INTO payment_transactions (order_id, gateway, merchant_order_no, amount_cents, status, pay_type, confirmation_source, created_at, updated_at) VALUES (?, 'sg65', ?, 1990, 'pending', 'alipay', 'callback', ?, ?)",
    [orderId, orderNo, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );

  const res = await h.app.inject({ method: "GET", url: `/admin/orders/${orderNo}`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(orderNo));
  assert.match(res.body, /手动处理/);
  assert.match(res.body, /查询 SG65 支付状态/);
  assert.match(res.body, /人工确认付款/);
  await h.app.close();
});

test("orders: unpaid delete releases stock, cancels the order and the payment ledger", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);
  const buyerId = await h.seedUser({ username: "buyer" });
  const productId = await h.seedProduct({ name: "取消商品" });
  const { orderId, orderNo } = await h.seedOrder(buyerId, productId);

  await h.deps.inventory.import(productId, ["RESERVED-CARD"], h.deps.crypto);
  await h.deps.inventory.reserve(productId, 1, orderId, "2026-01-02T00:00:00+00:00");
  await h.db.query(
    "INSERT INTO payment_transactions (order_id, gateway, merchant_order_no, amount_cents, status, confirmation_source, created_at, updated_at) VALUES (?, 'sg65', ?, 1990, 'pending', 'callback', ?, ?)",
    [orderId, orderNo, "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );

  const res = await h.app.inject({ method: "POST", url: "/admin/orders/delete-unpaid", ...h.form({ _csrf: CSRF, order_no: orderNo, reason: "超时" }) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/orders");

  const order = (await h.db.query("SELECT * FROM orders WHERE id = ?", [orderId])).rows[0];
  assert.equal(order?.["order_status"], "cancelled");
  const card = (await h.db.query("SELECT * FROM inventory_cards WHERE product_id = ?", [productId])).rows[0];
  assert.equal(card?.["status"], "available");
  const tx = (await h.db.query("SELECT * FROM payment_transactions WHERE order_id = ?", [orderId])).rows[0];
  assert.equal(tx?.["status"], "cancelled");
  await h.app.close();
});

test("settings: general save persists through the settings store", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);

  const res = await h.app.inject({
    method: "POST",
    url: "/admin/settings/general",
    ...h.form({
      _csrf: CSRF,
      site_name: "新站名",
      site_url: "https://new.example.test/",
      timezone: "Asia/Shanghai",
      order_ttl: "45",
      page_size: "12",
      registration: "1",
      auth_secret_prefix: "/g/abc",
    }),
  });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/settings/general");
  assert.equal(h.config.get("SITE_NAME"), "新站名");
  assert.equal(h.config.get("SITE_URL"), "https://new.example.test");
  assert.equal(h.config.get("ORDER_TTL_MINUTES"), "45");
  assert.equal(h.config.get("AUTH_SECRET_PREFIX"), "/g/abc");
  await h.app.close();
});

test("settings: invalid general values are rejected", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);
  const bad = await h.app.inject({
    method: "POST",
    url: "/admin/settings/general",
    ...h.form({ _csrf: CSRF, site_name: "x", site_url: "javascript:alert(1)" }),
  });
  assert.equal(bad.statusCode, 303);
  assert.notEqual(h.config.get("SITE_URL"), "javascript:alert(1)");

  const badPrefix = await h.app.inject({
    method: "POST",
    url: "/admin/settings/general",
    ...h.form({ _csrf: CSRF, site_name: "x", site_url: "https://ok.example.test", auth_secret_prefix: "http://evil" }),
  });
  assert.equal(badPrefix.statusCode, 303);
  assert.equal(h.config.get("AUTH_SECRET_PREFIX", ""), "");
  await h.app.close();
});

test("pages: every admin GET route renders inside the admin layout", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  const cookie = await h.login(adminId);
  const buyerId = await h.seedUser({ username: "buyer" });
  const productId = await h.seedProduct({ name: "页面巡检商品" });
  const { orderNo, orderId, unitId } = await h.seedOrder(buyerId, productId);
  await h.deps.inventory.import(productId, ["SMOKE-CARD"], h.deps.crypto);
  await h.db.query(
    "INSERT INTO voicehub_deliveries (source_type, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, created_at, updated_at) VALUES ('shop', ?, ?, ?, ?, 'inventory', 'smoke-1', 'failed', 2, 'boom', ?, ?)",
    [orderNo, unitId, h.deps.crypto.encrypt("SMOKE-CODE"), h.deps.crypto.hash("SMOKE-CODE"), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  await h.deps.afdianOrders.createIfAbsent({
    out_trade_no: "AFD-SMOKE-1",
    user_id: "u1",
    buyer_name: "支持者",
    amount_cents: 1000,
    status: "paid",
    created_at: "2026-01-01T00:00:00+00:00",
  });
  await h.deps.audit?.log(adminId, "smoke.action", "order", orderNo, { note: "巡检" });

  const urls = [
    "/admin",
    "/admin/products",
    "/admin/products/create",
    `/admin/products/edit/${productId}`,
    "/admin/categories",
    "/admin/inventory",
    "/admin/inventory/import",
    "/admin/orders",
    `/admin/orders/${orderNo}`,
    "/admin/payments",
    "/admin/users",
    `/admin/users/${buyerId}`,
    "/admin/settings/general",
    "/admin/settings/payment",
    "/admin/settings/auth",
    "/admin/settings/afdian",
    "/admin/settings/voicehub",
    "/admin/settings/smtp",
    "/admin/settings/security",
    "/admin/audit",
    "/admin/voicehub",
    "/admin/voicehub/failures",
    "/admin/afdian",
    "/admin/system/database",
  ];
  for (const url of urls) {
    const res = await h.app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(res.statusCode, 200, `${url} must render (got ${res.statusCode})`);
    assert.ok(res.body.includes("admin-shell"), `${url} must use the admin layout`);
    assert.ok(!res.body.includes("Cannot read propert"), `${url} rendered a template error`);
  }
  await h.app.close();
});

test("voicehub: retry without a fulfillment seam answers with a flash instead of half-applying", async () => {
  const h = await createHarness();
  const adminId = await h.seedUser({ username: "root", role: "admin" });
  await h.login(adminId);
  const buyerId = await h.seedUser({ username: "buyer" });
  const productId = await h.seedProduct({ name: "重试商品" });
  const { orderNo, unitId } = await h.seedOrder(buyerId, productId);
  await h.db.query(
    "INSERT INTO voicehub_deliveries (source_type, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, created_at, updated_at) VALUES ('shop', ?, ?, ?, ?, 'inventory', 'retry-1', 'failed', 1, ?, ?)",
    [orderNo, unitId, h.deps.crypto.encrypt("CODE"), h.deps.crypto.hash("CODE"), "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"],
  );
  const delivery = (await h.db.query("SELECT id FROM voicehub_deliveries WHERE idempotency_key = 'retry-1'")).rows[0];

  const res = await h.app.inject({ method: "POST", url: "/admin/voicehub/retry", ...h.form({ _csrf: CSRF, delivery_id: String(delivery?.["id"]) }) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, "/admin/voicehub");
  const flash = Buffer.from(String(res.headers["x-flash-message"] ?? ""), "base64").toString("utf8");
  assert.match(flash, /发货服务未配置/);
  await h.app.close();
});
