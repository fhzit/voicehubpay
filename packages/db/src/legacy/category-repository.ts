import { randomBytes } from 'node:crypto';
import type { Database } from '../index.js';
import { buildUpdate, first, lastInsertId, nowIso, type Row } from './shared.js';

/** Port of VoiceHubPay\Repositories\CategoryRepository. */
export class CategoryRepository {
  constructor(private readonly db: Database) {}

  async findById(id: number): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM categories WHERE id = ?', [id]));
  }

  async findBySlug(slug: string): Promise<Row | null> {
    return first(await this.db.query('SELECT * FROM categories WHERE slug = ?', [slug]));
  }

  async listActive(): Promise<Row[]> {
    return (await this.db.query("SELECT * FROM categories WHERE status = 'active' ORDER BY sort_order ASC, id ASC")).rows;
  }

  async listAll(): Promise<Row[]> {
    return (await this.db.query('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY c.sort_order ASC, c.id ASC')).rows;
  }

  async create(name: string, slug: string, sortOrder = 0, status = 'active'): Promise<Row | null> {
    const now = nowIso();
    await this.db.query(
      'INSERT INTO categories (name, slug, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, slug, status, sortOrder, now, now],
    );
    return this.findById(await lastInsertId(this.db));
  }

  async update(id: number, fields: Row): Promise<void> {
    const allowed = ['name', 'slug', 'status', 'sort_order'];
    const { sets, params } = buildUpdate(fields, allowed);
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(nowIso(), id);
    await this.db.query(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async setStatus(id: number, status: string): Promise<void> {
    await this.update(id, { status });
  }

  /** Only allows deletion when no products reference the category. */
  async delete(id: number): Promise<boolean> {
    const referenced = Number((await this.db.query('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [id])).rows[0]?.n ?? 0);
    if (referenced > 0) return false;
    const result = await this.db.query('DELETE FROM categories WHERE id = ?', [id]);
    return result.rowCount > 0;
  }

  async uniqueSlug(name: string, ignoreId: number | null = null): Promise<string> {
    let base = name.toLowerCase().trim().replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (base === '') base = `cat-${randomBytes(4).toString('hex').slice(0, 8)}`;
    let candidate = base;
    let i = 2;
    while (await this.slugExists(candidate, ignoreId)) {
      candidate = `${base}-${i}`;
      i += 1;
    }
    return candidate;
  }

  private async slugExists(slug: string, ignoreId: number | null): Promise<boolean> {
    const row = await this.db.query('SELECT id FROM categories WHERE slug = ? AND (? IS NULL OR id != ?) LIMIT 1', [slug, ignoreId, ignoreId]);
    return row.rows.length > 0;
  }
}
