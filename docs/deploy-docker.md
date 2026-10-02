# 运行镜像

镜像由 GitHub Actions 构建并发布到 GHCR:`ghcr.io/fhzit/voicehubpay`。

## 标签

- `main` — main 分支最新构建
- `sha-<short>` — 每次提交
- `1.2.3` / `1.2` — 推送 `v1.2.3` 标签时

## 运行

```bash
docker run -d --name voicehubpay \
  -p 8080:8080 \
  -v voicehubpay-data:/data \
  -e DATABASE_PATH=/data/database/voicehubpay.sqlite \
  -e APP_BASE_PATH=/data \
  -e SHOP_LEGACY_ENABLED=1 \
  -e SG65_ENABLED=1 \
  -e SG65_PID=<商户ID> \
  -e SG65_MERCHANT_PRIVATE_KEY="<PEM 或裸 base64>" \
  -e SG65_PLATFORM_PUBLIC_KEY="<PEM 或裸 base64>" \
  -e SITE_URL=https://your-domain \
  ghcr.io/fhzit/voicehubpay:main
```

## 数据卷 `/data`

- `/data/database/voicehubpay.sqlite` — SQLite 数据库(首次启动自动建表,含 legacy shop/payment schema)
- `/data/storage/.masterkey` — 卡密加密主密钥(0600,首次启动自动生成;**务必备份**,丢失后已售卡密无法解密)

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DATABASE_PATH` | SQLite 路径(默认 `/data/database/voicehubpay.sqlite`) |
| `APP_BASE_PATH` | masterkey 根目录(默认 `/data`) |
| `SHOP_LEGACY_ENABLED` | `1` 启用 legacy 店铺/SG65 支付路由 |
| `SG65_ENABLED` | SG65 网关总开关 |
| `SG65_PID` / `SG65_MERCHANT_PRIVATE_KEY` / `SG65_PLATFORM_PUBLIC_KEY` | 商户凭据 |
| `SITE_URL` | 回调地址基础 URL |
| `PORT` / `HOST` | 监听(默认 `8080` / `0.0.0.0`) |

## 从 PHP 部署迁移

PHP 版卡密用 libsodium secretbox 加密,Node 镜像用 AES-256-GCM,密文不互通。
迁移步骤:见 `scripts/migrate-crypto.mjs`(待补充)。
