import type { Database } from '../index.js';
import { like, nowIso, type Paginated, type Row } from './shared.js';

/**
 * Port of VoiceHubPay\Repositories\FulfillmentUnitRepository
 * (user card vault + admin order detail views over fulfillment_units).
 */
export class FulfillmentUnitRepository {
  constructor(private readonly db: Database) {}

  /** Cards visible to a user: delivered units of the user's paid orders. */
  async listForUser(userId: number, status = '', q = '', page = 1, perPage = 10): Promise<Paginated<Row>> {
    const where = ['o.user_id = ?', 'o.payment_status = ?'];
    const params: unknown[] = [userId, 'paid'];
    if (status === 'completed') {
      where.push("fu.status IN ('success','manual_completed')");
    } else if (status === 'processing') {
      where.push("fu.status IN ('pending','processing')");
    }
    if (q !== '') {
      where.push('(oi.product_name_snapshot LIKE ? OR o.order_no LIKE ?)');
      params.push(like(q), like(q));
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
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

  async countProcessingForUser(userId: number): Promise<number> {
    const row = (await this.db.query("SELECT COUNT(*) AS n FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = 'paid' AND fu.status IN ('pending','processing')", [userId])).rows[0];
    return Number(row?.n ?? 0);
  }

  async countForUser(userId: number): Promise<number> {
    const row = (await this.db.query("SELECT COUNT(*) AS n FROM fulfillment_units fu JOIN orders o ON o.id = fu.order_id WHERE o.user_id = ? AND o.payment_status = 'paid'", [userId])).rows[0];
    return Number(row?.n ?? 0);
  }
}
