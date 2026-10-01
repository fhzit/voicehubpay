import type { Database } from '../index.js';
import { like, nowIso, type Paginated, type Row } from './shared.js';

export interface AfdianStats extends Record<string, number> {
  pending: number;
  processing: number;
  success: number;
  failed: number;
}

/** Port of VoiceHubPay\Repositories\AfdianOrderRepository. */
export class AfdianOrderRepository {
  constructor(private readonly db: Database) {}

  async findByOutTradeNo(outTradeNo: string): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM afdian_orders WHERE out_trade_no = ?', [outTradeNo])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  async findById(id: number): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM afdian_orders WHERE id = ?', [id])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Insert if absent. When the out_trade_no already exists, poll/webhook
   * payloads that observe the same order before and after payment refresh the
   * source fields while preserving delivery state. Returns { created, order }.
   */
  async createIfAbsent(data: Row & { out_trade_no: string }): Promise<{ created: boolean; order: Row | null }> {
    const existing = await this.findByOutTradeNo(String(data.out_trade_no));
    if (existing !== null) {
      const status = String(data.status ?? existing.status);
      const paidAt = data.paid_at !== undefined
        ? data.paid_at
        : (['paid', '2'].includes(status) && (!(existing.paid_at) || existing.paid_at === '') ? nowIso() : existing.paid_at);
      await this.update(Number(existing.id), {
        trade_no: data.trade_no !== undefined ? data.trade_no : existing.trade_no,
        user_id: data.user_id !== undefined ? data.user_id : existing.user_id,
        buyer_name: data.buyer_name !== undefined ? data.buyer_name : (existing.buyer_name ?? ''),
        remark: data.remark !== undefined ? data.remark : (existing.remark ?? ''),
        plan_id: data.plan_id !== undefined ? data.plan_id : existing.plan_id,
        sku_detail: data.sku_detail !== undefined ? data.sku_detail : existing.sku_detail,
        amount_cents: data.amount_cents !== undefined ? Number(data.amount_cents) : Number(existing.amount_cents ?? 0),
        status,
        raw_payload: data.raw_payload !== undefined ? data.raw_payload : existing.raw_payload,
        paid_at: paidAt,
      });
      return { created: false, order: await this.findById(Number(existing.id)) };
    }

    const now = nowIso();
    const paidAt = data.paid_at ?? (['paid', '2'].includes(String(data.status ?? 'paid')) ? now : null);
    try {
      await this.db.query(
        'INSERT INTO afdian_orders (out_trade_no, trade_no, user_id, buyer_name, remark, plan_id, sku_detail, amount_cents, status, raw_payload, voicehub_status, voicehub_attempts, voicehub_last_error, created_at, paid_at, processed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL, ?)',
        [
          data.out_trade_no,
          String(data.trade_no ?? ''),
          String(data.user_id ?? ''),
          String(data.buyer_name ?? ''),
          String(data.remark ?? ''),
          String(data.plan_id ?? ''),
          String(data.sku_detail ?? ''),
          Number(data.amount_cents ?? 0),
          String(data.status ?? 'paid'),
          String(data.raw_payload ?? '[]'),
          String(data.voicehub_status ?? 'pending'),
          String(data.created_at ?? now),
          paidAt,
          now,
        ],
      );
    } catch (error) {
      // Concurrent webhook/poll race: the unique out_trade_no is the arbiter.
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.findByOutTradeNo(String(data.out_trade_no));
      if (raced !== null) return { created: false, order: raced };
      throw error;
    }
    const id = Number((await this.db.query('SELECT last_insert_rowid() AS id')).rows[0]?.id ?? 0);
    return { created: true, order: await this.findById(id) };
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['trade_no', 'user_id', 'buyer_name', 'remark', 'plan_id', 'sku_detail', 'amount_cents', 'status', 'raw_payload', 'voicehub_status', 'voicehub_attempts', 'voicehub_last_error', 'paid_at', 'created_at', 'processed_at'];
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
    await this.db.query(`UPDATE afdian_orders SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async markVoiceHub(id: number, status: string, attempts: number, error: string | null): Promise<void> {
    await this.update(id, {
      voicehub_status: status,
      voicehub_attempts: attempts,
      voicehub_last_error: error,
      processed_at: status === 'success' ? nowIso() : null,
    });
  }

  async stats(): Promise<AfdianStats> {
    const stats: AfdianStats = { pending: 0, processing: 0, success: 0, failed: 0 };
    for (const row of (await this.db.query('SELECT voicehub_status, COUNT(*) AS n FROM afdian_orders GROUP BY voicehub_status')).rows) {
      const status = String(row.voicehub_status);
      stats[status] = (stats[status] ?? 0) + Number(row.n);
    }
    return stats;
  }

  async sumPaid(): Promise<number> {
    const row = (await this.db.query("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM afdian_orders WHERE status = 'paid' OR status = '2'")).rows[0];
    return Number(row?.n ?? 0);
  }

  async count(): Promise<number> {
    const row = (await this.db.query('SELECT COUNT(*) AS n FROM afdian_orders')).rows[0];
    return Number(row?.n ?? 0);
  }

  async countToday(timeZone = 'Asia/Shanghai'): Promise<number> {
    const from = startOfTodayUtc(timeZone);
    const row = (await this.db.query('SELECT COUNT(*) AS n FROM afdian_orders WHERE created_at >= ?', [from])).rows[0];
    return Number(row?.n ?? 0);
  }

  async sumToday(timeZone = 'Asia/Shanghai'): Promise<number> {
    const from = startOfTodayUtc(timeZone);
    const row = (await this.db.query("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM afdian_orders WHERE status IN ('paid','2') AND created_at >= ?", [from])).rows[0];
    return Number(row?.n ?? 0);
  }

  async listAdmin(status = '', voicehub = '', q = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (status !== '') {
      where.push('status = ?');
      params.push(status);
    }
    if (voicehub !== '') {
      where.push('voicehub_status = ?');
      params.push(voicehub);
    }
    if (q !== '') {
      where.push('(out_trade_no LIKE ? OR trade_no LIKE ? OR buyer_name LIKE ?)');
      params.push(like(q), like(q), like(q));
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM afdian_orders ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT * FROM afdian_orders ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }

  async listRecent(limit = 10): Promise<Row[]> {
    return (await this.db.query(`SELECT * FROM afdian_orders ORDER BY created_at DESC, id DESC LIMIT ${limit}`)).rows;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT' || code === '23505' || code === '23000';
}

function startOfTodayUtc(timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
  const offsetMs = timezoneOffsetMs(timeZone, new Date(Date.UTC(year, month - 1, day, 12)));
  return new Date(Date.UTC(year, month - 1, day) - offsetMs).toISOString();
}

function timezoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - at.getTime();
}
