import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase, type Database } from '../src/index.js';
import { CryptoService } from '../src/legacy/crypto.js';
import {
  LegacyMigrationService,
  LegacySchemaDetector,
  LegacyV1Adapter,
  LegacyV2Adapter,
  UnknownLegacyAdapter,
  detectAdapter,
  type DataDbInfo,
} from '../src/legacy-migration/index.js';

/**
 * Deterministic fixtures: a temporary "old install" base path containing
 * storage/settings.sqlite (APP_CONFIGURED=1 + DATA_DB_* rows) and a legacy
 * data SQLite file with the legacy-shaped afdian_orders table; the target is
 * an in-memory SQLite database replayed from the project migrations.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', '..', 'database', 'migrations', 'sqlite');
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

function createTarget(): Database {
  const db = createSqliteDatabase(':memory:');
  for (const name of MIGRATION_FILES) {
    db.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }
  return db;
}

interface Fixture {
  basePath: string;
  dataDbPath: string;
  dataDbInfo: DataDbInfo;
  settingsDbPath: string;
}

function createLegacyFixture(rows: Array<Record<string, unknown>>): Fixture {
  const basePath = mkdtempSync(join(tmpdir(), 'voicehubpay-legacy-'));
  const storageDir = join(basePath, 'storage');
  mkdirSync(storageDir, { recursive: true });

  // Legacy settings DB: APP_CONFIGURED + DATA_DB_* keys.
  const settingsDbPath = join(storageDir, 'settings.sqlite');
  const settings = new BetterSqlite3(settingsDbPath);
  settings.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insertSetting = settings.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
  insertSetting.run('APP_CONFIGURED', '1');
  insertSetting.run('DATA_DB_CONNECTION', 'sqlite');
  insertSetting.run('DATA_DB_DATABASE', 'storage/legacy-data.sqlite');
  settings.close();

  // Legacy data DB with a V1-shaped afdian_orders table.
  const dataDbPath = join(storageDir, 'legacy-data.sqlite');
  const data = new BetterSqlite3(dataDbPath);
  const columns = Object.keys(rows[0] ?? { order_no: '' });
  data.exec(`CREATE TABLE afdian_orders (${columns.map((column) => `${column} TEXT`).join(', ')})`);
  const insertRow = data.prepare(`INSERT INTO afdian_orders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
  for (const row of rows) insertRow.run(...Object.values(row));
  data.close();

  return {
    basePath,
    dataDbPath,
    dataDbInfo: { connection: 'sqlite', database: 'storage/legacy-data.sqlite', host: '', port: '', username: '', password: '' },
    settingsDbPath,
  };
}

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const V1_ROWS = [
  { order_no: '2023102412345678', afdian_user_id: 'af-111', buyer_name: '张三', amount: '10.00', status: 'paid', voicehub_status: 'created', last_error: null, raw_payload: '{"plan":"p"}', created_at: '2023-10-24T08:00:00+00:00', updated_at: '2023-10-24T08:05:00+00:00' },
  { order_no: '2023102487654321', afdian_user_id: 'af-222', buyer_name: '李四', amount: '25.50', status: 'paid', voicehub_status: 'failed', last_error: 'gateway timeout', raw_payload: '{}', created_at: '2023-10-24T09:00:00+00:00', updated_at: '2023-10-24T09:01:00+00:00' },
  { order_no: '2023102500000001', afdian_user_id: 'af-333', buyer_name: '王五', amount: '5', status: 'paid', voicehub_status: 'pending', last_error: null, raw_payload: '{}', created_at: '2023-10-25T10:00:00+00:00', updated_at: '2023-10-25T10:00:00+00:00' },
];

describe('adapter registry', () => {
  it('detects V1 by order_no+amount, V2 by out_trade_no, and refuses unknown schemas', () => {
    expect(detectAdapter(['id', 'order_no', 'amount', 'voicehub_status']).name()).toBe('LegacyV1');
    expect(detectAdapter(['id', 'out_trade_no', 'amount_cents']).name()).toBe('LegacyV2');
    expect(detectAdapter(['id', 'something_else']).name()).toBe('UnknownLegacy');
  });

  it('maps V1 rows preserving out_trade_no verbatim and normalizing voicehub status', () => {
    const crypto = new CryptoService(tempPaths.splice(0).pop() ?? mkdtempSync(join(tmpdir(), 'voicehubpay-crypto-')));
    const adapter = new LegacyV1Adapter();
    const mapped = adapter.mapRow(V1_ROWS[0], crypto);
    expect(mapped.out_trade_no).toBe('2023102412345678'); // VERBATIM, no transforms
    expect(mapped.amount_cents).toBe(1000);
    expect(mapped.voicehub_status).toBe('success'); // 'created' -> success
    expect(mapped.voicehub_attempts).toBe(0);
    expect(mapped.processed_at).toBe('2023-10-24T08:00:00+00:00');
    const failed = adapter.mapRow(V1_ROWS[1], crypto);
    expect(failed.voicehub_status).toBe('failed');
    expect(failed.voicehub_attempts).toBe(1);
    expect(failed.voicehub_last_error).toBe('gateway timeout');
    const pending = adapter.mapRow(V1_ROWS[2], crypto);
    expect(pending.voicehub_status).toBe('pending');
    expect(pending.processed_at).toBeNull();
  });

  it('maps V2 rows with integer cents passthrough and decimal fallback', () => {
    const crypto = new CryptoService(mkdtempSync(join(tmpdir(), 'voicehubpay-crypto-')));
    const adapter = new LegacyV2Adapter();
    const centsRow = adapter.mapRow({ out_trade_no: 'ABC-1', amount_cents: 9900 }, crypto);
    expect(centsRow.amount_cents).toBe(9900);
    expect(centsRow.out_trade_no).toBe('ABC-1');
    const decimalRow = adapter.mapRow({ out_trade_no: 'ABC-2', amount: '12.34' }, crypto);
    expect(decimalRow.amount_cents).toBe(1234);
    const malformedRow = adapter.mapRow({ out_trade_no: 'ABC-3', amount: 'not-a-number' }, crypto);
    expect(malformedRow.amount_cents).toBe(0);
  });

  it('never maps rows for unknown schemas', () => {
    const crypto = new CryptoService(mkdtempSync(join(tmpdir(), 'voicehubpay-crypto-')));
    expect(() => new UnknownLegacyAdapter().mapRow({}, crypto)).toThrow('refusing to guess');
  });
});

describe('legacy schema detector', () => {
  it('reports no legacy install when settings are missing', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'voicehubpay-empty-'));
    tempPaths.push(basePath);
    const report = new LegacySchemaDetector(basePath).detect();
    expect(report.legacy).toBe(false);
    expect(report.config_exists).toBe(false);
    expect(report.config_configured).toBe(false);
    expect(report.table_present).toBe(false);
  });

  it('detects a configured legacy install with read-only stats', () => {
    const fixture = createLegacyFixture(V1_ROWS);
    tempPaths.push(fixture.basePath);
    const dataBefore = readFileSync(fixture.dataDbPath);
    const report = new LegacySchemaDetector(fixture.basePath).detect();
    expect(report.legacy).toBe(true);
    expect(report.config_configured).toBe(true);
    expect(report.table_present).toBe(true);
    expect(report.adapter).toBe('LegacyV1');
    expect(report.count).toBe(3);
    // Detection stats SUM the raw legacy amount column (as the PHP baseline
    // does): V1 stores yuan decimals, so 10.00+25.50+5 = 40.5.
    expect(report.amount_cents).toBe(40.5);
    expect(report.voicehub).toEqual({ success: 1, failed: 1, pending: 1 });
    expect(report.data_db).toBe('sqlite:storage/legacy-data.sqlite');
    expect(readFileSync(fixture.dataDbPath).equals(dataBefore)).toBe(true); // read-only detection
  });

  it('stays inert when APP_CONFIGURED is not 1', () => {
    const fixture = createLegacyFixture(V1_ROWS);
    tempPaths.push(fixture.basePath);
    const settings = new BetterSqlite3(fixture.settingsDbPath);
    settings.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('0', 'APP_CONFIGURED');
    settings.close();
    const report = new LegacySchemaDetector(fixture.basePath).detect();
    expect(report.legacy).toBe(false);
    expect(report.config_configured).toBe(false);
  });
});

describe('legacy migration dry run', () => {
  it('returns a full expected report for a detectable legacy install', () => {
    const fixture = createLegacyFixture(V1_ROWS);
    tempPaths.push(fixture.basePath);
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const report = service.dryRun();
    expect(report.detected).toBe(true);
    expect(report.adapter).toBe('LegacyV1');
    expect(report.count).toBe(3);
    // Raw legacy-column SUM (yuan decimals) for V1, matching the PHP baseline.
    expect(report.amount_cents).toBe(40.5);
    expect(report.expected).toEqual({
      orders: 3,
      amount_cents: 40.5,
      voicehub_success: 1,
      voicehub_failed: 1,
      voicehub_pending: 1,
    });
    expect(report.warnings).toEqual([]);
  });

  it('reports nothing to migrate when no legacy install exists', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'voicehubpay-empty2-'));
    tempPaths.push(basePath);
    const service = new LegacyMigrationService(basePath, new CryptoService(basePath));
    const report = service.dryRun();
    expect(report.detected).toBe(false);
    expect(report.adapter).toBe('none');
    expect(report.count).toBe(0);
    expect(report.warnings).toEqual([]);
  });

  it('warns on unrecognized schemas and refuses to execute', async () => {
    const fixture = createLegacyFixture([{ weird_column: 'x' }]);
    tempPaths.push(fixture.basePath);
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const dry = service.dryRun();
    expect(dry.report.adapter).toBe('UnknownLegacy');
    expect(dry.warnings).toEqual(['无法识别的旧数据库结构，拒绝迁移。']);
    await expect(service.migrate(createTarget(), fixture.dataDbInfo)).rejects.toThrow('无法识别的旧数据库结构');
  });
});

describe('legacy migration execute', () => {
  let fixture: Fixture;
  let target: Database;

  beforeEach(() => {
    fixture = createLegacyFixture(V1_ROWS);
    tempPaths.push(fixture.basePath);
    target = createTarget();
  });

  afterEach(async () => {
    await target.close();
  });

  it('migrates V1 orders, materializes historical deliveries, and verifies counts', async () => {
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const result = await service.migrate(target, fixture.dataDbInfo);
    expect(result.migrated).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.verification).toMatchObject({
      source_orders: 3,
      migrated_orders: 3,
      already_existing: 0,
      skipped_empty: 0,
      deliveries_created: 2, // success + failed only; pending stays implicit
      delivery_success: 1,
      delivery_failed: 1,
      target_orders_total: 3,
    });

    // out_trade_no preserved verbatim; integer cents preserved.
    const orders = (await target.query('SELECT * FROM afdian_orders ORDER BY id')).rows;
    expect(orders.map((row) => row.out_trade_no)).toEqual(['2023102412345678', '2023102487654321', '2023102500000001']);
    expect(orders.map((row) => row.amount_cents)).toEqual([1000, 2550, 500]);

    // Historical deliveries recorded with the afdian:{out_trade_no} key.
    const deliveries = (await target.query('SELECT * FROM voicehub_deliveries ORDER BY id')).rows;
    expect(deliveries.map((row) => row.idempotency_key)).toEqual(['afdian:2023102412345678', 'afdian:2023102487654321']);
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].success_at).not.toBeNull();
    expect(deliveries[0].source_order_no).toBe('2023102412345678');
    expect(deliveries[1].status).toBe('failed');
    expect(deliveries[1].last_error).toBe('gateway timeout');
  });

  it('is idempotent: re-running is a no-op that still verifies cleanly', async () => {
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const first = await service.migrate(target, fixture.dataDbInfo);
    expect(first.migrated).toBe(true);
    const second = await service.migrate(target, fixture.dataDbInfo);
    expect(second.migrated).toBe(true);
    expect(second.verification).toMatchObject({
      source_orders: 3,
      migrated_orders: 0,
      already_existing: 3,
      skipped_empty: 0,
      deliveries_created: 0,
      target_orders_total: 3,
    });
    expect((await target.query('SELECT COUNT(*) AS n FROM afdian_orders')).rows[0].n).toBe(3);
    expect((await target.query('SELECT COUNT(*) AS n FROM voicehub_deliveries')).rows[0].n).toBe(2);
  });

  it('migrates V2-shaped legacy tables via the explicit old-DB descriptor', async () => {
    // Recreate the legacy data DB with V2 columns.
    rmSync(fixture.dataDbPath);
    const data = new BetterSqlite3(fixture.dataDbPath);
    data.exec(`CREATE TABLE afdian_orders (
      out_trade_no TEXT, user_id TEXT, amount_cents INTEGER, status TEXT,
      voicehub_status TEXT, voicehub_last_error TEXT, created_at TEXT, updated_at TEXT)`);
    const insert = data.prepare('INSERT INTO afdian_orders (out_trade_no, user_id, amount_cents, status, voicehub_status, voicehub_last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('OUT-0001', 'af-1', 6800, 'paid', 'success', null, '2024-02-01T00:00:00+00:00', '2024-02-01T00:00:00+00:00');
    insert.run('OUT-0002', 'af-2', 1200, 'paid', 'failed', 'stock empty', '2024-02-02T00:00:00+00:00', '2024-02-02T00:00:00+00:00');
    data.close();

    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const result = await service.migrate(target, fixture.dataDbInfo);
    expect(result.ok).toBe(true);
    expect(result.verification).toMatchObject({ migrated_orders: 2, delivery_success: 1, delivery_failed: 1 });
    const orders = (await target.query('SELECT * FROM afdian_orders ORDER BY id')).rows;
    expect(orders.map((row) => row.out_trade_no)).toEqual(['OUT-0001', 'OUT-0002']);
    expect(orders.map((row) => row.amount_cents)).toEqual([6800, 1200]);
  });

  it('migrates from afdian_orders_legacy renamed inside the target DB', async () => {
    await target.query('CREATE TABLE afdian_orders_legacy (order_no TEXT, amount TEXT, voicehub_status TEXT, created_at TEXT)');
    await target.query("INSERT INTO afdian_orders_legacy (order_no, amount, voicehub_status, created_at) VALUES ('LEG-1', '3.00', 'created', '2023-01-01T00:00:00+00:00')");
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const result = await service.migrate(target, null);
    expect(result.ok).toBe(true);
    expect(result.verification).toMatchObject({ source_orders: 1, migrated_orders: 1 });
    expect((await target.query('SELECT out_trade_no, amount_cents FROM afdian_orders')).rows[0]).toEqual({ out_trade_no: 'LEG-1', amount_cents: 300 });
  });

  it('skips rows with empty out_trade_no but still verifies every source row', async () => {
    await target.query('DROP TABLE IF EXISTS afdian_orders_legacy');
    rmSync(fixture.dataDbPath);
    const data = new BetterSqlite3(fixture.dataDbPath);
    data.exec('CREATE TABLE afdian_orders (order_no TEXT, amount TEXT, voicehub_status TEXT, created_at TEXT)');
    const insert = data.prepare('INSERT INTO afdian_orders (order_no, amount, voicehub_status, created_at) VALUES (?, ?, ?, ?)');
    insert.run('', '1.00', 'pending', '2023-01-01T00:00:00+00:00');
    insert.run('OK-1', '2.00', 'pending', '2023-01-01T00:00:00+00:00');
    data.close();
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const result = await service.migrate(target, fixture.dataDbInfo);
    expect(result.ok).toBe(true);
    expect(result.verification).toMatchObject({ source_orders: 2, migrated_orders: 1, skipped_empty: 1 });
    expect((await target.query('SELECT out_trade_no FROM afdian_orders')).rows.map((row) => row.out_trade_no)).toEqual(['OK-1']);
  });

  it('never mutates or deletes the legacy DB and leaves a backup behind', async () => {
    const dataBefore = readFileSync(fixture.dataDbPath);
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    const result = await service.migrate(target, fixture.dataDbInfo);
    expect(result.migrated).toBe(true);
    expect(readFileSync(fixture.dataDbPath).equals(dataBefore)).toBe(true);
    const backupDir = result.backup ?? '';
    expect(backupDir).not.toBe('');
    expect(existsSync(join(backupDir, 'data-legacy-data.sqlite'))).toBe(true);
    expect(existsSync(join(backupDir, 'settings.sqlite'))).toBe(true);
  });

  it('imports legacy settings without overwriting existing keys, encrypting secrets', async () => {
    // Pre-existing legacy values: one secret, one plain, plus a colliding key.
    const settings = new BetterSqlite3(fixture.settingsDbPath);
    settings.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('AFDIAN_API_TOKEN', 'super-secret-token');
    settings.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('AFDIAN_LAST_POLL', '2023-10-25T00:00:00+00:00');
    settings.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run('APP_URL', 'https://old.example.com');
    settings.close();

    const crypto = new CryptoService(fixture.basePath);
    mkdirSync(join(fixture.basePath, 'storage'), { recursive: true });
    writeFileSync(join(fixture.basePath, 'storage', 'settings.json'), JSON.stringify({ APP_URL: 'https://new.example.com' }));

    const service = new LegacyMigrationService(fixture.basePath, crypto);
    const result = await service.migrate(target, fixture.dataDbInfo);
    expect(result.migrated).toBe(true);

    const newSettings = JSON.parse(readFileSync(join(fixture.basePath, 'storage', 'settings.json'), 'utf8')) as Record<string, string>;
    expect(newSettings.APP_URL).toBe('https://new.example.com'); // never overwritten
    expect(newSettings.AFDIAN_LAST_POLL).toBe('2023-10-25T00:00:00+00:00'); // imported

    // Secrets are stored encrypted and decrypt round-trip with the target key.
    const secretsRaw = JSON.parse(readFileSync(join(fixture.basePath, 'storage', 'secrets.json'), 'utf8')) as Record<string, string>;
    expect(secretsRaw.AFDIAN_API_TOKEN).not.toBe('super-secret-token');
    expect(crypto.decrypt(secretsRaw.AFDIAN_API_TOKEN)).toBe('super-secret-token');
  });

  it('returns migrated=false with a reason when there is nothing to migrate', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'voicehubpay-empty3-'));
    tempPaths.push(basePath);
    const emptyTarget = createTarget();
    const service = new LegacyMigrationService(basePath, new CryptoService(basePath));
    const result = await service.migrate(emptyTarget, null);
    expect(result).toMatchObject({ migrated: false, reason: 'no legacy installation detected' });
    expect(typeof result.backup).toBe('string');
    await emptyTarget.close();
  });

  it('rolls the target back atomically when an insert fails mid-migration', async () => {
    // Break the deliveries table AFTER the orders insert would have succeeded:
    // the whole transaction must roll back, leaving afdian_orders untouched.
    await target.query('DROP TABLE voicehub_deliveries');
    const service = new LegacyMigrationService(fixture.basePath, new CryptoService(fixture.basePath));
    await expect(service.migrate(target, fixture.dataDbInfo)).rejects.toThrow('Legacy migration failed');
    expect((await target.query('SELECT COUNT(*) AS n FROM afdian_orders')).rows[0].n).toBe(0);
  });
});
