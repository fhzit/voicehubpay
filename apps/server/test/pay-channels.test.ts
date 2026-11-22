import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { payChannels, parseFeePercent, channelFeeCents, payableCents } from "../src/shop-legacy/pay-channels.js";
import { FileAdminConfig } from "../src/admin/config.js";

function config(values: Record<string, string>) {
  return {
    get: (key: string, fallback = "") => (values[key] === undefined ? fallback : values[key]),
    bool: (key: string, fallback: boolean) => (values[key] === undefined ? fallback : values[key] === "1"),
  };
}

test("多通道同时启用时返回全部通道，并带自定义名称、备注与手续费", () => {
  const channels = payChannels(config({
    SG65_ENABLED: "1",
    EPAY_V2_ENABLED: "1",
    EPAY_V1_ENABLED: "1",
    PAY_CHANNEL_SG65_NAME: "支付宝/微信",
    PAY_CHANNEL_SG65_REMARK: "实时到账",
    PAY_CHANNEL_SG65_FEE_PERCENT: "1.5",
    PAY_CHANNEL_EPAYV2_FEE_PERCENT: "2",
  }));
  assert.deepEqual(channels.map((c) => c.id), ["sg65", "epayv2", "epayv1"]);
  assert.equal(channels[0]!.label, "支付宝/微信");
  assert.equal(channels[0]!.remark, "实时到账");
  assert.equal(channels[0]!.fee_percent, 1.5);
  assert.equal(channels[1]!.label, "易支付V2");
  assert.equal(channels[1]!.fee_percent, 2);
  assert.equal(channels[2]!.fee_percent, 0);
});

test("未启用的通道不出现在收银台", () => {
  assert.deepEqual(payChannels(config({ EPAY_V1_ENABLED: "1" })).map((c) => c.id), ["epayv1"]);
  assert.deepEqual(payChannels(config({})).map((c) => c.id), []);
});

test("手续费百分比解析：非法归零、上限 100、保留两位", () => {
  assert.equal(parseFeePercent(""), 0);
  assert.equal(parseFeePercent("abc"), 0);
  assert.equal(parseFeePercent("-3"), 0);
  assert.equal(parseFeePercent("150"), 100);
  assert.equal(parseFeePercent("2.567"), 2.57);
  assert.equal(parseFeePercent(3), 3);
});

test("手续费按原价叠加并四舍五入到分", () => {
  assert.equal(channelFeeCents(990, 2), 20); // 19.8 → 20
  assert.equal(payableCents(990, 2), 1010);
  assert.equal(channelFeeCents(0, 5), 0);
  assert.equal(channelFeeCents(1000, 0), 0);
  assert.equal(channelFeeCents(100, 1.5), 2); // 1.5 → 2
  assert.equal(channelFeeCents(-100, 5), 0);
});

test("后台保存的易支付V1 密钥会被持久化（修复“已配置仍显示未配置”）", () => {
  const basePath = mkdtempSync(join(tmpdir(), "vh-epay-v1-secret-"));
  try {
    const admin = new FileAdminConfig(basePath);
    assert.equal(admin.secret("EPAY_V1_KEY", ""), "");
    admin.setSecret("EPAY_V1_KEY", "my-md5-key");
    const reloaded = new FileAdminConfig(basePath);
    assert.equal(reloaded.secret("EPAY_V1_KEY", ""), "my-md5-key");
    reloaded.setSecret("EPAY_V2_MERCHANT_PRIVATE_KEY", "priv");
    assert.equal(new FileAdminConfig(basePath).secret("EPAY_V2_MERCHANT_PRIVATE_KEY", ""), "priv");
  } finally {
    rmSync(basePath, { recursive: true, force: true });
  }
});
