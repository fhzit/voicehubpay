# VoiceHubPay 升级 · 现状分析（UPGRADE 前置文档）

> 本文档记录对旧版 `voicehubpay`（Afdian → VoiceHub 桥）的完整勘察结论，
> 是本次升级的基线。升级原则：**旧数据不丢、旧爱发电业务不被商城逻辑改变**。

## 1. 当前目录结构

```
voicehubpay/
├── .env.example
├── .gitignore
├── README.md
├── composer.json                 # PSR-4: VoiceHubPay\ => src/
├── public/index.php              # 前端控制器 + 手工路由 match
├── src/
│   ├── bootstrap.php             # PSR-4 autoloader + session_start
│   ├── Config/Config.php         # .env + settings.sqlite 合并读取
│   ├── Config/SettingsRepository.php   # storage/settings.sqlite app_settings
│   ├── Database/Database.php     # PDO 工厂（sqlite/pgsql）
│   ├── Http/Request.php / Response.php
│   ├── Auth/SessionAuth.php      # OAuth2 会话（无本地账户）
│   ├── Auth/OAuthClient.php      # 通用 OAuth2
│   ├── Services/AfdianService.php     # webhook 验签 + API 轮询
│   ├── Services/VoiceHubService.php   # VoiceHub 发券
│   ├── Services/OrderService.php      # afdian_orders upsert + 派发
│   ├── Services/HttpJsonClient.php
│   └── Controllers/{Webhook,Setup,Auth,Admin}Controller.php
├── views/{layouts/app,dashboard,orders,setup,partials/order-table}.php
├── scripts/migrate.php, poll-afdian.php
├── database/migrations/001_create_afdian_orders.php
└── storage/                     # 仅 .gitkeep；settings.sqlite 首启自动创建
```

## 2. 当前数据库结构

### storage/settings.sqlite（配置库，固定 SQLite）
- `app_settings(key VARCHAR PRIMARY KEY, value TEXT, updated_at VARCHAR)`
- 关键 key：`APP_CONFIGURED`、`APP_URL`、`APP_KEY`、`DATA_DB_*`、
  `OAUTH_*`、`AFDIAN_*`、`VOICEHUB_*`

### 数据库（sqlite / pgsql，由 DATA_DB_CONNECTION 决定）
- `afdian_orders`：
  `id, order_no UNIQUE, afdian_user_id, buyer_name, amount NUMERIC(12,2),
   status, voicehub_status, voicehub_response, last_error, raw_payload,
   created_at, updated_at`
- 当前 **没有** 用户、商品、库存、订单、支付等表。

## 3. 当前 Afdian 流程（必须保持不变的核心业务）

```
Webhook  POST /webhook/afdian  ─┐
API Poll scripts/poll-afdian.php─┤→ AfdianService(验签/轮询) → OrderService::upsertAndDispatch
后台手动同步 POST /sync/afdian  ─┘        │
                                          ▼
                    afdian_orders(order_no=out_trade_no) upsert
                                          │
                                          ▼
                    VoiceHubService::createTicket  code = out_trade_no
                                          │
                                          ▼
                    afdian_orders.voicehub_status = created / failed
```

- **订单号**：Afdian `out_trade_no`（字符串，如 `202106232138371083454010626`）直接入库。
- **VoiceHub code**：永远 = `out_trade_no`，一次一条。
- **幂等**：`voicehub_status = created` 时不再重复推送。
- Webhook 默认要求 RSA 签名（`out_trade_no+user_id+plan_id+total_amount` SHA256）。

## 4. 当前 VoiceHub 流程

- `POST {VOICEHUB_API_BASE}{VOICEHUB_TICKET_ENDPOINT}`（默认 `/api/open/card-codes`）
- 请求头 `x-api-key: VOICEHUB_API_TOKEN`
- 请求体 `{"codes":"out_trade_no","note":"voicehubpay | source=afdian | ..."}`
- 成功判定：HTTP<400 且 body.success !== false

## 5. 可复用代码

| 模块 | 结论 |
|---|---|
| PSR-4 autoloader | 复用 |
| Config + SettingsRepository | 复用并扩展（加密 SecretStore、布尔/整数读取） |
| Database PDO 工厂 | 复用（扩展连接信息/驱动判断） |
| Http/Request、Response | 复用并扩展（CSRF、IP、输入助手） |
| AfdianService | 复用并改造（金额→分、SKU、plan_id、校验） |
| HttpJsonClient | 复用 |
| Webhook 控制器 | 改造为统一 AfdianOrderProcessor 入口 |
| 旧 afdian_orders 数据 | 作为 legacy 迁移源（amount→cents、voicehub 状态映射） |

## 6. 需要迁移的数据

| 数据 | 去向 | 规则 |
|---|---|---|
| afdian_orders.order_no | afdian_orders.out_trade_no | **原值 TEXT 保存，禁止截断/转数字/加前缀** |
| afdian_orders.amount | afdian_orders.amount_cents | 安全十进制字符串转分，禁止 float*100 |
| voicehub_status=created | afdian_orders.voicehub_status=success + voicehub_deliveries(status=success, idempotency=afdian:{out_trade_no}) | **绝不重推** |
| voicehub_status=failed | voicehub_status=failed + delivery(failed, 保留 attempts/last_error) | 等待管理员主动重试 |
| raw_payload / buyer / user | 原样保留 | — |
| settings（AFDIAN_*/VOICEHUB_*/APP_*） | 新 settings.sqlite | Secret 项用 APP_MASTER_KEY+libsodium 加密 |

## 7. 实施计划（对应需求 138 的 Phase）

1. 核心基础设施（Config/Database/Migrator/Http/Security）
2. 全量新表 migrations（sqlite + pgsql 双份）
3. Repositories → 领域服务
4. Auth（密码 + QQ/微信 social_identities）
5. Shop（商品/分类/库存原子预占/多件订单/fulfillment_units）
6. SG65 V2 RSA 支付（sign/verify/create/notify/query/reconcile）
7. VoiceHub 逐张一券一请求 Worker + 幂等 deliveries
8. AfdianOrderProcessor 统一入口（webhook/poll/retry，行为不变）
9. Legacy 迁移（detector/adapter/dry-run/幂等/校验）
10. /install 安装向导（7 步）
11. 控制器 + 路由 + public/index.php
12. 全局设计系统 + 前台/后台全部页面
13. CLI 脚本 + Cron
14. 关键行为测试
15. README / UPGRADE / 1Panel / Cron 文档

## 8. 升级完成状态（2026-08）

上文第 1-6 节为旧版勘察基线（历史事实），第 7 节计划已全部落地：

- ✅ 核心基础设施 / 双库迁移（sqlite+pgsql 001-014）/ Repositories / 领域服务
- ✅ Auth：Argon2id 密码 + QQ/微信 `social_identities`（UNIQUE provider+social_uid）、
  `session_regenerate_id(true)`、登录限流、全 POST CSRF
- ✅ Shop：登录必购、服务端 `price×qty` 整数分、一单→N 单元 `-001..-00N`、
  库存事务原子预占（`FOR UPDATE`）、`release-reservations.php` 释放、paid_stockout→manual_review
- ✅ SG65 V2（RSA-SHA256）支付：create/notify(GET，解耦立即回 success)/query 回填/对账，无退款
- ✅ VoiceHub 逐张一券一请求（`codes` 恒 1 元素）+ `UNIQUE(idempotency_key)` 幂等 +
  `process-fulfillments.php` worker
- ✅ AfdianOrderProcessor 单一入口（webhook/poll/retry），`out_trade_no`=code 不可变
- ✅ Legacy 迁移（detector/Adapters V1/V2/备份/校验/二次运行幂等），历史 success 物化不重推
- ✅ `/install` 7 步向导 + `storage/install.lock` 锁定
- ✅ 后台全模块（products/categories/inventory/orders/payments/voicehub/afdian/
  users/settings/audit/system）+ Dashboard KPIs/环比/趋势
- ✅ 前台全页面（home/products/detail/checkout/pay-return/account/orders/cards/connections/security）
- ✅ CLI 脚本 + cron 示例、`tests/`（12 套件原生测试，`php tests/run.php` 全绿）、
  README/UPGRADE/.env.example/composer.json

验证方式：`php -l` 全量语法校验通过；`php tests/run.php` 12 套件 1285 断言 0 失败
（覆盖金额防浮点、签名、下单事务/预占/回滚、VoiceHub/Afdian 幂等、SG65 notify 幂等、
V1 迁移与二次幂等）。最终交付前请按 UPGRADE.md 在真实旧库上预演迁移。
