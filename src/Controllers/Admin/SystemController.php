<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers\Admin;

use VoiceHubPay\App;
use VoiceHubPay\Controllers\Controller;
use VoiceHubPay\Database\Migrator;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Migration\Legacy\LegacyMigrationService;

final class SystemController extends Controller
{
    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function database(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        $db = $this->app->db;
        $describe = $db->describe();
        $migrator = new Migrator($db->pdo(), $this->app->config->basePath);

        $dbSize = null;
        if ($describe['type'] === 'SQLite') {
            $path = substr($describe['dsn'], strlen('sqlite:'));
            if (is_file($path)) {
                $dbSize = filesize($path);
            }
        }

        $backups = [];
        $backupDir = $this->app->config->basePath . '/storage/backups';
        if (is_dir($backupDir)) {
            foreach (glob($backupDir . '/*') ?: [] as $entry) {
                if (is_dir($entry)) {
                    $backups[] = ['name' => basename($entry), 'mtime' => gmdate('c', (int) filemtime($entry)), 'files' => count(glob($entry . '/*') ?: [])];
                }
            }
            rsort($backups);
        }

        return $this->render('admin/system/database', [
            'describe' => $describe,
            'db_size' => $dbSize,
            'schema_version' => $migrator->latestVersion(),
            'applied' => $migrator->appliedVersions(),
            'installed_at' => $this->app->config->get('INSTALLED_AT'),
            'last_migration' => $this->app->config->get('SCHEMA_VERSION'),
            'analytics_last_rebuild' => $this->app->make('analytics')->lastRebuild(),
            'backups' => array_slice($backups, 0, 20),
        ], 'admin');
    }

    public function rebuildAnalytics(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        try {
            $days = $this->app->make('analytics')->rebuild();
            $this->app->make('analytics')->markRebuilt();
            $this->audit($this->adminUserId(), 'analytics.rebuild', 'analytics', 'daily', ['days' => $days], $request);
            return $this->redirect('/admin/system/database')->withFlash('Analytics 缓存已重建（' . $days . ' 天）。');
        } catch (\Throwable $e) {
            return $this->redirect('/admin/system/database')->withFlash('重建失败：' . $e->getMessage(), 'error');
        }
    }

    public function checkDatabase(Request $request): Response
    {
        if ($redirect = $this->requireAdmin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        try {
            $pdo = $this->app->db->pdo();
            $checks = [];
            $tables = ['users', 'social_identities', 'categories', 'products', 'inventory_cards', 'orders', 'order_items', 'fulfillment_units', 'voicehub_deliveries', 'payment_transactions', 'afdian_orders', 'audit_logs', 'analytics_daily'];
            foreach ($tables as $table) {
                try {
                    $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
                    $checks[$table] = 'ok';
                } catch (\Throwable) {
                    $checks[$table] = 'missing';
                }
            }
            $this->audit($this->adminUserId(), 'database.check', 'database', 'tables', $checks, $request);
            return $this->json(['ok' => true, 'tables' => $checks]);
        } catch (\Throwable $e) {
            error_log('[database check] ' . $e->getMessage());
            return $this->json(['ok' => false, 'error' => '数据库健康检查执行失败，请查看服务器日志。'], 500);
        }
    }
}
