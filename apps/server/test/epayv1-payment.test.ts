import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentService, PaymentError } from "../src/shop-legacy/shop-service.js";
import { EpayV1Client } from "../src/shop-legacy/epayv1-client.js";
import { Sg65Client } from "../src/shop-legacy/sg65-client.js";
import type { OrdersPort, Row, TransactionsPort } from "../src/shop-legacy/types.js";

const clock = { now: () => 1_760_000_000 };

function config(values: Record<string, string>) {
  return {
    get: (key: string, fallback = "") => (values[key] === undefined ? fallback : values[key]),
    bool: (key: string, fallback: boolean) => (values[key] === undefined ? fallback : values[key] === "1"),
    int: (key: string, fallback: number) => {
      const raw = values[key];
      if (raw === undefined) return fallback;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? fallback : parsed;
    },
    appUrl: () => "https://example.test",
  };
}

interface Harness {
  service: PaymentService;
  order: Row;
  transactions: Array<Record<string, unknown>>;
  markPaidCalls: Array<Record<string, unknown>>;
}

function harness(values: Record<string, string> = {}): Harness {
  const cfg = config({
    EPAY_V1_ENABLED: "1",
    EPAY_V1_PID: "1001",
    EPAY_V1_KEY: "secret",
    EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay/epay",
    ...values,
  });
  const order: Row = {
    id: 7,
    order_no: "20240101120000001",
    user_id: 3,
    amount_due_cents: 990,
    payment_status: "unpaid",
  };
  const transactions: Array<Record<string, unknown>> = [];
  const markPaidCalls: Array<Record<string, unknown>> = [];
  const orders = {
    findById: async (id: number) => (Number(order["id"]) === id ? order : null),
    findByOrderNo: async (orderNo: string) => (String(order["order_no"]) === orderNo ? order : null),
    items: async () => [{ product_name_snapshot: "测试商品", quantity: 1 }],
    markPaid: async (id: number, amount: number, gateway: string, source: string) => {
      markPaidCalls.push({ id, amount, gateway, source });
      order["payment_status"] = "paid";
    },
  } as unknown as OrdersPort;
  const txPort = {
    upsert: async (data: Row) => {
      transactions.push({ ...data });
      return { id: transactions.length, ...data };
    },
    markPaid: async () => undefined,
    markCancelledForOrder: async () => 0,
    listForOrder: async () => [],
  } as unknown as TransactionsPort;

  const service = new PaymentService({
    config: cfg,
    clock,
    sg65: new Sg65Client(cfg, clock, async () => ({ status: 200, text: "{}" })),
    epayv1: new EpayV1Client(cfg),
    orders,
    transactions: txPort,
    crypto: {} as never,
  });
  return { service, order, transactions, markPaidCalls };
}

function signedNotify(overrides: Record<string, string> = {}): Record<string, string> {
  const client = new EpayV1Client(config({ EPAY_V1_PID: "1001", EPAY_V1_KEY: "secret" }));
  const params: Record<string, string> = {
    pid: "1001",
    out_trade_no: "20240101120000001",
    trade_no: "GW1",
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    money: "9.90",
    ...overrides,
  };
  return { ...params, sign: client.signParams(params), sign_type: "MD5" };
}

test("V1 下单返回带 MD5 签名的 submit.php 地址并写入 epayv1 流水", async () => {
  const h = harness();
  const result = await h.service.createPayment(h.order, "alipay", "127.0.0.1", "epayv1");
  const url = new URL(result.pay_info);
  assert.equal(url.origin + url.pathname, "https://666.hboqy.cn/xpay/epay/submit.php");
  assert.equal(url.searchParams.get("pid"), "1001");
  assert.equal(url.searchParams.get("type"), "alipay");
  assert.equal(url.searchParams.get("out_trade_no"), "20240101120000001");
  assert.equal(url.searchParams.get("money"), "9.90");
  assert.equal(url.searchParams.get("notify_url"), "https://example.test/payments/epayv1/notify");
  assert.match(url.searchParams.get("sign") ?? "", /^[0-9A-F]{32}$/);
  assert.equal(h.transactions.length, 1);
  assert.equal(h.transactions[0]!["gateway"], "epayv1");
  assert.equal(h.transactions[0]!["status"], "pending");
});

test("V1 回调确认支付且重复通知幂等", async () => {
  const h = harness();
  assert.equal(await h.service.handleEpayV1Notify(signedNotify()), "success");
  assert.equal(h.markPaidCalls.length, 1);
  assert.equal(h.markPaidCalls[0]!["gateway"], "epayv1");
  assert.equal(h.markPaidCalls[0]!["amount"], 990);
  assert.equal(await h.service.handleEpayV1Notify(signedNotify()), "success");
  assert.equal(h.markPaidCalls.length, 1, "重复通知不得再次确认支付");
});

test("V1 回调金额被篡改时拒绝且不确认支付", async () => {
  const h = harness();
  const tampered = signedNotify();
  tampered["money"] = "0.01";
  assert.equal(await h.service.handleEpayV1Notify(tampered), "verify_failed");
  assert.equal(h.markPaidCalls.length, 0);
});

test("V1 未配置密钥时下单失败并提示", async () => {
  const h = harness({ EPAY_V1_KEY: "" });
  await assert.rejects(
    () => h.service.createPayment(h.order, "alipay", "127.0.0.1", "epayv1"),
    (error: unknown) => error instanceof PaymentError,
  );
  assert.equal(h.transactions.length, 0);
});

test("V1 渠道关闭时回调返回 disabled", async () => {
  const h = harness({ EPAY_V1_ENABLED: "0" });
  assert.equal(await h.service.handleEpayV1Notify(signedNotify()), "disabled");
  assert.equal(h.markPaidCalls.length, 0);
});
