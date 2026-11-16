import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, createPrivateKey } from "node:crypto";
import { EpayV2Client } from "../src/shop-legacy/epayv2-client.js";
import { sign, verify, toPem } from "../src/shop-legacy/sg65-signer.js";

function pair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    pub: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

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
    authUrl: (route: string) => route,
    appUrl: () => "https://example.test",
  };
}

const clock = { now: () => 1_760_000_000 };

test("submitUrl 自动补全 /api/pay/submit", () => {
  const base = config({ EPAY_V2_BASE_URL: "https://666.hboqy.cn/xpay/epayn/" });
  const client = new EpayV2Client(base, clock, async () => ({ status: 200, text: "{}" }));
  assert.equal(client.submitUrl(), "https://666.hboqy.cn/xpay/epayn/api/pay/submit");

  const full = config({ EPAY_V2_BASE_URL: "https://666.hboqy.cn/xpay/epayn/api/pay/submit" });
  const client2 = new EpayV2Client(full, clock, async () => ({ status: 200, text: "{}" }));
  assert.equal(client2.submitUrl(), "https://666.hboqy.cn/xpay/epayn/api/pay/submit");
});

test("签名包含 pid/timestamp/sign_type 且可用对应公钥验签", () => {
  const keys = pair();
  const client = new EpayV2Client(
    config({ EPAY_V2_PID: "1001", EPAY_V2_MERCHANT_PRIVATE_KEY: keys.priv }),
    clock,
    async () => ({ status: 200, text: "{}" }),
  );
  const signed = client.signedParams({ out_trade_no: "T1", money: "1.00", type: "alipay", name: "测试" });
  assert.equal(signed["pid"], "1001");
  assert.equal(signed["timestamp"], "1760000000");
  assert.equal(signed["sign_type"], "RSA");
  assert.ok(signed["sign"].length > 100);
  assert.equal(verify(signed, keys.pub), true);
  // 篡改金额后验签必须失败
  assert.equal(verify({ ...signed, money: "0.01" }, keys.pub), false);
});

test("create 提交到下单地址并解析 pay_info", async () => {
  const keys = pair();
  const calls: Array<{ url: string; body: string }> = [];
  const client = new EpayV2Client(
    config({
      EPAY_V2_ENABLED: "1",
      EPAY_V2_PID: "1001",
      EPAY_V2_MERCHANT_PRIVATE_KEY: keys.priv,
      EPAY_V2_PLATFORM_PUBLIC_KEY: keys.pub,
      EPAY_V2_BASE_URL: "https://666.hboqy.cn/xpay/epayn",
    }),
    clock,
    async (url, body) => {
      calls.push({ url, body });
      return { status: 200, text: JSON.stringify({ code: 0, pay_info: "https://pay.test/cashier/1", trade_no: "P1" }) };
    },
  );
  const response = await client.create({ out_trade_no: "T2", money: "2.00", type: "wxpay", name: "商品" });
  assert.equal(response["code"], 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/xpay\/epayn\/api\/pay\/submit$/);
  assert.match(calls[0]!.body, /sign=/);
  assert.match(calls[0]!.body, /out_trade_no=T2/);
});

test("回调验签使用平台公钥", () => {
  const keys = pair();
  const client = new EpayV2Client(
    config({ EPAY_V2_PID: "1001", EPAY_V2_PLATFORM_PUBLIC_KEY: keys.pub }),
    clock,
    async () => ({ status: 200, text: "{}" }),
  );
  const notify = { pid: "1001", out_trade_no: "T3", money: "3.00", trade_status: "TRADE_SUCCESS" };
  const signed = { ...notify, sign: sign(notify, keys.priv), sign_type: "RSA" };
  assert.equal(client.verifySignature(signed), true);
  assert.equal(client.verifySignature({ ...signed, money: "0.01" }), false);
});

test("toPem 接受裸 base64 与完整 PEM", () => {
  const keys = pair();
  const pem = toPem(keys.priv, ["PRIVATE KEY", "RSA PRIVATE KEY"]);
  assert.match(pem, /BEGIN PRIVATE KEY/);
  assert.doesNotThrow(() => createPrivateKey(pem));
  assert.doesNotThrow(() => createPublicKey(toPem(keys.pub, ["PUBLIC KEY", "RSA PUBLIC KEY"])));
});
