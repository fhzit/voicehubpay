import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDatabase } from "../../../packages/db/src/index.js";
import { DbSettingsStore } from "../src/settings-db.js";
import { FileAdminConfig } from "../src/admin/config.js";

test("DbSettingsStore：建表、写入、读取", async () => {
  const db = createSqliteDatabase(":memory:");
  const store = new DbSettingsStore(db);
  await store.ensureSchema();
  await store.ensureSchema(); // 幂等
  await store.saveAll({ EPAY_V1_ENABLED: "1", PAY_CHANNEL_EPAYV1_FEE_PERCENT: "2" });
  await store.saveAll({ EPAY_V1_ENABLED: "0" }); // 更新而非重复插入
  const all = await store.loadAll();
  assert.equal(all["EPAY_V1_ENABLED"], "0");
  assert.equal(all["PAY_CHANNEL_EPAYV1_FEE_PERCENT"], "2");
  await db.close();
});

test("容器重建后设置从数据库恢复（本地文件被清空也不丢）", async () => {
  const db = createSqliteDatabase(":memory:");
  const store = new DbSettingsStore(db);
  await store.ensureSchema();

  const firstDir = mkdtempSync(join(tmpdir(), "vh-settings-persist-"));
  const first = new FileAdminConfig(firstDir, {} as NodeJS.ProcessEnv, store);
  await first.hydrate();
  first.settings.saveMany({
    EPAY_V1_ENABLED: "1",
    EPAY_V1_PID: "3003",
    EPAY_V2_ENABLED: "1",
    PAY_CHANNEL_EPAYV1_NAME: "页面支付",
    PAY_CHANNEL_EPAYV1_FEE_PERCENT: "2",
  });
  first.setSecret("EPAY_V1_KEY", "md5-secret-key");
  await first.persist();
  // 模拟 Pod 重建：整个本地目录被清空
  rmSync(firstDir, { recursive: true, force: true });

  const secondDir = mkdtempSync(join(tmpdir(), "vh-settings-persist-2-"));
  try {
    const restored = new FileAdminConfig(secondDir, {} as NodeJS.ProcessEnv, store);
    await restored.hydrate();
    assert.equal(restored.get("EPAY_V1_ENABLED"), "1");
    assert.equal(restored.get("EPAY_V2_ENABLED"), "1");
    assert.equal(restored.get("EPAY_V1_PID"), "3003");
    assert.equal(restored.get("PAY_CHANNEL_EPAYV1_NAME"), "页面支付");
    assert.equal(restored.get("PAY_CHANNEL_EPAYV1_FEE_PERCENT"), "2");
    assert.equal(restored.secret("EPAY_V1_KEY", ""), "md5-secret-key");
  } finally {
    rmSync(secondDir, { recursive: true, force: true });
    await db.close();
  }
});

test("数据库为空时把本地文件值回写（首次持久化）", async () => {
  const db = createSqliteDatabase(":memory:");
  const store = new DbSettingsStore(db);
  await store.ensureSchema();

  const dir = mkdtempSync(join(tmpdir(), "vh-settings-seed-"));
  try {
    const config = new FileAdminConfig(dir, {} as NodeJS.ProcessEnv, store);
    config.settings.saveMany({ SITE_NAME: "本地站点" });
    await config.persist();
    const rows = await store.loadAll();
    assert.equal(rows["SITE_NAME"], "本地站点");

    // 清掉数据库，再从已有本地文件启动 → 应回写
    await db.query("DELETE FROM app_settings");
    const again = new FileAdminConfig(dir, {} as NodeJS.ProcessEnv, store);
    await again.hydrate();
    assert.equal((await store.loadAll())["SITE_NAME"], "本地站点");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.close();
  }
});
