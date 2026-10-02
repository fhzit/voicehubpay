import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Database } from '../index.js';
import { CryptoService } from '../legacy/crypto.js';
import { insertReturningId, type Row } from '../legacy/shared.js';
import { LegacyV2Adapter, UnknownLegacyAdapter } from './adapters.js';
import { detectAdapter } from './adapter-registry.js';
import { LegacySchemaDetector, openSqliteReader, type DataDbInfo, type LegacyDetectionReport, type LegacyReader } from './schema-detector.js';

export interface DryRunReport {
  detected: boolean;
  report: LegacyDetectionReport;
  adapter: string;
  count: number;
  amount_cents: number;
  voicehub: { success: number; failed: number; pending: number };
  expected?: {
    orders: number;
    amount_cents: number;
    voicehub_success: number;
    voicehub_failed: number;
    voicehub_pending: number;
  };
  warnings: string[];
}

export interface MigrationVerification {
  source_orders: number;
  migrated_orders: number;
  already_existing: number;
  skipped_empty: number;
  deliveries_created: number;
  delivery_success: number;
  delivery_failed: number;
  target_orders_total: number;
}

export interface MigrationResult {
  migrated: boolean;
  reason?: string;
  backup?: string;
  verification?: MigrationVerification;
  ok?: boolean;
}

/**
 * How the legacy afdian_orders source is located (PHP openSource):
 *  - 'target_legacy': afdian_orders_legacy already renamed into the target DB;
 *  - 'old_db': an explicit legacy data-DB descriptor;
 *  - null: nothing usable found -> migration aborts.
 */
type Source = { rows: Row[]; columns: string[]; reader: LegacyReader | null };

/**
 * Port of LegacyMigrationService: executes the legacy VoiceHubPay data
 * migration.
 *
 * Principles (preserved from the PHP baseline):
 *   - out_trade_no is preserved VERBATIM (TEXT, no transforms).
 *   - successful historical VoiceHub deliveries become status=success and are
 *     NEVER re-pushed (idempotency key `afdian:{out_trade_no}`).
 *   - failed ones keep attempts/last_error and wait for admin retry.
 *   - amounts convert via safe decimal-string conversion (integer cents).
 *   - the migration is idempotent (safe to re-run; existing orders skipped).
 *   - old databases are never deleted; a backup is created first.
 */
export class LegacyMigrationService {
  private readonly detector: LegacySchemaDetector;

  constructor(private readonly basePath: string, private readonly crypto: CryptoService) {
    this.detector = new LegacySchemaDetector(basePath);
  }

  detect(): LegacyDetectionReport {
    return this.detector.detect();
  }

  /** Dry-run report — reads only, writes nothing. */
  dryRun(): DryRunReport {
    const detected = this.detector.detect();
    if (!detected.legacy || !detected.table_present) {
      return {
        detected: false,
        report: detected,
        adapter: 'none',
        count: 0,
        amount_cents: 0,
        voicehub: { success: 0, failed: 0, pending: 0 },
        warnings: [],
      };
    }
    return {
      detected: true,
      report: detected,
      adapter: detected.adapter,
      count: detected.count,
      amount_cents: detected.amount_cents,
      voicehub: {
        success: detected.voicehub.success,
        failed: detected.voicehub.failed,
        pending: detected.voicehub.pending,
      },
      expected: {
        orders: detected.count,
        amount_cents: detected.amount_cents,
        voicehub_success: detected.voicehub.success,
        voicehub_failed: detected.voicehub.failed,
        voicehub_pending: detected.voicehub.pending,
      },
      warnings: detected.adapter === 'UnknownLegacy' ? ['无法识别的旧数据库结构，拒绝迁移。'] : [],
    };
  }

  /**
   * Create a backup of the legacy settings sqlite + legacy data DB files
   * (copies only; the originals are never deleted or modified). Returns the
   * backup directory path.
   */
  backup(suffix = ''): string {
    const dir = join(this.basePath, 'storage', 'backups');
    mkdirSync(dir, { recursive: true, mode: 0o775 });
    const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomBytes(3).toString('hex').slice(0, 6)}${suffix !== '' ? `-${suffix}` : ''}`;
    const backupDir = join(dir, `legacy-${stamp}`);
    mkdirSync(backupDir, { recursive: true, mode: 0o775 });

    const settingsPath = join(this.basePath, 'storage', 'settings.sqlite');
    if (existsSync(settingsPath)) {
      copyFileSync(settingsPath, join(backupDir, 'settings.sqlite'));
    }

    const info = this.detector.detect().data_db_info;
    if (info !== null && (info.connection ?? 'sqlite') === 'sqlite') {
      let dbPath = info.database ?? 'storage/voicehubpay.sqlite';
      if (!dbPath.startsWith('/')) dbPath = join(this.basePath, dbPath);
      if (existsSync(dbPath)) {
        copyFileSync(dbPath, join(backupDir, `data-${basename(dbPath)}`));
        for (const sidecarSuffix of ['-wal', '-shm']) {
          const sidecar = dbPath + sidecarSuffix;
          if (existsSync(sidecar)) copyFileSync(sidecar, join(backupDir, basename(sidecar)));
        }
      }
    }
    return backupDir;
  }

  /**
   * Run the migration into the target DB.
   *
   * Legacy data may be present via three routes:
   *   1) the old install is still detected by settings (fresh install),
   *   2) the migrator already renamed afdian_orders -> afdian_orders_legacy
   *      in the target DB, or
   *   3) the caller passed an explicit old-DB descriptor.
   *
   * Throws on failure (migration FAILED); returns a verification report.
   */
  async migrate(targetDb: Database, oldDbInfo: DataDbInfo | null = null): Promise<MigrationResult> {
    const backupDir = this.backup();

    const targetHasLegacy = await this.tableExists(targetDb, 'afdian_orders_legacy');
    const detected = this.detector.detect();
    let oldDbHasLegacy = false;
    if (oldDbInfo !== null) {
      try {
        const oldReader = this.detector.openDataDb(oldDbInfo);
        try {
          oldDbHasLegacy = this.readerColumns(oldReader, 'afdian_orders').length > 0;
        } finally {
          oldReader.close();
        }
      } catch {
        oldDbHasLegacy = false;
      }
    }

    if (!detected.legacy && !targetHasLegacy && !oldDbHasLegacy) {
      return { migrated: false, reason: 'no legacy installation detected', backup: backupDir };
    }

    const source = await this.openSource(targetDb, oldDbInfo, detected.columns);
    if (source === null) throw new Error('无法定位旧数据库中的 afdian_orders 数据。');

    try {
      const adapterStatic = detectAdapter(source.columns);
      if (adapterStatic.name() === UnknownLegacyAdapter.metadata.name()) {
        throw new Error('无法识别的旧数据库结构，迁移已中止。');
      }
      if (adapterStatic.name() === 'LegacyV2') LegacyV2Adapter.setColumns(source.columns);
      const adapter = adapterStatic.create();
      const expectedCount = source.rows.length;

      let migratedOrders = 0;
      let deliveriesCreated = 0;
      let skippedEmpty = 0;
      let alreadyImported = 0;
      let deliverySuccess = 0;
      let deliveryFailed = 0;

      try {
        await targetDb.transaction(async (tx: Database) => {
          for (const legacy of source.rows) {
            const mapped = adapter.mapRow(legacy, this.crypto);
            const outTradeNo = String(mapped.out_trade_no);
            if (outTradeNo === '') {
              skippedEmpty += 1;
              continue;
            }
            // Idempotency: skip existing orders (re-runs are a no-op).
            const exists = (await tx.query('SELECT 1 AS ok FROM afdian_orders WHERE out_trade_no = ? LIMIT 1', [outTradeNo])).rows.length > 0;
            if (exists) {
              alreadyImported += 1;
              continue;
            }
            const newId = await insertReturningId(
              tx,
              'INSERT INTO afdian_orders (out_trade_no, trade_no, user_id, plan_id, sku_detail, amount_cents, status, raw_payload, voicehub_status, voicehub_attempts, voicehub_last_error, created_at, paid_at, processed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                outTradeNo,
                mapped.trade_no,
                mapped.user_id,
                mapped.plan_id,
                mapped.sku_detail,
                mapped.amount_cents,
                mapped.status,
                mapped.raw_payload,
                mapped.voicehub_status,
                mapped.voicehub_attempts,
                mapped.voicehub_last_error,
                mapped.created_at,
                mapped.paid_at,
                mapped.processed_at,
                mapped.updated_at,
              ],
            );
            migratedOrders += 1;

            // Historical VoiceHub delivery (idempotency-key guarded).
            // Successful deliveries are NEVER re-pushed: the
            // `afdian:{out_trade_no}` idempotency key makes any later push a
            // no-op.
            const idempotency = `afdian:${outTradeNo}`;
            const deliveryExists = (await tx.query('SELECT 1 AS ok FROM voicehub_deliveries WHERE idempotency_key = ? LIMIT 1', [idempotency])).rows.length > 0;
            if (deliveryExists) continue;
            const status = mapped.voicehub_status === 'success' ? 'success' : mapped.voicehub_status === 'failed' ? 'failed' : 'pending';
            if (status === 'pending') continue; // only materialize historical success/failed deliveries
            const created = String(mapped.created_at);
            await insertReturningId(
              tx,
              "INSERT INTO voicehub_deliveries (source_type, source_id, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, request_payload, response_payload, created_at, updated_at, success_at) VALUES ('afdian', ?, ?, NULL, ?, ?, 'afdian_order_no', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
              [
                newId,
                outTradeNo,
                this.crypto.encrypt(outTradeNo),
                this.crypto.hash(outTradeNo),
                idempotency,
                status,
                status === 'success' ? 1 : Math.max(1, Number(mapped.voicehub_attempts ?? 0)),
                status === 'failed' ? ((mapped.voicehub_last_error as string | null | undefined) ?? 'historical failure') : null,
                created,
                created,
                status === 'success' ? created : null,
              ],
            );
            deliveriesCreated += 1;
            if (status === 'success') deliverySuccess += 1;
            else deliveryFailed += 1;
          }
        });
      } catch (error) {
        throw new Error(`Legacy migration failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Verification: every source row must be accounted for (imported now or
      // already present from a previous run).
      const newCount = Number((await targetDb.query('SELECT COUNT(*) AS n FROM afdian_orders')).rows[0]?.n ?? 0);
      const verification: MigrationVerification = {
        source_orders: expectedCount,
        migrated_orders: migratedOrders,
        already_existing: alreadyImported,
        skipped_empty: skippedEmpty,
        deliveries_created: deliveriesCreated,
        delivery_success: deliverySuccess,
        delivery_failed: deliveryFailed,
        target_orders_total: newCount,
      };
      // Verification: every source row must be accounted for (imported now,
      // already present from a previous run, or skipped as an empty
      // out_trade_no — an empty key cannot ever be imported).
      const ok = migratedOrders + alreadyImported + skippedEmpty === expectedCount;
      if (!ok) {
        throw new Error(`Migration FAILED: migrated ${migratedOrders} of ${expectedCount} orders. Backup at ${backupDir}`);
      }

      this.migrateSettings();

      return { migrated: true, backup: backupDir, verification, ok };
    } finally {
      source.reader?.close();
    }
  }

  /**
   * Import legacy settings (AFDIAN_* / VOICEHUB_* / APP_URL etc.) into the
   * new settings store. Only fills keys not already set; secret keys
   * (AFDIAN_API_TOKEN, VOICEHUB_API_TOKEN, OAUTH_CLIENT_SECRET) are stored
   * encrypted in storage/secrets.json, plain values in storage/settings.json.
   */
  migrateSettings(): void {
    const settingsPath = join(this.basePath, 'storage', 'settings.sqlite');
    if (!existsSync(settingsPath)) return;
    let rows: Array<{ key: string; value: string }>;
    try {
      const reader = openSqliteReader(settingsPath);
      try {
        rows = reader.query<{ key: string; value: string }>('SELECT key, value FROM app_settings').rows;
      } finally {
        reader.close();
      }
    } catch {
      return;
    }
    const secretKeys = ['AFDIAN_API_TOKEN', 'VOICEHUB_API_TOKEN', 'OAUTH_CLIENT_SECRET'];
    const settingsFile = join(this.basePath, 'storage', 'settings.json');
    const secretsFile = join(this.basePath, 'storage', 'secrets.json');
    const settings = this.readJsonMap(settingsFile);
    const secrets = this.readJsonMap(secretsFile);
    let settingsDirty = false;
    let secretsDirty = false;
    for (const { key, value } of rows) {
      if (value === '') continue;
      // Only import when the new store does not already have the key.
      if (secretKeys.includes(key)) {
        if (!secrets.has(key)) {
          secrets.set(key, this.crypto.encrypt(value));
          secretsDirty = true;
        }
      } else if (!settings.has(key)) {
        settings.set(key, value);
        settingsDirty = true;
      }
    }
    mkdirSync(join(this.basePath, 'storage'), { recursive: true, mode: 0o775 });
    if (settingsDirty) writeFileSync(settingsFile, JSON.stringify(Object.fromEntries(settings), null, 2));
    if (secretsDirty) writeFileSync(secretsFile, JSON.stringify(Object.fromEntries(secrets), null, 2));
  }

  /** Source resolution: prefer afdian_orders_legacy in the target, else the legacy data DB. */
  private async openSource(targetDb: Database, oldDbInfo: DataDbInfo | null, detectedColumns: string[]): Promise<Source | null> {
    if (await this.tableExists(targetDb, 'afdian_orders_legacy')) {
      const columns = await this.targetColumns(targetDb, 'afdian_orders_legacy');
      const rows = (await targetDb.query<Row>('SELECT * FROM afdian_orders_legacy')).rows;
      return { rows, columns, reader: null };
    }
    if (oldDbInfo !== null) {
      try {
        const oldReader = this.detector.openDataDb(oldDbInfo);
        const columns = this.readerColumns(oldReader, 'afdian_orders');
        if (columns.length > 0) {
          const rows = oldReader.query<Row>('SELECT * FROM afdian_orders').rows;
          return { rows, columns, reader: oldReader };
        }
        oldReader.close();
      } catch {
        return null;
      }
    }
    // Fall back to the columns reported by detection — but only if the table
    // we would read actually exists in the target. Otherwise these columns
    // came from an old/separate data DB that could not be opened, and reading
    // the hard-coded afdian_orders_legacy name here would fail the install.
    if (detectedColumns.length > 0 && await this.tableExists(targetDb, 'afdian_orders_legacy')) {
      const columns = await this.targetColumns(targetDb, 'afdian_orders_legacy');
      const rows = (await targetDb.query<Row>('SELECT * FROM afdian_orders_legacy')).rows;
      return { rows, columns, reader: null };
    }
    return null;
  }

  private async tableExists(db: Database, table: string): Promise<boolean> {
    try {
      return (await db.query("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?", [table])).rows.length > 0;
    } catch {
      return false;
    }
  }

  private async targetColumns(db: Database, table: string): Promise<string[]> {
    try {
      return (await db.query<Record<string, unknown>>(`PRAGMA table_info(${table})`)).rows.map((row) => String(row.name));
    } catch {
      return [];
    }
  }

  private readerColumns(reader: { query(sql: string, parameters?: readonly unknown[]): { rows: Array<Record<string, unknown>> } }, table: string): string[] {
    try {
      return reader.query(`PRAGMA table_info(${table})`).rows.map((row) => String(row.name));
    } catch {
      return [];
    }
  }

  private readJsonMap(file: string): Map<string, string> {
    try {
      if (!existsSync(file)) return new Map();
      return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>));
    } catch {
      return new Map();
    }
  }
}
