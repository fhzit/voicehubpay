import BetterSqlite3 from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectAdapter } from './adapter-registry.js';

export const LEGACY_CONFIG_PATH = 'storage/settings.sqlite';

export interface DataDbInfo {
  connection: string;
  database: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

export interface VoicehubCounts {
  success: number;
  failed: number;
  pending: number;
}

export interface LegacyDetectionReport {
  legacy: boolean;
  config_configured: boolean;
  data_db: string | null;
  table_present: boolean;
  columns: string[];
  adapter: string;
  count: number;
  amount_cents: number;
  voicehub: VoicehubCounts;
  config_exists: boolean;
  data_db_info: DataDbInfo | null;
}

/** Minimal read-only handle used for detection and migration reads. */
export interface LegacyReader {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): { rows: Row[] };
  close(): void;
}

/** Open a read-only connection to a legacy SQLite file. */
export function openSqliteReader(path: string): LegacyReader {
  const connection = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  return {
    query<Row extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): { rows: Row[] } {
      if (parameters.length === 0 && /;\s*$/.test(sql)) {
        connection.exec(sql);
        return { rows: [] };
      }
      const statement = connection.prepare(sql);
      if (statement.reader) return { rows: statement.all(...parameters) as Row[] };
      statement.run(...parameters);
      return { rows: [] };
    },
    close: () => connection.close(),
  };
}

/**
 * Port of LegacySchemaDetector: detects a legacy VoiceHubPay installation
 * (storage/settings.sqlite with APP_CONFIGURED=1 plus a legacy data DB
 * containing afdian_orders). Detection is read-only and NEVER mutates the
 * old database.
 */
export class LegacySchemaDetector {
  constructor(private readonly basePath: string) {}

  detect(): LegacyDetectionReport {
    const configPath = join(this.basePath, LEGACY_CONFIG_PATH);
    const configExists = existsSync(configPath);
    let configured = false;
    let dataDbInfo: DataDbInfo | null = null;

    if (configExists) {
      try {
        const configReader = openSqliteReader(configPath);
        try {
          const flag = configReader.query<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', ['APP_CONFIGURED']).rows[0];
          configured = flag?.value === '1';
          if (configured) {
            const map = new Map<string, string>();
            for (const row of configReader.query<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key IN ('DATA_DB_CONNECTION','DATA_DB_DATABASE','DATA_DB_HOST','DATA_DB_PORT','DATA_DB_USERNAME','DATA_DB_PASSWORD')").rows) {
              map.set(row.key, row.value);
            }
            const connection = map.get('DATA_DB_CONNECTION') ?? 'sqlite';
            dataDbInfo = {
              connection,
              database: map.get('DATA_DB_DATABASE') ?? 'storage/voicehubpay.sqlite',
              host: map.get('DATA_DB_HOST') ?? '127.0.0.1',
              port: map.get('DATA_DB_PORT') ?? '5432',
              username: map.get('DATA_DB_USERNAME') ?? '',
              password: map.get('DATA_DB_PASSWORD') ?? '',
            };
          }
        } finally {
          configReader.close();
        }
      } catch {
        configured = false;
      }
    }

    const result: LegacyDetectionReport = {
      legacy: false,
      config_configured: configured,
      data_db: null,
      table_present: false,
      columns: [],
      adapter: 'none',
      count: 0,
      amount_cents: 0,
      voicehub: { success: 0, failed: 0, pending: 0 },
      config_exists: configExists,
      data_db_info: dataDbInfo,
    };
    if (!configured) return result;

    // Locate the legacy data DB (read-only; failures keep legacy=false).
    let dataReader: LegacyReader;
    try {
      dataReader = this.openDataDb(dataDbInfo);
    } catch {
      return result;
    }
    result.data_db = this.dataDbIdentifier(dataDbInfo);

    try {
      const columns = this.tableColumns(dataReader, 'afdian_orders');
      if (columns.length === 0) return result;
      result.table_present = true;
      result.columns = columns;
      result.adapter = detectAdapter(columns).name();

      result.count = Number(dataReader.query('SELECT COUNT(*) AS n FROM afdian_orders').rows[0]?.n ?? 0);
      result.amount_cents = Number(dataReader.query(`SELECT COALESCE(SUM(${detectAdapter(columns).amountColumn()}), 0) AS n FROM afdian_orders`).rows[0]?.n ?? 0);
      const voicehubColumn = detectAdapter(columns).voicehubColumn();
      for (const row of dataReader.query<{ v: unknown; c: number }>(`SELECT ${voicehubColumn} AS v, COUNT(*) AS c FROM afdian_orders GROUP BY ${voicehubColumn}`).rows) {
        const key = String(row.v).toLowerCase();
        if (key === 'created' || key === 'success') result.voicehub.success += Number(row.c);
        else if (key === 'failed') result.voicehub.failed += Number(row.c);
        else result.voicehub.pending += Number(row.c);
      }
    } catch {
      // Stats are best-effort; never fail detection on them.
    } finally {
      dataReader.close();
    }

    result.legacy = true;
    return result;
  }

  /** Open a READ-ONLY connection to the legacy data DB. */
  openDataDb(info: DataDbInfo | null): LegacyReader {
    if (info === null) throw new Error('Legacy data DB info missing');
    const connection = info.connection ?? 'sqlite';
    if (connection === 'sqlite') {
      let path = info.database ?? 'storage/voicehubpay.sqlite';
      if (!path.startsWith('/')) path = join(this.basePath, path);
      if (!existsSync(path) || !path.endsWith('.sqlite') && !path.endsWith('.sqlite3') && !path.endsWith('.db')) {
        // Keep the PHP error message contract for missing files.
        if (!existsSync(path)) throw new Error(`Legacy SQLite data file not found: ${path}`);
      }
      return openSqliteReader(path);
    }
    throw new Error(`Legacy data DB connection '${connection}' requires a driver; only sqlite is supported by the Node migration runtime`);
  }

  private dataDbIdentifier(info: DataDbInfo | null): string {
    if ((info?.connection ?? 'sqlite') === 'pgsql') return `pgsql:${info?.database ?? 'voicehubpay'}`;
    return `sqlite:${info?.database ?? 'storage/voicehubpay.sqlite'}`;
  }

  private tableColumns(reader: LegacyReader, table: string): string[] {
    try {
      return reader.query<{ name: string }>(`PRAGMA table_info(${table})`).rows.map((row) => row.name);
    } catch {
      return [];
    }
  }
}
