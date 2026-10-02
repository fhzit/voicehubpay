import type { Database } from "../../../../packages/db/src/index.js";
import {
  InventoryRepository,
  OrderRepository,
  PaymentTransactionRepository,
  ProductRepository,
  CryptoService,
} from "../../../../packages/db/src/legacy/index.js";
import type { ConfigPort, ShopLegacyDependencies } from "./types.js";

/**
 * Wiring layer: bind the legacy-schema TypeScript repositories to the
 * ShopLegacyDependencies ports consumed by shop-legacy routes/services,
 * mirroring the PHP App->make('products'|'orders'|'inventory'|'payments')
 * container registrations.
 *
 * `basePath` points at the deployment root so CryptoService can resolve
 * storage/.masterkey (same layout as the PHP install).
 */
export function createShopLegacyDependencies(
  db: Database,
  config: ConfigPort,
  options: { basePath: string },
): ShopLegacyDependencies {
  const crypto = new CryptoService(options.basePath);
  return {
    sessions: {
      async load(id) {
        const row = (await db.query("SELECT data FROM sessions WHERE session_id = ?", [id])).rows[0];
        if (row === undefined) return null;
        try {
          return JSON.parse(String(row["data"] ?? "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      },
      async create(id, data) {
        await db.query(
          "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
          [id, JSON.stringify(data), nowIso(), nowIso()],
        );
      },
      async save(id, data) {
        await db.query("UPDATE sessions SET data = ?, updated_at = ? WHERE session_id = ?", [JSON.stringify(data), nowIso(), id]);
      },
      async destroy(id) {
        await db.query("DELETE FROM sessions WHERE session_id = ?", [id]);
      },
    },
    db,
    config,
    crypto,
    products: new ProductRepository(db),
    orders: new OrderRepository(db),
    inventory: new InventoryRepository(db),
    transactions: new PaymentTransactionRepository(db),
  };
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
