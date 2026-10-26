# VoiceHubPay PHP → TypeScript 迁移运行手册

> 目标站点：`vhpay.idoknow.top`  
> Rancher 集群：`asia-k3s`；项目/命名空间：`idoknow`  
> 目标节点：`cn-sh-tencent-01`  
> TS 镜像：`ghcr.nju.edu.cn/fhzit/voicehubpay:refactor-typescript-fullstack-migration`

本文描述安全迁移路径：**核对资产 → 备份 → 准备 TS 配置 → 并行部署 → 验证 → 切流 → 观察/回滚**。除非明确完成验收，不要删除 PHP Deployment、站点文件、主密钥或数据库备份。

---

## 0. 当前状态与管理员前置报告

用户提供的管理员报告补齐了关键事实：

- 实际节点为 `cn-sh-tencent-01`（Debian 12、containerd）。报告记载 PHP 镜像已在该节点 Kubernetes containerd，TS 镜像已通过 `k3s crictl pull` 拉取，Web 镜像从 Docker 导入 containerd。后续 SSH 不稳定，执行前需重新读回确认这些节点状态。
- 旧站真实根目录：`/opt/k8s-idoknow/panel/www/sites/vhpay/index`。
- 真实主密钥：`/opt/k8s-idoknow/panel/www/sites/vhpay/index/storage/.masterkey`。不要使用错误路径 `/opt/k8s-idoknow/panel/www/storage/.masterkey`。
- 站点 PHP/Nginx 目录与主密钥均包含在同节点备份 `/root/voicehubpay-preflight/legacy-panel.tar` 中。报告记录大小 14,305,280 bytes、SHA-256 `fb03b3899edb74900df75fd86ab14d9a3ce2ebe849419480b0d7c056dc86bd68`，归档目录检查确认含 `.masterkey`。备份当前仅在同一节点，尚无异机副本。
- 报告定位调度拒绝根因为宽泛 `Exists/NoSchedule` toleration 命中 Sydney 专用准入策略；报告给出的两个精确 toleration 曾以用户身份 server-side dry-run 成功。不得放宽或修改准入策略。
- 本会话当前实测：PHP Deployment 0 副本，TS Deployment/Service 尚不存在，Ingress 仍指向 `voicehubpay:8080`，PostgreSQL 1/1。
- PHP/TS 生产运行、TS 解密兼容、PHP HTTP 回滚均未实测。节点报告中的镜像/文件事实不代表现在已再次核验。

**禁止事项：**不要输出或复制 `.masterkey`、私钥、Secret 值；不要让 TS 在旧主密钥未挂载时生成新 key；不要未验证兼容性就改写卡密密文；不要未经验收切换 Ingress。

---

## 1. 变更前只读核对

### 1.1 Rancher/Kubernetes 资源

```bash
rancher context current
rancher ps --project idoknow
rancher inspect --type workload voicehubpay
kubectl -n idoknow get deploy voicehubpay voicehub-postgres voicehubpay-ts
kubectl -n idoknow get svc voicehubpay voicehub-postgres voicehubpay-ts
kubectl -n idoknow get ingress voicehubpay -o yaml
kubectl -n idoknow get secret voicehubpay-ts-env -o name
```

检查副本数、镜像/tag、拉取策略、nodeSelector、tolerations、端口/探针、Secret 引用与 hostPath。不要读取 Secret `.data`/`.stringData`。迁移前 Ingress 后端应仍为 `voicehubpay:8080`。

### 1.2 在真实节点核验目录和镜像

必须通过 `cn-sh-tencent-01` 的授权节点通道执行，不要在其他宿主机推断：

```bash
sudo stat /opt/k8s-idoknow/panel/www/sites/vhpay/index
sudo stat /opt/k8s-idoknow/panel/www/sites/vhpay/index/storage/.masterkey
sudo find /opt/k8s-idoknow/panel/www/sites/vhpay/index -maxdepth 2 -type f \
  -printf '%P %s bytes %TY-%Tm-%Td\n' | head -100
sudo k3s crictl images | grep -E 'voicehubpay-php|voicehub-web|fhzit/voicehubpay'
```

确认 `k3s crictl` 指向 kubelet 实际使用的 containerd；核对完整镜像 tag 与 repo digest，不要仅看 Docker daemon 的镜像列表。不要 `cat` `.masterkey` 或输出敏感配置。

### 1.3 核对节点污点和准入约束

节点污点以实时检查为准。管理员报告提供的精确容忍配置：

```yaml
nodeSelector:
  kubernetes.io/hostname: cn-sh-tencent-01
tolerations:
  - key: migration.rockchin.top/hold
    operator: Equal
    value: "true"
    effect: NoSchedule
  - key: workload.rockchin.top/langbot-cloud-excluded
    operator: Equal
    value: "true"
    effect: NoSchedule
```

禁止使用无 key 的 `operator: Exists`。应用前用同一身份 server-side dry-run，不修改集群准入策略：

```bash
kubectl apply --dry-run=server -f <审阅后的清单>
```

---

## 2. 备份

### 2.1 PostgreSQL

确认 `voicehub-postgres` 为 Ready、`pg_isready` 成功、库名为 `voicehubpay`。用受控环境执行自定义格式备份：

```bash
pg_dump -Fc --no-owner --dbname="$DATABASE_URL" \
  -f /secure-backup/voicehubpay-$(date +%Y%m%d-%H%M%S).dump
pg_restore -l /secure-backup/voicehubpay-*.dump >/dev/null
sha256sum /secure-backup/voicehubpay-*.dump
```

真实连接串不要放进聊天、日志或 shell 历史。备份写入持久安全路径，记录大小/校验和并验证可读，尽可能复制到异机；不要依赖临时目录或旧备份路径。

### 2.2 站点文件与配置

管理员报告记录的同节点归档：

```text
/root/voicehubpay-preflight/legacy-panel.tar
SHA-256: fb03b3899edb74900df75fd86ab14d9a3ce2ebe849419480b0d7c056dc86bd68
```

执行前在节点读回文件大小、权限、哈希，并验证归档包含：

```text
www/sites/vhpay/index/storage/.masterkey
```

备份含站点和主密钥，应限制权限（目录 `0700`、文件 `0600`），并复制异机安全位置。不要打印 key。

受控保存当前 Deployment、Service、Ingress、ConfigMap；Secret 如需备份必须加密且限制访问。确认切流前 Ingress 仍指向 `voicehubpay:8080`。

---

## 3. 修正并准备 TS 配置

清单位置：

```text
deploy/k8s/voicehubpay-ts.yaml
deploy/k8s/README.md
```

目标是新建独立 `voicehubpay-ts` Deployment/Service，不覆盖旧 PHP 资源。Deployment 包括 `server`、`worker` 两容器，共用 TS 镜像；服务端口 `8080`，健康检查 `/health`，Worker 每 60 秒运行。

### 3.1 镜像与调度

镜像：

```text
ghcr.nju.edu.cn/fhzit/voicehubpay:refactor-typescript-fullstack-migration
```

- 执行前从节点读回镜像 digest；报告里的 image/config ID 不等于 registry manifest digest。
- 选与实际镜像供应方式匹配的 `imagePullPolicy`。节点已预拉时可用 `IfNotPresent`；若 `Always`，确认 registry 网络和认证可用。不要对未缓存镜像使用 `Never`。
- `nodeSelector` 指定 `cn-sh-tencent-01`，tolerations 使用上节精确 key/value，禁止宽泛 `Exists`。

### 3.2 站点子路径和主密钥挂载

hostPath 允许根目录是：

```text
/opt/k8s-idoknow/panel/www
```

但真正站点根是子目录 `sites/vhpay/index`。TS 容器应将站点根子目录只读挂到 `/legacy/vhpay`：

```yaml
volumes:
  - name: legacy-site
    hostPath:
      path: /opt/k8s-idoknow/panel/www
      type: Directory
volumeMounts:
  - name: legacy-site
    subPath: sites/vhpay/index
    mountPath: /legacy/vhpay
    readOnly: true
```

真实 `.masterkey` 随此挂载映射为：

```text
/legacy/vhpay/storage/.masterkey
```

这才与 TS 的 `APP_BASE_PATH=/legacy/vhpay/index` 加 `storage/.masterkey` 寻址方式一致。应用前审阅实际代码/路径语义，并以只读检查确认容器访问的是生产旧 key。不得使用 `/opt/k8s-idoknow/panel/www/storage/.masterkey`，也不得把完整 www 根误当站点根。

TS 的密钥代码在 key 不存在时可能生成新 key，因此必须先确认上述挂载生效、旧 key 可读，再允许应用启动。若挂载或 key 有问题，停止 Deployment，不要让它生成替代 key。

### 3.3 Secret

在 `idoknow` 命名空间以受控凭据渠道创建 `voicehubpay-ts-env`，清单至少要求：

- `DATABASE_URL`：连接 `voicehub-postgres` 中的 `voicehubpay`；
- `SG65_PID`；
- `SG65_MERCHANT_PRIVATE_KEY`；
- `SG65_PLATFORM_PUBLIC_KEY`。

不把敏感值用命令行 `--from-literal`、提交 Git、贴聊天或写普通临时文件。使用 Secret manager 或受限权限临时文件；创建后只检查 Secret 名称/key 名称，不读值。DB 连接串和支付凭证必须来自可信现存来源，不能猜测。

数据库保持原有实例/存储，不重建、不清库。首次 TS 启动可能执行幂等 schema 补齐，必须先备份并审阅迁移代码。

---

## 4. 并行部署 TS（暂不切流）

1. 确认数据库健康、数据库备份可读。
2. 确认节点实际镜像 digest、hostPath 子目录和 `.masterkey`、节点污点、准入 dry-run 均通过。
3. 创建 Secret 并检查 key 名（不显示值）。
4. 审阅最终 YAML：没有空 Secret、精确 tolerations、正确 `subPath`、只读挂载、镜像策略正确。
5. 对 Secret 与工作负载分别 server-side dry-run。
6. 仅应用 TS Service/Deployment，不动 PHP、Service 和 Ingress：

```bash
kubectl apply -f deploy/k8s/voicehubpay-ts.yaml
kubectl -n idoknow rollout status deploy/voicehubpay-ts --timeout=5m
kubectl -n idoknow get deploy,pod,svc -l app=voicehubpay-ts -o wide
```

7. 确认两个容器 Ready、Pod 在目标节点、镜像 digest 正确、目录只读挂载、生产 `.masterkey` 可读。
8. 检查 Events/日志中无 `ErrImagePull`、调度拒绝、数据库连接、迁移、解密错误；日志不应出现连接串、密钥或卡密明文。失败时先定位根因，不盲目重启。

---

## 5. 冒烟和业务验收

暂时使用 port-forward，不改公网流量：

```bash
kubectl -n idoknow port-forward deploy/voicehubpay-ts 18080:8080
```

另一终端：

```bash
curl --fail --show-error http://127.0.0.1:18080/health
curl -I http://127.0.0.1:18080/
```

预期 `/health` 返回 `{"status":"ok"}`，首页 HTTP 200。随后用低风险测试数据验收：管理员登录、商品/订单读取、旧卡密解密、库存预留/取消、SG65 验签及金额核对、爱发电流程（若启用）、VoiceHub 发券幂等、Worker 超时释放。不要在未批准情况下触发真实付款或真实发券。

比较数据库迁移前后的 schema、记录计数和关键业务数据；确认没有重复订单、误写状态或密文更改。用受控测试密文验证 PHP→TS 解密，不输出明文/密文。Server/Worker 日志均需检查。

---

## 6. 切流

只有数据库与文件备份可恢复、TS Pod 就绪、Secret/镜像/key/解密已验证、业务验收通过、回滚方案可用时才切流。切流前读回 Ingress 后端应为 `voicehubpay:8080`。

```bash
kubectl -n idoknow patch ingress voicehubpay --type=json \
  -p='[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"voicehubpay-ts"}]'
```

立即读回 Ingress，确认后端 `voicehubpay-ts:8080`，检查 Service endpoints/Pod Ready，再通过正常 TLS 访问：

```bash
curl --fail --show-error https://vhpay.idoknow.top/health
curl -I https://vhpay.idoknow.top/
```

验证登录、商品、订单、支付回调和发券，观察 5xx、验签失败、Worker 错误与数据库异常。PHP Deployment、镜像、站点文件、key 和备份继续保留。

---

## 7. 回滚

出现严重问题时，先切回 PHP Service：

```bash
kubectl -n idoknow patch ingress voicehubpay --type=json \
  -p='[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"voicehubpay"}]'
kubectl -n idoknow get ingress voicehubpay -o yaml
```

然后确认旧 PHP 镜像确实在节点 Kubernetes containerd、PHP hostPath 类型正确、站点文件与 PHP 运行时目录有效，且精确调度容忍通过，再扩容 PHP Deployment 并等待 Ready/HTTP 验证。**历史模板不是可用回滚的证据；回滚目标必须预先实际启动验收。**

确认流量已回 PHP 后，才将 TS 缩为 0：

```bash
kubectl -n idoknow scale deploy/voicehubpay-ts --replicas=0
```

如果 TS 已写入数据库，不要直接用备份覆盖现库。先停止写入并盘点变更，再执行已审定的恢复方案。

---

## 8. 稳定期与清理

切流后观察数日：HTTP 5xx、登录会话、订单状态、SG65 `verify_failed`/`amount_mismatch`、Worker 重复发券/库存释放、PostgreSQL 连接/锁/慢查询、`.masterkey` 挂载与备份。稳定并经业务负责人确认后，另行批准 PHP 下线。删除旧 Deployment、镜像、站点目录、主密钥或备份均是独立且影响回滚的变更。

---

## 9. 当前状态清单

- [x] 管理员报告称节点上 PHP/Web/TS 镜像已准备；操作时需重新读回。
- [x] 管理员报告确认旧站目录、真实 `.masterkey` 路径和同节点归档。
- [x] 管理员报告确认调度拒绝原因与精确 toleration 修正，dry-run 成功。
- [ ] 完成数据库备份、受控配置备份和异机文件备份。
- [ ] 在当前节点核实镜像 repo digest、目录类型、归档校验和。
- [ ] 创建并验证 TS Secret（DB/SG65）。
- [ ] 修正 TS 清单为精确 tolerations、`subPath: sites/vhpay/index`，确保 key 路径与只读挂载正确。
- [ ] 当前身份 server-side dry-run 通过。
- [ ] 部署并验收 TS Server/Worker、数据库兼容和卡密解密。
- [ ] PHP 回滚目标实际 Ready/HTTP 验收。
- [ ] 批准后切换 Ingress 并验证公网。

> 本文为操作手册，不代表迁移已完成。最近一次集群实时核对：PHP 0 副本、TS Deployment/Service 不存在、Ingress 仍指向 PHP Service、PostgreSQL 1/1。
