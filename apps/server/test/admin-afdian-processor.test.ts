import { test } from "node:test";
import assert from "node:assert/strict";
import { createAfdianAdminProcessor } from "../src/admin-afdian-processor.js";

function config(values: Record<string, string>, bools: Record<string, boolean> = {}) {
  return {
    get: (key: string, fallback = "") => (values[key] === undefined ? fallback : values[key]),
    bool: (key: string, fallback: boolean) => (bools[key] === undefined ? fallback : bools[key]!),
    int: (key: string, fallback: number) => (values[key] === undefined ? fallback : Number.parseInt(values[key]!, 10)),
  };
}

function stubs() {
  const calls: string[] = [];
  const orderRow: Record<string, unknown> = { id: 7, out_trade_no: "A1", status: "paid", voicehub_status: "pending" };
  const deliveryRow: Record<string, unknown> = { id: 9, status: "pending", attempts: 0 };
  return {
    calls,
    orders: {
      createIfAbsent: async () => ({ created: true, order: orderRow }),
      markVoiceHub: async (id: number, status: string) => { calls.push(`order:${id}:${status}`); },
      findByOutTradeNo: async () => orderRow,
    },
    deliveries: {
      createIfAbsent: async () => ({ delivery: deliveryRow }),
      claimForProcessing: async () => true,
      markSuccess: async () => { calls.push("delivery:success"); },
      markFailed: async () => { calls.push("delivery:failed"); },
      findByIdempotencyKey: async () => deliveryRow,
      update: async () => { calls.push("delivery:update"); },
    },
    crypto: { encrypt: (v: string) => `enc:${v}`, hash: (v: string) => `h:${v}` },
  };
}

test("processPoll 拉订单、入库、发券成功", async () => {
  const s = stubs();
  const fetchImpl = (async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/api/open/query-order")) {
      return new Response(JSON.stringify({
        ec: 200,
        data: { total_page: 1, list: [{ out_trade_no: "A1", status: 2, total_amount: "5.00", user_name: "测试" }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as unknown as typeof fetch;

  const processor = createAfdianAdminProcessor({
    config: config({ AFDIAN_USER_ID: "u1", AFDIAN_API_TOKEN: "t1", VOICEHUB_API_BASE: "http://voice", VOICEHUB_API_TOKEN: "k" }),
    orders: s.orders as never,
    deliveries: s.deliveries as never,
    crypto: s.crypto as never,
    fetchImpl,
  });

  const results = await processor.processPoll();
  assert.equal(results.length, 1);
  assert.equal(results[0]!.status, "success");
  assert.ok(s.calls.includes("order:7:success"));
  assert.ok(s.calls.includes("delivery:success"));
});

test("未配置 Token 时抛出明确错误，而不是静默失败", async () => {
  const s = stubs();
  const processor = createAfdianAdminProcessor({
    config: config({ AFDIAN_USER_ID: "u1" }),
    orders: s.orders as never,
    deliveries: s.deliveries as never,
    crypto: s.crypto as never,
    fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
  });
  await assert.rejects(() => processor.processPoll(), /Token/);
});

test("retry(force) 重置计数并重新推送", async () => {
  const s = stubs();
  const fetchImpl = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
  const processor = createAfdianAdminProcessor({
    config: config({ AFDIAN_USER_ID: "u1", AFDIAN_API_TOKEN: "t1", VOICEHUB_API_BASE: "http://voice", VOICEHUB_API_TOKEN: "k" }),
    orders: s.orders as never,
    deliveries: s.deliveries as never,
    crypto: s.crypto as never,
    fetchImpl,
  });
  const result = await processor.retry("A1", true);
  assert.equal(result.status, "success");
  assert.ok(s.calls.includes("delivery:update"));
});
