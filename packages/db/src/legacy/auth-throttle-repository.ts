import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import type { Database } from '../index.js';

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 900; // 15 min
const LOCK_SECONDS = 900;

/**
 * Port of VoiceHubPay\Security\LoginThrottle: lightweight login rate limiting
 * per username/IP, persisted in the auth_throttle table. Prevents brute-force.
 */
export class AuthThrottleRepository {
  constructor(private readonly db: Database, private readonly basePath?: string) {}

  ensureTable(): void {
    this.db.query(
      "CREATE TABLE IF NOT EXISTS auth_throttle (throttle_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '')",
    );
  }

  async isLocked(key: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
    const row = (await this.db.query('SELECT locked_until FROM auth_throttle WHERE throttle_key = ?', [key])).rows[0];
    return Number(row?.locked_until ?? 0) > nowSeconds;
  }

  async recordFailure(key: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<void> {
    const row = (await this.db.query('SELECT attempts, window_start, locked_until FROM auth_throttle WHERE throttle_key = ?', [key])).rows[0];
    let attempts = 1;
    let windowStart = nowSeconds;
    if (row !== undefined) {
      attempts = Number(row.attempts) + 1;
      const previousWindowStart = Number(row.window_start);
      windowStart = previousWindowStart > 0 ? previousWindowStart : nowSeconds;
      if (nowSeconds - Number(row.window_start) > WINDOW_SECONDS) {
        attempts = 1;
        windowStart = nowSeconds;
      }
    }
    const lockedUntil = attempts >= MAX_ATTEMPTS ? nowSeconds + LOCK_SECONDS : 0;
    await this.db.query(
      "INSERT INTO auth_throttle (throttle_key, attempts, window_start, locked_until, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(throttle_key) DO UPDATE SET attempts = excluded.attempts, window_start = excluded.window_start, locked_until = excluded.locked_until, updated_at = excluded.updated_at",
      [key, attempts, windowStart, lockedUntil, nowIso()],
    );
  }

  async clear(key: string): Promise<void> {
    await this.db.query('DELETE FROM auth_throttle WHERE throttle_key = ?', [key]);
  }

  async remaining(key: string): Promise<number> {
    const row = (await this.db.query('SELECT attempts FROM auth_throttle WHERE throttle_key = ?', [key])).rows[0];
    return Math.max(0, MAX_ATTEMPTS - Number(row?.attempts ?? 0));
  }
}

/**
 * Key/value settings store backed by the legacy app_settings table (or a
 * JSON file when no table exists). Port of the config accessor surface the
 * repositories use (SettingsRepository::get/set/has).
 */
export class SettingsRepository {
  constructor(private readonly basePath: string) {}

  private file(): string {
    return join(this.basePath, 'storage', 'settings.json');
  }

  private read(): Map<string, string> {
    const file = this.file();
    if (!existsSync(file)) return new Map();
    try {
      return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>));
    } catch {
      return new Map();
    }
  }

  private write(values: Map<string, string>): void {
    const file = this.file();
    mkdirSync(join(this.basePath, 'storage'), { recursive: true, mode: 0o775 });
    writeFileSync(file, JSON.stringify(Object.fromEntries(values), null, 2));
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
  }

  get(key: string): string | null {
    return this.read().get(key) ?? null;
  }

  has(key: string): boolean {
    return this.read().has(key);
  }

  set(key: string, value: string): void {
    const values = this.read();
    values.set(key, value);
    this.write(values);
  }
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
