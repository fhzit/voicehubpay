/**
 * Email verification codes for registration and account binding.
 *
 * Codes are 6 digits, stored as `sha256(email|purpose|code)` so a database leak
 * cannot be replayed. Each issue invalidates the previous code for the same
 * email+purpose, and verification is attempt-limited.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Database } from "../../../packages/db/src/index.js";

export type EmailPurpose = "register" | "bind";

export interface EmailCodeOptions {
  ttlSeconds?: number;
  maxAttempts?: number;
  cooldownSeconds?: number;
}

const DEFAULTS = { ttlSeconds: 600, maxAttempts: 5, cooldownSeconds: 60 };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email) || email.includes("..")) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

function hashCode(email: string, purpose: EmailPurpose, code: string): string {
  return createHash("sha256").update(`${email}|${purpose}|${code}`).digest("hex");
}

export class EmailCodeService {
  private readonly ttl: number;
  private readonly maxAttempts: number;
  private readonly cooldown: number;

  constructor(
    private readonly db: Database,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
    options: EmailCodeOptions = {},
  ) {
    this.ttl = options.ttlSeconds ?? DEFAULTS.ttlSeconds;
    this.maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    this.cooldown = options.cooldownSeconds ?? DEFAULTS.cooldownSeconds;
  }

  async ensureSchema(): Promise<void> {
    const pk = this.db.dialect === "pgsql" ? "BIGSERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
    const ts = this.db.dialect === "pgsql" ? "BIGINT" : "INTEGER";
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS email_verification_codes (
        id ${pk},
        email VARCHAR(254) NOT NULL,
        purpose VARCHAR(16) NOT NULL,
        code_hash VARCHAR(64) NOT NULL,
        user_id BIGINT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at ${ts} NULL,
        expires_at ${ts} NOT NULL,
        created_at ${ts} NOT NULL,
        ip VARCHAR(64) NOT NULL DEFAULT ''
      )`,
    );
    await this.db.query("CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_verification_codes (email, purpose)");
  }

  /** Seconds until another code may be requested (0 = allowed now). */
  async cooldownRemaining(email: string, purpose: EmailPurpose): Promise<number> {
    const result = await this.db.query<{ created_at: number }>(
      "SELECT created_at FROM email_verification_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
      [normalizeEmail(email), purpose],
    );
    const last = result.rows[0]?.created_at;
    if (last === undefined) return 0;
    const elapsed = this.clock() - Number(last);
    return elapsed >= this.cooldown ? 0 : this.cooldown - elapsed;
  }

  /** Issues a fresh code and returns the plaintext (to be emailed). */
  async issue(email: string, purpose: EmailPurpose, userId: number | null, ip = ""): Promise<string> {
    const target = normalizeEmail(email);
    const now = this.clock();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.query(
      "UPDATE email_verification_codes SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL",
      [now, target, purpose],
    );
    await this.db.query(
      `INSERT INTO email_verification_codes (email, purpose, code_hash, user_id, attempts, consumed_at, expires_at, created_at, ip)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      [target, purpose, hashCode(target, purpose, code), userId, now + this.ttl, now, ip.slice(0, 64)],
    );
    return code;
  }

  async verify(email: string, purpose: EmailPurpose, code: string): Promise<boolean> {
    const target = normalizeEmail(email);
    const input = code.trim();
    if (!/^\d{6}$/.test(input)) return false;
    const result = await this.db.query<{ id: number; code_hash: string; attempts: number; expires_at: number }>(
      "SELECT id, code_hash, attempts, expires_at FROM email_verification_codes WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1",
      [target, purpose],
    );
    const row = result.rows[0];
    if (row === undefined) return false;
    if (Number(row.attempts) >= this.maxAttempts) return false;
    if (Number(row.expires_at) < this.clock()) return false;

    const expected = Buffer.from(String(row.code_hash), "utf8");
    const actual = Buffer.from(hashCode(target, purpose, input), "utf8");
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!matches) {
      await this.db.query("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?", [row.id]);
      return false;
    }
    await this.db.query("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?", [this.clock(), row.id]);
    return true;
  }
}
