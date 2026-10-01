import { createHash } from 'node:crypto';
import type { Database } from '../index.js';
import { like, nowIso, type Paginated, type Row } from './shared.js';
import type { CryptoService } from './crypto.js';

export interface ImportReport {
  total: number;
  imported: number;
  duplicates: number;
  invalid: number;
}

export interface InventoryStats {
  available: number;
  reserved: number;
  sold: number;
  disabled: number;
}

/** Port of VoiceHubPay\Repositories\InventoryRepository. */
export class InventoryRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    const rows = (await this.db.query('SELECT * FROM inventory_cards WHERE id = ?', [id])).rows;
    return rows.length > 0 ? rows[0] : null;
  }

  async countAvailable(productId: number): Promise<number> {
    const row = (await this.db.query("SELECT COUNT(*) AS n FROM inventory_cards WHERE product_id = ? AND status = 'available'", [productId])).rows[0];
    return Number(row?.n ?? 0);
  }

  async countByStatus(productId: number, status: string): Promise<number> {
    const row = (await this.db.query('SELECT COUNT(*) AS n FROM inventory_cards WHERE product_id = ? AND status = ?', [productId, status])).rows[0];
    return Number(row?.n ?? 0);
  }

  async stats(productId: number): Promise<InventoryStats> {
    const stats: InventoryStats = { available: 0, reserved: 0, sold: 0, disabled: 0 };
    for (const row of (await this.db.query('SELECT status, COUNT(*) AS n FROM inventory_cards WHERE product_id = ? GROUP BY status', [productId])).rows) {
      const status = String(row.status);
      if (status in stats) stats[status as keyof InventoryStats] = Number(row.n);
    }
    return stats;
  }

  async totalStats(): Promise<InventoryStats> {
    const stats: InventoryStats = { available: 0, reserved: 0, sold: 0, disabled: 0 };
    for (const row of (await this.db.query('SELECT status, COUNT(*) AS n FROM inventory_cards GROUP BY status')).rows) {
      const status = String(row.status);
      if (status in stats) stats[status as keyof InventoryStats] = Number(row.n);
    }
    return stats;
  }

  /**
   * Import card secrets (already normalized) for a product, encrypted.
   * Returns [total, imported, duplicates, invalid] as a report object.
   */
  async import(productId: number, secrets: readonly string[], crypto: CryptoService): Promise<ImportReport> {
    // Build hash set of existing secrets for dedup.
    const hashes = new Set<string>();
    for (const row of (await this.db.query('SELECT secret_hash FROM inventory_cards WHERE product_id = ?', [productId])).rows) {
      hashes.add(String(row.secret_hash));
    }

    const now = nowIso();
    const report: ImportReport = { total: secrets.length, imported: 0, duplicates: 0, invalid: 0 };
    for (const raw of secrets) {
      const secret = raw.trim();
      if (secret === '') {
        report.invalid += 1;
        continue;
      }
      const hash = crypto.hash(secret);
      if (hashes.has(hash)) {
        report.duplicates += 1;
        continue;
      }
      hashes.add(hash);
      await this.db.query(
        "INSERT INTO inventory_cards (product_id, secret_ciphertext, secret_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'available', ?, ?)",
        [productId, crypto.encrypt(secret), hash, now, now],
      );
      report.imported += 1;
    }
    return report;
  }

  /**
   * Atomically reserve up to `quantity` available cards for an order.
   * Throws Error('insufficient_stock') when not enough are available.
   * Runs inside its own transaction when the caller has not opened one.
   * Returns the reserved card rows (with plaintext secrets when withSecrets).
   */
  async reserve(productId: number, quantity: number, orderId: number, reservedUntil: string, withSecrets = false, crypto?: CryptoService): Promise<Row[]> {
    if (quantity < 1) throw new Error('insufficient_stock');
    const run = async (tx: Database): Promise<Row[]> => {
      const ids = (await tx.query(
        "SELECT id FROM inventory_cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT ?",
        [productId, quantity],
      )).rows.map((row) => Number(row.id));

      if (ids.length < quantity) throw new Error('insufficient_stock');

      const inClause = ids.map(() => '?').join(',');
      await tx.query(
        `UPDATE inventory_cards SET status = 'reserved', reserved_order_id = ?, reserved_until = ?, updated_at = ? WHERE id IN (${inClause})`,
        [orderId, reservedUntil, nowIso(), ...ids],
      );

      const rows = (await tx.query(`SELECT * FROM inventory_cards WHERE id IN (${inClause}) ORDER BY id`, ids)).rows;
      if (withSecrets) {
        if (!crypto) throw new Error('withSecrets requires a CryptoService');
        for (const row of rows) {
          row.secret_plain = crypto.decrypt(String(row.secret_ciphertext));
        }
      }
      return rows;
    };
    return run(this.db);
  }

  /**
   * Release reservations that have expired AND belong to unpaid orders.
   * Never touches reserved cards of paid orders.
   */
  async releaseExpired(nowIsoValue: string): Promise<number> {
    const ids = (await this.db.query(
      "SELECT ic.id FROM inventory_cards ic LEFT JOIN orders o ON o.id = ic.reserved_order_id WHERE ic.status = 'reserved' AND ic.reserved_until IS NOT NULL AND ic.reserved_until < ? AND (o.id IS NULL OR o.payment_status != 'paid')",
      [nowIsoValue],
    )).rows.map((row) => Number(row.id));
    if (ids.length === 0) return 0;
    const inClause = ids.map(() => '?').join(',');
    await this.db.query(
      `UPDATE inventory_cards SET status = 'available', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE id IN (${inClause})`,
      [nowIso(), ...ids],
    );
    return ids.length;
  }

  /** Release a specific reservation (used when cancelling an unpaid order). */
  async releaseForOrder(orderId: number): Promise<number> {
    const result = await this.db.query(
      "UPDATE inventory_cards SET status = 'available', reserved_order_id = NULL, reserved_until = NULL, updated_at = ? WHERE reserved_order_id = ? AND status = 'reserved'",
      [nowIso(), orderId],
    );
    return result.rowCount;
  }

  /** Mark reserved cards as sold for a paid order. Returns count. */
  async markSoldForOrder(orderId: number): Promise<number> {
    const now = nowIso();
    const result = await this.db.query(
      "UPDATE inventory_cards SET status = 'sold', sold_order_id = ?, sold_at = ?, updated_at = ? WHERE reserved_order_id = ? AND status = 'reserved'",
      [orderId, now, now, orderId],
    );
    return result.rowCount;
  }

  async setDisabled(id: number, disabled: boolean): Promise<void> {
    await this.db.query('UPDATE inventory_cards SET status = ?, updated_at = ? WHERE id = ?', [disabled ? 'disabled' : 'available', nowIso(), id]);
  }

  async listForProduct(productId: number, status = '', q = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where = ['product_id = ?'];
    const params: unknown[] = [productId];
    if (status !== '') {
      where.push('status = ?');
      params.push(status);
    }
    if (q !== '') {
      // Cards are stored encrypted (SHA-256 hash of the plaintext). Match by
      // hash so a card value entered in search resolves its row.
      where.push('secret_hash = ?');
      params.push(createHash('sha256').update(q, 'utf8').digest('hex'));
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM inventory_cards ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT * FROM inventory_cards ${whereSql} ORDER BY id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }

  /**
   * Admin-wide inventory list with product names. The optional query matches
   * either a product name (substring) or an exact card value (by SHA-256 hash).
   */
  async listAll(q = '', page = 1, perPage = 20): Promise<Paginated<Row>> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q !== '') {
      where.push('(p.name LIKE ? OR ic.secret_hash = ?)');
      params.push(like(q), createHash('sha256').update(q, 'utf8').digest('hex'));
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.db.query(`SELECT COUNT(*) AS n FROM inventory_cards ic JOIN products p ON p.id = ic.product_id ${whereSql}`, params)).rows[0]?.n ?? 0);
    const offset = Math.max(0, (page - 1) * perPage);
    const items = (await this.db.query(`SELECT ic.*, p.name AS product_name FROM inventory_cards ic JOIN products p ON p.id = ic.product_id ${whereSql} ORDER BY ic.id DESC LIMIT ${perPage} OFFSET ${offset}`, params)).rows;
    return { items, total, page, perPage };
  }

  async lowStockProducts(limit = 20): Promise<Row[]> {
    const sql = `SELECT p.*,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') AS stock_available,
                (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'reserved') AS stock_reserved
            FROM products p
            WHERE p.status = 'active' AND p.stock_enabled = 1
              AND (SELECT COUNT(*) FROM inventory_cards ic WHERE ic.product_id = p.id AND ic.status = 'available') <= p.low_stock_threshold
            ORDER BY stock_available ASC LIMIT ${limit}`;
    return (await this.db.query(sql)).rows;
  }
}
