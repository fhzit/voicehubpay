# UPGRADE · 从旧版 voicehubpay 升级到 VoiceHubPay

本文面向旧版 **Afdian → VoiceHub 桥**（下文称"旧版"）的现有部署。旧版仅包含
`afdian_orders` 订单同步 + VoiceHub 发券，无商城、无本地账户、无支付。

升级目标：**旧数据不丢、爱发电业务行为不变、无缝获得商城能力**。

---

## 0. 升级前准备

- 备份旧代码目录（建议整目录复制到别处，如 `voicehubpay.bak`）。
- 记下旧版 `storage/settings.sqlite` 中的关键配置（`AFDIAN_*`、`VOICEHUB_*`、
  `DATA_DB_*`），新版迁移服务会自动读取，但保留副本更稳妥。
- QQ/微信已改为任性聚合登录，旧的 `QQ_APP_*` / `WX_APP_*` 直连凭据不兼容、
  不会迁移；升级后需在后台「登录设置」重新填写聚合平台 AppID/AppKey。
- 确认 PHP 8.2+ 环境（旧版如为低版本 PHP 需先升级运行环境）。

## 1. 部署新代码

1. 将新版代码放入站点目录（站点运行目录指向 `public/`）。
2. 不要删除旧版的 `storage/settings.sqlite` 与旧数据文件——它们是迁移的数据源。
3. 浏览器访问 `/install`。

## 2. /install 向导中的旧数据迁移

向导共 7 步，其中「数据库」步骤会**自动探测旧库**并展示：

- 是否检测到旧版（`APP_CONFIGURED` + 旧 `DATA_DB_*` + `afdian_orders` 表）；
- 旧表结构适配器（V1：`order_no`+`amount`；V2：`out_trade_no`）；
- 预估行数与历史推送状态分布（success / failed / pending）。

确认后，向导在写库阶段执行 `LegacyMigrationService`：

1. **备份**：自动创建 `storage/backups/legacy-<时间戳>`，复制旧 settings 与数据文件；
   旧库文件**从不删除**。
2. **映射**（每个旧行）：
   - `order_no` → `out_trade_no` **原样 TEXT**（绝不做任何改写/后缀）；
   - 金额 `NUMERIC(12,2)` → **整数分**（`Money::toCents` 十进制安全转换）；
   - `status` 原样（`paid`/`unpaid`/…）；
   - 历史推送状态：`created`/`success` → 新表 `voicehub_status=success` 且
     生成一条 `voicehub_deliveries`（`idempotency_key=afdian:{out_trade_no}`，
     `code=out_trade_no`，`status=success`，`attempts=1`）——**已成功的绝不重推**；
     `failed` → `voicehub_status=failed`，保留 `attempts` 与 `last_error`，
     物化一条 failed 交付记录；未推送/未支付 → `pending`，由新 worker 继续处理。
3. **校验**：迁移数 + 已存在数 == 源行数。不等则抛 `Migration FAILED`，
   事务整体回滚并保留备份，可排查后重来。
4. **幂等**：再次运行 `scripts/migrate.php --legacy` 时，已存在 `out_trade_no`
   自动跳过，不会重复导入、不会重复生成交付记录。

> 说明：旧的 `voicehub_status=created`（旧版"已创建工单"）按约定视同
> `success` 物化，避免升级后重复推送同一 `out_trade_no` 到 VoiceHub。

## 3. 升级后核对

- `/admin/afdian` 应看到与旧版一致的订单列表（数量、`out_trade_no`、金额分）。
- 历史成功订单在 `/admin/voicehub` 中显示为成功交付，且**不会被 worker 重推**。
- 历史失败订单保留失败信息，可在后台「重试」继续（复用原 code=out_trade_no）。
- 爱发电 Webhook 地址、轮询 cron 配置保持不变（仍是 `/webhook/afdian`）。

## 4. 行为不变承诺

- 爱发电 `out_trade_no` 永远作为 VoiceHub code（无 `-001` 后缀、不读库存卡密、
  不用商城订单号）。
- 爱发电每单每次只发一个 code（`codes` 数组长度恒为 1）。
- 所有爱发电入口（Webhook / 轮询 / 后台同步 / 重试）统一走 `AfdianOrderProcessor`。

## 5. 常见问题

**问：向导没有检测到旧库？**
答：旧 `storage/settings.sqlite` 必须存在且含 `APP_CONFIGURED=1`，且旧
`DATA_DB_DATABASE` 指向的库里要有 `afdian_orders` 表。若旧库迁移过结构，
请手动把旧表改回 `afdian_orders` 或在迁移服务传入旧库描述符。

**问：迁移报 `Migration FAILED`？**
答：不会丢数据——事务已回滚，备份在 `storage/backups/`。核对源表行数与
`out_trade_no` 是否为空/重复后重跑即可（幂等）。

**问：迁移后历史订单会不会被重复发券？**
答：不会。成功历史已物化为 success 交付记录，处理器见 `voicehub_status=success`
直接跳过；且交付行有 `UNIQUE(idempotency_key)` 双保险。
