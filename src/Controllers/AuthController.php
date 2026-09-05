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
            'qq_enabled' => $this->app->config->bool('QQ_LOGIN_ENABLED', false),
            'wx_enabled' => $this->app->config->bool('WX_LOGIN_ENABLED', false),
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
            return $this->redirect($this->app->config->authUrl('/login') . '?redirect=' . urlencode($request->string('redirect', '/')))->withFlash($result['error'], 'error');
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
        // Prevent duplicate accounts: a logged-in user (e.g. created via
        // QQ/WeChat social login, no password yet) who submits the register
        // form would otherwise get a SECOND account and silently switch to it.
        // Point them to the "complete my account" flow instead — that sets a
        // username + password on the SAME account.
        if ($this->auth->isLoggedIn()) {
            return $this->redirect('/account?complete=1')
                ->withFlash('您已登录，请直接在账号信息中为当前账号设置用户名和密码，无需重新注册。');
        }
        $result = $this->auth->register(
            $request->string('username'),
            $request->string('password'),
            $request->string('password_confirm'),
            $request->string('display_name'),
            (bool) $request->int('agreed', 0),
            $request->string('email'),
        );
        if (!$result['ok']) {
            return $this->redirect($this->app->config->authUrl('/register'))->withFlash($result['error'], 'error');
        }
        $this->auth->loginUser($result['user']);
        return $this->redirect('/account')->withFlash('注册成功，欢迎加入！');
    }

    /**
     * First-time QQ/WeChat registration steps: show a form that REQUIRES the
     * user to choose a username (pre-filled with the social nickname) and set a
     * password before any account is created. No auto-generated qq_<uid>
     * usernames, no password-less social-only accounts.
     */
    public function showCompleteSocial(Request $request): Response
    {
        $profile = $_SESSION['social_signup_pending'] ?? null;
        if (!is_array($profile) || ($profile['social_uid'] ?? '') === '') {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('请先使用 QQ / 微信登录后再完善账号。', 'error');
        }
        $provider = in_array((string) ($profile['provider'] ?? ''), ['qq', 'wx'], true) ? (string) $profile['provider'] : 'qq';
        return $this->render('auth/complete-social', [
            'provider' => $provider,
            'nickname' => (string) ($profile['nickname'] ?? ''),
            'avatar' => (string) ($profile['avatar_url'] ?? ''),
        ], 'auth');
    }

    public function completeSocial(Request $request): Response
    {
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $profile = $_SESSION['social_signup_pending'] ?? null;
        if (!is_array($profile) || ($profile['social_uid'] ?? '') === '') {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('登录状态已失效，请重新使用 QQ / 微信登录。', 'error');
        }
        $result = $this->auth->completeSocialSignup(
            $profile,
            $request->string('username'),
            $request->string('password'),
            $request->string('password_confirm'),
            $request->string('email'),
        );
        if (!$result['ok']) {
            // Keep the pending profile so the user can retry without re-auth.
            return $this->redirect('/complete-social')->withFlash($result['error'], 'error');
        }
        unset($_SESSION['social_signup_pending']);
        $this->auth->loginUser($result['user']);
        return $this->redirect('/account')->withFlash('账号创建成功，欢迎加入！');
    }

    public function socialRedirect(Request $request, array $params): Response
    {
        // The聚合登录平台 can bounce the user back to a /auth/social/{provider}
        // style URL (e.g. /auth/social or /auth/social/qq) carrying the
        // authorization code, instead of the canonical /auth/social/callback.
        // When a code is present that is a callback return, not a fresh
        // authorize click — hand off to the callback handler so logins don't
        // fail with "不支持的登录方式".
        if ($request->query['code'] ?? '' !== '') {
            // Pass through the route provider so /auth/social/wx?code=… keeps
            // its WeChat identity even when the query omits `provider`.
            return $this->socialCallback($request, (string) ($params['provider'] ?? ''));
        }
        $provider = (string) ($params['provider'] ?? '');
        if (!in_array($provider, ['qq', 'wx'], true)) {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('不支持的登录方式。', 'error');
        }
        $enabledKey = strtoupper($provider) . '_LOGIN_ENABLED';
        if (!$this->app->config->bool($enabledKey, false)) {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('该登录方式未开启。', 'error');
        }
        try {
            $social = new SocialAuth($this->app);
            // When the visitor is already authenticated this flow binds the
            // social identity to their account instead of signing in/up a
            // separate (or new) account.
            if ($this->auth->isLoggedIn()) {
                $_SESSION['social_bind_mode'] = true;
                return $this->redirect($social->authorizeUrl($provider, '/account/connections'));
            }
            return $this->redirect($social->authorizeUrl($provider, $request->string('redirect', '/account')));
        } catch (\Throwable $e) {
            error_log('[aggregate auth authorize] ' . $e->getMessage());
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('聚合登录服务暂时不可用，请稍后重试或使用账号密码登录。', 'error');
        }
    }

    public function socialCallback(Request $request, string $fallbackProvider = ''): Response
    {
        $provider = (string) ($request->query['provider'] ?? ($fallbackProvider !== '' ? $fallbackProvider : 'qq'));
        $provider = in_array($provider, ['qq', 'wx'], true) ? $provider : 'qq';
        $state = (string) ($request->query['state'] ?? '');
        $expectedState = (string) ($_SESSION['social_state'] ?? '');
        if ($state === '' || !hash_equals($expectedState, $state)) {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('登录状态校验失败，请重试。', 'error');
        }
        if (($_SESSION['social_provider'] ?? '') !== $provider) {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('登录方式不匹配，请重试。', 'error');
        }
        $code = (string) ($request->query['code'] ?? '');
        if ($code === '') {
            return $this->redirect($this->app->config->authUrl('/login'))->withFlash('未收到授权码，请重试。', 'error');
        }

        $bindMode = (bool) ($_SESSION['social_bind_mode'] ?? false);
        $redirectAfter = (string) ($_SESSION['social_redirect'] ?? ($bindMode ? '/account/connections' : '/account'));
        // Consume the one-time state before any account switch so a replay or a
        // concurrent duplicate callback cannot re-use the same code to bind or
        // switch accounts. Regeneration keeps the session itself intact.
        unset($_SESSION['social_state'], $_SESSION['social_provider'], $_SESSION['social_redirect']);
        try {
            $social = new SocialAuth($this->app);
            $profile = $social->exchangeCode($provider, $code);
            if ($bindMode) {
                if (!$this->auth->isLoggedIn()) {
                    unset($_SESSION['social_bind_mode']);
                    return $this->redirect($this->app->config->authUrl('/login'))->withFlash('登录状态已失效，请重新登录后再绑定。', 'error');
                }
                $result = $this->auth->bindToCurrentUser($provider, $profile);
                unset($_SESSION['social_bind_mode']);
                if (!$result['ok']) {
                    return $this->redirect($redirectAfter)->withFlash($result['error'], 'error');
                }
                return $this->redirect($this->safeRedirect($redirectAfter))->withFlash($result['already_bound'] ? '该登录方式此前已绑定。' : '绑定成功！');
            }
            // Non-bind login: if the visitor is already authenticated we must NOT
            // silently switch to whatever account the code resolves to — that is
            // how one browser can end up "logged into someone else's account"
            // (e.g. a stale/second callback racing an active session). Keep them
            // on their current account instead.
            if ($this->auth->isLoggedIn()) {
                return $this->redirect('/account')->withFlash('您已登录，若需切换账号请先退出后再登录。');
            }
            $result = $this->auth->loginWithSocial($provider, $profile);
            if (!$result['ok']) {
                return $this->redirect($this->app->config->authUrl('/login'))->withFlash($result['error'], 'error');
            }
            // First-time social login: force username + password before the
            // account exists. Stash the profile, go to the signup-completion
            // page (nickname pre-filled as the default username).
            if (!empty($result['needs_signup'])) {
                unset($_SESSION['social_bind_mode']);
                $_SESSION['social_signup_pending'] = $result['profile'];
                return $this->redirect('/complete-social')->withFlash('请设置您的用户名和密码以完成账号创建。');
            }
            $this->auth->loginUser($result['user']);
            return $this->redirect($this->safeRedirect($redirectAfter))->withFlash('登录成功！');
        } catch (\Throwable $e) {
            error_log('[social auth] ' . $e->getMessage());
            // Keep provider responses, access-token errors and transport details
            // out of the browser; they may contain sensitive diagnostics.
            return $this->redirect($bindMode ? $redirectAfter : $this->app->config->authUrl('/login'))->withFlash('第三方登录失败，请稍后重试或联系管理员。', 'error');
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
