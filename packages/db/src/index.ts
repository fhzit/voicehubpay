import BetterSqlite3 from 'better-sqlite3';
import type { Pool, PoolClient, QueryResult as PgQueryResult } from 'pg';
export { SqliteOrderRepository, type CreatedOrder, type OrderRequest } from './orders.js';

export type Dialect = 'sqlite' | 'pgsql';
export interface QueryResult<Row> { rows: Row[]; rowCount: number }
export interface Database {
  readonly dialect: Dialect;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<QueryResult<Row>>;
  transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function placeholders(dialect: Dialect, count: number, startAt = 1): string {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(startAt) || startAt < 1) throw new RangeError('Invalid placeholder range');
  return Array.from({ length: count }, (_, index) => dialect === 'pgsql' ? `$${startAt + index}` : '?').join(', ');
}

export function createSqliteDatabase(filename: string, options?: BetterSqlite3.Options): Database {
  const connection = new BetterSqlite3(filename, options);
  connection.pragma('foreign_keys = ON');
  let active = false;
  const makeDb = (transaction = false): Database => ({
    dialect: 'sqlite',
    async query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
      if (parameters.length === 0 && sql.includes(';')) { connection.exec(sql); return { rows: [], rowCount: 0 }; }
      const statement = connection.prepare(sql);
      if (statement.reader) return { rows: statement.all(...parameters) as Row[], rowCount: 0 };
      const result = statement.run(...parameters);
      return { rows: [], rowCount: result.changes };
    },
    async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
      if (active) throw new Error('Nested transactions are not supported');
      active = true;
      connection.exec('BEGIN');
      try { const value = await work(makeDb(true)); connection.exec('COMMIT'); return value; }
      catch (error) { connection.exec('ROLLBACK'); throw error; }
      finally { active = false; }
    },
    async close(): Promise<void> { if (!transaction) connection.close(); },
  });
  return makeDb();
}

/** Translate portable ? parameters while preserving quoted strings and SQL comments. */
export function toPostgresPlaceholders(sql: string): string {
  let output = '', index = 0, state: 'normal' | 'single' | 'double' | 'line' | 'block' | 'dollar' = 'normal', dollarTag = '';
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (state === 'single') { output += c; if (c === "'" && next === "'") output += sql[++i]; else if (c === "'") state = 'normal'; continue; }
    if (state === 'double') { output += c; if (c === '"' && next === '"') output += sql[++i]; else if (c === '"') state = 'normal'; continue; }
    if (state === 'line') { output += c; if (c === '\n') state = 'normal'; continue; }
    if (state === 'block') { output += c; if (c === '*' && next === '/') { output += sql[++i]; state = 'normal'; } continue; }
    if (state === 'dollar') { if (sql.startsWith(dollarTag, i)) { output += dollarTag; i += dollarTag.length - 1; state = 'normal'; } else output += c; continue; }
    if (c === "'") state = 'single'; else if (c === '"') state = 'double';
    else if (c === '-' && next === '-') { output += '--'; i++; state = 'line'; continue; }
    else if (c === '/' && next === '*') { output += '/*'; i++; state = 'block'; continue; }
    else if (c === '$') { const match = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i)); if (match) { dollarTag = match[0]; output += dollarTag; i += dollarTag.length - 1; state = 'dollar'; continue; } }
    else if (c === '?') { output += `$${++index}`; continue; }
    output += c;
  }
  return output;
}

export function createPostgresDatabase(pool: Pool): Database {
  const execute = async <Row extends Record<string, unknown>>(executor: Pick<PoolClient, 'query'>, sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> => {
    const result: PgQueryResult = await executor.query(toPostgresPlaceholders(sql), [...parameters]);
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
  };
  const makeDb = (client?: PoolClient): Database => ({
    dialect: 'pgsql',
    query: <Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => execute<Row>(client ?? pool, sql, parameters),
    async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
      if (client) throw new Error('Nested transactions are not supported');
      const connection = await pool.connect();
      try { await connection.query('BEGIN'); const value = await work(makeDb(connection)); await connection.query('COMMIT'); return value; }
      catch (error) { await connection.query('ROLLBACK'); throw error; }
      finally { connection.release(); }
    },
    async close(): Promise<void> { if (!client) await pool.end(); },
  });
  return makeDb();
}
