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

const config = loadConfig();
const databaseUrl = process.env.DATABASE_URL;
const databasePath = process.env.DATABASE_PATH;

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
    };
    let shop;
    if (new EnvShopConfig().bool("SHOP_LEGACY_ENABLED", false)) {
      shop = createShopLegacyDependencies(db, new EnvShopConfig(), {
        basePath: process.env.APP_BASE_PATH ?? process.cwd(),
      });
    }
    const app = buildApp({ auth, commerce, shop, secureCookies: config.nodeEnv === "production" });
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
    };
    let shop;
    if (new EnvShopConfig().bool("SHOP_LEGACY_ENABLED", false)) {
      shop = createShopLegacyDependencies(db, new EnvShopConfig(), {
        basePath: process.env.APP_BASE_PATH ?? process.cwd(),
      });
    }
    const app = buildApp({ auth, commerce, shop, secureCookies: config.nodeEnv === "production" });
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
