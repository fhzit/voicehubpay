import type { Database } from '../index.js';
import { buildUpdate, first, insertReturningId, like, nowIso, type Paginated, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\OrderRepository. */
export class OrderRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM orders WHERE id = ?', [id]));
  }

  async findByOrderNo(orderNo: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM orders WHERE order_no = ?', [orderNo]));
  }

  async create(data: Row & { order_no: string; user_id: number }): Promise<Row | null> {
    const now = nowIso();
    const id = await insertReturningId(
      this.db,
      'INSERT INTO orders (order_no, user_id, source, amount_due_cents, amount_paid_cents, currency, order_status, payment_status, fulfillment_status, payment_gateway, payment_confirmation_source, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [
        data.order_no,
        data.user_id,
        String(data.source ?? 'shop'),
        Number(data.amount_due_cents ?? 0),
        Number(data.amount_paid_cents ?? 0),
        String(data.currency ?? 'CNY'),
        String(data.order_status ?? 'active'),
        String(data.payment_status ?? 'unpaid'),
        String(data.fulfillment_status ?? 'pending'),
        String(data.payment_gateway ?? ''),
        String(data.payment_confirmation_source ?? ''),
        now,
        now,
        (data.expires_at as string | null | undefined) ?? null,
      ],
    );
    return this.findById(id);
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['order_status', 'payment_status', 'fulfillment_status', 'payment_gateway', 'payment_confirmation_source', 'amount_paid_cents', 'expires_at', 'paid_at', 'fulfilled_at', 'cancelled_at'];
    const { sets, params } = buildUpdate(fields, allowed);
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    await this.db.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async markPaid(id: number, amountPaidCents: number, gateway: string, confirmationSource: string): Promise<void> {
    await this.update(id, {
      payment_status: 'paid',
      amount_paid_cents: amountPaidCents,
      payment_gateway: gateway,
      payment_confirmation_source: confirmationSource,
      paid_at: nowIso(),
    });
  }

  async items(orderId: number): Promise<Row[]> {
    return (await this.db.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId])).rows;
  }

  async addItem(data: Row & { order_id: number; product_id: number; product_name_snapshot: string }): Promise<number> {
    return insertReturningId(
      this.db,
      'INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_price_cents_snapshot, quantity, delivery_mode_snapshot, voicehub_code_source_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
      [
        data.order_id,
        data.product_id,
        data.product_name_snapshot,
        Number(data.product_price_cents_snapshot ?? 0),
        Number(data.quantity ?? 1),
        String(data.delivery_mode_snapshot ?? 'card'),
        String(data.voicehub_code_source_snapshot ?? 'inventory'),
        nowIso(),
      ],
    );
  }

  async addUnit(data: Row & { order_id: number; order_item_id: number; unit_index: number; unit_no: string }): Promise<number> {
    const now = nowIso();
    return insertReturningId(
      this.db,
      'INSERT INTO fulfillment_units (order_id, order_item_id, unit_index, unit_no, inventory_card_id, delivery_code_ciphertext, delivery_code_hash, voicehub_code_ciphertext, voicehub_code_hash, status, voicehub_status, voicehub_attempts, voicehub_last_error, manual_note, created_at, updated_at, fulfilled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, NULL)',
      [
        data.order_id,
        data.order_item_id,
        data.unit_index,
        data.unit_no,
        (data.inventory_card_id as number | null | undefined) ?? null,
        (data.delivery_code_ciphertext as string | null | undefined) ?? null,
        (data.delivery_code_hash as string | null | undefined) ?? null,
        (data.voicehub_code_ciphertext as string | null | undefined) ?? null,
        (data.voicehub_code_hash as string | null | undefined) ?? null,
        String(data.status ?? 'pending'),
        String(data.voicehub_status ?? 'not_required'),
        now,
        now,
      ],
    );
  }

  async units(orderId: number): Promise<Row[]> {
    return (await this.db.query('SELECT * FROM fulfillment_units WHERE order_id = ? ORDER BY unit_index', [orderId])).rows;
  }

  async findUnit(unitId: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM fulfillment_units WHERE id = ?', [unitId]));
  }

  async updateUnit(unitId: number, fields: Row): Promise<void> {
    const allowed = ['status', 'voicehub_status', 'voicehub_attempts', 'voicehub_last_error', 'manual_note', 'delivery_code_ciphertext', 'delivery_code_hash', 'voicehub_code_ciphertext', 'voicehub_code_hash', 'inventory_card_id', 'fulfilled_at'];
    const { sets, params } = buildUpdate(fields, allowed);
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), unitId);
    await this.db.query(`UPDATE fulfillment_units SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async countUnitsByStatus(orderId: number): Promise<Record<string, number>> {
    const stats: Record<string, number> = { pending: 0, processing: 0, success: 0, failed: 0, manual_completed: 0 };
    for (const row of (await this.db.query('SELECT status, COUNT(*) AS n FROM fulfillment_units WHERE order_id = ? GROUP BY status', [orderId])).rows) {
      const status = String(row.status);
      stats[status] = (stats[status] ?? 0) + Number(row.n);
    }
    return stats;
  }

  /** Recompute the order-level fulfillment_status from its units. */
  async recalcFulfillmentStatus(orderId: number): Promise<void> {
    const units = await this.units(orderId);
    if (units.length === 0) return;
    const total = units.length;
    let success = 0;
    let failed = 0;
    let manual = 0;
    for (const unit of units) {
      if (unit.status === 'success') success += 1;
      else if (unit.status === 'manual_completed') manual += 1;
      else if (unit.status === 'failed') failed += 1;
    }
    const order = await this.findById(orderId);
    if (order === null || order.payment_status !== 'paid') return;
    let status: string;
    if (failed === total) status = 'failed';
    else if (manual === total) status = 'manual_completed';
    else if (success + manual === total) status = 'success';
    else if (success + manual > 0) status = 'partial';
    else if (failed > 0) status = 'partial';
    else status = 'processing';
    await this.update(orderId, {
      fulfillment_status: status,
      fulfilled_at: ['success', 'failed', 'manual_completed'].includes(status) ? nowIso() : null,
    });
  }

  /** User-facing order list. */
  async listForUser(userId: number, status = '', q = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (status !== '') {
      const map: Record<string, string> = {
        unpaid: "payment_status IN ('unpaid','pending')",
        paid: "payment_status = 'paid' AND fulfillment_status IN ('pending','processing','partial')",
        completed: "payment_status = 'paid' AND fulfillment_status IN ('success','manual_completed')",
        abnormal: "payment_status = 'paid' AND fulfillment_status IN ('failed')",
      };
      where.push(map[status] ?? `payment_status = '${status}'`);
    }
    if (q !== '') {
      where.push('order_no LIKE ?');
      params.push(like(q));
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
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

  /** Admin order list with filters + user info. */
  async listAdmin(filters: {
    order_no?: string;
    username?: string;
    product?: string;
    payment_status?: string;
    fulfillment_status?: string;
    abnormal?: boolean | string;
    from?: string;
    to?: string;
  } = {}, page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.order_no) {
      where.push('o.order_no LIKE ?');
      params.push(like(filters.order_no));
    }
    if (filters.username) {
      where.push('u.username LIKE ?');
      params.push(like(filters.username));
    }
    if (filters.product) {
      where.push('EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = o.id AND oi2.product_name_snapshot LIKE ?)');
      params.push(like(filters.product));
    }
    if (filters.payment_status) {
      where.push('o.payment_status = ?');
      params.push(filters.payment_status);
    }
    if (filters.fulfillment_status) {
      where.push('o.fulfillment_status = ?');
      params.push(filters.fulfillment_status);
    }
    if (filters.abnormal) {
      where.push("o.payment_status = 'paid' AND o.fulfillment_status = 'failed'");
    }
    if (filters.from) {
      where.push('o.created_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('o.created_at <= ?');
      params.push(filters.to);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM orders o LEFT JOIN users u ON u.id = o.user_id ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT o.*, u.username, u.display_name,
                (SELECT product_name_snapshot FROM order_items oi3 WHERE oi3.order_id = o.id ORDER BY oi3.id ASC LIMIT 1) AS first_item_name,
                (SELECT SUM(oi4.quantity) FROM order_items oi4 WHERE oi4.order_id = o.id) AS item_count
            FROM orders o LEFT JOIN users u ON u.id = o.user_id ${whereSql} ORDER BY o.id DESC LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  /** Orders awaiting fulfillment (paid, not terminal), oldest first. */
  async listPendingFulfillment(limit = 50): Promise<Row[]> {
    const sql = `SELECT * FROM orders WHERE payment_status = 'paid' AND fulfillment_status IN ('pending','processing','partial') ORDER BY id ASC LIMIT ${limit}`;
    return (await this.db.query(sql)).rows;
  }

  async isOwner(orderId: number, userId: number): Promise<boolean> {
    const rows = (await this.db.query('SELECT 1 AS ok FROM orders WHERE id = ? AND user_id = ? LIMIT 1', [orderId, userId])).rows;
    return rows.length > 0;
  }

  async orderWithItems(orderNo: string): Promise<(Row & { items: Row[]; units: Row[] }) | null> {
    const order = await this.findByOrderNo(orderNo);
    if (order === null) return null;
    const id = Number(order.id);
    return { ...order, items: await this.items(id), units: await this.units(id) };
  }
}
