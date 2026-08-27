<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Auth\SocialAuth;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class AuthController extends Controller
{
    public function showLogin(Request $request): Response
    {
        if ($this->auth->isLoggedIn()) {
            return $this->redirect('/account');
        }
        return $this->render('auth/login', [
            'redirect' => $request->string('redirect', '/'),
            'qq_enabled' => $this->app->config->bool('QQ_LOGIN_ENABLED', false),
            'wx_enabled' => $this->app->config->bool('WX_LOGIN_ENABLED', false),
        ], 'auth');
    }

    public function showRegister(Request $request): Response
    {
        if ($this->auth->isLoggedIn()) {
            return $this->redirect('/account');
        }
        return $this->render('auth/register', [
            'registration_enabled' => $this->app->config->bool('REGISTRATION_ENABLED', true),
        ], 'auth');
    }

    public function login(Request $request): Response
    {
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $username = $request->string('username');
        $password = $request->string('password');
        $result = $this->auth->loginWithPassword($username, $password, $request);
        if (!$result['ok']) {
            return $this->redirect('/login?redirect=' . urlencode($request->string('redirect', '/')))->withFlash($result['error'], 'error');
        }
        $this->auth->loginUser($result['user']);
        $redirect = $this->safeRedirect($request->string('redirect', '/'));
        return $this->redirect($redirect)->withFlash('欢迎回来，' . ($result['user']['display_name'] ?: $result['user']['username']));
    }

    public function register(Request $request): Response
    {
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $result = $this->auth->register(
            $request->string('username'),
            $request->string('password'),
            $request->string('password_confirm'),
            $request->string('display_name'),
            (bool) $request->int('agreed', 0),
        );
        if (!$result['ok']) {
            return $this->redirect('/register')->withFlash($result['error'], 'error');
        }
        $this->auth->loginUser($result['user']);
        return $this->redirect('/account')->withFlash('注册成功，欢迎加入！');
    }

    public function socialRedirect(Request $request, array $params): Response
    {
        $provider = (string) ($params['provider'] ?? '');
        if (!in_array($provider, ['qq', 'wx'], true)) {
            return $this->redirect('/login')->withFlash('不支持的登录方式。', 'error');
        }
        $enabledKey = strtoupper($provider) . '_LOGIN_ENABLED';
        if (!$this->app->config->bool($enabledKey, false)) {
            return $this->redirect('/login')->withFlash('该登录方式未开启。', 'error');
        }
        $social = new SocialAuth($this->app);
        return $this->redirect($social->authorizeUrl($provider, $request->string('redirect', '/account')));
    }

    public function socialCallback(Request $request): Response
    {
        $provider = (string) ($request->query['provider'] ?? 'qq');
        $provider = in_array($provider, ['qq', 'wx'], true) ? $provider : 'qq';
        $state = (string) ($request->query['state'] ?? '');
        $expectedState = (string) ($_SESSION['social_state'] ?? '');
        if ($state === '' || !hash_equals($expectedState, $state)) {
            return $this->redirect('/login')->withFlash('登录状态校验失败，请重试。', 'error');
        }
        if (($_SESSION['social_provider'] ?? '') !== $provider) {
            return $this->redirect('/login')->withFlash('登录方式不匹配，请重试。', 'error');
        }
        $code = (string) ($request->query['code'] ?? '');
        if ($code === '') {
            return $this->redirect('/login')->withFlash('未收到授权码，请重试。', 'error');
        }

        try {
            $social = new SocialAuth($this->app);
            $profile = $social->exchangeCode($provider, $code);
            $result = $this->auth->loginWithSocial($provider, $profile);
            if (!$result['ok']) {
                return $this->redirect('/login')->withFlash($result['error'], 'error');
            }
            $this->auth->loginUser($result['user']);
            $redirectAfter = (string) ($_SESSION['social_redirect'] ?? '/account');
            unset($_SESSION['social_state'], $_SESSION['social_provider'], $_SESSION['social_redirect']);
            return $this->redirect($this->safeRedirect($redirectAfter))->withFlash('登录成功！');
        } catch (\Throwable $e) {
            error_log('[social auth] ' . $e->getMessage());
            // Keep provider responses, access-token errors and transport details
            // out of the browser; they may contain sensitive diagnostics.
            return $this->redirect('/login')->withFlash('第三方登录失败，请稍后重试或联系管理员。', 'error');
        }
    }

    public function logout(Request $request): Response
    {
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $this->auth->logout();
        return $this->redirect('/')->withFlash('已安全退出。');
    }

    private function safeRedirect(string $url): string
    {
        if ($url === '' || $url === '/') {
            return '/';
        }
        // Only allow internal relative redirects. Reject browser-normalized
        // backslashes, control characters and any URL with authority/scheme.
        if (!str_starts_with($url, '/')
            || str_starts_with($url, '//')
            || str_contains($url, '\\')
            || preg_match('/[\x00-\x1F\x7F]/', $url) === 1) {
            return '/';
        }
        $parts = parse_url($url);
        if ($parts === false || isset($parts['scheme']) || isset($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return '/';
        }
        return $url;
    }
}
