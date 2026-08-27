<?php

declare(strict_types=1);

/**
 * CLI: apply database migrations.
 *
 *   php scripts/migrate.php               # apply pending migrations only
 *   php scripts/migrate.php --fresh       # legacy-table prepare + all migrations
 *   php scripts/migrate.php --legacy      # also run legacy data migration
 *
 * Idempotent: already-applied migrations are skipped.
 */

use VoiceHubPay\App;
use VoiceHubPay\Database\Migrator;
use VoiceHubPay\Migration\Legacy\LegacyMigrationService;

require __DIR__ . '/../src/bootstrap.php';

$app = new App(dirname(__DIR__));
$pdo = $app->db->pdo();

$args = array_slice($argv, 1);
$doLegacy = in_array('--legacy', $args, true);
$fresh = in_array('--fresh', $args, true);

$migrator = new Migrator($pdo, $app->config->basePath);
$applied = $migrator->migrate($fresh);
echo 'Migrations applied: ' . (count($applied) ? implode(', ', $applied) : 'none (already up to date)') . PHP_EOL;

if ($doLegacy) {
    $legacy = new LegacyMigrationService($app->config->basePath, $app->crypto);
    $report = $legacy->detect();
    if (!$report['legacy'] || !$report['table_present']) {
        echo 'Legacy migration: nothing to migrate.' . PHP_EOL;
    } else {
        $result = $legacy->migrate($pdo, $report['data_db_info']);
        echo 'Legacy migration OK: ' . $result['verification']['migrated_orders'] . ' orders, '
            . $result['verification']['deliveries_created'] . ' deliveries. Backup: ' . $result['backup'] . PHP_EOL;
        try {
            $app->make('analytics')->rebuild();
            echo 'Analytics cache rebuilt.' . PHP_EOL;
        } catch (\Throwable $e) {
            echo 'Analytics rebuild skipped: ' . $e->getMessage() . PHP_EOL;
        }
    }
}

echo 'Done.' . PHP_EOL;
