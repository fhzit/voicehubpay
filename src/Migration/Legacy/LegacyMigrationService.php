<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy;

use PDO;
use VoiceHubPay\Migration\Legacy\Adapters\LegacyAdapter;
use VoiceHubPay\Migration\Legacy\Adapters\LegacyV1Adapter;
use VoiceHubPay\Migration\Legacy\Adapters\LegacyV2Adapter;
use VoiceHubPay\Migration\Legacy\Adapters\UnknownLegacyAdapter;
use VoiceHubPay\Security\CryptoService;
use VoiceHubPay\Support\Money;

/**
 * Executes the legacy VoiceHubPay data migration.
 *
 * Principles:
 *   - out_trade_no is preserved VERBATIM (TEXT, no transforms).
 *   - successful historical VoiceHub deliveries become status=success and are
 *     NEVER re-pushed (idempotency key afdian:{out_trade_no}).
 *   - failed ones keep attempts/last_error and wait for admin retry.
 *   - amounts convert via safe decimal-string conversion.
 *   - the migration is idempotent (safe to re-run).
 *   - old databases are never deleted; a backup is created first.
 */
final class LegacyMigrationService
{
    private LegacySchemaDetector $detector;

    public function __construct(private readonly string $basePath, private readonly CryptoService $crypto)
    {
        $this->detector = new LegacySchemaDetector($basePath);
    }

    public function detect(): array
    {
        return $this->detector->detect();
    }

    /**
     * Dry-run report — reads only, writes nothing.
     */
    public function dryRun(): array
    {
        $detected = $this->detector->detect();
        if (!$detected['legacy'] || !$detected['table_present']) {
            return [
                'detected' => false,
                'report' => $detected,
                'adapter' => 'none',
                'count' => 0,
                'amount_cents' => 0,
                'voicehub' => ['success' => 0, 'failed' => 0, 'pending' => 0],
                'warnings' => [],
            ];
        }
        $adapter = $this->adapterFor($detected['columns']);
        return [
            'detected' => true,
            'report' => $detected,
            'adapter' => $adapter::name(),
            'count' => $detected['count'],
            'amount_cents' => $detected['amount_cents'],
            'voicehub' => [
                'success' => $detected['voicehub']['success'],
                'failed' => $detected['voicehub']['failed'],
                'pending' => $detected['voicehub']['pending'],
            ],
            'expected' => [
                'orders' => $detected['count'],
                'amount_cents' => $detected['amount_cents'],
                'voicehub_success' => $detected['voicehub']['success'],
                'voicehub_failed' => $detected['voicehub']['failed'],
                'voicehub_pending' => $detected['voicehub']['pending'],
            ],
            'warnings' => $detected['adapter'] === 'UnknownLegacy' ? ['无法识别的旧数据库结构，拒绝迁移。'] : [],
        ];
    }

    /**
     * Create a backup of the legacy settings sqlite + legacy data DB files.
     * Returns the backup directory path.
     */
    public function backup(string $suffix = ''): string
    {
        $dir = $this->basePath . '/storage/backups';
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $stamp = gmdate('Ymd-His') . '-' . substr(bin2hex(random_bytes(3)), 0, 6) . ($suffix !== '' ? '-' . $suffix : '');
        $backupDir = $dir . '/legacy-' . $stamp;
        mkdir($backupDir, 0775, true);

        $settingsPath = $this->basePath . '/storage/settings.sqlite';
        if (is_file($settingsPath)) {
            copy($settingsPath, $backupDir . '/settings.sqlite');
        }

        $detected = $this->detector->detect();
        if ($detected['data_db_info'] ?? null) {
            $info = $detected['data_db_info'];
            if (($info['connection'] ?? 'sqlite') === 'sqlite') {
                $dbPath = $info['database'] ?? 'storage/voicehubpay.sqlite';
                if (!str_starts_with($dbPath, '/')) {
                    $dbPath = $this->basePath . '/' . $dbPath;
                }
                if (is_file($dbPath)) {
                    copy($dbPath, $backupDir . '/data-' . basename($dbPath));
                    foreach (glob($dbPath . '-wal') ?: [] as $wal) {
                        copy($wal, $backupDir . '/' . basename($wal));
                    }
                    foreach (glob($dbPath . '-shm') ?: [] as $shm) {
                        copy($shm, $backupDir . '/' . basename($shm));
                    }
                }
            }
        }
        return $backupDir;
    }

    /**
     * Run the migration into the target DB.
     *
     * @param PDO    $targetPdo    already-migrated target database
     * @param array|null $oldDbInfo legacy data DB descriptor (optional when
     *                             legacy data already lives in the target)
     * @return array report with verification results
     * @throws \RuntimeException on failure (Migration FAILED)
     */
    public function migrate(PDO $targetPdo, ?array $oldDbInfo = null): array
    {
        $backupDir = $this->backup();

        // Legacy data may be present via three routes:
        //   1) the old install is still detected by settings (fresh install),
        //   2) Migrator already renamed afdian_orders -> afdian_orders_legacy
        //      in the target DB (the /install flow), or
        //   3) the caller passed an explicit old-DB descriptor.
        $targetHasLegacy = $this->tableExists($targetPdo, 'afdian_orders_legacy');
        $detected = $this->detector->detect();
        $oldDbHasLegacy = false;
        if ($oldDbInfo !== null) {
            try {
                $oldDbHasLegacy = $this->tableExists($this->detector->openDataDb($oldDbInfo), 'afdian_orders');
            } catch (\Throwable) {
                $oldDbHasLegacy = false;
            }
        }

        if (!$detected['legacy'] && !$targetHasLegacy && !$oldDbHasLegacy) {
            return ['migrated' => false, 'reason' => 'no legacy installation detected', 'backup' => $backupDir];
        }

        $source = $this->openSource($targetPdo, $oldDbInfo, $detected['columns']);
        if ($source === null) {
            throw new \RuntimeException('无法定位旧数据库中的 afdian_orders 数据。');
        }
        [$sourcePdo, $tableName, $columns] = $source;
        $adapter = $this->adapterFor($columns);

        $migratedOrders = 0;
        $deliveriesCreated = 0;
        $skippedEmpty = 0;
        $alreadyImported = 0;
        $deliverySuccess = 0;
        $deliveryFailed = 0;

        $targetPdo->beginTransaction();
        try {
            $rows = $sourcePdo->query('SELECT * FROM ' . $tableName)->fetchAll();
            $expectedCount = count($rows);
            $insert = $targetPdo->prepare('INSERT INTO afdian_orders (out_trade_no, trade_no, user_id, plan_id, sku_detail, amount_cents, status, raw_payload, voicehub_status, voicehub_attempts, voicehub_last_error, created_at, paid_at, processed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $deliveryInsert = $targetPdo->prepare('INSERT INTO voicehub_deliveries (source_type, source_id, source_order_no, fulfillment_unit_id, code_ciphertext, code_hash, code_source, idempotency_key, status, attempts, last_error, request_payload, response_payload, created_at, updated_at, success_at) VALUES (\'afdian\', ?, ?, NULL, ?, ?, \'afdian_order_no\', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)');

            $existsCheck = $targetPdo->prepare('SELECT 1 FROM afdian_orders WHERE out_trade_no = ? LIMIT 1');
            $deliveryExists = $targetPdo->prepare('SELECT 1 FROM voicehub_deliveries WHERE idempotency_key = ? LIMIT 1');

            foreach ($rows as $legacy) {
                $mapped = $adapter->mapRow($legacy, $this->crypto);
                $outTradeNo = (string) $mapped['out_trade_no'];
                if ($outTradeNo === '') {
                    $skippedEmpty++;
                    continue;
                }
                // Idempotency: skip existing orders (re-runs are a no-op).
                $existsCheck->execute([$outTradeNo]);
                if ($existsCheck->fetchColumn() !== false) {
                    $alreadyImported++;
                    continue;
                }
                $insert->execute([
                    $outTradeNo,
                    $mapped['trade_no'],
                    $mapped['user_id'],
                    $mapped['plan_id'],
                    $mapped['sku_detail'],
                    $mapped['amount_cents'],
                    $mapped['status'],
                    $mapped['raw_payload'],
                    $mapped['voicehub_status'],
                    $mapped['voicehub_attempts'],
                    $mapped['voicehub_last_error'],
                    $mapped['created_at'],
                    $mapped['paid_at'],
                    $mapped['processed_at'],
                    $mapped['updated_at'],
                ]);
                $newId = (int) $targetPdo->lastInsertId();
                $migratedOrders++;

                // Historical VoiceHub delivery (idempotency-key guarded).
                $idempotency = 'afdian:' . $outTradeNo;
                $deliveryExists->execute([$idempotency]);
                if ($deliveryExists->fetchColumn() !== false) {
                    continue;
                }
                $status = $mapped['voicehub_status'] === 'success' ? 'success' : ($mapped['voicehub_status'] === 'failed' ? 'failed' : 'pending');
                if ($status === 'pending') {
                    continue; // only materialize historical success/failed deliveries
                }
                $created = $mapped['created_at'];
                $deliveryInsert->execute([
                    $newId,
                    $outTradeNo,
                    $this->crypto->encrypt($outTradeNo),
                    $this->crypto->hash($outTradeNo),
                    $idempotency,
                    $status,
                    $status === 'success' ? 1 : max(1, (int) $mapped['voicehub_attempts']),
                    $status === 'failed' ? ($mapped['voicehub_last_error'] ?? 'historical failure') : null,
                    $created,
                    $created,
                    $status === 'success' ? $created : null,
                ]);
                $deliveriesCreated++;
                if ($status === 'success') {
                    $deliverySuccess++;
                } else {
                    $deliveryFailed++;
                }
            }
            $targetPdo->commit();
        } catch (\Throwable $e) {
            if ($targetPdo->inTransaction()) {
                $targetPdo->rollBack();
            }
            throw new \RuntimeException('Legacy migration failed: ' . $e->getMessage(), 0, $e);
        }

        // Verification.
        $newCount = (int) $targetPdo->query('SELECT COUNT(*) FROM afdian_orders')->fetchColumn();
        $ok = $migratedOrders === $expectedCount;

        $verification = [
            'source_orders' => $expectedCount,
            'migrated_orders' => $migratedOrders,
            'already_existing' => $alreadyImported,
            'skipped_empty' => $skippedEmpty,
            'deliveries_created' => $deliveriesCreated,
            'delivery_success' => $deliverySuccess,
            'delivery_failed' => $deliveryFailed,
            'target_orders_total' => $newCount,
        ];

        // Every source row must be accounted for (imported now or already present).
        $ok = ($migratedOrders + $alreadyImported) === $expectedCount;
        if (!$ok) {
            throw new \RuntimeException('Migration FAILED: migrated ' . $migratedOrders . ' of ' . $expectedCount . ' orders. Backup at ' . $backupDir);
        }

        $this->migrateSettings();

        return [
            'migrated' => true,
            'backup' => $backupDir,
            'verification' => $verification,
            'ok' => $ok,
        ];
    }

    /**
     * Import legacy settings (AFDIAN_* / VOICEHUB_* / APP_URL) into the new
     * settings store, encrypting secret values. Only fills keys not already set.
     */
    public function migrateSettings(): void
    {
        $settingsPath = $this->basePath . '/storage/settings.sqlite';
        if (!is_file($settingsPath)) {
            return;
        }
        try {
            $pdo = new PDO('sqlite:' . $settingsPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $rows = $pdo->query('SELECT key, value FROM app_settings')->fetchAll();
        } catch (\Throwable) {
            return;
        }
        $repo = new \VoiceHubPay\Config\SettingsRepository($this->basePath);
        $secretStore = new \VoiceHubPay\Security\SecretStore($this->basePath, $repo);

        $secretKeys = ['AFDIAN_API_TOKEN', 'VOICEHUB_API_TOKEN', 'OAUTH_CLIENT_SECRET'];
        foreach ($rows as $row) {
            $key = (string) $row['key'];
            $value = (string) $row['value'];
            if ($value === '') {
                continue;
            }
            // Only import when the new store does not already have the key.
            if ($repo->has($key)) {
                continue;
            }
            if (in_array($key, $secretKeys, true)) {
                $secretStore->set($key, $value);
            } else {
                $repo->set($key, $value);
            }
        }
    }

    /**
     * Source resolution: prefer afdian_orders_legacy in the target, else open
     * the legacy data DB.
     *
     * @return array{0: PDO, 1: string, 2: array}|null
     */
    private function openSource(PDO $targetPdo, ?array $oldDbInfo, array $detectedColumns): ?array
    {
        if ($this->tableExists($targetPdo, 'afdian_orders_legacy')) {
            $columns = $this->tableColumns($targetPdo, 'afdian_orders_legacy');
            return [$targetPdo, 'afdian_orders_legacy', $columns];
        }
        if ($oldDbInfo !== null) {
            try {
                $oldPdo = $this->detector->openDataDb($oldDbInfo);
                if ($this->tableExists($oldPdo, 'afdian_orders')) {
                    return [$oldPdo, 'afdian_orders', $this->tableColumns($oldPdo, 'afdian_orders')];
                }
            } catch (\Throwable) {
                return null;
            }
        }
        // Fall back to the columns reported by detection.
        if ($detectedColumns !== []) {
            return [$targetPdo, 'afdian_orders_legacy', $detectedColumns];
        }
        return null;
    }

    private function adapterFor(array $columns): LegacyAdapter
    {
        $class = Adapters\AdapterRegistry::detect($columns);
        if ($class === UnknownLegacyAdapter::class) {
            throw new \RuntimeException('无法识别的旧数据库结构，迁移已中止。');
        }
        return new $class();
    }

    private function tableExists(PDO $pdo, string $table): bool
    {
        $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        try {
            if ($driver === 'pgsql') {
                $stmt = $pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name = ?");
                $stmt->execute([$table]);
                return $stmt->fetchColumn() !== false;
            }
            $stmt = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?");
            $stmt->execute([$table]);
            return $stmt->fetchColumn() !== false;
        } catch (\Throwable) {
            return false;
        }
    }

    private function tableColumns(PDO $pdo, string $table): array
    {
        $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        try {
            if ($driver === 'pgsql') {
                $stmt = $pdo->prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name = ?");
                $stmt->execute([$table]);
                return array_column($stmt->fetchAll(), 'column_name');
            }
            $stmt = $pdo->prepare('PRAGMA table_info(' . $table . ')');
            $stmt->execute();
            return array_column($stmt->fetchAll(), 'name');
        } catch (\Throwable) {
            return [];
        }
    }
}
