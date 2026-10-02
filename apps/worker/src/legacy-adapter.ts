import { Pool } from "pg";
import {
  createPostgresDatabase,
  createSqliteDatabase,
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  type Database,
} from "../../../packages/db/src/index.js";
import { ShopService } from "../../server/src/shop-legacy/shop-service.js";
import { createShopLegacyDependencies, EnvShopConfig } from "../../server/src/shop-legacy/index.js";
import type { WorkerPorts } from "./index.js";

/**
 * Real adapter composition for the worker over the legacy-schema database
 * (PostgreSQL via DATABASE_URL, or SQLite via DATABASE_PATH — mirrors the
 * server entry).
 *
 * - reservations.releaseExpiredUnpaid → inventory.releaseExpired(now): frees
 *   cards whose reservation TTL lapsed on still-unpaid orders.
 * - reservations sweep also cancels expired unpaid orders via
 *   ShopService.expireUnpaidOrders(), which releases each order's remaining
 *   cards and marks the order cancelled (PHP scripts/release-reservations.php).
 */
export async function createLegacyWorkerPorts(env: NodeJS.ProcessEnv = process.env): Promise<WorkerPorts> {
  const databaseUrl = env.DATABASE_URL;
  const databasePath = env.DATABASE_PATH;
  let db: Database;
  let close: () => Promise<void>;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    db = createPostgresDatabase(pool);
    close = () => pool.end();
  } else if (databasePath) {
    const sqlite = createSqliteDatabase(databasePath);
    db = sqlite;
    close = () => sqlite.close();
  } else {
    throw new Error("DATABASE_URL or DATABASE_PATH is required for worker adapters");
  }

  const basePath = env.APP_BASE_PATH ?? process.cwd();
  const deps = createShopLegacyDependencies(db, new EnvShopConfig(env), { basePath });
  const inventory = new InventoryRepository(db);
  const orders = new OrderRepository(db);
  const shop = new ShopService(deps);

  return {
    fulfillment: {
      async process(limit: number): Promise<number> {
        // Fulfillment delivery is handled by the voicehub plugin push flow;
        // nothing to do here until the delivery queue lands.
        void limit;
        return 0;
      },
    },
    afdian: {
      async poll(limit: number): Promise<number> {
        void limit;
        return 0;
      },
    },
    reservations: {
      async releaseExpiredUnpaid(limit: number): Promise<number> {
        const nowIsoValue = new Date().toISOString();
        // 1) Free lapsed reservations directly (cards of unpaid orders only).
        const released = await inventory.releaseExpired(nowIsoValue);
        // 2) Cancel expired unpaid orders (releases their remaining cards,
        //    marks order cancelled, cancels pending payment transactions).
        const cancelled = await shop.expireUnpaidOrders(limit);
        // Silence unused warnings if repos evolve.
        void orders;
        void close;
        return released + cancelled;
      },
    },
  };
}
