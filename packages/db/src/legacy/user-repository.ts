import { randomBytes } from 'node:crypto';
import type { Database } from '../index.js';
import { buildUpdate, first, lastInsertId, like, nowIso, type Paginated, type Row } from './shared.js';

/**
 * Port of VoiceHubPay\Repositories\UserRepository (schema-faithful:
 * users(id, username, password_hash, display_name, avatar_url, email, role,
 * status, created_at, updated_at, last_login_at)).
 */
export class UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM users WHERE id = ?', [id]));
  }

  async findByUsername(username: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM users WHERE username = ?', [username]));
  }

  async findByEmail(email: string): Promise<Row | null> {
    if (email === '') return null;
    return first(await this.db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]));
  }

  /**
   * Create a user; returns the new user row. `password` is hashed by the
   * caller-supplied hasher (the app owns PasswordHasher); pass the prepared
   * `password_hash` directly when it is already hashed.
   */
  async create(data: Row & { username?: string }): Promise<Row | null> {
    const now = nowIso();
    const username = String(data.username ?? '');
    if (username === '') throw new RangeError('username is required');
    await this.db.query(
      'INSERT INTO users (username, password_hash, display_name, avatar_url, email, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        username,
        (data.password_hash as string | null | undefined) ?? null,
        String(data.display_name ?? ''),
        String(data.avatar_url ?? ''),
        String(data.email ?? ''),
        String(data.role ?? 'user'),
        String(data.status ?? 'active'),
        now,
        now,
      ],
    );
    return this.findById(await lastInsertId(this.db));
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['username', 'password_hash', 'display_name', 'avatar_url', 'email', 'role', 'status', 'last_login_at'];
    const { sets, params } = buildUpdate(fields, allowed);
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await this.update(id, { password_hash: passwordHash });
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.update(id, { last_login_at: nowIso() });
  }

  async countUsers(): Promise<number> {
    return Number((await this.db.query('SELECT COUNT(*) AS n FROM users')).rows[0]?.n ?? 0);
  }

  /** Search users (admin list). Supports optional q + pagination. */
  async search(q = '', status = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q !== '') {
      where.push('(username LIKE ? OR display_name LIKE ? OR email LIKE ?)');
      params.push(like(q), like(q), like(q));
    }
    if (status !== '') {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM users ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT * FROM users ${whereSql} ORDER BY id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }

  async setStatus(id: number, status: string): Promise<void> {
    await this.update(id, { status });
  }

  async setRole(id: number, role: string): Promise<void> {
    await this.update(id, { role });
  }

  /**
   * Permanently remove a user and its login bindings. The users row and the
   * social_identities bindings are physically DELETEd; historical orders keep
   * their order_no/amounts with a dangling user_id rendered as '—'.
   */
  async delete(id: number): Promise<void> {
    await this.db.query('DELETE FROM social_identities WHERE user_id = ?', [id]);
    await this.db.query('DELETE FROM users WHERE id = ?', [id]);
  }

  /**
   * The super admin is the admin with the lowest user id — the first admin
   * account ever created. Only it may promote/demote other admins and it
   * cannot itself be demoted.
   */
  async superAdminId(): Promise<number | null> {
    if (!(await this.tableExists())) return null;
    const value = (await this.db.query("SELECT MIN(id) AS id FROM users WHERE role IN ('admin','superadmin')")).rows[0]?.id;
    return value === null || value === undefined ? null : Number(value);
  }

  async isSuperAdmin(id: number): Promise<boolean> {
    const superId = await this.superAdminId();
    return superId !== null && id === superId;
  }

  private async tableExists(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1 FROM users LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** Generate a guaranteed-unique username (used for social logins). */
  async uniqueUsername(prefix: string, seed: string): Promise<string> {
    const base = prefix + seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
    let candidate = base;
    let i = 1;
    while ((await this.findByUsername(candidate)) !== null) {
      candidate = `${base}_${i}`;
      i += 1;
      if (i > 100) candidate = `${prefix}_${randomBytes(6).toString('hex')}`;
    }
    return candidate;
  }
}
