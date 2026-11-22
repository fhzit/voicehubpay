import { test } from "node:test";
import assert from "node:assert/strict";
import { EpayV1Client } from "../src/shop-legacy/epayv1-client.js";

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

test("V1 submitUrl 支持只填 /xpay/epay、结尾带斜杠或完整 submit.php", () => {
  const base = new EpayV1Client(config({ EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay/epay" }));
  assert.equal(base.submitUrl(), "https://666.hboqy.cn/xpay/epay/submit.php");

  const trailing = new EpayV1Client(config({ EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay/epay/" }));
  assert.equal(trailing.submitUrl(), "https://666.hboqy.cn/xpay/epay/submit.php");

  const full = new EpayV1Client(config({ EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay/epay/submit.php" }));
  assert.equal(full.submitUrl(), "https://666.hboqy.cn/xpay/epay/submit.php");

  const rootOnly = new EpayV1Client(config({ EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay" }));
  assert.equal(rootOnly.submitUrl(), "https://666.hboqy.cn/xpay/epay/submit.php");
});

test("V1 签名：ASCII 升序拼接 + 密钥，MD5 大写（固定向量）", () => {
  const client = new EpayV1Client(config({ EPAY_V1_PID: "1001", EPAY_V1_KEY: "secret" }));
  const sign = client.signParams({ pid: "1001", type: "alipay", out_trade_no: "T1", name: "测试", money: "1.00" });
  assert.equal(sign, "97BB369874CD9202BA6D8DC8B42D5DB3");
});

test("V1 签名跳过 sign/sign_type 与空值", () => {
  const client = new EpayV1Client(config({ EPAY_V1_PID: "1001", EPAY_V1_KEY: "secret" }));
  const sign = client.signParams({
    pid: "1001", type: "alipay", out_trade_no: "T1", name: "测试", money: "1.00",
    sign: "IGNORED", sign_type: "MD5", return_url: "",
  });
  assert.equal(sign, "97BB369874CD9202BA6D8DC8B42D5DB3");
});

test("V1 收银台地址包含必需参数并带上签名", () => {
  const client = new EpayV1Client(config({
    EPAY_V1_PID: "1001",
    EPAY_V1_KEY: "secret",
    EPAY_V1_BASE_URL: "https://666.hboqy.cn/xpay/epay",
  }));
  const url = new URL(client.payUrl({
    type: "alipay",
    out_trade_no: "T1",
    notify_url: "https://example.test/payments/epayv1/notify",
    return_url: "https://example.test/payments/epayv1/return",
    name: "测试商品",
    money: "1.00",
  }));
  assert.equal(url.origin + url.pathname, "https://666.hboqy.cn/xpay/epay/submit.php");
  assert.equal(url.searchParams.get("pid"), "1001");
  assert.equal(url.searchParams.get("type"), "alipay");
  assert.equal(url.searchParams.get("out_trade_no"), "T1");
  assert.equal(url.searchParams.get("notify_url"), "https://example.test/payments/epayv1/notify");
  assert.equal(url.searchParams.get("return_url"), "https://example.test/payments/epayv1/return");
  assert.equal(url.searchParams.get("name"), "测试商品");
  assert.equal(url.searchParams.get("money"), "1.00");
  assert.match(url.searchParams.get("sign") ?? "", /^[0-9A-F]{32}$/);
});

test("V1 回调验签：固定向量通过，篡改金额失败，缺签失败", () => {
  const client = new EpayV1Client(config({ EPAY_V1_PID: "1001", EPAY_V1_KEY: "secret" }));
  const notify: Record<string, string> = {
    pid: "1001",
    out_trade_no: "20240101120000001",
    trade_no: "GW1",
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    money: "9.90",
  };
  const signed = { ...notify, sign: "70CF5AC9F289813772D71E91B0578B67", sign_type: "MD5" };
  assert.equal(client.verifySignature(signed), true);
  assert.equal(client.verifySignature({ ...signed, money: "0.01" }), false);
  assert.equal(client.verifySignature(notify), false);
});

test("V1 未配置密钥时不产生签名，且默认关闭", () => {
  const client = new EpayV1Client(config({ EPAY_V1_PID: "1001" }));
  assert.equal(client.isEnabled(), false);
  assert.throws(() => client.signParams({ out_trade_no: "T1" }), /密钥未配置/);
});

test("V1 支付方式集合与默认值", () => {
  const client = new EpayV1Client(config({ EPAY_V1_ENABLED_TYPES: "wxpay, alipay", EPAY_V1_DEFAULT_TYPE: "wxpay" }));
  assert.deepEqual(client.enabledPayTypes(), ["alipay", "wxpay"]);
  assert.equal(client.defaultPayType(), "wxpay");
  assert.equal(client.isPayTypeEnabled("qqpay"), false);
});
