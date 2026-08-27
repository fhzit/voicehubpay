<?php

declare(strict_types=1);

namespace VoiceHubPay\Database;

use PDO;

/**
 * Runs SQL migration files from database/migrations/{sqlite,pgsql} in order and
 * records applied versions in schema_migrations. Each file may contain multiple
 * statements separated by ";" (statements are split naively; no ";" inside
 * literals is expected in the migration files).
 */
final class Migrator
{
    public function __construct(private readonly PDO $pdo, private readonly string $basePath)
    {
    }

    public function driver(): string
    {
        return $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    public function ensureSchemaTable(): void
    {
        $driver = $this->driver();
        if ($driver === 'pgsql') {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(128) PRIMARY KEY, applied_at VARCHAR(64) NOT NULL)');
        } else {
            $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
        }
    }

    /**
     * Legacy upgrade pre-flight: if a legacy afdian_orders table (old schema)
     * exists, rename it to afdian_orders_legacy so the new schema can be
     * created. Data is preserved and later copied by the LegacyMigrationService.
     */
    public function prepareLegacyTables(): void
    {
        $table = $this->tableExists('afdian_orders');
        if (!$table) {
            return;
        }
        $columns = $this->tableColumns('afdian_orders');
        // Old schema is identified by order_no (not out_trade_no).
        if (in_array('order_no', $columns, true) && !in_array('out_trade_no', $columns, true)) {
            $this->pdo->exec('ALTER TABLE afdian_orders RENAME TO afdian_orders_legacy');
        }
    }

    public function tableExists(string $table): bool
    {
        $driver = $this->driver();
        if ($driver === 'pgsql') {
            $stmt = $this->pdo->prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?");
            $stmt->execute([$table]);
            return $stmt->fetchColumn() !== false;
        }
        $stmt = $this->pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
        $stmt->execute([$table]);
        return $stmt->fetchColumn() !== false;
    }

    public function tableColumns(string $table): array
    {
        $driver = $this->driver();
        if ($driver === 'pgsql') {
            $stmt = $this->pdo->prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?");
            $stmt->execute([$table]);
            return array_column($stmt->fetchAll(), 'column_name');
        }
        $stmt = $this->pdo->prepare('PRAGMA table_info(' . $table . ')');
        $stmt->execute();
        return array_column($stmt->fetchAll(), 'name');
    }

    /**
     * @return string[] applied migration versions
     */
    public function migrate(bool $fresh = false): array
    {
        $this->ensureSchemaTable();
        if ($fresh) {
            $this->prepareLegacyTables();
        }
        $driver = $this->driver();
        $dir = $this->basePath . '/database/migrations/' . $driver;
        if (!is_dir($dir)) {
            throw new \RuntimeException('Migration directory not found: ' . $dir);
        }
        $files = glob($dir . '/*.sql') ?: [];
        sort($files);

        $applied = [];
        $appliedSet = $this->appliedVersions();

        foreach ($files as $file) {
            $version = basename($file, '.sql');
            if (isset($appliedSet[$version])) {
                continue;
            }
            $sql = (string) file_get_contents($file);
            $statements = $this->splitStatements($sql);
            $this->pdo->beginTransaction();
            try {
                foreach ($statements as $statement) {
                    $statement = trim($statement);
                    if ($statement === '') {
                        continue;
                    }
                    $this->pdo->exec($statement);
                }
                $stmt = $this->pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
                $stmt->execute([$version, gmdate('c')]);
                $this->pdo->commit();
                $applied[] = $version;
            } catch (\Throwable $e) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw new \RuntimeException('Migration failed at ' . $version . ': ' . $e->getMessage(), 0, $e);
            }
        }

        return $applied;
    }

    public function appliedVersions(): array
    {
        $this->ensureSchemaTable();
        $rows = $this->pdo->query('SELECT version FROM schema_migrations')->fetchAll();
        $map = [];
        foreach ($rows as $row) {
            $map[$row['version']] = true;
        }
        return $map;
    }

    public function latestVersion(): ?string
    {
        $versions = array_keys($this->appliedVersions());
        sort($versions);
        return $versions ? (string) end($versions) : null;
    }

    /**
     * Naive SQL statement splitter (handles quoted strings minimally).
     */
    private function splitStatements(string $sql): array
    {
        $statements = [];
        $current = '';
        $len = strlen($sql);
        $inSingle = false;
        $inDouble = false;
        for ($i = 0; $i < $len; $i++) {
            $ch = $sql[$i];
            $next = $i + 1 < $len ? $sql[$i + 1] : '';
            if ($ch === "'" && !$inDouble) {
                $inSingle = !$inSingle;
            } elseif ($ch === '"' && !$inSingle) {
                $inDouble = !$inDouble;
            }
            if ($ch === ';' && !$inSingle && !$inDouble) {
                $statements[] = $current;
                $current = '';
                continue;
            }
            if ($ch === '-' && $next === '-' && !$inSingle && !$inDouble) {
                // skip to end of line
                while ($i < $len && $sql[$i] !== "\n") {
                    $i++;
                }
                $current .= "\n";
                continue;
            }
            $current .= $ch;
        }
        if (trim($current) !== '') {
            $statements[] = $current;
        }
        return $statements;
    }
}
