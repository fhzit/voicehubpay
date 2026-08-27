<?php

declare(strict_types=1);

use VoiceHubPay\Migration\Legacy\LegacyMigrationService;
use VoiceHubPay\Migration\Legacy\LegacySchemaDetector;
use VoiceHubPay\Security\CryptoService;

return static function (\VoiceHubPay\Tests\TestCase $t): array {
    [$app, $pdo] = $t->freshApp('legacy-target');
    $crypto = $t->freshCrypto('legacy');

    // Build a legacy V1 data DB (order_no + amount NUMERIC schema).
    $legacyDir = $t->tmpDir('legacy-db');
    $legacyDb = $legacyDir . '/afdian.sqlite';
    $l = new PDO('sqlite:' . $legacyDb);
    $l->exec('CREATE TABLE afdian_orders (order_no TEXT PRIMARY KEY, afdian_user_id TEXT, buyer_name TEXT, amount NUMERIC(12,2), status TEXT, voicehub_status TEXT, voicehub_response TEXT, last_error TEXT, raw_payload TEXT, created_at TEXT, updated_at TEXT)');
    $l->exec("INSERT INTO afdian_orders VALUES ('LG-0001','u1','甲',12.5,'paid','success','{}',NULL,'{}','2024-01-01T00:00:00+00:00','2024-01-02T00:00:00+00:00')");
    $l->exec("INSERT INTO afdian_orders VALUES ('LG-0002','u2','乙',8,'paid','failed','{}','boom','{}','2024-02-01T00:00:00+00:00','2024-02-02T00:00:00+00:00')");
    $l->exec("INSERT INTO afdian_orders VALUES ('LG-0003','u3','丙',20,'unpaid',NULL,NULL,NULL,'{}','2024-03-01T00:00:00+00:00','2024-03-01T00:00:00+00:00')");

    // Legacy settings file (as a real old install would have: storage/settings.sqlite).
    $settingsPath = $legacyDir . '/storage/settings.sqlite';
    if (!is_dir(dirname($settingsPath))) {
        mkdir(dirname($settingsPath), 0777, true);
    }
    $s = new PDO('sqlite:' . $settingsPath);
    $s->exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)');
    $s->exec("INSERT INTO app_settings VALUES ('APP_CONFIGURED','1','2024-01-01T00:00:00+00:00')");
    $s->exec("INSERT INTO app_settings VALUES ('DATA_DB_CONNECTION','sqlite','2024-01-01T00:00:00+00:00')");
    $s->exec("INSERT INTO app_settings VALUES ('DATA_DB_DATABASE','" . $legacyDb . "','2024-01-01T00:00:00+00:00')");

    // Detection is read-only.
    $detector = new LegacySchemaDetector($legacyDir);
    $report = $detector->detect();
    $t->assertTrue($report['legacy']);
    $t->assertTrue($report['table_present']);
    $t->assertSame(3, $report['count']);
    $t->assertSame('LegacyV1', $report['adapter']);

    $oldDbInfo = $report['data_db_info'];

    // Migrate into the fresh target (bypassing the settings-backed detection
    // by passing the explicit old-DB descriptor — as the /install flow does).
    $service = new LegacyMigrationService($legacyDir, $crypto);
    $result = $service->migrate($pdo, $oldDbInfo);
    $t->assertTrue($result['migrated']);
    $t->assertSame(3, $result['verification']['migrated_orders']);
    $t->assertSame(2, $result['verification']['deliveries_created'], 'success+failed materialized, pending skipped');

    // amounts converted to integer cents; statuses preserved
    $rows = $pdo->query('SELECT out_trade_no, amount_cents, status, voicehub_status FROM afdian_orders ORDER BY id')->fetchAll();
    $t->assertSame('LG-0001', $rows[0]['out_trade_no']);
    $t->assertSame('1250', (string) $rows[0]['amount_cents'], '12.5 -> 1250');
    $t->assertSame('paid', $rows[0]['status']);
    $t->assertSame('success', $rows[0]['voicehub_status'], 'historical success preserved (never re-pushed)');
    $t->assertSame('800', (string) $rows[1]['amount_cents'], '8 -> 800');
    $t->assertSame('failed', $rows[1]['voicehub_status']);
    $t->assertSame('2000', (string) $rows[2]['amount_cents'], '20 -> 2000');
    $t->assertSame('unpaid', $rows[2]['status']);

    // historical deliveries materialized, idempotency key afdian:{out_trade_no}
    $vd = $pdo->query("SELECT source_order_no, status, idempotency_key, attempts FROM voicehub_deliveries WHERE source_type='afdian' ORDER BY id")->fetchAll();
    $t->assertSame(2, count($vd));
    $t->assertSame('success', $vd[0]['status']);
    $t->assertSame('afdian:LG-0001', $vd[0]['idempotency_key']);
    $t->assertSame('failed', $vd[1]['status']);
    $t->assertSame('1', (string) $vd[1]['attempts'], 'failed keeps attempts');

    // re-run is a no-op / idempotent
    $result2 = $service->migrate($pdo, $oldDbInfo);
    $t->assertTrue($result2['migrated']);
    $t->assertSame(0, $result2['verification']['migrated_orders'], 'second run imports nothing');
    $t->assertSame(3, $result2['verification']['already_existing']);

    return ['assertions' => $t->assertions()];
};
