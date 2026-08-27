<?php

declare(strict_types=1);

namespace VoiceHubPay\Migration\Legacy;

use PDO;
use VoiceHubPay\Migration\Legacy\Adapters\LegacyAdapter;

/**
 * Detects a legacy VoiceHubPay installation:
 *  - storage/settings.sqlite with APP_CONFIGURED=1
 *  - legacy data DB (from legacy DATA_DB_* settings) containing afdian_orders
 *
 * Detection is read-only and never mutates the old database.
 */
final class LegacySchemaDetector
{
    public const LEGACY_CONFIG_PATH = 'storage/settings.sqlite';

    public function __construct(private readonly string $basePath)
    {
    }

    /**
     * @return array{legacy:bool, config_configured:bool, data_db:?string, table_present:bool, columns:array, adapter:string, count:int, amount_cents:int, voicehub:array, drivers:array}
     */
    public function detect(): array
    {
        $configPath = $this->basePath . '/' . self::LEGACY_CONFIG_PATH;
        $configExists = is_file($configPath);
        $configured = false;
        $dataDbConnection = null;
        $dataDbInfo = null;

        if ($configExists) {
            try {
                $pdo = new PDO('sqlite:' . $configPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $stmt = $pdo->prepare('SELECT value FROM app_settings WHERE key = ?');
                $stmt->execute(['APP_CONFIGURED']);
                $configured = $stmt->fetchColumn() === '1';
                if ($configured) {
                    $stmt = $pdo->prepare('SELECT key, value FROM app_settings WHERE key IN (\'DATA_DB_CONNECTION\',\'DATA_DB_DATABASE\',\'DATA_DB_HOST\',\'DATA_DB_PORT\',\'DATA_DB_USERNAME\',\'DATA_DB_PASSWORD\')');
                    $stmt->execute();
                    $map = [];
                    foreach ($stmt->fetchAll() as $row) {
                        $map[$row['key']] = $row['value'];
                    }
                    $dataDbConnection = $map['DATA_DB_CONNECTION'] ?? 'sqlite';
                    $dataDbInfo = [
                        'connection' => $dataDbConnection,
                        'database' => $map['DATA_DB_DATABASE'] ?? 'storage/voicehubpay.sqlite',
                        'host' => $map['DATA_DB_HOST'] ?? '127.0.0.1',
                        'port' => $map['DATA_DB_PORT'] ?? '5432',
                        'username' => $map['DATA_DB_USERNAME'] ?? '',
                        'password' => $map['DATA_DB_PASSWORD'] ?? '',
                    ];
                }
            } catch (\Throwable) {
                $configured = false;
            }
        }

        $result = [
            'legacy' => false,
            'config_configured' => $configured,
            'data_db' => null,
            'table_present' => false,
            'columns' => [],
            'adapter' => 'none',
            'count' => 0,
            'amount_cents' => 0,
            'voicehub' => ['success' => 0, 'failed' => 0, 'pending' => 0],
            'drivers' => PDO::getAvailableDrivers(),
            'config_exists' => $configExists,
            'data_db_info' => $dataDbInfo,
        ];

        if (!$configured) {
            return $result;
        }

        // Locate the legacy data DB.
        try {
            $dataPdo = $this->openDataDb($dataDbInfo);
        } catch (\Throwable) {
            return $result;
        }
        $result['data_db'] = $this->dataDbIdentifier($dataDbInfo);

        $columns = $this->tableColumns($dataPdo, 'afdian_orders');
        if ($columns === []) {
            return $result;
        }
        $result['table_present'] = true;
        $result['columns'] = $columns;

        $adapter = Adapters\AdapterRegistry::detect($columns);
        $result['adapter'] = $adapter::name();

        try {
            $result['count'] = (int) $dataPdo->query('SELECT COUNT(*) FROM afdian_orders')->fetchColumn();
            $result['amount_cents'] = (int) $dataPdo->query('SELECT COALESCE(SUM(' . $adapter::amountColumn() . '),0) FROM afdian_orders')->fetchColumn();
            foreach ($dataPdo->query('SELECT ' . $adapter::voicehubColumn() . ' AS v, COUNT(*) AS c FROM afdian_orders GROUP BY ' . $adapter::voicehubColumn())->fetchAll() as $row) {
                $key = strtolower((string) $row['v']);
                if ($key === 'created' || $key === 'success') {
                    $result['voicehub']['success'] += (int) $row['c'];
                } elseif ($key === 'failed') {
                    $result['voicehub']['failed'] += (int) $row['c'];
                } else {
                    $result['voicehub']['pending'] += (int) $row['c'];
                }
            }
        } catch (\Throwable) {
            // stats are best-effort
        }

        $result['legacy'] = true;
        return $result;
    }

    /**
     * Open a read-only connection to the legacy data DB.
     */
    public function openDataDb(?array $info): PDO
    {
        if ($info === null) {
            throw new \RuntimeException('Legacy data DB info missing');
        }
        $connection = $info['connection'] ?? 'sqlite';
        if ($connection === 'sqlite') {
            $path = $info['database'] ?? 'storage/voicehubpay.sqlite';
            if (!str_starts_with($path, '/')) {
                $path = $this->basePath . '/' . $path;
            }
            if (!is_file($path)) {
                throw new \RuntimeException('Legacy SQLite data file not found: ' . $path);
            }
            return new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        }
        $dsn = sprintf(
            'pgsql:host=%s;port=%s;dbname=%s',
            $info['host'] ?? '127.0.0.1',
            $info['port'] ?? '5432',
            $info['database'] ?? 'voicehubpay'
        );
        return new PDO($dsn, $info['username'] ?? '', $info['password'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    }

    private function dataDbIdentifier(array $info): string
    {
        if (($info['connection'] ?? 'sqlite') === 'pgsql') {
            return 'pgsql:' . ($info['database'] ?? 'voicehubpay');
        }
        $path = $info['database'] ?? 'storage/voicehubpay.sqlite';
        return 'sqlite:' . $path;
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
