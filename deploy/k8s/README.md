# TS 版切换步骤（vhpay.idoknow.top）

前提：TS 镜像 `ghcr.io/fhzit/voicehubpay:refactor-typescript-fullstack-migration`
（或切 main 后用 `main`/版本 tag）已在 GHCR 可拉取。

## 1. 填 Secret

```bash
kubectl -n idoknow create secret generic voicehubpay-ts-env \
  --from-literal=DATABASE_URL='postgres://<user>:<password>@voicehub-postgres.idoknow.svc:5432/voicehubpay' \
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

数据落点：PostgreSQL —— 集群现有 `voicehub-postgres`（库 `voicehubpay`，
已含完整 legacy schema 与生产数据），`DATABASE_URL` 从 Secret 注入；
首次启动 `migrateShopSchema`/`migrateAuthSchema` 幂等补齐缺失表（如 sessions）。

masterkey：hostPath `/opt/k8s-idoknow/panel/www`（准入策略只放行该 legacy 根路径）
只读挂到容器 `/legacy/vhpay`，`APP_BASE_PATH=/legacy/vhpay/index` →
卡密解密复用 PHP 时代的 `storage/.masterkey`，密文无需重加密。

worker 与 server 同 Pod，每 60s 一轮：过期未支付订单自动取消 +
释放预留卡密 + reservations 兜底。已核对生产库：时间列为 varchar ISO 格式
（`+00:00` 偏移），与清理任务的字符串比较语义兼容；当前无滞留 reserved 卡密。

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

- 切流前对 PG 库做一次备份（`pg_dump` 到节点的临时目录）。
- 已知边界：legacy 店铺链路高并发抢卡密靠事务回滚兜底而非 SKIP LOCKED，
  出现锁等待时可升级为 FOR UPDATE SKIP LOCKED 版库存预留。
