import { randomBytes } from 'node:crypto';
import type { Database } from '../index.js';
import { buildUpdate, first, lastInsertId, like, nowIso, type Paginated, type Row } from './shared.js';

export interface ProductListFilters {
  category_id?: number;
  q?: string;
  sort?: string;
}

/** Port of VoiceHubPay\Repositories\ProductRepository. */
export class ProductRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM products WHERE id = ?', [id]));
  }

  async findBySlug(slug: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM products WHERE slug = ?', [slug]));
  }

  async activeCount(): Promise<number> {
    return Number((await this.db.query("SELECT COUNT(*) AS n FROM products WHERE status = 'active'")).rows[0]?.n ?? 0);
  }

  /** Public storefront listing with filters/sort/pagination + live stock. */
  async listPublic(filters: ProductListFilters = {}, page = 1, perPage = 12): Promise<Paginated<Row>> {
    const where = ["p.status = 'active'"];
    const params: unknown[] = [];
    if (filters.category_id) {
      where.push('p.category_id = ?');
      params.push(Number(filters.category_id));
    }
    if (filters.q) {
      where.push('(p.name LIKE ? OR p.description LIKE ?)');
      params.push(like(filters.q), like(filters.q));
    }
    const orderMap: Record<string, string> = {
      price: 'p.price_cents ASC',
      newest: 'p.id DESC',
    };
    const order = orderMap[filters.sort ?? ''] ?? 'p.sort_order ASC, p.id DESC';
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM products p ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT p.*,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'sold') AS stock_sold
            FROM products p ${whereSql} ORDER BY ${order} LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  async listHot(limit = 8): Promise<Row[]> {
    const sql = `SELECT p.*,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available
            FROM products p
            WHERE p.status = 'active'
            ORDER BY (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') DESC, p.sort_order ASC, p.id DESC
            LIMIT ${limit}`;
    return (await this.db.query(sql)).rows;
  }

  /** Admin listing with filters + pagination + stats. */
  async listAdmin(q = '', status = '', categoryId: number | null = null, page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q !== '') {
      where.push('p.name LIKE ?');
      params.push(like(q));
    }
    if (status !== '') {
      where.push('p.status = ?');
      params.push(status);
    }
    if (categoryId !== null) {
      where.push('p.category_id = ?');
      params.push(categoryId);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM products p ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const sql = `SELECT p.*,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'sold') AS stock_sold,
                (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS sold_units,
                (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS paid_orders,
                (SELECT COALESCE(SUM(oi.quantity * oi.product_price_cents_snapshot), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.payment_status = 'paid') AS revenue_cents
            FROM products p ${whereSql} ORDER BY p.id DESC LIMIT ${perPage} OFFSET ${offset}`;
    const items = (await this.db.query(sql, params)).rows;
    return { items, total, page, perPage };
  }

  async create(data: Row & { name: string; slug: string }): Promise<Row | null> {
    const now = nowIso();
    await this.db.query(
      'INSERT INTO products (category_id, name, slug, description, cover_image, price_cents, status, delivery_mode, voicehub_enabled, voicehub_code_source, stock_enabled, min_quantity, max_quantity, quantity_step, low_stock_threshold, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        (data.category_id as number | null | undefined) ?? null,
        data.name,
        data.slug,
        String(data.description ?? ''),
        String(data.cover_image ?? ''),
        Number(data.price_cents ?? 0),
        String(data.status ?? 'draft'),
        String(data.delivery_mode ?? 'card'),
        data.voicehub_enabled ? 1 : 0,
        String(data.voicehub_code_source ?? 'inventory'),
        data.stock_enabled ? 1 : 0,
        Number(data.min_quantity ?? 1),
        Number(data.max_quantity ?? 99),
        Number(data.quantity_step ?? 1),
        Number(data.low_stock_threshold ?? 0),
        Number(data.sort_order ?? 0),
        now,
        now,
      ],
    );
    return this.findById(await lastInsertId(this.db));
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['category_id', 'name', 'slug', 'description', 'cover_image', 'price_cents', 'status', 'delivery_mode', 'voicehub_enabled', 'voicehub_code_source', 'stock_enabled', 'min_quantity', 'max_quantity', 'quantity_step', 'low_stock_threshold', 'sort_order'];
    const { sets, params } = buildUpdate(fields, allowed);
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    await this.db.query(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async setStatus(id: number, status: string): Promise<void> {
    await this.update(id, { status });
  }

  /**
   * Soft delete: only fully delete when no order references the product,
   * otherwise disable.
   */
  async deleteOrDisable(id: number): Promise<'deleted' | 'disabled'> {
    const referenced = Number((await this.db.query('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', [id])).rows[0]?.n ?? 0);
    if (referenced > 0) {
      await this.setStatus(id, 'disabled');
      return 'disabled';
    }
    await this.db.query('DELETE FROM products WHERE id = ?', [id]);
    return 'deleted';
  }

  async uniqueSlug(name: string, ignoreId: number | null = null): Promise<string> {
    let base = name.toLowerCase().trim().replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (base === '') base = `product-${randomBytes(4).toString('hex').slice(0, 8)}`;
    let candidate = base;
    let i = 2;
    while (await this.slugExists(candidate, ignoreId)) {
      candidate = `${base}-${i}`;
      i += 1;
    }
    return candidate;
  }

  private async slugExists(slug: string, ignoreId: number | null): Promise<boolean> {
    const row = await this.db.query('SELECT id FROM products WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1', [slug, ignoreId, ignoreId]);
    return row.rows.length > 0;
  }
}
