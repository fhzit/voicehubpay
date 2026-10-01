import type { Database } from '../index.js';
import { like, nowIso, type Paginated, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\AuditLogRepository. */
export class AuditLogRepository {
  constructor(private readonly db: Database) {}

  /**
   * Write an audit entry. Never stores card codes, passwords, keys or
   * tokens — sensitive-looking metadata keys are redacted defensively.
   */
  async log(userId: number | null, action: string, objectType = '', objectId = '', metadata: Record<string, unknown> = {}, ip: string | null = null, userAgent: string | null = null): Promise<void> {
    const safe = redact(metadata);
    await this.db.query(
      'INSERT INTO audit_logs (user_id, action, object_type, object_id, ip, user_agent, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        userId,
        action,
        objectType,
        objectId,
        ip ?? '',
        userAgent ?? '',
        JSON.stringify(safe) || '{}',
        nowIso(),
      ],
    );
  }

  async list(filters: { action?: string; user_id?: number; object_type?: string; q?: string; from?: string; to?: string } = {}, page = 1, perPage = 30): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.action) {
      where.push('action = ?');
      params.push(filters.action);
    }
    if (filters.user_id) {
      where.push('al.user_id = ?');
      params.push(Number(filters.user_id));
    }
    if (filters.object_type) {
      where.push('al.object_type = ?');
      params.push(filters.object_type);
    }
    if (filters.q) {
      where.push('(al.object_id LIKE ? OR al.ip LIKE ?)');
      params.push(like(filters.q), like(filters.q));
    }
    if (filters.from) {
      where.push('al.created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('al.created_at <= ?');
      params.push(filters.to);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM audit_logs al ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT al.*, u.username FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ${whereSql} ORDER BY al.id DESC LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  async distinctActions(): Promise<string[]> {
    return (await this.db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action')).rows.map((row) => String(row.action));
  }
}

const BLOCKED_KEY_FRAGMENTS = ['password', 'secret', 'key', 'token', 'card', 'code', 'private_key', 'appkey', 'ciphertext'];

/** Recursive redaction, defense in depth for the audit trail. */
function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = redact(value as Record<string, unknown>);
      continue;
    }
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      output[key] = '[complex]';
      continue;
    }
    const lower = key.toLowerCase();
    output[key] = BLOCKED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) ? '[redacted]' : value;
  }
  return output;
}
