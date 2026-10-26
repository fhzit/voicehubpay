import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { configureAfdianWebhook } from "../src/afdian-webhook.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
function signed(payload: Record<string, unknown>) {
  const order = (payload.data as { order: Record<string, unknown> }).order;
  const bytes = `${order.out_trade_no}${order.user_id}${order.plan_id}${order.total_amount}`;
  return sign("RSA-SHA256", Buffer.from(bytes), keys.privateKey).toString("base64");
}
function payload(status = "2") { return { data: { type: "order", order: { out_trade_no: "A-001", user_id: "u1", plan_id: "p1", total_amount: "19.90", status } } }; }
async function server(opts: { enabled?: boolean; requireSignature?: boolean; process?: (o: Record<string, unknown>) => Promise<{ status: string }> } = {}) {
  const app = Fastify();
  const orders: Record<string, unknown>[] = [];
  configureAfdianWebhook(app, { enabled: () => opts.enabled ?? true, requireSignature: () => opts.requireSignature ?? true, publicKey,
    processNormalizedOrder: async (o) => { orders.push(o); return opts.process ? opts.process(o) : { status: String(o.status) === "paid" ? "success" : "unpaid" }; } });
  return { app, orders };
}

test("Afdian webhook accepts PHP-compatible RSA-SHA256 signature and ec response", async () => {
  const h = await server(); const body = payload();
  const res = await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: { ...body, sign: signed(body) } });
  assert.equal(res.statusCode, 200); assert.deepEqual(res.json(), { ec: 200, em: "", status: "success" });
  assert.equal(h.orders.length, 1); assert.equal(h.orders[0]!.amount_cents, 1990);
});

test("Afdian webhook rejects missing and incorrect signatures", async () => {
  const h = await server(); const body = payload();
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: body })).statusCode, 401);
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: { ...body, sign: "AAAA" } })).statusCode, 401);
  assert.equal(h.orders.length, 0);
});

test("Afdian webhook sends non-paid orders through shared processor without fulfillment", async () => {
  const h = await server(); const body = payload("1");
  const res = await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: { ...body, data: { ...body.data, sign: signed(body) } } });
  assert.equal(res.statusCode, 200); assert.equal(res.json().status, "unpaid");
  assert.equal(h.orders.length, 1); assert.equal(h.orders[0]!.status, "1");
});

test("Afdian repeated order delegates idempotency to shared processor", async () => {
  let deliveries = 0; const h = await server({ process: async () => { if (!deliveries++) return { status: "success" }; return { status: "already_success" }; } });
  const body = payload(); const signValue = signed(body); const sent = { ...body, sign: signValue };
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: sent })).json().status, "success");
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: sent })).json().status, "already_success");
  assert.equal(deliveries, 2);
});

test("Afdian webhook startup processor persists an order and creates one shared delivery idempotently", async () => {
  const { createSqliteDatabase, AfdianOrderRepository, VoiceHubDeliveryRepository, CryptoService } = await import("../../../packages/db/src/index.js");
  const db = createSqliteDatabase(":memory:");
  await db.query(`CREATE TABLE afdian_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, out_trade_no TEXT NOT NULL UNIQUE, trade_no TEXT, user_id TEXT, buyer_name TEXT, remark TEXT, plan_id TEXT, sku_detail TEXT, amount_cents INTEGER, status TEXT, raw_payload TEXT, voicehub_status TEXT, voicehub_attempts INTEGER, voicehub_last_error TEXT, created_at TEXT, paid_at TEXT, processed_at TEXT, updated_at TEXT)`);
  await db.query(`CREATE TABLE voicehub_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_id INTEGER, source_order_no TEXT, fulfillment_unit_id INTEGER, code_ciphertext TEXT, code_hash TEXT, code_source TEXT, idempotency_key TEXT UNIQUE, status TEXT, attempts INTEGER, last_error TEXT, request_payload TEXT, response_payload TEXT, created_at TEXT, updated_at TEXT, success_at TEXT)`);
  const { createAfdianWebhookProcessor } = await import("../src/afdian-webhook-processor.js");
  const processNormalizedOrder = createAfdianWebhookProcessor(new AfdianOrderRepository(db), new VoiceHubDeliveryRepository(db), new CryptoService(process.cwd()));
  const h = await server({ process: processNormalizedOrder });
  const body = payload(); const sent = { ...body, sign: signed(body) };
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: sent })).json().status, "success");
  assert.equal((await h.app.inject({ method: "POST", url: "/webhook/afdian", payload: sent })).json().status, "success");
  assert.equal(await new AfdianOrderRepository(db).count(), 1);
  const delivery = await new VoiceHubDeliveryRepository(db).findByIdempotencyKey("afdian:A-001");
  assert.equal(delivery?.status, "pending");
  assert.equal(new CryptoService(process.cwd()).decrypt(String(delivery?.code_ciphertext)), "A-001");
  await db.close();
});
