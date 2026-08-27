<?php

declare(strict_types=1);

namespace VoiceHubPay\Auth;

use VoiceHubPay\App;
use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;
use VoiceHubPay\Repositories\SocialIdentityRepository;
use VoiceHubPay\Repositories\UserRepository;
use VoiceHubPay\Security\LoginThrottle;
use VoiceHubPay\Security\PasswordHasher;

final class AuthService
{
    private UserRepository $users;
    private SocialIdentityRepository $social;

    public function __construct(private readonly App $app)
    {
        $this->users = $app->make('users');
        $this->social = $app->make('social');
    }

    public function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if ($id === null) {
            return null;
        }
        $user = $this->users->findById((int) $id);
        if ($user === null || $user['status'] !== 'active') {
            unset($_SESSION['user_id'], $_SESSION['admin_last_seen_at']);
            return null;
        }
        if ($user['role'] === 'admin') {
            $timeout = max(10, $this->app->config->int('SECURITY_ADMIN_SESSION_MINUTES', 120)) * 60;
            $lastSeen = (int) ($_SESSION['admin_last_seen_at'] ?? time());
            if (time() - $lastSeen > $timeout) {
                unset($_SESSION['user_id'], $_SESSION['admin_last_seen_at']);
                return null;
            }
            $_SESSION['admin_last_seen_at'] = time();
        } else {
            unset($_SESSION['admin_last_seen_at']);
        }
        return $user;
    }

    public function isLoggedIn(): bool
    {
        return $this->user() !== null;
    }

    public function isAdmin(): bool
    {
        $user = $this->user();
        return $user !== null && $user['role'] === 'admin';
    }

    /**
     * @return Response|null a redirect response when the user must log in.
     */
    public function requireUser(Request $request): ?Response
    {
        if ($this->isLoggedIn()) {
            return null;
        }
        return Response::redirect('/login?redirect=' . urlencode($request->path()));
    }

    public function requireAdmin(Request $request): ?Response
    {
        $redirect = $this->requireUser($request);
        if ($redirect !== null) {
            return $redirect;
        }
        if (!$this->isAdmin()) {
            return $this->app->make('controllers.error')->forbidden();
        }
        return null;
    }

    public function loginUser(array $user): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        if (($user['role'] ?? '') === 'admin') {
            $_SESSION['admin_last_seen_at'] = time();
        } else {
            unset($_SESSION['admin_last_seen_at']);
        }
        $this->users->touchLastLogin((int) $user['id']);
    }

    public function logout(): void
    {
        unset($_SESSION['user_id']);
        $_SESSION = [];
        session_regenerate_id(true);
    }

    /**
     * Password login. Returns ['ok' => bool, 'error' => string, 'user' => ?array].
     */
    public function loginWithPassword(string $username, string $password, Request $request): array
    {
        $throttle = new LoginThrottle($this->app->db->pdo());
        $ipKey = 'ip:' . $request->ip();
        $userKey = 'user:' . strtolower($username);
        if ($throttle->isLocked($ipKey) || $throttle->isLocked($userKey)) {
            return ['ok' => false, 'error' => '尝试次数过多，请稍后再试。', 'user' => null];
        }

        $user = $this->users->findByUsername($username);
        if ($user === null || !PasswordHasher::verify($password, $user['password_hash'] ?? null)) {
            $throttle->recordFailure($ipKey);
            $throttle->recordFailure($userKey);
            return ['ok' => false, 'error' => '用户名或密码错误。', 'user' => null];
        }
        if ($user['status'] !== 'active') {
            return ['ok' => false, 'error' => '该账号已被禁用。', 'user' => null];
        }

        $throttle->clear($ipKey);
        $throttle->clear($userKey);
        if (PasswordHasher::needsRehash($user['password_hash'] ?? '')) {
            $this->users->setPassword((int) $user['id'], $password);
        }
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Register a new user. Returns ['ok' => bool, 'error' => string, 'user' => ?array].
     */
    public function register(string $username, string $password, string $confirm, string $displayName = '', bool $accepted = false): array
    {
        if (!$this->app->config->bool('REGISTRATION_ENABLED', true)) {
            return ['ok' => false, 'error' => '当前未开放注册。', 'user' => null];
        }
        if (!$accepted) {
            return ['ok' => false, 'error' => '请先阅读并同意服务说明。', 'user' => null];
        }
        $username = trim($username);
        if (strlen($username) < 3 || strlen($username) > 32) {
            return ['ok' => false, 'error' => '用户名长度需为 3-32 个字符。', 'user' => null];
        }
        if (!preg_match('/^[a-zA-Z0-9_\-\x{4e00}-\x{9fa5}]+$/u', $username)) {
            return ['ok' => false, 'error' => '用户名仅支持字母、数字、下划线、短横线与中文。', 'user' => null];
        }
        if (strlen($password) < 8) {
            return ['ok' => false, 'error' => '密码至少需要 8 位。', 'user' => null];
        }
        if ($password !== $confirm) {
            return ['ok' => false, 'error' => '两次输入的密码不一致。', 'user' => null];
        }
        if ($this->users->findByUsername($username) !== null) {
            return ['ok' => false, 'error' => '该用户名已被占用。', 'user' => null];
        }
        $user = $this->users->create([
            'username' => $username,
            'password' => $password,
            'display_name' => $displayName !== '' ? $displayName : $username,
        ]);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Social login: bind by (provider, social_uid) or create a fresh user.
     * Never merges accounts by nickname/avatar.
     */
    public function loginWithSocial(string $provider, array $profile): array
    {
        $provider = in_array($provider, ['qq', 'wx'], true) ? $provider : 'qq';
        $socialUid = (string) ($profile['openid'] ?? $profile['social_uid'] ?? '');
        if ($socialUid === '') {
            return ['ok' => false, 'error' => '未获取到第三方身份标识。', 'user' => null];
        }
        $nickname = (string) ($profile['nickname'] ?? '');
        $avatar = (string) ($profile['avatar_url'] ?? '');

        $identity = $this->social->findByIdentity($provider, $socialUid);
        if ($identity) {
            $user = $this->users->findById((int) $identity['user_id']);
            if ($user === null || $user['status'] !== 'active') {
                return ['ok' => false, 'error' => '账号不可用。', 'user' => null];
            }
            return ['ok' => true, 'error' => '', 'user' => $user];
        }

        // Create new user bound to this social identity.
        $username = $this->users->uniqueUsername($provider . '_', $socialUid);
        $user = $this->users->create([
            'username' => $username,
            'password' => '',
            'display_name' => $nickname !== '' ? $nickname : $username,
            'avatar_url' => $avatar,
        ]);
        $this->social->bind((int) $user['id'], $provider, $socialUid, $nickname, $avatar);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Bind a social identity to the currently logged-in user.
     *
     * This never signs the user out, switches accounts, or creates a new
     * account. It only adds (provider, social_uid) to the active user's
     * login methods. Returns an error if that social identity is already
     * bound to a different account.
     */
    public function bindToCurrentUser(string $provider, array $profile): array
    {
        $provider = in_array($provider, ['qq', 'wx'], true) ? $provider : 'qq';
        $user = $this->user();
        if ($user === null) {
            return ['ok' => false, 'error' => '请先登录再绑定。', 'user' => null];
        }
        $socialUid = (string) ($profile['openid'] ?? $profile['social_uid'] ?? '');
        if ($socialUid === '') {
            return ['ok' => false, 'error' => '未获取到第三方身份标识。', 'user' => null];
        }
        $existing = $this->social->findByIdentity($provider, $socialUid);
        if ($existing !== null) {
            if ((int) $existing['user_id'] === (int) $user['id']) {
                return ['ok' => true, 'error' => '', 'already_bound' => true, 'user' => $user];
            }
            return ['ok' => false, 'error' => '该' . ($provider === 'qq' ? 'QQ' : '微信') . '账号已绑定到其他账号，无法重复绑定。', 'user' => null];
        }
        $nickname = (string) ($profile['nickname'] ?? '');
        $avatar = (string) ($profile['avatar_url'] ?? '');
        $this->social->bind((int) $user['id'], $provider, $socialUid, $nickname, $avatar);
        return ['ok' => true, 'error' => '', 'already_bound' => false, 'user' => $user];
    }
}
