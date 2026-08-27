<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Database\Migrator;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Migration\Legacy\LegacyMigrationService;
use VoiceHubPay\Support\Money;

/**
 * /install wizard (7 steps: env, db, legacy, site, admin, confirm, done).
 * After successful install, /install is locked (storage/install.lock) and
 * re-execution is forbidden.
 */
final class InstallController extends Controller
{
    private const STEPS = [1 => 'env', 2 => 'db', 3 => 'legacy', 4 => 'site', 5 => 'admin', 6 => 'confirm', 7 => 'done'];

    public function __construct(App $app)
    {
        parent::__construct($app);
    }

    public function show(Request $request): Response
    {
        if ($this->app->config->isInstalled()) {
            return $this->render('install/locked', [], 'install');
        }
        $state = $this->state();
        $step = max(1, (int) ($request->query['step'] ?? $state['step']));
        $step = min(7, $step);
        $state['step'] = $step;
        $_SESSION['install'] = $state;

        $method = $request->method();
        if ($method === 'POST') {
            if ($redirect = $this->requireCsrf($request)) {
                // /install is intentionally public before initialization, so a
                // stale/invalid token must return to the wizard, not /login.
                return $this->redirect('/install?step=' . $step)->withFlash('安装会话已过期，请刷新页面后重试。', 'error');
            }
            return $this->handlePost($request, $step, $state);
        }
        return $this->showStep($step, $state, $request);
    }

    private function handlePost(Request $request, int $step, array $state): Response
    {
        try {
            $state = match ($step) {
                1 => $this->postEnv($request, $state),
                2 => $this->postDb($request, $state),
                3 => $this->postLegacy($request, $state),
                4 => $this->postSite($request, $state),
                5 => $this->postAdmin($request, $state),
                6 => $this->postConfirm($request, $state),
                default => $state,
            };
            $state['step'] = min(7, $state['step'] + 1);
            $_SESSION['install'] = $state;
        } catch (\InvalidArgumentException $e) {
            $state['error'] = $e->getMessage();
            $_SESSION['install'] = $state;
            return $this->redirect('/install?step=' . $step);
        } catch (\Throwable $e) {
            error_log('[install] ' . $e->getMessage());
            // Do not expose DSNs, filesystem paths or database-driver errors to
            // an unauthenticated visitor of the pre-install wizard.
            $state['error'] = '安装步骤执行失败，请核对当前配置并查看服务器错误日志。';
            $_SESSION['install'] = $state;
            return $this->redirect('/install?step=' . $step);
        }

        if ($step === 6) {
            // Install executed — final page is "done".
            return $this->redirect('/install?step=7');
        }
        if ($step === 3 && ($request->string('action') === 'dry_run')) {
            // Stay on step 3 to show dry-run results.
            $state['step'] = 3;
            $_SESSION['install'] = $state;
            return $this->redirect('/install?step=3&dry=1');
        }
        return $this->redirect('/install?step=' . ($step + 1));
    }

    // ---------------------------------------------------------------- steps

    private function showStep(int $step, array $state, Request $request): Response
    {
        return match ($step) {
            1 => $this->render('install/step-env', ['state' => $state, 'env' => $this->envCheck()], 'install'),
            2 => $this->render('install/step-db', ['state' => $state, 'env' => $this->envCheck()], 'install'),
            3 => $this->render('install/step-legacy', ['state' => $state, 'legacy' => $this->legacyReport($request)], 'install'),
            4 => $this->render('install/step-site', ['state' => $state], 'install'),
            5 => $this->render('install/step-admin', ['state' => $state], 'install'),
            6 => $this->render('install/step-confirm', ['state' => $state, 'legacy' => $this->legacyReport($request)], 'install'),
            default => $this->render('install/step-done', ['state' => $state], 'install'),
        };
    }

    private function postEnv(Request $request, array $state): array
    {
        $env = $this->envCheck();
        foreach ($env as $item) {
            if ($item['required'] && !$item['ok']) {
                throw new \InvalidArgumentException($item['label'] . ' 未满足：' . $item['hint']);
            }
        }
        $state['env_ok'] = true;
        return $state;
    }

    private function postDb(Request $request, array $state): array
    {
        $connection = $request->string('db_connection', 'sqlite');
        if (!in_array($connection, ['sqlite', 'pgsql'], true)) {
            throw new \InvalidArgumentException('不支持的数据库类型。');
        }
        $db = [
            'connection' => $connection,
            'database' => $request->string('db_database', $connection === 'sqlite' ? 'storage/voicehubpay.sqlite' : 'voicehubpay'),
            'host' => $request->string('db_host', '127.0.0.1'),
            'port' => $request->string('db_port', '5432') ?: '5432',
            'username' => $request->string('db_username'),
            'password' => $request->string('db_password'),
        ];
        // Test connection.
        if ($connection === 'sqlite') {
            $path = $db['database'];
            if (!str_starts_with($path, '/')) {
                $path = $this->app->config->path($path);
            }
            if (!is_dir(dirname($path))) {
                mkdir(dirname($path), 0775, true);
            }
            $pdo = new \PDO('sqlite:' . $path, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $pdo->query('SELECT 1');
        } else {
            $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $db['host'], $db['port'], $db['database']);
            $pdo = new \PDO($dsn, $db['username'], $db['password'], [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $pdo->query('SELECT 1');
        }
        $state['db'] = $db;
        $state['db_tested'] = true;
        return $state;
    }

    private function postLegacy(Request $request, array $state): array
    {
        $legacy = $this->legacyReport($request);
        $action = $request->string('action', 'continue');
        if ($action === 'dry_run') {
            $state['legacy_dry'] = $legacy;
            return $state;
        }
        if ($legacy['detected'] && $legacy['adapter'] === 'UnknownLegacy') {
            throw new \InvalidArgumentException('无法识别的旧数据库结构，禁止迁移。请先备份并联系技术支持。');
        }
        $state['legacy'] = [
            'detected' => $legacy['detected'],
            'adapter' => $legacy['adapter'],
            'count' => $legacy['count'],
            'amount_cents' => $legacy['amount_cents'],
            'success' => $legacy['voicehub']['success'],
            'failed' => $legacy['voicehub']['failed'],
            'backup_required' => $legacy['detected'],
            // Old-DB descriptor captured while the legacy config was still
            // active (used by execute() even after settings are overwritten).
            'data_db_info' => $legacy['report']['data_db_info'] ?? null,
        ];
        return $state;
    }

    private function postSite(Request $request, array $state): array
    {
        $siteName = trim($request->string('site_name'));
        if ($siteName === '') {
            throw new \InvalidArgumentException('站点名称不能为空。');
        }
        $siteUrl = trim($request->string('site_url'));
        $parts = parse_url($siteUrl);
        if (!is_array($parts) || !in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true) || ($parts['host'] ?? '') === '' || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            throw new \InvalidArgumentException('站点 URL 必须是无账号、查询参数和片段的 HTTP(S) 根地址。');
        }
        $tz = $request->string('timezone', 'Asia/Shanghai');
        try {
            new \DateTimeZone($tz);
        } catch (\Throwable) {
            throw new \InvalidArgumentException('无效的时区。');
        }
        $state['site'] = [
            'name' => $siteName,
            'url' => rtrim($siteUrl, '/'),
            'timezone' => $tz,
            'registration' => $request->int('registration', 1) === 1 ? '1' : '0',
            'order_ttl' => max(5, $request->int('order_ttl', 30)),
        ];
        return $state;
    }

    private function postAdmin(Request $request, array $state): array
    {
        $username = trim($request->string('admin_username'));
        $password = $request->string('admin_password');
        $confirm = $request->string('admin_password_confirm');
        if (strlen($username) < 3 || strlen($username) > 32) {
            throw new \InvalidArgumentException('管理员用户名需为 3-32 个字符。');
        }
        if (strlen($password) < 8) {
            throw new \InvalidArgumentException('管理员密码至少需要 8 位。');
        }
        if ($password !== $confirm) {
            throw new \InvalidArgumentException('两次输入的管理员密码不一致。');
        }
        $state['admin'] = [
            'username' => $username,
            'display_name' => trim($request->string('admin_display_name')) ?: $username,
            'email' => trim($request->string('admin_email')),
            'password' => $password,
        ];
        return $state;
    }

    private function postConfirm(Request $request, array $state): array
    {
        if (empty($state['env_ok'])) {
            throw new \InvalidArgumentException('请先完成环境检测。');
        }
        if (empty($state['db'])) {
            throw new \InvalidArgumentException('请先完成数据库配置。');
        }
        if (empty($state['site'])) {
            throw new \InvalidArgumentException('请先完成网站配置。');
        }
        if (empty($state['admin'])) {
            throw new \InvalidArgumentException('请先创建管理员。');
        }
        $this->execute($state);
        return $state;
    }

    // ------------------------------------------------------------- execution

    private function execute(array $state): void
    {
        $repo = $this->app->config->settings();

        // 1) Persist DB settings.
        $db = $state['db'];
        $repo->setMany([
            'DATA_DB_CONNECTION' => $db['connection'],
            'DATA_DB_DATABASE' => $db['database'],
            'DATA_DB_HOST' => $db['host'],
            'DATA_DB_PORT' => $db['port'],
            'DATA_DB_USERNAME' => $db['username'],
            'DATA_DB_PASSWORD' => $db['password'],
        ]);
        $this->app->config->reloadSettings();

        // 2) Build the data PDO + run migrations (handles legacy rename).
        $dataPdo = $this->app->db->pdo();
        $migrator = new Migrator($dataPdo, $this->app->config->basePath);
        $applied = $migrator->migrate(true);

        // 3) Legacy data import (if detected).
        $legacyService = new LegacyMigrationService($this->app->config->basePath, $this->app->crypto);
        $legacyDetection = $legacyService->detect();
        $legacyResult = null;
        // Gate on the wizard-time detection (captured while the old config was
        // active) OR a live detection (works for same-file upgrades). migrate()
        // itself additionally reads target afdian_orders_legacy if present.
        $shouldMigrate = !empty($state['legacy']['detected'])
            || ($legacyDetection['legacy'] && $legacyDetection['table_present']);
        if ($shouldMigrate) {
            $legacyOldInfo = $state['legacy']['data_db_info'] ?? null;
            $legacyResult = $legacyService->migrate($dataPdo, $legacyOldInfo ?? $legacyDetection['data_db_info']);
        }

        // 4) Site settings.
        $site = $state['site'];
        $repo->setMany([
            'SITE_NAME' => $site['name'],
            'SITE_URL' => $site['url'],
            'APP_URL' => $site['url'],
            'APP_TIMEZONE' => $site['timezone'],
            'REGISTRATION_ENABLED' => $site['registration'],
            'ORDER_TTL_MINUTES' => (string) $site['order_ttl'],
            'PAGE_SIZE' => '20',
        ]);

        // 5) Admin account.
        $admin = $state['admin'];
        $users = $this->app->make('users');
        $existing = $users->findByUsername($admin['username']);
        if ($existing !== null) {
            $users->update((int) $existing['id'], ['role' => 'admin', 'status' => 'active', 'email' => $admin['email'], 'display_name' => $admin['display_name']]);
            $users->setPassword((int) $existing['id'], $admin['password']);
        } else {
            $users->create([
                'username' => $admin['username'],
                'password' => $admin['password'],
                'display_name' => $admin['display_name'],
                'email' => $admin['email'],
                'role' => 'admin',
            ]);
        }

        // 6) Master key + install metadata.
        $this->app->crypto->masterKey();
        $repo->setMany([
            'INSTALLED_AT' => gmdate('c'),
            'INSTALLATION_ID' => bin2hex(random_bytes(16)),
            'SCHEMA_VERSION' => (string) end($applied),
            'LEGACY_MIGRATED' => $legacyResult !== null ? '1' : '0',
            'APP_CONFIGURED' => '1',
        ]);

        // 7) Install lock file.
        $lock = $this->app->config->basePath . '/storage/install.lock';
        file_put_contents($lock, json_encode([
            'installed_at' => gmdate('c'),
            'installation_id' => (string) $repo->get('INSTALLATION_ID'),
            'migration' => $legacyResult !== null ? 'upgrade' : 'fresh',
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . PHP_EOL, LOCK_EX);

        // 8) Rebuild analytics cache when legacy data was imported.
        if ($legacyResult !== null) {
            try {
                $this->app->make('analytics')->rebuild();
            } catch (\Throwable $e) {
                error_log('[install analytics] ' . $e->getMessage());
            }
        }

        unset($_SESSION['install']);
    }

    // --------------------------------------------------------------- helpers

    private function state(): array
    {
        $state = $_SESSION['install'] ?? [];
        $state['step'] = (int) ($state['step'] ?? 1);
        return $state;
    }

    private function legacyReport(Request $request): array
    {
        $service = new LegacyMigrationService($this->app->config->basePath, $this->app->crypto);
        $dry = $service->dryRun();
        return $dry;
    }

    public function envCheck(): array
    {
        $checks = [];
        $checks['php'] = ['label' => 'PHP >= 8.2', 'ok' => version_compare(PHP_VERSION, '8.2.0', '>='), 'hint' => '当前版本 ' . PHP_VERSION];
        $drivers = \PDO::getAvailableDrivers();
        $checks['pdo'] = ['label' => 'PDO 扩展', 'ok' => class_exists('PDO'), 'hint' => '需要 PHP PDO'];
        $checks['sqlite'] = ['label' => 'SQLite 驱动', 'ok' => in_array('sqlite', $drivers, true), 'hint' => '需要 pdo_sqlite 扩展'];
        $checks['pgsql'] = ['label' => 'PostgreSQL 驱动', 'ok' => in_array('pgsql', $drivers, true), 'hint' => '需要 pdo_pgsql 扩展（可选）'];
        $checks['curl'] = ['label' => 'cURL 扩展', 'ok' => function_exists('curl_init'), 'hint' => '需要 curl 扩展'];
        $checks['openssl'] = ['label' => 'OpenSSL 扩展', 'ok' => extension_loaded('openssl'), 'hint' => '需要 openssl 扩展'];
        $checks['sodium'] = ['label' => 'Sodium 扩展', 'ok' => extension_loaded('sodium'), 'hint' => '需要 sodium 扩展（libsodium）'];
        $checks['session'] = ['label' => 'Session 支持', 'ok' => function_exists('session_start'), 'hint' => '需要 PHP session'];
        $checks['json'] = ['label' => 'JSON 扩展', 'ok' => function_exists('json_encode'), 'hint' => '需要 json 扩展'];
        $storage = $this->app->config->basePath . '/storage';
        if (!is_dir($storage)) {
            @mkdir($storage, 0775, true);
        }
        $checks['storage'] = ['label' => 'storage 可写', 'ok' => is_writable($storage), 'hint' => '请确保 storage 目录 PHP 可写（如 chown www:www storage）'];

        $required = [];
        foreach ($checks as $k => $c) {
            $checks[$k]['required'] = !in_array($k, ['pgsql'], true);
            if ($checks[$k]['required']) {
                $required[] = $c;
            }
        }
        return array_values($checks);
    }
}
