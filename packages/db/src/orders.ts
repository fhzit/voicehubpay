import type { Cents } from '../../domain/src/money.js';
import type { Database } from './index.js';

export interface OrderRequest { orderNo: string; userId: number; items: Array<{ productId: number; quantity: number }>; reservedUntil: string }
export interface CreatedOrder { id: number; orderNo: string; amountDueCents: Cents; items: Array<{ productId: number; productName: string; quantity: number; unitPriceCents: Cents; lineTotalCents: Cents }> }
interface ProductRow extends Record<string, unknown> { id: number; name: string; price_cents: number; status: string }

export class SqliteOrderRepository {
  constructor(private readonly db: Database) {}

  async createOrder(input: OrderRequest): Promise<CreatedOrder> {
    if (!input.orderNo || !Number.isSafeInteger(input.userId) || input.userId < 1 || !input.reservedUntil || !input.items.length) throw new RangeError('Invalid order');
    const merged = new Map<number, number>();
    for (const item of input.items) {
      if (!Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new RangeError('Invalid order item');
      merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
    }
    return this.db.transaction(async tx => {
      const products: ProductRow[] = [];
      for (const productId of merged.keys()) {
        const row = (await tx.query<ProductRow>("SELECT id,name,price_cents,status FROM products WHERE id=? AND status='active'", [productId])).rows[0];
        if (!row || !Number.isSafeInteger(row.price_cents) || row.price_cents < 0) throw new Error(`Product unavailable: ${productId}`);
        products.push(row);
      }
      const lines = products.map(product => {
        const quantity = merged.get(product.id)!;
        const lineTotal = product.price_cents * quantity;
        if (!Number.isSafeInteger(lineTotal) || lineTotal > 2_147_483_647) throw new RangeError('Order total exceeds supported integer cents');
        return { productId: product.id, productName: product.name, quantity, unitPriceCents: product.price_cents as Cents, lineTotalCents: lineTotal as Cents };
      });
      const total = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
      if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new RangeError('Order total exceeds supported integer cents');
      const now = new Date().toISOString();
      await tx.query("INSERT INTO orders(order_no,user_id,amount_due_cents,amount_paid_cents,currency,order_status,payment_status,fulfillment_status,created_at,updated_at,expires_at) VALUES (?,?,?,0,'CNY','active','unpaid','pending',?,?,?)", [input.orderNo,input.userId,total,now,now,input.reservedUntil]);
      const orderId = (await tx.query<{ id: number }>('SELECT id FROM orders WHERE order_no=?',[input.orderNo])).rows[0]?.id;
      if (!orderId) throw new Error('Order insert was not visible');
      for (const line of lines) {
        await tx.query('INSERT INTO order_items(order_id,product_id,product_name_snapshot,product_price_cents_snapshot,quantity,created_at) VALUES (?,?,?,?,?,?)', [orderId,line.productId,line.productName,line.unitPriceCents,line.quantity,now]);
        const candidates = await tx.query<{ id: number }>("SELECT id FROM inventory_cards WHERE product_id=? AND status='available' ORDER BY id LIMIT ?", [line.productId,line.quantity]);
        if (candidates.rows.length !== line.quantity) throw new Error(`Insufficient stock for product ${line.productId}`);
        const ids = candidates.rows.map(row=>row.id);
        const updated = await tx.query(`UPDATE inventory_cards SET status='reserved',reserved_order_id=?,reserved_until=? WHERE status='available' AND id IN (${ids.map(()=>'?').join(',')})`, [orderId,input.reservedUntil,...ids]);
        if (updated.rowCount !== line.quantity) throw new Error(`Insufficient stock for product ${line.productId}`);
      }
      return { id: orderId, orderNo: input.orderNo, amountDueCents: total as Cents, items: lines };
    });
  }
}
