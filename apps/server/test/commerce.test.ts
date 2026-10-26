import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import type { ShopLegacyDependencies, Row } from "../src/shop-legacy/types.js";
import { buildApp } from "../src/app.js";
import { hashSessionToken } from "../src/auth.js";
const token = "a".repeat(43), csrf = "b".repeat(43);
const product = { id: 1, name: "Visible", slug: "visible", description: "", priceCents: 900, status: "active" as const };
const hidden = { ...product, id: 2, name: "Draft", slug: "draft", status: "draft" as const };
function fixture(userId = "customer", admin = false, shop?: ShopLegacyDependencies, sessionUserId = userId) {
 const created: unknown[] = [];
 const commerce = { auth: { users: { findByEmail: async () => null }, sessions: { create: async () => {}, find: async (hash: string) => hash === hashSessionToken(token) ? { userId: sessionUserId, csrfToken: csrf } : null, rotate: async () => false, revoke: async () => {} }, passwords: { verify: async () => false } }, products: { listProducts: async () => [product, hidden], getProduct: async (id: number) => id === 1 ? product : id === 2 ? hidden : null, createProduct: async (input: unknown) => { created.push(input); return 1; } }, isAdmin: async () => admin };
 return { app: buildApp({ commerce: { ...commerce, shop } }), created };
}
test("product reads expose active products only", async () => { const { app } = fixture(); try { const response = await app.inject({ method: "GET", url: "/api/products" }); assert.equal(response.statusCode, 200); assert.deepEqual(response.json().products.map((p: { id: number }) => p.id), [1]); assert.equal((await app.inject({ method: "GET", url: "/api/products/2" })).statusCode, 404); } finally { await app.close(); } });
test("admin product creation requires authentication, CSRF and admin role", async () => { const { app, created } = fixture(); try { const payload = { name: "New", slug: "new", priceCents: 500 }; assert.equal((await app.inject({ method: "POST", url: "/api/products", payload })).statusCode, 401); const headers = { cookie: `vh_session=${token}` }; assert.equal((await app.inject({ method: "POST", url: "/api/products", headers, payload })).statusCode, 403); assert.equal((await app.inject({ method: "POST", url: "/api/products", headers: { ...headers, "x-csrf-token": csrf }, payload })).statusCode, 403); assert.equal(created.length, 0); } finally { await app.close(); } });
test("product mutation validates its request after access controls", async () => { const { app, created } = fixture("admin", true); try { const response = await app.inject({ method: "POST", url: "/api/products", headers: { cookie: `vh_session=${token}`, "x-csrf-token": csrf }, payload: { name: "Bad", slug: "bad", priceCents: 1, total: 999 } }); assert.equal(response.statusCode, 400); assert.equal(created.length, 0); } finally { await app.close(); } });
test("purchase endpoint requires authenticated session and CSRF before accepting order data", async () => { const { app } = fixture(); try { const response = await app.inject({ method: "POST", url: "/api/orders", payload: { productId: 1, quantity: 2, totalCents: 1 } }); assert.equal(response.statusCode, 401); assert.equal(response.json().error, "UNAUTHENTICATED"); } finally { await app.close(); } });

function paymentFixture(ownerId = "7", sessionUserId = ownerId) {
 const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
 const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
 const requests: Array<{ path: string; body: string }> = [];
 const transactions: Row[] = [];
 const order: Row = { id: 41, order_no: "ord-1", user_id: Number(ownerId), amount_due_cents: 1234, payment_status: "unpaid" };
 const config = {
  get: (key: string, fallback = "") => ({ SG65_PID: "merchant-1", SG65_MERCHANT_PRIVATE_KEY: privatePem, SG65_ENABLED_TYPES: "alipay,wxpay,qqpay" }[key] ?? fallback),
  bool: (key: string, fallback: boolean) => key === "SG65_ENABLED" ? true : fallback,
  int: (_key: string, fallback: number) => fallback,
  appUrl: () => "https://shop.example",
 };
 const shop = {
  sessions: { load: async () => null, create: async () => {}, save: async () => {}, destroy: async () => {} },
  db: { transaction: async <T>(work: (tx: unknown) => Promise<T>) => work({}) }, config,
  crypto: { encrypt: (v: string) => v, decrypt: (v: string) => v, hash: (v: string) => v, mask: (v: string) => v },
  products: { findById: async () => null },
  orders: {
   findByOrderNo: async (n: string) => n === "ord-1" ? order : null,
   items: async () => [{ product_name_snapshot: "Test product", quantity: 2 }],
   update: async () => {}, markPaid: async () => {}, findById: async () => order, create: async () => order,
   addItem: async () => 1, addUnit: async () => 1, units: async () => [], findUnit: async () => null,
   countUnitsByStatus: async () => ({}), orderWithItems: async () => null, findExpiredUnpaid: async () => [],
  },
  inventory: { countAvailable: async () => 0, reserve: async () => [], releaseForOrder: async () => 0 },
  transactions: { upsert: async (data: Row) => { transactions.push(data); return { id: 1 }; }, markPaid: async () => {}, markCancelledForOrder: async () => 0, listForOrder: async () => [] },
  sg65Post: async (path: string, body: string) => { requests.push({ path, body }); return { status: 200, text: JSON.stringify({ code: 0, pay_info: "https://pay.example/checkout", trade_no: "gateway-123" }) }; },
 } satisfies ShopLegacyDependencies;
 const base = fixture(ownerId, false, shop, sessionUserId);
 return { app: base.app, shop, order, requests, transactions };
}

test("payment initiation requires auth and CSRF and never calls SG65 for invalid credentials", async () => { const { app, requests } = paymentFixture(); try { const url = "/api/orders/ord-1/pay", payload = { payType: "alipay" }; assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 401); const headers = { cookie: `vh_session=${token}` }; assert.equal((await app.inject({ method: "POST", url, headers, payload })).statusCode, 403); assert.equal(requests.length, 0); } finally { await app.close(); } });
test("payment initiation rejects malformed type before looking up order", async () => { const { app, requests } = paymentFixture(); try { const response = await app.inject({ method: "POST", url: "/api/orders/ord-1/pay", headers: { cookie: `vh_session=${token}`, "x-csrf-token": csrf }, payload: { payType: "evil", amount: 0 } }); assert.equal(response.statusCode, 400); assert.equal(requests.length, 0); } finally { await app.close(); } });
test("payment initiation returns gateway URL based on server order amount and ownership", async () => { const { app, requests, transactions } = paymentFixture(); try { const response = await app.inject({ method: "POST", url: "/api/orders/ord-1/pay", headers: { cookie: `vh_session=${token}`, "x-csrf-token": csrf }, payload: { payType: "alipay", amount: 1, amountDueCents: 1 } }); assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { payInfo: "https://pay.example/checkout", tradeNo: "gateway-123" }); assert.equal(requests.length, 1); const fields = new URLSearchParams(requests[0]!.body); assert.equal(fields.get("money"), "12.34"); assert.equal(fields.get("out_trade_no"), "ord-1"); assert.equal(transactions[0]?.amount_cents, 1234); } finally { await app.close(); } });
test("payment initiation hides another user's order", async () => { const { app, requests } = paymentFixture("7", "9"); try { const response = await app.inject({ method: "POST", url: "/api/orders/ord-1/pay", headers: { cookie: `vh_session=${token}`, "x-csrf-token": csrf }, payload: { payType: "alipay" } }); assert.equal(response.statusCode, 404); assert.equal(requests.length, 0); } finally { await app.close(); } });
