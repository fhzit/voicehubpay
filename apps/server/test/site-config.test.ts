import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSiteConfig } from "../src/site-config.js";
import { payChannels } from "../src/shop-legacy/pay-channels.js";

test("后台保存的通道配置立刻对前台可见（同一实例，settings.json 优先）", () => {
  const dir = mkdtempSync(join(tmpdir(), "vh-site-config-"));
  try {
    const site = createSiteConfig({ ADMIN_DATA_DIR: dir } as NodeJS.ProcessEnv);
    // 前台初始没有任何通道
    assert.deepEqual(payChannels(site).map((c) => c.id), []);

    // 后台「支付设置」保存两个易支付通道 + 展示/手续费
    site.settings.saveMany({
      EPAY_V2_ENABLED: "1",
      EPAY_V1_ENABLED: "1",
      EPAY_V2_PID: "2002",
      EPAY_V1_PID: "3003",
      PAY_CHANNEL_EPAYV2_NAME: "接口支付",
      PAY_CHANNEL_EPAYV1_NAME: "页面支付",
      PAY_CHANNEL_EPAYV1_REMARK: "跳转收银台",
      PAY_CHANNEL_EPAYV2_FEE_PERCENT: "1.5",
      SITE_URL: "https://shop.example.test",
    });

    const channels = payChannels(site);
    assert.deepEqual(channels.map((c) => c.id), ["epayv2", "epayv1"]);
    assert.equal(channels[0]!.label, "接口支付");
    assert.equal(channels[0]!.fee_percent, 1.5);
    assert.equal(channels[1]!.label, "页面支付");
    assert.equal(channels[1]!.remark, "跳转收银台");
    assert.equal(site.appUrl(), "https://shop.example.test");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("保存后落盘，重启进程仍能读到（环境变量只作兜底）", () => {
  const dir = mkdtempSync(join(tmpdir(), "vh-site-config-persist-"));
  try {
    const first = createSiteConfig({ ADMIN_DATA_DIR: dir } as NodeJS.ProcessEnv);
    first.settings.saveMany({ EPAY_V1_ENABLED: "1", EPAY_V1_PID: "3003" });

    const restarted = createSiteConfig({
      ADMIN_DATA_DIR: dir,
      EPAY_V1_ENABLED: "0",
      EPAY_V1_PID: "env-pid",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(payChannels(restarted).map((c) => c.id), ["epayv1"], "文件优先于环境变量");
    assert.equal(restarted.get("EPAY_V1_PID"), "3003");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authUrl 兼容历史 AUTH_PATH_PREFIX 与现行 AUTH_SECRET_PREFIX", () => {
  const dir = mkdtempSync(join(tmpdir(), "vh-site-config-auth-"));
  try {
    const site = createSiteConfig({ ADMIN_DATA_DIR: dir } as NodeJS.ProcessEnv);
    assert.equal(site.authUrl("/login"), "/login");
    site.settings.saveMany({ AUTH_SECRET_PREFIX: "/g/abc" });
    assert.equal(site.authUrl("/login"), "/g/abc/login");
    assert.equal(site.authUrl("login"), "/g/abc/login");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
