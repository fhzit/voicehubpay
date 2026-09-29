import { createSqliteDatabase, SqliteCatalogRepository } from "../../../packages/db/src/index.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSqliteAuthRepositories, createSqliteOrderStatusRepository, migrateAuthSchema } from "./sqlite-auth.js";

const config = loadConfig();
const databasePath = process.env.DATABASE_PATH;
const db = databasePath ? createSqliteDatabase(databasePath) : null;
try {
  if (db) {
    await migrateAuthSchema(db);
    const auth = createSqliteAuthRepositories(db);
    const commerce = {
      auth,
      products: new SqliteCatalogRepository(db),
      orders: createSqliteOrderStatusRepository(db),
    };
    const app = buildApp({ auth, commerce, secureCookies: config.nodeEnv === "production" });
    app.addHook("onClose", async () => { await db.close(); });
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`VoiceHubPay API listening on ${config.host}:${config.port}`);
  } else {
    const app = buildApp({ secureCookies: config.nodeEnv === "production" });
    app.log.warn("Authentication and commerce are disabled: DATABASE_PATH is not configured");
    await app.listen({ port: config.port, host: config.host });
  }
} catch (error) {
  console.error(error);
  await db?.close();
  process.exitCode = 1;
}
