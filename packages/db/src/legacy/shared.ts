import type { Database, QueryResult } from '../index.js';

/** ISO-8601 UTC timestamp, same format as the PHP `gmdate('c')` baseline. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export interface Paginated<Row> {
  items: Row[];
  total: number;
  page: number;
  perPage: number;
}

/** Row types reflect the legacy SQLite/pgsql schema (database/migrations). */
export type Row = Record<string, unknown>;

export function first<T extends Row>(result: QueryResult<T>): T | null {
  return result.rows.length > 0 ? result.rows[0] : null;
}

/** Number of rows changed by the last INSERT/UPDATE/DELETE. */
export function changed(result: QueryResult<unknown>): number {
  return result.rowCount;
}

export async function scalarNumber(db: Database, sql: string, parameters: readonly unknown[] = []): Promise<number> {
  const result = await db.query<Record<string, unknown>>(sql, parameters);
  const value = Object.values(result.rows[0] ?? {})[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export async function scalarExists(db: Database, sql: string, parameters: readonly unknown[] = []): Promise<boolean> {
  const result = await db.query(sql, parameters);
  return result.rows.length > 0;
}

/** Last autoincrement id for the current connection (SQLite `lastInsertId`). */
export async function lastInsertId(db: Database): Promise<number> {
  if (db.dialect === 'pgsql') {
    // PostgreSQL: LASTVAL() returns the most recent sequence value on this
    // session. Only safe inside a transaction or single-client usage.
    const result = await db.query<{ id: number }>('SELECT LASTVAL() AS id');
    return Number(result.rows[0]?.id ?? 0);
  }
  const result = await db.query<{ id: number }>('SELECT last_insert_rowid() AS id');
  return Number(result.rows[0]?.id ?? 0);
}

/**
 * Run an INSERT and return the new row's id, portable across dialects:
 * SQLite uses last_insert_rowid(); PostgreSQL appends RETURNING id to the
 * same statement so the id is atomic even on a pool connection.
 */
export async function insertReturningId(db: Database, sql: string, parameters: readonly unknown[] = []): Promise<number> {
  if (db.dialect === 'pgsql') {
    if (/Returning\s+id/i.test(sql)) throw new RangeError('Statement already has RETURNING');
    const result = await db.query<{ id: number }>(`${sql.replace(/;\s*$/, '')} RETURNING id`, parameters);
    return Number(result.rows[0]?.id ?? 0);
  }
  await db.query(sql, parameters);
  return lastInsertId(db);
}

/**
 * Dynamic SET clause builder mirroring the PHP repositories: unknown keys are
 * skipped, allowed columns only, `updated_at` appended automatically by the
 * caller.
 */
export function buildUpdate(
  fields: Row,
  allowed: readonly string[],
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  return { sets, params };
}

/** LIKE escape used by search filters: `%q%` verbatim, matching PHP. */
export function like(value: string): string {
  return `%${value}%`;
}
