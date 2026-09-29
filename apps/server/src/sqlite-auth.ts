import type { Database } from "../../../packages/db/src/index.js";
import type { AuthDependencies, AuthUser, SessionRecord } from "./auth.js";
import type { OrderStatusResponse } from "../../../packages/contracts/src/commerce.js";

export interface SqliteOrderStatus {
  getForUser(id: number | string, userId: string): Promise<OrderStatusResponse | null>;
}

export function createSqliteOrderStatusRepository(db: Database): SqliteOrderStatus {
  if (db.dialect !== "sqlite") throw new Error("SQLite order status repository requires a SQLite database");
  return { async getForUser(id, userId) {
    const result = await db.query<{ id: number | string; order_no: string; order_status: string; payment_status: string; fulfillment_status: string; amount_due_cents: number; amount_paid_cents: number; created_at: string }>("SELECT id, order_no, order_status, payment_status, fulfillment_status, amount_due_cents, amount_paid_cents, created_at FROM orders WHERE CAST(id AS TEXT) = CAST(? AS TEXT) AND CAST(user_id AS TEXT) = CAST(? AS TEXT) LIMIT 1", [id, userId]);
    const row = result.rows[0];
    if (!row) return null;
    const numericId = Number(row.id);
    if (!Number.isSafeInteger(numericId) || numericId < 1) return null;
    return { id: numericId, orderNo: row.order_no, orderStatus: row.order_status, paymentStatus: row.payment_status.toLowerCase() as "unpaid" | "pending" | "paid" | "failed", fulfillmentStatus: row.fulfillment_status, amountDueCents: Number(row.amount_due_cents), amountPaidCents: Number(row.amount_paid_cents), createdAt: row.created_at };
  } };
}

export async function migrateAuthSchema(db: Database): Promise<void> {
  await db.query("CREATE TABLE IF NOT EXISTS server_auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL)");
  await db.query("CREATE TABLE IF NOT EXISTS server_auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES server_auth_users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_server_auth_sessions_expiry ON server_auth_sessions(expires_at)");
}

export function createSqliteAuthRepositories(db: Database): AuthDependencies {
  if (db.dialect !== "sqlite") throw new Error("SQLite auth repositories require a SQLite database");
  return {
    users: { async findByEmail(email: string): Promise<AuthUser | null> {
      const result = await db.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM server_auth_users WHERE lower(email) = ? LIMIT 1", [email.toLowerCase()]);
      const user = result.rows[0];
      return user ? { id: user.id, passwordHash: user.password_hash } : null;
    } },
    sessions: {
      async create(userId, tokenHash, csrfToken, expiresAt) {
        await db.query("INSERT INTO server_auth_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)", [tokenHash, userId, csrfToken, expiresAt.getTime()]);
      },
      async find(tokenHash): Promise<SessionRecord | null> {
        const result = await db.query<{ user_id: string; csrf_token: string }>("SELECT user_id, csrf_token FROM server_auth_sessions WHERE token_hash = ? AND expires_at > ?", [tokenHash, Date.now()]);
        const row = result.rows[0];
        return row ? { userId: row.user_id, csrfToken: row.csrf_token } : null;
      },
      async rotate(oldHash, newHash, csrfToken, expiresAt) {
        return db.transaction(async (tx) => {
          const old = await tx.query<{ user_id: string }>("SELECT user_id FROM server_auth_sessions WHERE token_hash = ? AND expires_at > ?", [oldHash, Date.now()]);
          const userId = old.rows[0]?.user_id;
          if (!userId) return false;
          const deletion = await tx.query("DELETE FROM server_auth_sessions WHERE token_hash = ?", [oldHash]);
          if (deletion.rowCount !== 1) return false;
          await tx.query("INSERT INTO server_auth_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)", [newHash, userId, csrfToken, expiresAt.getTime()]);
          return true;
        });
      },
      async revoke(tokenHash) { await db.query("DELETE FROM server_auth_sessions WHERE token_hash = ?", [tokenHash]); },
    },
    passwords: { async verify(hash, password) { const { argon2idPasswords } = await import("./auth.js"); return argon2idPasswords.verify(hash, password); } },
  };
}
