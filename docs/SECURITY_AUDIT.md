# VoiceHubPay 前后端系统性安全与质量审查报告

审查日期：2026-08-27
范围：`public/index.php`、全部 Controller/Repository/Service、认证与会话、SG65、爱发电、VoiceHub、安装与迁移、全部 PHP 视图、`app.js`、`app.css`。

## 结论

完成两轮人工代码审查与回归。未发现未修复的高危漏洞；确认的问题已在本次审查中直接修复。核心业务约束保持不变：爱发电 `out_trade_no` 原样作为 VoiceHub code、成功记录永不重推、每个 code 单独请求、商城金额由服务端按整数分计算、卡密加密存储且默认掩码、支付通知与履约解耦、迁移可备份/预演/幂等。

## 已修复问题

### 中等风险

1. **结账页支付标识不一致**：前端 `wechat/qq` 与 SG65 后端 `wxpay/qqpay` 不一致，微信和 QQ 通道被过滤。已统一标识。
2. **账户订单详情使用错误布局**：显式使用 shop 布局，导致账户导航缺失。已改为 account 布局。
3. **安装向导 POST 无 CSRF**：未安装状态下第三方站点可驱动安装步骤。已在入口验证 CSRF，并为每个安装表单加入 token。
4. **支付返回页订单归属缺失**：返回页会按传入订单号查询/展示状态，未按当前用户过滤。已要求登录用户且订单归属一致，否则返回 404。
5. **代理 IP 信任可被客户端触发**：仅凭 `X-Forwarded-Proto` 即信任 `X-Forwarded-For`，可绕过 IP 限流。已改为仅在显式 `APP_TRUST_PROXY=1` 时信任。
6. **管理员安全设置未实际执行**：`SECURITY_FORCE_HTTPS` 与 `SECURITY_ADMIN_SESSION_MINUTES` 只保存不生效。已实现 HTTPS 跳转、Secure Cookie 判定与管理员空闲会话超时。
7. **后台连接测试 AJAX 缺 CSRF**：`data-action-test` POST 被后端拒绝。已附带 CSRF。
8. **后台数据库检查存在 DOM XSS 模式**：响应错误文本进入 `innerHTML`。已改用 `textContent` 和 `replaceChildren`。
9. **第三方登录/安装/数据库异常泄露内部细节**：底层异常直接展示给浏览器。已改为服务端日志记录、客户端通用错误。
10. **配置 URL/Endpoint 输入边界不足**：站点 URL、VoiceHub/爱发电 Base URL 与 Endpoint 缺少严格结构验证。已限制为 HTTP(S) Base URL 和单斜杠开头的相对 Endpoint，并限制 cURL 协议、禁止跟随跳转。
11. **商品价格非法输入静默变为 0**：解析失败会保存零价商品。已拒绝非法或非正价格，并白名单化商品状态。
12. **SG65 通道设置未白名单化**：数组值可原样持久化，默认类型也可能未启用。已白名单过滤并保证默认类型属于启用集合。
13. **暗色主题语义边框 token 缺失**：浅色硬编码边框在暗色模式中过亮。已补齐 light/dark token 并替换硬编码。
14. **管理 Dashboard 双列布局无移动端降级**：内联 grid 模板导致窄屏挤压。已加入专用响应式类。
15. **安装数据库表单字段冲突**：SQLite 与 PostgreSQL 隐藏区域共用 `db_database`，浏览器会同时提交并可能覆盖 SQLite 路径。已拆分字段名并按数据库类型读取。
16. **VoiceHub/爱发电履约并发重复调用**：重叠 cron、Webhook 或后台重试可同时读取同一待处理记录并重复请求外部 API。已加入数据库条件更新的原子处理租约、陈旧租约回收和单次 attempts 计数。
17. **SG65 对账过度信任列表结果**：商户订单列表的 `status=1` 可直接触发本地入账，未逐单校验签名、订单号和金额。现仅将列表用于发现候选，并通过签名单笔查询确认；缺失订单号或金额时拒绝回填。
18. **爱发电未支付订单无法转为已支付**：重复订单只读回旧行，不刷新来源状态，导致首次抓到 unpaid 的订单永久不发券。已在重复事件中刷新来源字段并保留投递状态，覆盖 unpaid→paid。
19. **登录后跳转反斜杠边界**：`/\\evil.example` 可被部分浏览器规范化为外站 URL。已拒绝反斜杠、控制字符和带 authority/scheme 的目标。
20. **配置优先级与文档相反**：运行时数据库设置覆盖 `.env`，使环境级紧急覆盖不生效。已按文档改为环境层优先。
21. **并发 create-if-absent 并非真正幂等**：并发 Webhook/worker 可在“先查后插”间触发唯一键异常。现捕获唯一约束冲突并读回已存在记录。
22. **QQ/微信直连供应商配置分散**：原实现分别直连 QQ 互联和微信开放平台，需要两套凭据和两套协议。现已完全替换为任性聚合登录官方 `act=login` / `act=callback` 流程，QQ/微信共用加密 AppKey，保留一次性 state、provider 绑定和既有 `social_uid` 身份兼容；旧直连密钥保存时主动清除。

### 低风险/质量问题

1. 前端数量步进合计把整元显示成 `¥10`，与服务端两位小数不一致；已固定为两位小数。
2. OAuth HTTP 客户端允许跟随重定向；固定供应商端点现已禁止重定向并限制 HTTPS。
3. `--blue-border` 与蓝色 badge 使用浅色硬编码；已改为语义 token。
4. Afdian 管理重试的 `force` 参数对成功历史仍不会生效。这是“成功永不重推”硬规则的保护，不作为漏洞修改。

## 未发现问题的关键区域

- SQL 注入：动态 SQL 的排序字段均来自白名单，分页值强制整数，筛选条件参数化；批量 `IN` 占位符由内部 ID 数量生成。
- XSS：业务视图用户可控输出均经过 `View::e()`；卡密、订单、昵称、审计元数据均转义。
- 卡密 IDOR：揭示接口要求登录、CSRF、订单归属和已付款状态。
- SG65：RSA/SHA256 验签、PID、交易状态、精确分金额与幂等校验完整。
- 爱发电：Webhook 验签默认强制；`out_trade_no` 原样保存和投递；成功历史不会重推。
- VoiceHub：每次构造恰好一个 code；未发现批量推送路径。
- 密钥：API token、商户私钥、平台公钥使用加密 SecretStore，页面仅显示占位符。
- 库存与订单：服务端计算整数分总价，事务内预留库存；取消/超时释放库存。
- 开放重定向：登录后跳转仅允许单斜杠开头的站内相对 URL。

## 回归覆盖

新增并扩展 `tests/unit/SecurityRegressionTest.php`、`tests/integration/VoiceHubFulfillmentTest.php` 与 `tests/integration/AfdianProcessorTest.php`，覆盖代理头欺骗、SG65 前后端标识、订单布局、AJAX CSRF、金额格式、安装表单 CSRF、数据库字段隔离、跳转校验、环境配置优先级、履约原子抢占/尝试次数，以及爱发电 unpaid→paid 状态刷新。

本轮使用用户目录中的 PHP 8.4 CLI 真实执行：147 个跟踪 PHP 文件语法检查全部通过；13 个测试套件共 1643 个断言、0 失败。另在空目录启动 PHP 内置服务，按真实 Cookie+CSRF 完成 `/install` 1–7 步，确认生成 `settings.sqlite`、业务 SQLite、`.masterkey`、`install.lock`、16 张表及有效管理员账号。
