# TS 版切换步骤（vhpay.idoknow.top）

前提：TS 镜像 `ghcr.io/fhzit/voicehubpay:refactor-typescript-fullstack-migration`
（或切 main 后用 `main`/版本 tag）已在 GHCR 可拉取。

## 1. 填 Secret

```bash
kubectl -n idoknow create secret generic voicehubpay-ts-env \
  --from-literal=SG65_PID='<商户PID>' \
  --from-file=SG65_MERCHANT_PRIVATE_KEY=<商户私钥.pem> \
  --from-file=SG65_PLATFORM_PUBLIC_KEY=<平台公钥.pem>
```

（若已用清单里的 Secret 模板，`kubectl apply` 前填好三个值；二选一。）

## 2. 部署

```bash
kubectl apply -f deploy/k8s/voicehubpay-ts.yaml
kubectl -n idoknow rollout status deploy/voicehubpay-ts
```

数据落点：hostPath `/opt/k8s-idoknow/panel/www`（准入策略只放行该 legacy 根路径）
挂到容器 `/legacy/vhpay`，`APP_BASE_PATH=/legacy/vhpay/index` →
masterkey 复用 `storage/.masterkey`（卡密密文可直接解），
`DATABASE_PATH=/legacy/vhpay/index/storage/voicehubpay.sqlite` → 沿用旧库文件，
`migrateShopSchema`/`migrateAuthSchema` 幂等补齐 TS 需要的表/列。

worker 与 server 同 Pod（`Recreate` + 单副本，SQLite 防双写），
每 60s 一轮：过期未支付订单自动取消 + 释放预留卡密 + reservations 兜底。

## 3. 冒烟验证（切流前）

```bash
kubectl -n idoknow port-forward deploy/voicehubpay-ts 18080:8080 &
curl -s localhost:18080/health                       # {"status":"ok"}
curl -sI localhost:18080/ | head -1                  # web 静态页 200
# legacy 商品列表/下单页可打开
```

## 4. 切流

ingress `voicehubpay` 后端 `service: voicehubpay:8080` → `voicehubpay-ts:8080`：

```bash
kubectl -n idoknow patch ingress voicehubpay --type=json \
  -p='[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"voicehubpay-ts"}]'
```

回滚 = 把 name 改回 `voicehubpay`（PHP 栈保持原样未动，秒级回退）。

## 5. 观察点

- SG65 回调：`GET /payments/sg65/notify` 返回 success/verify_failed —— 盯
  verify_failed / amount_mismatch 日志
- worker 日志：每轮 `expireUnpaidOrders`/`releaseExpired` 结果
- 稳定运行数日后可下线旧 `voicehubpay` PHP Deployment

## 注意

- 稳妥起见切流前先对 `voicehubpay.sqlite` 做一次快照备份（hostPath 在宿主机上）。
- PG 迁移（DATABASE_URL）是可选后续：现结构直接沿用 SQLite 最小改动；
  如要切 PG，需要先跑卡密重加密迁移（libsodium → AES-GCM 由 masterkey 差异决定,
  当前同 key 复用则无需重加密）。
