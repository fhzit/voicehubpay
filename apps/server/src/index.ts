import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import {
  createSqliteDatabase,
  createPostgresDatabase,
  SqliteCatalogRepository,
  PostgresCatalogRepository,
} from "../../../packages/db/src/index.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSqliteAuthRepositories, createSqliteOrderStatusRepository, migrateAuthSchema } from "./sqlite-auth.js";
import {
  createShopLegacyDependencies,
  EnvShopConfig,
  migrateShopSchema,
} from "./shop-legacy/index.js";
import { AfdianOrderRepository, VoiceHubDeliveryRepository, CryptoService, type Database } from "../../../packages/db/src/index.js";
import { configureAfdianWebhook } from "./afdian-webhook.js";
import { createAfdianWebhookProcessor } from "./afdian-webhook-processor.js";
import {
  configureAccountRoutes,
  configureAuthRoutes,
  createSqliteLegacyAuthDependencies,
} from "./auth-legacy/index.js";
import { configureErrorPages } from "./error-pages.js";
import { AggregateOAuthProvider } from "./aggregate-oauth.js";
import { PageConfig } from "./page-config.js";
import { checkDeploymentEnv, formatDeploymentReport } from "./env-check.js";
import { FileAdminConfig, registerAdminRoutes } from "./admin/index.js";
import { SmtpMailer } from "./mailer.js";
import { createAfdianAdminProcessor } from "./admin-afdian-processor.js";
import { EmailCodeService } from "./email-code.js";
import { Sg65Client, sg65HttpPost } from "./shop-legacy/sg65-client.js";
import { ensureAdminSchema } from "./admin/index.js";
import { registerInventoryGenerateRoutes } from "./admin-inventory-generate.js";
import { createAdminWiring } from "./admin-wiring.js";
import { ensureLegacySchema } from "./schema-bootstrap.js";

const deployment = checkDeploymentEnv();
console.log(formatDeploymentReport(deployment));
if (!deployment.ok) {
  console.error("启动中止：缺少必要环境变量。设置 ALLOW_EMPTY_DB=1 可在无数据库时启动用于探活。");
  process.exit(1);
}

const config = loadConfig();
const databaseUrl = process.env.DATABASE_URL;
const databasePath = process.env.DATABASE_PATH;
const afdianConfig = new EnvShopConfig();

try {
  // PostgreSQL (DATABASE_URL) takes precedence; SQLite (DATABASE_PATH) is the
  // default single-node deployment.
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    const db = createPostgresDatabase(pool);
    await migrateAuthSchema(db);
    await migrateShopSchema(db);
    const auth = createSqliteAuthRepositories(db);
    const commerce = {
      auth,
      products: new PostgresCatalogRepository(db),
      orders: createSqliteOrderStatusRepository(db),
      shop: createShopLegacyDependencies(db, new EnvShopConfig(), { basePath: process.env.APP_BASE_PATH ?? process.cwd() }),
    };
    let shop;
    if (new EnvShopConfig().bool("SHOP_LEGACY_ENABLED", false)) {
      shop = createShopLegacyDependencies(db, new EnvShopConfig(), {
        basePath: process.env.APP_BASE_PATH ?? process.cwd(),
      });
    }
    const app = buildApp({ auth, commerce, shop, secureCookies: config.nodeEnv === "production" });
    await wirePageRoutes(app, db, config.nodeEnv === "production", shop === undefined);
    await configureAfdianTables(db);
    configureAfdianWebhook(app, {
      enabled: () => afdianConfig.bool("AFDIAN_WEBHOOK_ENABLED", false),
      requireSignature: () => afdianConfig.bool("AFDIAN_WEBHOOK_REQUIRE_SIGNATURE", true),
      publicKey: afdianConfig.get("AFDIAN_WEBHOOK_PUBLIC_KEY").replace(/\\n/g, "\n"),
      processNormalizedOrder: createAfdianWebhookProcessor(
        new AfdianOrderRepository(db), new VoiceHubDeliveryRepository(db),
        new CryptoService(process.env.APP_BASE_PATH ?? process.cwd()),
      ),
    });
    app.addHook("onClose", async () => { await pool.end(); });
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`VoiceHubPay API (pgsql) listening on ${config.host}:${config.port}`);
  } else if (databasePath) {
    const db = createSqliteDatabase(databasePath);
    await migrateAuthSchema(db);
    await migrateShopSchema(db);
    const auth = createSqliteAuthRepositories(db);
    const commerce = {
      auth,
      products: new SqliteCatalogRepository(db),
      orders: createSqliteOrderStatusRepository(db),
      shop: createShopLegacyDependencies(db, new EnvShopConfig(), { basePath: process.env.APP_BASE_PATH ?? process.cwd() }),
    };
    let shop;
    if (new EnvShopConfig().bool("SHOP_LEGACY_ENABLED", false)) {
      shop = createShopLegacyDependencies(db, new EnvShopConfig(), {
        basePath: process.env.APP_BASE_PATH ?? process.cwd(),
      });
    }
    const app = buildApp({ auth, commerce, shop, secureCookies: config.nodeEnv === "production" });
    await wirePageRoutes(app, db, config.nodeEnv === "production", shop === undefined);
    await configureAfdianTables(db);
    configureAfdianWebhook(app, {
      enabled: () => afdianConfig.bool("AFDIAN_WEBHOOK_ENABLED", false),
      requireSignature: () => afdianConfig.bool("AFDIAN_WEBHOOK_REQUIRE_SIGNATURE", true),
      publicKey: afdianConfig.get("AFDIAN_WEBHOOK_PUBLIC_KEY").replace(/\\n/g, "\n"),
      processNormalizedOrder: createAfdianWebhookProcessor(
        new AfdianOrderRepository(db), new VoiceHubDeliveryRepository(db),
        new CryptoService(process.env.APP_BASE_PATH ?? process.cwd()),
      ),
    });
    app.addHook("onClose", async () => { await db.close(); });
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`VoiceHubPay API (sqlite) listening on ${config.host}:${config.port}`);
  } else {
    const app = buildApp({ secureCookies: config.nodeEnv === "production" });
    app.log.warn("Authentication and commerce are disabled: DATABASE_URL or DATABASE_PATH is not configured");
    await app.listen({ port: config.port, host: config.host });
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

/**
 * Register the PHP-parity HTML surfaces that the API layer does not cover:
 * `/login`, `/register`, `/auth/password/*`, `/account/*` (auth-legacy routes)
 * and the 404/500 error pages. Storefront pages are wired by `shop`.
 */
async function wirePageRoutes(app: FastifyInstance, db: Database, secureCookies: boolean, withErrorPages: boolean): Promise<void> {
  const shopConfig = new PageConfig();
  const legacyAuth = await createSqliteLegacyAuthDependencies(db, {
    config: shopConfig,
    socialProvider: new AggregateOAuthProvider(shopConfig, undefined, () => process.env.APP_URL ?? ""),
    secureCookies,
    basePath: process.env.APP_BASE_PATH ?? process.cwd(),
  });
  // 注册/绑定邮箱需要验证码与发信能力（SmtpMailer 读取后台 SMTP 设置）。
  const authConfig = new FileAdminConfig(process.env.ADMIN_DATA_DIR ?? "/data");
  const emailCodes = new EmailCodeService(db);
  await emailCodes.ensureSchema();
  legacyAuth.emailCodes = emailCodes;
  legacyAuth.mailer = new SmtpMailer(authConfig, process.env.APP_BASE_PATH ?? "/legacy/vhpay");
  configureAuthRoutes(app, legacyAuth);
  configureAccountRoutes(app, legacyAuth);

  // PHP-parity tables the incremental schemas miss (social_identities, audit_logs, analytics_daily).
  await ensureLegacySchema(db);

  // Admin panel (PHP parity) + card-code generation.
  await ensureAdminSchema(db);
  // Admin settings persist to a writable dir (env/Secret supplies the defaults,
  // so SG65 / Afdian / VoiceHub values are visible and editable without SQLite).
  const adminConfig = new FileAdminConfig(process.env.ADMIN_DATA_DIR ?? "/data");
  const wiring = createAdminWiring(db, {
    config: adminConfig,
    mailer: new SmtpMailer(adminConfig, process.env.APP_BASE_PATH ?? "/legacy/vhpay"),
    // HEAD/GET probe used by 后台 → 设置 → VoiceHub「连通性测试」.
    // 后台「支付设置 → 测试连接」用同一套凭据与传输（含重试）。
    sg65Probe: new Sg65Client(adminConfig, { now: () => Math.floor(Date.now() / 1000) }, sg65HttpPost),
    voicehubProbe: async (baseUrl, token) => {
      const base = baseUrl.replace(/\/+$/, "");
      try {
        const response = await fetch(base === "" ? "http://127.0.0.1" : base, {
          method: "GET",
          headers: token === "" ? {} : { "x-api-key": token },
          signal: AbortSignal.timeout(8000),
          redirect: "manual",
        });
        return { reachable: true, status: response.status, error: "" };
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause;
        return { reachable: false, status: 0, error: cause?.code ?? (error instanceof Error ? error.message : String(error)) };
      }
    },
    // 后台「爱发电订单 → 手动同步/重试」的真实处理器（此前未装配，永远提示未配置）。
    afdianProcessor: createAfdianAdminProcessor({
      config: adminConfig,
      orders: new AfdianOrderRepository(db),
      deliveries: new VoiceHubDeliveryRepository(db),
      crypto: new CryptoService(process.env.APP_BASE_PATH ?? process.cwd()),
    }),
    sessions: legacyAuth.sessions,
    crypto: new CryptoService(process.env.APP_BASE_PATH ?? process.cwd()),
    secureCookies,
  });
  registerAdminRoutes(app, wiring.admin);
  registerInventoryGenerateRoutes(app, wiring.inventoryGenerate);
  // configureShopRoutes already registers the shared 404/500 pages when the
  // legacy shop is enabled; only add them for API-only deployments.
  if (withErrorPages) configureErrorPages(app, { config: shopConfig });
}

async function configureAfdianTables(db: Database): Promise<void> {
  const pk = db.dialect === "pgsql" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const ts = "VARCHAR(64)";
  await db.query(`CREATE TABLE IF NOT EXISTS afdian_orders (id ${pk}, out_trade_no VARCHAR(128) NOT NULL UNIQUE, trade_no VARCHAR(128) NOT NULL DEFAULT '', user_id VARCHAR(128) NOT NULL DEFAULT '', buyer_name VARCHAR(128) NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', plan_id VARCHAR(128) NOT NULL DEFAULT '', sku_detail TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0, status VARCHAR(64) NOT NULL DEFAULT 'paid', raw_payload TEXT NOT NULL DEFAULT '', voicehub_status VARCHAR(64) NOT NULL DEFAULT 'pending', voicehub_attempts INTEGER NOT NULL DEFAULT 0, voicehub_last_error TEXT NULL, created_at ${ts} NOT NULL, paid_at ${ts} NULL, processed_at ${ts} NULL, updated_at ${ts} NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS voicehub_deliveries (id ${pk}, source_type VARCHAR(32) NOT NULL, source_id BIGINT NULL, source_order_no VARCHAR(128) NOT NULL, fulfillment_unit_id BIGINT NULL, code_ciphertext TEXT NOT NULL, code_hash VARCHAR(128) NOT NULL, code_source VARCHAR(32) NOT NULL, idempotency_key VARCHAR(255) NOT NULL UNIQUE, status VARCHAR(32) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL, request_payload TEXT NULL, response_payload TEXT NULL, created_at ${ts} NOT NULL, updated_at ${ts} NOT NULL, success_at ${ts} NULL)`);
}
