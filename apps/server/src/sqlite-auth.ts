import type { Database } from "../../../packages/db/src/index.js";
import type { AuthDependencies, AuthUser, SessionRecord } from "./auth.js";

/** Additive server-owned auth schema; compatible with the existing users table. */
export async function migrateAuthSchema(db: Database): Promise<void> {
  await db.query("CREATE TABLE IF NOT EXISTS server_auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL)");
  await db.query(`CREATE TABLE IF NOT EXISTS server_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES server_auth_users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS idx_server_auth_sessions_expiry ON server_auth_sessions(expires_at)");
}

export function createSqliteAuthRepositories(db: Database): AuthDependencies {
  if (db.dialect !== "sqlite") throw new Error("SQLite auth repositories require a SQLite database");
  return {
    users: {
      async findByEmail(email: string): Promise<AuthUser | null> {
        const result = await db.query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM server_auth_users WHERE lower(email) = ? LIMIT 1", [email.toLowerCase()]);
        const user = result.rows[0];
        return user ? { id: user.id, passwordHash: user.password_hash } : null;
      },
    },
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
