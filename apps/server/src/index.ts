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

async function configureAfdianTables(db: Database): Promise<void> {
  const pk = db.dialect === "pgsql" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const ts = "VARCHAR(64)";
  await db.query(`CREATE TABLE IF NOT EXISTS afdian_orders (id ${pk}, out_trade_no VARCHAR(128) NOT NULL UNIQUE, trade_no VARCHAR(128) NOT NULL DEFAULT '', user_id VARCHAR(128) NOT NULL DEFAULT '', buyer_name VARCHAR(128) NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', plan_id VARCHAR(128) NOT NULL DEFAULT '', sku_detail TEXT NOT NULL DEFAULT '', amount_cents INTEGER NOT NULL DEFAULT 0, status VARCHAR(64) NOT NULL DEFAULT 'paid', raw_payload TEXT NOT NULL DEFAULT '', voicehub_status VARCHAR(64) NOT NULL DEFAULT 'pending', voicehub_attempts INTEGER NOT NULL DEFAULT 0, voicehub_last_error TEXT NULL, created_at ${ts} NOT NULL, paid_at ${ts} NULL, processed_at ${ts} NULL, updated_at ${ts} NOT NULL)`);
  await db.query(`CREATE TABLE IF NOT EXISTS voicehub_deliveries (id ${pk}, source_type VARCHAR(32) NOT NULL, source_id BIGINT NULL, source_order_no VARCHAR(128) NOT NULL, fulfillment_unit_id BIGINT NULL, code_ciphertext TEXT NOT NULL, code_hash VARCHAR(128) NOT NULL, code_source VARCHAR(32) NOT NULL, idempotency_key VARCHAR(255) NOT NULL UNIQUE, status VARCHAR(32) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL, request_payload TEXT NULL, response_payload TEXT NULL, created_at ${ts} NOT NULL, updated_at ${ts} NOT NULL, success_at ${ts} NULL)`);
}
