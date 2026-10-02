import type { Database } from '../index.js';
import { insertReturningId, like, nowIso, type Paginated, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\VoiceHubDeliveryRepository. */
export class VoiceHubDeliveryRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM voicehub_deliveries WHERE id = ?', [id])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  async findByIdempotencyKey(key: string): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM voicehub_deliveries WHERE idempotency_key = ?', [key])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  async findByUnitId(unitId: number): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM voicehub_deliveries WHERE fulfillment_unit_id = ? ORDER BY id DESC LIMIT 1', [unitId])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a delivery unless one already exists for the idempotency key.
   * The unique idempotency key is the arbiter under concurrency. Returns
   * { created, delivery }.
   */
  async createIfAbsent(data: Row & {
    source_type: string;
    source_order_no: string;
    code_ciphertext: string;
    code_hash: string;
    code_source: string;
    idempotency_key: string;
  }): Promise<{ created: boolean; delivery: Row | null }> {
    const existing = await this.findByIdempotencyKey(String(data.idempotency_key));
    if (existing !== null) return { created: false, delivery: existing };
    const now = nowIso();
    let id = 0;
    try {
      id = await insertReturningId(
        this.db,
        'INSERT INTO voicehub_deliveries (source_type, source_id, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, request_payload, response_payload, created_at, updated_at, success_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, NULL)', 
        [
          data.source_type,
          (data.source_id as number | null | undefined) ?? null,
          data.source_order_no,
          (data.fulfillment_unit_id as number | null | undefined) ?? null,
          data.code_ciphertext,
          data.code_hash,
          data.code_source,
          data.idempotency_key,
          String(data.status ?? 'pending'),
          now,
          now,
        ],
      );
    } catch (error) {
      // Concurrent create: the unique idempotency key is the arbiter.
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.findByIdempotencyKey(String(data.idempotency_key));
      if (raced !== null) return { created: false, delivery: raced };
      throw error;
    }
    return { created: true, delivery: await this.findById(id) };
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['status', 'attempts', 'last_error', 'request_payload', 'response_payload', 'success_at'];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = ?`);
      params.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    await this.db.query(`UPDATE voicehub_deliveries SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  /**
   * Atomically claim a delivery before issuing the external HTTP request.
   * A stale processing lease may be reclaimed after leaseSeconds so a crashed
   * worker cannot block the delivery forever. With force, any non-processing
   * (or stale-processing) status may be re-claimed.
   */
  async claimForProcessing(id: number, requestPayload: string, maxAttempts: number, force = false, leaseSeconds = 300, clock: () => number = Date.now): Promise<boolean> {
    // `now` and the stale-lease boundary both derive from the injected clock
    // so tests (and any monotonic source) control the lease deterministically.
    const now = new Date(clock()).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const staleBefore = new Date(clock() - Math.max(30, leaseSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
    let sql: string;
    let params: unknown[];
    if (force) {
      sql = "UPDATE voicehub_deliveries SET status = 'processing', attempts = attempts + 1, request_payload = ?, last_error = NULL, updated_at = ? WHERE id = ? AND (status != 'processing' OR updated_at < ?)";
      params = [requestPayload, now, id, staleBefore];
    } else {
      sql = "UPDATE voicehub_deliveries SET status = 'processing', attempts = attempts + 1, request_payload = ?, last_error = NULL, updated_at = ? WHERE id = ? AND attempts < ? AND (status IN ('pending','failed') OR (status = 'processing' AND updated_at < ?))";
      params = [requestPayload, now, id, Math.max(1, maxAttempts), staleBefore];
    }
    const result = await this.db.query(sql, params);
    return result.rowCount === 1;
  }

  async markSuccess(id: number, responsePayload: string): Promise<void> {
    await this.update(id, { status: 'success', response_payload: responsePayload, success_at: nowIso(), last_error: null });
  }

  async markFailed(id: number, error: string, responsePayload = ''): Promise<void> {
    await this.update(id, {
      status: 'failed',
      last_error: [...error].slice(0, 1000).join(''),
      response_payload: responsePayload !== '' ? responsePayload : null,
    });
  }

  async stats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const row of (await this.db.query('SELECT status, COUNT(*) AS n FROM voicehub_deliveries GROUP BY status')).rows) {
      const status = String(row.status);
      stats[status] = (stats[status] ?? 0) + Number(row.n);
    }
    return stats;
  }

  /** Count deliveries of `status` since local midnight in `timeZone`. */
  async countTodayByStatus(status: string, timeZone = 'Asia/Shanghai'): Promise<number> {
    const from = startOfTodayUtc(timeZone);
    const row = (await this.db.query('SELECT COUNT(*) AS n FROM voicehub_deliveries WHERE status = ? AND created_at >= ?', [status, from])).rows[0];
    return Number(row?.n ?? 0);
  }

  /** List deliveries with filters (admin + failure center). */
  async list(filters: { status?: string; code_source?: string; q?: string; only_failed?: boolean | string } = {}, page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('vd.status = ?');
      params.push(filters.status);
    }
    if (filters.code_source) {
      where.push('vd.code_source = ?');
      params.push(filters.code_source);
    }
    if (filters.q) {
      where.push('vd.source_order_no LIKE ?');
      params.push(like(filters.q));
    }
    if (filters.only_failed) {
      where.push("vd.status = 'failed'");
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM voicehub_deliveries vd ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT vd.*, fu.order_id, o.order_no AS shop_order_no FROM voicehub_deliveries vd LEFT JOIN fulfillment_units fu ON fu.id = vd.fulfillment_unit_id LEFT JOIN orders o ON o.id = fu.order_id ${whereSql} ORDER BY vd.id DESC LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  async recentFailures(limit = 10): Promise<Row[]> {
    const sql = `SELECT vd.*, fu.order_id, o.order_no AS shop_order_no FROM voicehub_deliveries vd LEFT JOIN fulfillment_units fu ON fu.id = vd.fulfillment_unit_id LEFT JOIN orders o ON o.id = fu.order_id WHERE vd.status = 'failed' ORDER BY vd.id DESC LIMIT ${limit}`;
    return (await this.db.query(sql)).rows;
  }

  async countFailedRetryable(): Promise<number> {
    const row = (await this.db.query("SELECT COUNT(*) AS n FROM voicehub_deliveries WHERE status = 'failed'")).rows[0];
    return Number(row?.n ?? 0);
  }
}

/** SQLite/pgsql unique-violation detection for idempotency races. */
export function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT' || code === '23505' || code === '23000';
}

/** UTC ISO instant of local midnight (today) in `timeZone`. */
export function startOfTodayUtc(timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
  const utcOffsetMs = timezoneOffsetMs(timeZone, new Date(Date.UTC(year, month - 1, day, 12)));
  const localMidnightUtcMs = Date.UTC(year, month - 1, day) - utcOffsetMs;
  return new Date(localMidnightUtcMs).toISOString();
}

function timezoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - at.getTime();
}
