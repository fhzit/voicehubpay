import type { Database } from '../index.js';
import { first, insertReturningId, like, nowIso, type Paginated, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\PaymentTransactionRepository. */
export class PaymentTransactionRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM payment_transactions WHERE id = ?', [id]));
  }

  async findByMerchantOrderNo(orderNo: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM payment_transactions WHERE merchant_order_no = ? ORDER BY id DESC LIMIT 1', [orderNo]));
  }

  async findByGatewayTradeNo(tradeNo: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM payment_transactions WHERE gateway_trade_no = ? ORDER BY id DESC LIMIT 1', [tradeNo]));
  }

  async listForOrder(orderId: number): Promise<Row[]> {
    return (await this.db.query('SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY id DESC', [orderId])).rows;
  }

  /** Create/update a payment transaction for an order. Returns the row. */
  async upsert(data: Row & { merchant_order_no: string }): Promise<Row | null> {
    const existing = await this.findByMerchantOrderNo(String(data.merchant_order_no));
    const now = nowIso();
    if (existing !== null) {
      const fields = ['gateway', 'order_id', 'gateway_trade_no', 'api_trade_no', 'amount_cents', 'status', 'pay_type', 'pay_url', 'confirmation_source', 'raw_notify_payload'];
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const field of fields) {
        if (!(field in data)) continue;
        sets.push(`${field} = ?`);
        params.push(data[field]);
      }
      if (String(data.status ?? '') === 'paid') {
        sets.push('paid_at = ?');
        params.push(now);
      }
      sets.push('updated_at = ?');
      params.push(now, existing.id);
      await this.db.query(`UPDATE payment_transactions SET ${sets.join(', ')} WHERE id = ?`, params);
      return this.findById(Number(existing.id));
    }

    const id = await insertReturningId(
      this.db,
      'INSERT INTO payment_transactions (order_id, gateway, merchant_order_no, gateway_trade_no, api_trade_no, amount_cents, status, pay_type, pay_url, confirmation_source, raw_notify_payload, created_at, updated_at, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [
        data.order_id,
        String(data.gateway ?? 'sg65'),
        data.merchant_order_no,
        (data.gateway_trade_no as string | null | undefined) ?? null,
        (data.api_trade_no as string | null | undefined) ?? null,
        Number(data.amount_cents ?? 0),
        String(data.status ?? 'pending'),
        (data.pay_type as string | null | undefined) ?? null,
        (data.pay_url as string | null | undefined) ?? null,
        String(data.confirmation_source ?? 'callback'),
        (data.raw_notify_payload as string | null | undefined) ?? null,
        now,
        now,
        String(data.status ?? '') === 'paid' ? now : null,
      ],
    );
    return this.findById(id);
  }

  async markPaid(id: number, gatewayTradeNo: string, apiTradeNo: string, confirmationSource: string): Promise<void> {
    const now = nowIso();
    await this.db.query(
      'UPDATE payment_transactions SET status = ?, gateway_trade_no = COALESCE(?, gateway_trade_no), api_trade_no = COALESCE(?, api_trade_no), confirmation_source = ?, paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE id = ?',
      ['paid', gatewayTradeNo, apiTradeNo, confirmationSource, now, now, id],
    );
  }

  /**
   * Mark an order's payment transactions as cancelled. Only touches
   * transactions that are not already paid — a paid transaction is never
   * downgraded — so safe to call on any cancel path.
   */
  async markCancelledForOrder(orderId: number): Promise<number> {
    const result = await this.db.query(
      "UPDATE payment_transactions SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status <> 'paid'",
      [nowIso(), orderId],
    );
    return result.rowCount;
  }

  async listAdmin(payType = '', status = '', q = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (payType !== '') {
      where.push('pt.pay_type = ?');
      params.push(payType);
    }
    if (status !== '') {
      where.push('pt.status = ?');
      params.push(status);
    }
    if (q !== '') {
      where.push('(pt.merchant_order_no LIKE ? OR pt.gateway_trade_no LIKE ?)');
      params.push(like(q), like(q));
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM payment_transactions pt ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT pt.*, o.order_no, o.amount_due_cents FROM payment_transactions pt JOIN orders o ON o.id = pt.order_id ${whereSql} ORDER BY pt.id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }
}
