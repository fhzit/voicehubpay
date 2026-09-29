import type { Cents } from '../../domain/src/money.js';
import type { Database } from './index.js';

export type ProductStatus = 'draft' | 'active' | 'archived';
export interface Product { id: number; name: string; slug: string; description: string; priceCents: Cents; status: ProductStatus }
export interface NewProduct { name: string; slug: string; description?: string; priceCents: Cents | number; status?: ProductStatus }

export interface CatalogRepository {
  createProduct(input: NewProduct): Promise<number>;
  getProduct(id: number): Promise<Product | null>;
  listProducts(): Promise<Product[]>;
  reserveStock(productId: number, orderId: number, quantity: number, reservedUntil: string): Promise<number>;
}

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Database) {}

  async createProduct(input: NewProduct): Promise<number> {
    validateProduct(input);
    await this.db.query('INSERT INTO products(name, slug, description, price_cents, status) VALUES (?, ?, ?, ?, ?)', [input.name, input.slug, input.description ?? '', input.priceCents, input.status ?? 'draft']);
    const row = await this.db.query<{ id: number }>('SELECT id FROM products WHERE slug = ?', [input.slug]);
    if (!row.rows[0]) throw new Error('Product insert was not visible');
    return row.rows[0].id;
  }
  async getProduct(id: number): Promise<Product | null> {
    const result = await this.db.query<ProductRow>('SELECT id, name, slug, description, price_cents, status FROM products WHERE id = ?', [id]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }
  async listProducts(): Promise<Product[]> {
    const result = await this.db.query<ProductRow>('SELECT id, name, slug, description, price_cents, status FROM products ORDER BY id');
    return result.rows.map(mapProduct);
  }
  async reserveStock(productId: number, orderId: number, quantity: number, reservedUntil: string): Promise<number> {
    validateReservation(productId, orderId, quantity, reservedUntil);
    return this.db.transaction(async tx => {
      const candidates = await tx.query<{ id: number }>("SELECT id FROM inventory_cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ?", [productId, quantity]);
      if (candidates.rows.length !== quantity) return 0;
      const ids = candidates.rows.map(row => row.id);
      const updated = await tx.query(`UPDATE inventory_cards SET status = 'reserved', reserved_order_id = ?, reserved_until = ? WHERE status = 'available' AND id IN (${ids.map(() => '?').join(', ')})`, [orderId, reservedUntil, ...ids]);
      return updated.rowCount === quantity ? quantity : 0;
    });
  }
}

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly db: Database) {}
  async createProduct(input: NewProduct): Promise<number> {
    validateProduct(input);
    const result = await this.db.query<{ id: number }>('INSERT INTO products(name, slug, description, price_cents, status) VALUES (?, ?, ?, ?, ?) RETURNING id', [input.name, input.slug, input.description ?? '', input.priceCents, input.status ?? 'draft']);
    if (!result.rows[0]) throw new Error('Product insert was not visible');
    return result.rows[0].id;
  }
  async getProduct(id: number): Promise<Product | null> {
    const result = await this.db.query<ProductRow>('SELECT id, name, slug, description, price_cents, status FROM products WHERE id = ?', [id]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }
  async listProducts(): Promise<Product[]> {
    const result = await this.db.query<ProductRow>('SELECT id, name, slug, description, price_cents, status FROM products ORDER BY id');
    return result.rows.map(mapProduct);
  }
  async reserveStock(productId: number, orderId: number, quantity: number, reservedUntil: string): Promise<number> {
    validateReservation(productId, orderId, quantity, reservedUntil);
    return this.db.transaction(async tx => {
      const selected = await tx.query<{ id: number }>("SELECT id FROM inventory_cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED", [productId, quantity]);
      if (selected.rows.length !== quantity) return 0;
      const ids = selected.rows.map(row => row.id);
      const updated = await tx.query(`UPDATE inventory_cards SET status = 'reserved', reserved_order_id = ?, reserved_until = ? WHERE status = 'available' AND id IN (${ids.map(() => '?').join(', ')})`, [orderId, reservedUntil, ...ids]);
      return updated.rowCount === quantity ? quantity : 0;
    });
  }
}

interface ProductRow extends Record<string, unknown> { id: number; name: string; slug: string; description: string; price_cents: number; status: string }
function mapProduct(row: ProductRow): Product { return { id: row.id, name: row.name, slug: row.slug, description: row.description, priceCents: row.price_cents as Cents, status: row.status as ProductStatus }; }
function validateProduct(input: NewProduct): void {
  if (!input.name.trim() || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(input.slug)) throw new RangeError('Invalid product name or slug');
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 2_147_483_647) throw new RangeError('priceCents must be a non-negative integer');
}
function validateReservation(productId: number, orderId: number, quantity: number, reservedUntil: string): void {
  if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || !reservedUntil) throw new RangeError('Invalid stock reservation');
}
