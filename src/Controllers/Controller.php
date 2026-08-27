<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\App;
use VoiceHubPay\Auth\AuthService;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Http\View;
use VoiceHubPay\Security\Csrf;
use VoiceHubPay\Repositories\AuditLogRepository;

/**
 * Base controller: view rendering, auth helpers, CSRF and audit.
 */
abstract class Controller
{
    protected AuthService $auth;
    protected View $view;

    public function __construct(protected readonly App $app)
    {
        $this->auth = $app->make('auth');
        $this->view = $app->view;
    }

    protected function render(string $viewName, array $data = [], ?string $layout = null): Response
    {
        if ($layout === null) {
            $layout = str_starts_with($viewName, 'account/') ? 'account' : 'shop';
        }
        $data['__user'] = $this->auth->user();
        $data['__app'] = $this->app;
        $data['__site'] = [
            'name' => (string) $this->app->config->get('SITE_NAME', 'VoiceHubPay'),
            'url' => $this->app->config->appUrl(),
            'user' => $data['__user'],
        ];
        $data['__flash'] = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        if ($layout === 'admin') {
            try {
                $GLOBALS['__admin_badges'] = ['voicehub' => $this->app->make('deliveries')->countFailedRetryable()];
            } catch (\Throwable) {
                $GLOBALS['__admin_badges'] = [];
            }
        }
        return Response::html($this->view->render($viewName, $data, $layout));
    }

    protected function json(array $data, int $status = 200): Response
    {
        return Response::json($data, $status);
    }

    protected function redirect(string $url): Response
    {
        return Response::redirect($url);
    }

    protected function currentUser(): ?array
    {
        return $this->auth->user();
    }

    protected function requireLogin(Request $request): ?Response
    {
        return $this->auth->requireUser($request);
    }

    protected function requireAdmin(Request $request): ?Response
    {
        return $this->auth->requireAdmin($request);
    }

    /**
     * Verify CSRF on state-changing POST requests. Returns an error response
     * or null when valid.
     */
    protected function requireCsrf(Request $request): ?Response
    {
        if (!$request->csrfValid()) {
            return $this->redirect('/login')->withFlash('会话已过期，请重新操作。', 'error');
        }
        return null;
    }

    protected function audit(int $userId, string $action, string $objectType = '', string $objectId = '', array $metadata = [], ?Request $request = null): void
    {
        $ip = $request?->ip() ?? '';
        $ua = $request?->userAgent() ?? '';
        $this->app->make('audit')->log($userId, $action, $objectType, $objectId, $metadata, $ip, $ua);
    }

    protected function adminUserId(): int
    {
        $user = $this->auth->user();
        return $user !== null ? (int) $user['id'] : 0;
    }

    protected function flash(string $message, string $type = 'success'): void
    {
        $_SESSION['flash'] = ['message' => $message, 'type' => $type];
    }

    protected function csrfField(): string
    {
        return Csrf::field();
    }
}
