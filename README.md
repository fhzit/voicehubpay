# VoiceHubPay · 数字商品发卡商城

原生 PHP（无框架）数字商品发卡商城 + 爱发电(Afdian)→VoiceHub 发券桥接。
支持自营卡密商城、VoiceHub 自动发券、爱发电订单同步、SG65 V2 支付，以及从旧版
`voicehubpay`（Afdian 桥）一键无损升级。

- 语言/技术：PHP 8.2+（开发验证于 8.3）、原生 PHP、PDO、cURL、Session、OpenSSL、libsodium
- 数据库：SQLite 或 PostgreSQL 双支持（`DATA_DB_CONNECTION`）
- 无 Laravel / Symfony / ThinkPHP / Vue / React / Node 构建；纯原生 HTML/CSS/JS

---

## 目录

1. [功能总览](#功能总览)
2. [运行要求](#运行要求)
3. [安装（1Panel / 手工）](#安装)
4. [从旧版 voicehubpay 升级](#从旧版-voicehubpay-升级)
5. [配置与后台](#配置与后台)
6. [定时任务（cron）](#定时任务cron)
7. [测试](#测试)
8. [目录结构](#目录结构)
9. [关键业务规则（不可违反）](#关键业务规则)

---

## 功能总览

**前台（用户）**
- 商品列表 / 详情 / 多数量购买（一单 → 多个履约单元 `-001..-00N`）
- 需登录购买；账号密码（Argon2id）+ 任性聚合登录提供的 QQ / 微信登录
- 订单查询（轮询，不依赖支付回调确认）、卡密仓库、我的订单、账号安全（改密/改绑）
- 返回页只轮询状态，绝不把"跳转回站"当作支付成功

**后台（管理）**
- Dashboard：KPIs（收入/订单/销量/发券）+ 环比 + 原生 CSS 趋势图
- 商品 / 分类 / 库存（导入、预留、释放、售罄告警）/ 订单（人工确认、人工补发、
  手动完成、指定卡密）/ 支付流水 / VoiceHub 发券与失败重试 / 爱发电同步与重试
- 用户管理、系统设置（SG65 / 登录 / VoiceHub / 爱发电 / 安全）、操作审计、数据库健康检查

**集成**
- 爱发电：Webhook + API 轮询 + 后台手动同步/重试，全部走单一 `AfdianOrderProcessor`
- VoiceHub：每张券一个 HTTP 请求（`codes` 恒为 1 个元素），幂等交付
- SG65：仅 V2（RSA-SHA256），GET 通知与履约 worker 解耦

## 运行要求

- PHP 8.2+，扩展：`pdo`、`pdo_sqlite` 或 `pdo_pgsql`、`curl`、`openssl`、`sodium`、
  `mbstring`、`session`、`json`、`sqlite3`
- 1Panel 环境：应用商店安装 PHP 8.2+ 运行环境（勾选上述扩展）+ OpenResty
- 出网能力：调 VoiceHub / 爱发电 / SG65 需要外网

## 安装

### 1Panel（推荐）

1. 将本项目目录部署到网站根目录（站点运行目录指向 `public/`）。
2. 在 1Panel 中为站点配置 PHP 8.2+，启用上表扩展；重开 PHP 使扩展生效。
3. 用浏览器访问 `https://你的域名/install`（**注意是 `/install`，不是 `/setup`**）。
4. 按向导 7 步完成：环境自检 → 数据库（SQLite/PostgreSQL）→ 旧数据检测 →
   站点信息 → 管理员账号 → 确认 → 完成。
5. 安装完成后系统写入 `storage/install.lock`，向导自动锁定，不可重跑。
6. 在后台「系统设置」填写 SG65、VoiceHub、爱发电的密钥；配置下方 cron。

### 手工 / PHP 内置服务器（仅体验）

```bash
php -S 127.0.0.1:8080 -t public
# 访问 http://127.0.0.1:8080/install
```

生产环境务必用 Nginx/OpenResty + PHP-FPM，并将 `document root` 指向 `public/`。

## 从旧版 voicehubpay 升级

旧版 `voicehubpay`（仅 Afdian→VoiceHub 桥，`afdian_orders(order_no, amount, ...)` +
`storage/settings.sqlite`）可无损升级，**旧数据不会丢失，爱发电业务不会被商城逻辑改变**。

1. 部署新代码，`/install` 向导在「数据库」步骤会**自动探测旧库**并显示迁移预览。
2. 迁移规则（由 `LegacyMigrationService` 强制执行，无法绕过）：
   - `order_no` → `out_trade_no` **原样 TEXT** 保留；
   - 金额 `NUMERIC` → **整数分**（`Money::toCents`，绝不用浮点）；
   - 历史 `voicehub_status=created/success` → 物化为 `success` 交付记录
     （**绝不重新推送**）；`failed` 保持 `failed` 并带上 `attempts` 与 `last_error`；
   - 未支付/未推送订单保持 `pending`，交由新 worker 继续处理；
   - 迁移前自动备份到 `storage/backups/legacy-*`；旧库文件**从不删除**；
   - 迁移后可二次运行：已存在记录自动跳过（幂等）。
3. 迁移校验：计数一致（迁移数 + 已存在数 = 源行数），否则输出
   `Migration FAILED` 并保留备份，可回滚重来。
4. 详细步骤见 [UPGRADE.md](UPGRADE.md)。

## 配置与后台

- 安装时的站点信息（名称、货币、时区）写入 `storage/settings.sqlite` 的
  `app_settings`（SQLite 固定，即使业务库用 PostgreSQL）。
- 敏感密钥（SG65 私钥/平台公钥、任性聚合登录 AppKey、VoiceHub/Afdian Token）经
  **APP_MASTER_KEY + libsodium** 加密存储于 `storage/settings.sqlite`，
  后台界面一律以掩码 `••••••••` 展示，绝不回显明文。
- QQ 与微信登录统一通过[任性聚合登录](https://a.idcfx.net/doc.php)接入，共用
  `AGGREGATE_OAUTH_APP_ID` / 加密的 `AGGREGATE_OAUTH_APP_KEY`，默认接口为
  `https://a.idcfx.net/connect.php`；不再使用 QQ 互联或微信开放平台的直连密钥。
- 后台地址 `/admin`（仅 `role=admin` 可见），所有 POST 表单强制 CSRF。
- 站点通知回调地址（后台「系统设置」页会显示，可直接复制）：
  - SG65 异步通知：`GET {APP_URL}/payments/sg65/notify`
  - 爱发电 Webhook：`POST {APP_URL}/webhook/afdian`
  - QQ 登录回调 / 微信登录回调：由「登录设置」页展示

## 定时任务（cron）

每分钟跑履约 worker，其它按需：

```bash
# 每分钟：履约（VoiceHub 发券）+ 释放超时未支付订单的库存预留
* * * * *  /usr/bin/php /data/www/voicehubpay/scripts/process-fulfillments.php
* * * * *  /usr/bin/php /data/www/voicehubpay/scripts/release-reservations.php

# 每 2-5 分钟：爱发电 API 轮询（Webhook 之外的第二入口）
*/2 * * * * /usr/bin/php /data/www/voicehubpay/scripts/poll-afdian.php

# 升级/维护时：应用数据库迁移（幂等）
# php /data/www/voicehubpay/scripts/migrate.php
```

> 支付（SG65 notify）与履约（worker）完全解耦：notify 收到后立即回 `success`，
> 发券由 `process-fulfillments.php` 完成，避免回调超时。

## 测试

原生 PHP 测试（无 PHPUnit 依赖）：

```bash
php tests/run.php                  # 全部（单元 + 集成）
php tests/run.php --filter=Shop    # 只跑名称含 Shop 的套件
php tests/run.php tests/unit       # 只跑单元
```

当前覆盖：金额十进制→分（防浮点）、时间区间边界（上海时区）、SG65 V2 签名/验签、
密码哈希/卡密加解密掩码、订单号规则、路由匹配、注册登录/会话再生/登录限流/社交身份唯一、
商城下单（服务端算额、多单元、库存原子预留、取消回滚、缺货整单回滚）、VoiceHub 每码一请求
与幂等、爱发电 `out_trade_no`=code 且幂等、SG65 notify 幂等与验签、旧数据 V1 迁移与二次运行幂等。

## 设计系统（Indigo Slate）

UI 命名规范 **Indigo Slate**：Slate 冷灰为中性底、Indigo 靛蓝为品牌色（Light `#4F46E5` / Dark `#818CF8`），
Blue 辅助、Green/Amber/Red 状态色。**所有颜色一律走 CSS 语义令牌**（`var(--primary)`、`var(--success)` …），
组件里不硬写任何色值；换主题只需改 `public/assets/css/app.css` 里的 `:root` 与 `.dark` 两组变量。

### 令牌与主题

- Light 令牌：`--background:#F7F8FC`、三层表面 `--surface/--surface-secondary/--surface-tertiary`、
  四级前景 `--foreground(-secondary/-muted-foreground/-faint)`、`--primary` 系列、
  `--success/--warning/--destructive` 各自带 `-soft/-border`、`--sidebar` 系列、`--ring`。
- Dark 令牌（`.dark`）：底层 `#090D18`，绝不用大面 `#000000`；图表暗色值由 `--chart-*` 单独提供。
- 主题切换：`localStorage['vhpay_theme']` = `light | dark | system`（默认跟随系统）；
  每个布局 `<head>` 内联 no-FOUC 脚本，`app.js` 监听 `prefers-color-scheme` 变化。
- 图表固定 5 色 palette `--chart-1..5`，series 不超过 5；收入趋势固定
  总 `#4F46E5` / 商城 `#2563EB` / 爱发电 `#8B5CF6`。

### 排版 / 圆角 / 阴影 / 间距

- 系统字体栈 + `tabular-nums`（金额/数字）+ mono（订单号、券码、密钥、请求 ID）。
- 字号：页面标题 28 / 后台标题 24 / Section 18 / 卡片 14–16 / 正文 14 / 辅助 13 / 小标签 12 /
  KPI 28–34 / Hero 44–52。
- 圆角令牌 `--radius-sm 6 / md 8 / lg 12 / xl 16`：按钮与输入 8、后台卡片 10–12、商城卡片 12–16、弹窗 14。
- 阴影 `--shadow-xs/sm/lg` 具体值：后台 Border>Shadow（克制）、商城卡片 hover 上浮 `shadow-sm`。
- 4px 栅格间距；商城更轻留白（Navbar 72px、1200px 内容宽、商品间距 24）vs 后台高密度
  （Sidebar 236px、Topbar 58px、表格行 44–48）。

### 交互与可访问性

- 按钮：Primary（无渐变）/ Secondary / Outline / Ghost，高 40（sm 32 / lg 48）。
- 输入：40px 高、focus `--primary` 3px ring；错误 = 红边 + 红字提示。
- 状态不以颜色为准：点 + 文字（`status-dot`，如「● 已同步」）；`#CBD5E1` 仅用于禁用/装饰，次级文字用 `#64748B`。
- 动画极少（150–200ms），`@media (prefers-reduced-motion: reduce)` 全部禁用；`:focus-visible` 2px ring。
- 图标：内联 SVG，Lucide 风格线宽 1.8–2；**禁止 Emoji 作为正式图标**。

### 文件

- `public/assets/css/app.css` — 全部令牌 + 组件（约 1300 行），保留旧类名兼容。
- `public/assets/js/app.js` — 主题 / Toast / 确认弹窗 / 卡密显示复制 / 数量步进器 / 轮询等。
- `views/layouts/{shop,admin,auth,install,account}.php` — 五套布局。

## 目录结构

```
voicehubpay/
├── public/index.php            # 前端控制器：路由表 + 维护模式 + 统一错误
├── public/assets/css|js        # 设计系统（靛蓝 4F46E5 / 系统字体 / 12px 圆角）
├── src/
│   ├── bootstrap.php           # 手写 PSR-4 autoloader + 安全 session 参数
│   ├── App.php                 # 轻量服务容器
│   ├── Config/                 # Config + SettingsRepository
│   ├── Database/               # PDO 工厂 + Migrator
│   ├── Http/                   # Request / Response / Router({param}) / View
│   ├── Security/               # CryptoService / SecretStore / Csrf / PasswordHasher / LoginThrottle
│   ├── Auth/                   # AuthService（密码+社交）/ SocialAuth（QQ、微信）
│   ├── Repositories/           # users/products/inventory/orders/units/deliveries/afdian/audit...
│   ├── Shop/                   # OrderNumberService / ShopService（下单事务）
│   ├── Fulfillment/            # FulfillmentService（履约编排 + 手动处理）
│   ├── Payments/               # Sg65Signer / Sg65Client / PaymentService
│   ├── Integrations/           # VoiceHubApiClient / AfdianService / AfdianOrderProcessor
│   ├── Analytics/              # AnalyticsService / DashboardService
│   ├── Migration/Legacy/       # 旧数据检测 / V1/V2 适配器 / 迁移服务
│   └── Controllers/            # 前台 + Admin + Install（7 步向导）
├── views/                      # layouts / shop / auth / account / checkout / admin / install / errors
├── database/migrations/{sqlite,pgsql}/   # 001..014 双库迁移
├── scripts/                    # migrate / poll-afdian / process-fulfillments / release-reservations
├── tests/                      # 原生测试框架 + 单元/集成用例
└── storage/                    # 运行期：settings.sqlite / .masterkey / install.lock / backups
```

## 关键业务规则

以下规则在代码中被视为不可违反的硬性约束：

1. **爱发电 `out_trade_no` 必须始终直接作为 VoiceHub code**——绝不使用库存卡密、
   绝不使用商城订单号、无 `-001/-002` 后缀。
2. 所有爱发电入口（Webhook、API 轮询、后台同步、后台重试）都必须经过单个
   `AfdianOrderProcessor`，不允许其它代码复制发券逻辑。
3. 商城购买必须登录；`POST /orders` 在服务端重验 session；所有订单绑定 `users.id`。
4. 多数量购买：一单 → `order_items` → N 个 `fulfillment_units`；金额一律
   `unit_price_snapshot × quantity`（服务端计算），绝不信任客户端总额；金额一律整数分。
5. VoiceHub 每 code 一个 HTTP 请求，`codes` 数组长度恒为 1（字段名仍叫 `codes`）。
6. 商城 `order_no` 源 + 数量 > 1 → `VH...-001`、`-002`…；重试必须复用原 code，绝不重新生成。
7. SG65 通知与履约解耦；通知立即返回 `success`，推送由 worker 完成。
8. 无退款：`payment_status` 仅 `unpaid/pending/paid/failed`。
9. 库存下单时原子预留（事务 + `FOR UPDATE`），`release-reservations.php` 释放，
   已支付订单绝不释放；`paid_stockout` → `manual_review` 人工处理。
10. 卡密密文存储 + SHA-256 哈希；展示仅掩码（`SG82****A1`）；绝不记录完整卡密日志。
11. 幂等：SG65 重复 notify 不重复确认；爱发电重复 webhook 不重复推送；
    VoiceHub 交付 `UNIQUE(idempotency_key)`（`shop:{order}:{unit}` / `afdian:{out_trade_no}`）。
12. 旧数据迁移：备份 → 预演 → 迁移 → 校验；绝不删除旧库；二次运行幂等。
