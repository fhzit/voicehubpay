<?php

declare(strict_types=1);

/**
 * VoiceHubPay front controller.
 */

use VoiceHubPay\App;
use VoiceHubPay\Controllers\AccountController;
use VoiceHubPay\Controllers\Admin\AfdianController;
use VoiceHubPay\Controllers\Admin\AuditController;
use VoiceHubPay\Controllers\Admin\CategoryController;
use VoiceHubPay\Controllers\Admin\DashboardController;
use VoiceHubPay\Controllers\Admin\InventoryController;
use VoiceHubPay\Controllers\Admin\OrderController as AdminOrderController;
use VoiceHubPay\Controllers\Admin\PaymentController as AdminPaymentController;
use VoiceHubPay\Controllers\Admin\ProductController as AdminProductController;
use VoiceHubPay\Controllers\Admin\SettingsController;
use VoiceHubPay\Controllers\Admin\SystemController;
use VoiceHubPay\Controllers\Admin\UserController;
use VoiceHubPay\Controllers\Admin\VoiceHubController;
use VoiceHubPay\Controllers\ApiController;
use VoiceHubPay\Controllers\AuthController;
use VoiceHubPay\Controllers\HomeController;
use VoiceHubPay\Controllers\InstallController;
use VoiceHubPay\Controllers\OrderController;
use VoiceHubPay\Controllers\PaymentController;
use VoiceHubPay\Controllers\ProductController;
use VoiceHubPay\Controllers\WebhookController;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Router;

$basePath = dirname(__DIR__);
require $basePath . '/src/bootstrap.php';

$app = new App($basePath);
$request = Request::capture();

// Enforce the configured canonical HTTPS scheme. Forwarded proto is honored
// only when the deployment explicitly enables APP_TRUST_PROXY.
if ($app->config->bool('SECURITY_FORCE_HTTPS', false)) {
    $directHttps = in_array(strtolower((string) ($_SERVER['HTTPS'] ?? '')), ['on', '1', 'true'], true);
    $trustProxy = $app->config->bool('APP_TRUST_PROXY', false);
    $forwardedHttps = $trustProxy && strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0])) === 'https';
    if (!$directHttps && !$forwardedHttps) {
        $target = $app->config->appUrl();
        if (str_starts_with($target, 'https://')) {
            $query = $request->query !== [] ? '?' . http_build_query($request->query) : '';
            \VoiceHubPay\Http\Response::redirect($target . $request->path() . $query, 302)->send();
            exit;
        }
    }
}

// Maintenance mode (except install + external callbacks).
if ($app->config->bool('MAINTENANCE_MODE', false)) {
    $path = $request->path();
    $isExternal = $path === '/webhook/afdian' || $path === '/payments/sg65/notify' || str_starts_with($path, '/payments/sg65/notify');
    if (!str_starts_with($path, '/install') && !$isExternal && !$app->make('auth')->isLoggedIn()) {
        \VoiceHubPay\Http\Response::html($app->view->render('errors/maintenance', [], 'shop'))->send();
        exit;
    }
}

$router = new Router();

$authC = static fn (App $app) => new AuthController($app);
$accountC = static fn (App $app) => new AccountController($app);
$orderC = static fn (App $app) => new OrderController($app);
$apiC = static fn (App $app) => new ApiController($app);
$installC = static fn (App $app) => new InstallController($app);

// ---------------------------------------------------------------- public
$router->get('/', fn ($r) => (new HomeController($app))->index($r));
$router->get('/products', fn ($r) => (new ProductController($app))->index($r));
$router->get('/product/{slug}', fn ($r, $p) => (new ProductController($app))->show($r, $p));

// ------------------------------------------------------------ auth routes
$router->get('/login', fn ($r) => $authC($app)->showLogin($r));
$router->get('/register', fn ($r) => $authC($app)->showRegister($r));
$router->post('/auth/password/login', fn ($r) => $authC($app)->login($r));
$router->post('/auth/password/register', fn ($r) => $authC($app)->register($r));
$router->post('/logout', fn ($r) => $authC($app)->logout($r));
$router->get('/auth/social/callback', fn ($r) => $authC($app)->socialCallback($r));
// The {provider} route MUST come AFTER /auth/social/callback so a callback URL
// is never captured as provider="callback" (which would reject it as an
// unsupported login). Router dispatches in registration order.
$router->get('/auth/social/{provider}', fn ($r, $p) => $authC($app)->socialRedirect($r, $p));

// ------------------------------------------------------------ user routes
$router->get('/account', fn ($r) => $accountC($app)->overview($r));
$router->get('/account/orders', fn ($r) => $accountC($app)->orders($r));
$router->get('/account/cards', fn ($r) => $accountC($app)->cards($r));
$router->get('/account/connections', fn ($r) => $accountC($app)->connections($r));
$router->get('/account/security', fn ($r) => $accountC($app)->security($r));
$router->post('/account/connections/unbind', fn ($r) => $accountC($app)->unbind($r));
$router->post('/account/security/password', fn ($r) => $accountC($app)->changePassword($r));

// ------------------------------------------------------------ shop routes
$router->post('/orders', fn ($r) => $orderC($app)->create($r));
$router->get('/checkout/{orderNo}', fn ($r, $p) => $orderC($app)->checkout($r, $p));
$router->get('/orders/{orderNo}', fn ($r, $p) => $orderC($app)->show($r, $p));
$router->post('/orders/{orderNo}/pay', fn ($r, $p) => $orderC($app)->pay($r, $p));

// ------------------------------------------------------------ SG65 routes
$router->get('/payments/sg65/notify', fn ($r) => (new PaymentController($app))->notify($r));
$router->get('/payments/sg65/return', fn ($r) => (new PaymentController($app))->returnPage($r));

// --------------------------------------------------------------- API routes
$router->get('/api/orders/{orderNo}/status', fn ($r, $p) => $apiC($app)->orderStatus($r, $p));
$router->post('/api/cards/{unitId}/reveal', fn ($r, $p) => $apiC($app)->revealCard($r, $p));
$router->post('/api/orders/{orderNo}/reveal-all', fn ($r, $p) => $apiC($app)->revealOrder($r, $p));

// ------------------------------------------------------- Afdian webhook
$router->post('/webhook/afdian', fn ($r) => (new WebhookController($app))->afdian($r));

// --------------------------------------------------------------- install
$router->get('/install', fn ($r) => $installC($app)->show($r));
$router->post('/install', fn ($r) => $installC($app)->show($r));

// --------------------------------------------------------------- admin
$router->get('/admin', fn ($r) => (new DashboardController($app))->index($r));
$router->get('/admin/products', fn ($r) => (new AdminProductController($app))->index($r));
$router->get('/admin/products/create', fn ($r) => (new AdminProductController($app))->createForm($r));
$router->get('/admin/products/edit/{id}', fn ($r, $p) => (new AdminProductController($app))->editForm($r, $p));
$router->post('/admin/products/save', fn ($r) => (new AdminProductController($app))->save($r));
$router->post('/admin/products/{id}/status', fn ($r, $p) => (new AdminProductController($app))->toggleStatus($r, $p));
$router->post('/admin/products/{id}/delete', fn ($r, $p) => (new AdminProductController($app))->delete($r, $p));

$router->get('/admin/categories', fn ($r) => (new CategoryController($app))->index($r));
$router->post('/admin/categories/save', fn ($r) => (new CategoryController($app))->save($r));
$router->post('/admin/categories/delete', fn ($r) => (new CategoryController($app))->delete($r));

$router->get('/admin/inventory', fn ($r) => (new InventoryController($app))->index($r));
$router->get('/admin/inventory/import', fn ($r) => (new InventoryController($app))->importForm($r));
$router->post('/admin/inventory/import', fn ($r) => (new InventoryController($app))->import($r));
$router->post('/admin/inventory/{id}/status', fn ($r, $p) => (new InventoryController($app))->toggleStatus($r, $p));

$router->get('/admin/orders', fn ($r) => (new AdminOrderController($app))->index($r));
$router->get('/admin/orders/{orderNo}', fn ($r, $p) => (new AdminOrderController($app))->show($r, $p));
$router->post('/admin/orders/query-payment', fn ($r) => (new AdminOrderController($app))->queryPayment($r));
$router->post('/admin/orders/manual-confirm', fn ($r) => (new AdminOrderController($app))->manualConfirm($r));
$router->post('/admin/orders/cancel', fn ($r) => (new AdminOrderController($app))->cancelOrder($r));
$router->post('/admin/orders/process', fn ($r) => (new AdminOrderController($app))->processOrder($r));
$router->post('/admin/orders/retry-failed', fn ($r) => (new AdminOrderController($app))->retryFailed($r));
$router->post('/admin/orders/retry-unit', fn ($r) => (new AdminOrderController($app))->retryUnit($r));
$router->post('/admin/orders/unit-complete', fn ($r) => (new AdminOrderController($app))->manualCompleteUnit($r));
$router->post('/admin/orders/complete', fn ($r) => (new AdminOrderController($app))->manualCompleteOrder($r));
$router->post('/admin/orders/assign-code', fn ($r) => (new AdminOrderController($app))->assignCode($r));
$router->post('/admin/orders/assign-inventory', fn ($r) => (new AdminOrderController($app))->assignInventory($r));
$router->post('/admin/orders/delete-unpaid', fn ($r) => (new AdminOrderController($app))->deleteUnpaid($r));

$router->get('/admin/payments', fn ($r) => (new AdminPaymentController($app))->index($r));

$router->get('/admin/voicehub', fn ($r) => (new VoiceHubController($app))->index($r));
$router->get('/admin/voicehub/failures', fn ($r) => (new VoiceHubController($app))->failures($r));
$router->post('/admin/voicehub/retry', fn ($r) => (new VoiceHubController($app))->retry($r));
$router->post('/admin/voicehub/retry-all', fn ($r) => (new VoiceHubController($app))->retryAllFailed($r));

$router->get('/admin/afdian', fn ($r) => (new AfdianController($app))->index($r));
$router->post('/admin/afdian/sync', fn ($r) => (new AfdianController($app))->sync($r));
$router->post('/admin/afdian/retry', fn ($r) => (new AfdianController($app))->retry($r));

$router->get('/admin/users', fn ($r) => (new UserController($app))->index($r));
$router->get('/admin/users/{id}', fn ($r, $p) => (new UserController($app))->show($r, $p));
$router->post('/admin/users/{id}/status', fn ($r, $p) => (new UserController($app))->toggleStatus($r, $p));

$router->get('/admin/settings/general', fn ($r) => (new SettingsController($app))->general($r));
$router->post('/admin/settings/general', fn ($r) => (new SettingsController($app))->saveGeneral($r));
$router->get('/admin/settings/payment', fn ($r) => (new SettingsController($app))->payment($r));
$router->post('/admin/settings/payment', fn ($r) => (new SettingsController($app))->savePayment($r));
$router->post('/admin/settings/payment/test', fn ($r) => (new SettingsController($app))->testPayment($r));
$router->get('/admin/settings/auth', fn ($r) => (new SettingsController($app))->auth($r));
$router->post('/admin/settings/auth', fn ($r) => (new SettingsController($app))->saveAuth($r));
$router->get('/admin/settings/voicehub', fn ($r) => (new SettingsController($app))->voicehub($r));
$router->post('/admin/settings/voicehub', fn ($r) => (new SettingsController($app))->saveVoicehub($r));
$router->post('/admin/settings/voicehub/test', fn ($r) => (new SettingsController($app))->testVoicehub($r));
$router->get('/admin/settings/afdian', fn ($r) => (new SettingsController($app))->afdian($r));
$router->post('/admin/settings/afdian', fn ($r) => (new SettingsController($app))->saveAfdian($r));
$router->post('/admin/settings/afdian/test', fn ($r) => (new SettingsController($app))->testAfdian($r));
$router->get('/admin/settings/security', fn ($r) => (new SettingsController($app))->security($r));
$router->post('/admin/settings/security', fn ($r) => (new SettingsController($app))->saveSecurity($r));

$router->get('/admin/audit', fn ($r) => (new AuditController($app))->index($r));
$router->get('/admin/system/database', fn ($r) => (new SystemController($app))->database($r));
$router->post('/admin/system/database/check', fn ($r) => (new SystemController($app))->checkDatabase($r));
$router->post('/admin/system/analytics/rebuild', fn ($r) => (new SystemController($app))->rebuildAnalytics($r));

// --------------------------------------------------------------- dispatch
try {
    $response = $router->dispatch($request);
    if ($response === null) {
        $response = $app->make('controllers.error')->notFound($request);
    }
} catch (\Throwable $e) {
    error_log('[voicehubpay] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $response = $app->make('controllers.error')->serverError($request, substr(bin2hex(random_bytes(8)), 0, 12));
}
$response->send();
