import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { createPostgresDatabase, type Database, type QueryResult } from '../src/index.js';
import { AfdianOrderRepository, VoiceHubDeliveryRepository, CryptoService } from '../src/index.js';
import { LegacyMigrationService, type DataDbInfo } from '../src/legacy-migration/index.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEST_URL = process.env.LEGACY_PG_TEST_URL;

describe.skipIf(!TEST_URL)('PostgreSQL legacy migration integration', () => {
  it('detects and migrates a PostgreSQL source into a PostgreSQL target idempotently', async () => {
    const sourcePool = new Pool({ connectionString: TEST_URL });
    const targetPool = new Pool({ connectionString: TEST_URL });
    const sourceSchema = `legacy_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const targetSchema = `target_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const sourceDb = createPostgresDatabase(schemaPool(sourcePool, sourceSchema));
    const targetDb = createPostgresDatabase(schemaPool(targetPool, targetSchema));
    const basePath = mkdtempSync(join(tmpdir(), 'vh-legacy-pg-'));
    try {
      await sourcePool.query(`CREATE SCHEMA ${sourceSchema}`);
      await targetPool.query(`CREATE SCHEMA ${targetSchema}`);
      await sourceDb.query(`CREATE TABLE afdian_orders (id BIGSERIAL PRIMARY KEY, order_no TEXT, amount NUMERIC(12,2), status TEXT, voicehub_status TEXT, last_error TEXT, buyer_name TEXT, raw_payload TEXT, created_at TEXT, updated_at TEXT)`);
      await sourceDb.query("INSERT INTO afdian_orders (order_no, amount, status, voicehub_status, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ['PG-ORDER-001', '12.34', 'paid', 'created', null, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z']);
      const { readFile } = await import('node:fs/promises');
      for (const name of ['009_voicehub_deliveries.sql', '011_afdian_orders.sql', '015_afdian_add_buyer_name.sql', '016_afdian_add_remark.sql']) await targetDb.query(await readFile(join(import.meta.dirname, '../../../database/migrations/pgsql', name), 'utf8'));
      const info: DataDbInfo = { connection: 'pgsql', database: new URL(TEST_URL!).pathname.slice(1), host: new URL(TEST_URL!).hostname, port: new URL(TEST_URL!).port || '5432', username: decodeURIComponent(new URL(TEST_URL!).username), password: decodeURIComponent(new URL(TEST_URL!).password) };
      await sourceDb.query('SET search_path TO ' + sourceSchema);
      const service = new LegacyMigrationService(basePath, new CryptoService(basePath));
      // Explicitly scope the source reader to its schema via database option unavailable in old config: schema is set through source connection's user search_path.
      const result = await service.migrate(targetDb, { ...info, database: `${info.database}?options=-csearch_path%3D${sourceSchema}` });
      expect(result.ok).toBe(true);
      expect((await targetDb.query('SELECT out_trade_no, amount_cents FROM afdian_orders')).rows[0]).toMatchObject({ out_trade_no: 'PG-ORDER-001', amount_cents: 1234 });
      expect((await targetDb.query('SELECT idempotency_key, status FROM voicehub_deliveries')).rows[0]).toMatchObject({ idempotency_key: 'afdian:PG-ORDER-001', status: 'success' });
      expect((await service.migrate(targetDb, { ...info, database: `${info.database}?options=-csearch_path%3D${sourceSchema}` })).verification?.already_existing).toBe(1);
    } finally {
      rmSync(basePath, { recursive: true, force: true });
      await sourcePool.query(`DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`);
      await targetPool.query(`DROP SCHEMA IF EXISTS ${targetSchema} CASCADE`);
      await sourcePool.end(); await targetPool.end();
    }
  });
});

function schemaPool(pool: Pool, schema: string): Pool {
  return new Proxy(pool, { get(target, property) {
    if (property === 'connect') return async () => {
      const client = await target.connect();
      await client.query(`SET search_path TO ${schema}`);
      return client;
    };
    if (property === 'query') return (...args: unknown[]) => target.query(...args as [string, unknown[]]);
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
