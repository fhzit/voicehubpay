import type { Database } from "../../../../packages/db/src/index.js";
import { AuthThrottleRepository } from "../../../../packages/db/src/legacy/auth-throttle-repository.js";
import { insertReturningId } from "../../../../packages/db/src/legacy/shared.js";
import { CryptoService } from "../../../../packages/db/src/legacy/crypto.js";
import type { Paginated, Row } from "./types.js";
import type { AuditPort, Clock, ConfigPort, CryptoPort, LegacyAuthDependencies, OrdersPort, SessionData, SessionStore, SocialIdentityRepositoryPort, SocialAuthProvider, UnitsPort, UserRepositoryPort } from "./types.js";

/**
 * SQLite adapters binding the legacy-schema TypeScript repositories
 * (packages/db/src/legacy) to the ports consumed by auth-legacy, plus the
 * `sessions` table store consistent with the PHP session lifecycle.
 */
export class SqliteUserRepository implements UserRepositoryPort {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first((await this.db.query("SELECT * FROM users WHERE id = ?", [id])).rows);
  }

  async findByUsername(username: string): Promise<Row | null> {
    return first((await this.db.query("SELECT * FROM users WHERE username = ?", [username])).rows);
  }

  async create(data: Row): Promise<Row | null> {
    const now = nowIso();
    const id = await insertReturningId(
      this.db,
      "INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        String(data["username"] ?? ""),
        (data["password_hash"] as string | null | undefined) ?? null,
        String(data["display_name"] ?? ""),
        String(data["avatar_url"] ?? ""),
        String(data["email"] ?? ""),
        String(data["role"] ?? "user"),
        String(data["status"] ?? "active"),
        now,
        now,
      ],
    );
    return this.findById(id);
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ["username", "password_hash", "display_name", "avatar_url", "email", "role", "status", "last_login_at"];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    params.push(nowIso(), id);
    await this.db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await this.update(id, { password_hash: passwordHash });
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.update(id, { last_login_at: nowIso() });
  }

  async isSuperAdmin(id: number): Promise<boolean> {
    const row = (await this.db.query("SELECT MIN(id) AS id FROM users WHERE role IN ('admin','superadmin')")).rows[0];
    const superId = row === undefined ? null : Number(row["id"]);
    return superId !== null && !Number.isNaN(superId) && id === superId;
  }
}

export class SqliteSocialIdentityRepository implements SocialIdentityRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByIdentity(provider: string, socialUid: string): Promise<Row | null> {
    return first((await this.db.query("SELECT * FROM social_identities WHERE provider = ? AND social_uid = ? LIMIT 1", [provider, socialUid])).rows);
  }

  async listForUser(userId: number): Promise<Row[]> {
    return (await this.db.query("SELECT * FROM social_identities WHERE user_id = ? ORDER BY provider", [userId])).rows;
  }

  async getProvider(userId: number, provider: string): Promise<Row | null> {
    return first((await this.db.query("SELECT * FROM social_identities WHERE user_id = ? AND provider = ? LIMIT 1", [userId, provider])).rows);
  }

  async bind(userId: number, provider: string, socialUid: string, nickname = "", avatarUrl = ""): Promise<Row | null> {
    const now = nowIso();
    await this.db.query(
      "INSERT INTO social_identities (user_id, provider, social_uid, nickname, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [userId, provider, socialUid, nickname, avatarUrl, now, now],
    );
    return this.getProvider(userId, provider);
  }

  async unbind(userId: number, provider: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM social_identities WHERE user_id = ? AND provider = ?", [userId, provider]);
    return result.rowCount > 0;
  }

  async loginMethodCount(user: Row): Promise<number> {
    let count = 0;
    const hash = user["password_hash"];
    if (typeof hash === "string" && hash !== "") count += 1;
    count += (await this.listForUser(Number(user["id"]))).length;
    return count;
  }
}

/**
 * AuthThrottleRepository with an injected clock: the legacy repository defaults
 * to wall-clock `nowSeconds`, so a fixed-clock wrapper delegates with the
 * deterministic time. 5 failures in a 15-minute window → 15-minute lock.
 */
export class SqliteThrottleAdapter {
  private readonly repo: AuthThrottleRepository;
  constructor(db: Database, private readonly clock: Clock) {
    this.repo = new AuthThrottleRepository(db);
    this.repo.ensureTable();
  }

  isLocked(key: string): Promise<boolean> {
    return this.repo.isLocked(key, this.clock.now());
  }

  recordFailure(key: string): Promise<void> {
    return this.repo.recordFailure(key, this.clock.now());
  }

  clear(key: string): Promise<void> {
    return this.repo.clear(key);
  }

  remaining(key: string): Promise<number> {
    return this.repo.remaining(key);
  }
}

/** `sessions` table store: one row per PHP-style session, data as JSON. */
export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(
      "CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
  }

  async load(id: string): Promise<SessionData | null> {
    const row = first((await this.db.query("SELECT data FROM sessions WHERE session_id = ?", [id])).rows);
    if (row === null) return null;
    try {
      return JSON.parse(String(row["data"] ?? "{}")) as SessionData;
    } catch {
      return {};
    }
  }

  async create(id: string, data: SessionData): Promise<void> {
    const now = nowIso();
    await this.db.query(
      "INSERT INTO sessions (session_id, data, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      [id, JSON.stringify(data), now, now],
    );
  }

  async save(id: string, data: SessionData): Promise<void> {
    await this.db.query("UPDATE sessions SET data = ?, updated_at = ? WHERE session_id = ?", [JSON.stringify(data), nowIso(), id]);
  }

  async destroy(id: string): Promise<void> {
    await this.db.query("DELETE FROM sessions WHERE session_id = ?", [id]);
  }
}

/** Orders port backed by the legacy OrderRepository (account views). */
export class SqliteOrdersAdapter implements OrdersPort {
  constructor(private readonly db: Database) {}

  async listForUser(userId: number, status = "", q = "", page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (status !== "") {
      const map: Record<string, string> = {
        unpaid: "payment_status IN ('unpaid','pending')",
        paid: "payment_status = 'paid' AND fulfillment_status IN ('pending','processing','partial')",
        completed: "payment_status = 'paid' AND fulfillment_status IN ('success','manual_completed')",
        abnormal: "payment_status = 'paid' AND fulfillment_status IN ('failed')",
      };
      where.push(map[status] ?? `payment_status = '${status}'`);
    }
    if (q !== "") {
      where.push("order_no LIKE ?");
      params.push(`%${q}%`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM orders ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }

  async listForUserLatest(userId: number, limit = 5): Promise<Row[]> {
    const sql = `SELECT o.*, oi.product_name_snapshot AS first_item_name, oi.quantity AS item_quantity,
            (SELECT COUNT(*) FROM order_items oi2 WHERE oi2.order_id = o.id) AS item_count
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE o.user_id = ? AND oi.id = (SELECT MIN(oi3.id) FROM order_items oi3 WHERE oi3.order_id = o.id)
            ORDER BY o.id DESC LIMIT ${limit}`;
    return (await this.db.query(sql, [userId])).rows;
  }
}

/** Units port backed by the legacy FulfillmentUnitRepository (cards view). */
export class SqliteUnitsAdapter implements UnitsPort {
  constructor(private readonly db: Database) {}

  async listForUser(userId: number, status = "", q = "", page = 1, perPage = 10): Promise<Paginated<Row>> {
    const where = ["o.user_id = ?", "o.payment_status = ?"];
    const params: unknown[] = [userId, "paid"];
    if (status === "completed") {
      where.push("fu.status IN ('success','manual_completed')");
    } else if (status === "processing") {
      where.push("fu.status IN ('pending','processing')");
    }
    if (q !== "") {
      where.push("(oi.product_name_snapshot LIKE ? OR o.order_no LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id JOIN order_items oi ON oi.id = fu.order_item_id ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT fu.*, o.order_no, o.amount_paid_cents, oi.product_name_snapshot, oi.delivery_mode_snapshot, oi.voicehub_code_source_snapshot, oi.product_price_cents_snapshot FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id JOIN order_items oi ON oi.id = fu.order_item_id ${whereSql} ORDER BY fu.id DESC LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  async countDeliveredForUser(userId: number): Promise<number> {
    const row = (await this.db.query("SELECT COUNT(*) AS n FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = 'paid' AND fu.status IN ('success','manual_completed')", [userId])).rows[0];
    return Number(row?.n ?? 0);
  }
}

/** Audit port backed by the legacy AuditLogRepository (with redaction). */
export class SqliteAuditAdapter implements AuditPort {
  constructor(private readonly db: Database) {}

  async log(userId: number | null, action: string, objectType = "", objectId = "", metadata: Record<string, unknown> = {}, ip: string | null = null, userAgent: string | null = null): Promise<void> {
    await this.db.query(
      "INSERT INTO audit_logs (user_id, action, object_type, object_id, ip, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [userId, action, objectType, objectId, ip ?? "", userAgent ?? "", JSON.stringify(redact(metadata)) || "{}", nowIso()],
    );
  }
}

const BLOCKED_KEY_FRAGMENTS = ["password", "secret", "key", "token", "card", "code", "private_key", "appkey", "ciphertext"];

function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    output[key] = BLOCKED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) ? "[redacted]" : value;
  }
  return output;
}

/** Crypto port backed by the legacy CryptoService (AES-256-GCM, `v1:` prefix). */
export class NodeCryptoAdapter implements CryptoPort {
  private readonly service: CryptoService;
  constructor(basePath: string) {
    this.service = new CryptoService(basePath);
  }
  decrypt(cipher: string): string {
    return this.service.decrypt(cipher);
  }
  mask(value: string): string {
    return this.service.mask(value);
  }
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** In-memory config seam standing in for the PHP App->config accessor. */
export class MapConfig implements ConfigPort {
  constructor(private readonly values: Map<string, string | boolean | number> = new Map()) {}

  get(key: string, fallback = ""): string {
    const value = this.values.get(key);
    return value === undefined ? fallback : String(value);
  }

  bool(key: string, fallback: boolean): boolean {
    const value = this.values.get(key);
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }

  int(key: string, fallback: number): number {
    const value = this.values.get(key);
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  authUrl(route: string): string {
    const prefix = this.get("AUTH_SECRET_PREFIX", "").trim();
    if (prefix === "" || prefix === "/") return route;
    const normalized = `/${prefix}`.replace(/\/+/g, "/").replace(/\/+$/, "");
    return normalized === "" || normalized === "/" ? route : normalized + route;
  }
}

/**
 * Aggregate all SQLite-backed dependencies. `socialProvider` must be supplied
 * by the integrator (the real aggregate-login adapter or a test stub).
 * Orders/units/audit/crypto ports are wired to the legacy repositories so the
 * account routes work out of the box.
 */
export async function createSqliteLegacyAuthDependencies(
  db: Database,
  options: { clock?: Clock; config?: ConfigPort; socialProvider: SocialAuthProvider; secureCookies?: boolean; basePath?: string },
): Promise<LegacyAuthDependencies> {
  const clock = options.clock ?? { now: () => Math.floor(Date.now() / 1000) };
  const sessionStore = new SqliteSessionStore(db);
  await sessionStore.ensureSchema();
  return {
    users: new SqliteUserRepository(db),
    social: new SqliteSocialIdentityRepository(db),
    throttle: new SqliteThrottleAdapter(db, clock),
    sessions: sessionStore,
    socialProvider: options.socialProvider,
    config: options.config ?? new MapConfig(),
    clock,
    secureCookies: options.secureCookies,
    orders: new SqliteOrdersAdapter(db),
    units: new SqliteUnitsAdapter(db),
    audit: new SqliteAuditAdapter(db),
    crypto: new NodeCryptoAdapter(options.basePath ?? "."),
  };
}

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0]! : null;
}

