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
        if (($user['role'] === 'admin' || $user['role'] === 'superadmin')) {
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
        return $user !== null && ($user['role'] === 'admin' || $user['role'] === 'superadmin');
    }

    /**
     * True when the logged-in user is the super admin (the first-created admin).
     */
    public function isSuperAdmin(): bool
    {
        $user = $this->user();
        if ($user === null || !$this->isAdmin()) {
            return false;
        }
        return $this->users->isSuperAdmin((int) $user['id']);
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
            return $this->app->make('controllers.error')->forbidden($request);
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
    public function register(string $username, string $password, string $confirm, string $displayName = '', bool $accepted = false, string $email = ''): array
    {
        if (!$this->app->config->bool('REGISTRATION_ENABLED', true)) {
            return ['ok' => false, 'error' => '当前未开放注册。', 'user' => null];
        }
        if (!$accepted) {
            return ['ok' => false, 'error' => '请先阅读并同意服务说明。', 'user' => null];
        }
        $username = trim($username);
        $usernameError = $this->usernameError($username);
        if ($usernameError !== '') {
            return ['ok' => false, 'error' => $usernameError, 'user' => null];
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
        $email = trim($email);
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'error' => '邮箱格式不正确。', 'user' => null];
        }
        $user = $this->users->create([
            'username' => $username,
            'password' => $password,
            'display_name' => $displayName !== '' ? $displayName : $username,
            'email' => $email,
        ]);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Update the email address on a user account. Empty string clears it.
     */
    public function updateEmail(int $userId, string $email): array
    {
        $email = trim($email);
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'error' => '邮箱格式不正确。', 'user' => null];
        }
        if (mb_strlen($email) > 254) {
            return ['ok' => false, 'error' => '邮箱长度不能超过 254 个字符。', 'user' => null];
        }
        $this->users->update($userId, ['email' => $email]);
        $user = $this->users->findById($userId);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    public function updateNickname(int $userId, string $nickname): array
    {
        $nickname = trim($nickname);
        if (mb_strlen($nickname) > 50) {
            return ['ok' => false, 'error' => '昵称长度不能超过 50 个字符。', 'user' => null];
        }
        $this->users->update($userId, ['display_name' => $nickname]);

        $user = $this->users->findById($userId);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Change the username for the given user. Returns
     * ['ok' => bool, 'error' => string, 'user' => ?array].
     */
    public function changeUsername(int $userId, string $username): array
    {
        $username = trim($username);
        $error = $this->usernameError($username);
        if ($error !== '') {
            return ['ok' => false, 'error' => $error, 'user' => null];
        }
        $existing = $this->users->findByUsername($username);
        if ($existing !== null && (int) $existing['id'] !== $userId) {
            return ['ok' => false, 'error' => '该用户名已被占用。', 'user' => null];
        }
        $this->users->update($userId, ['username' => $username]);

        $user = $this->users->findById($userId);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Complete a social-only account: set a real username and password.
     * Used when the account was created via QQ/WeChat and has no password yet.
     * Returns ['ok' => bool, 'error' => string, 'user' => ?array].
     */
    public function completeUsernamePassword(int $userId, string $username, string $password, string $confirm): array
    {
        $user = $this->users->findById($userId);
        if ($user === null) {
            return ['ok' => false, 'error' => '账号不存在。', 'user' => null];
        }
        // Only accounts without a password may use this one-shot completion;
        // if a password already exists they should use the profile page instead.
        if (!empty($user['password_hash'])) {
            return ['ok' => false, 'error' => '该账号已设置密码，请直接在账号信息中修改。', 'user' => null];
        }

        $usernameResult = $this->changeUsername($userId, $username);
        if (!$usernameResult['ok']) {
            return ['ok' => false, 'error' => $usernameResult['error'], 'user' => null];
        }
        if (strlen($password) < 8) {
            return ['ok' => false, 'error' => '密码至少需要 8 位。', 'user' => null];
        }
        if ($password !== $confirm) {
            return ['ok' => false, 'error' => '两次输入的密码不一致。', 'user' => null];
        }
        $this->users->setPassword($userId, $password);

        $user = $this->users->findById($userId);
        return ['ok' => true, 'error' => '', 'user' => $user];
    }

    /**
     * Social login: bind by (provider, social_uid) or create a fresh user.
     * Never merges accounts by nickname/avatar.
     *
     * For a brand-new social identity this does NOT create an account yet;
     * it returns needs_signup=true with the social profile so the caller can
     * require the user to choose a username (defaulting to the social
     * nickname) and a password before signing up — no more auto-generated
     * qq_<uid> system usernames and no password-less social-only accounts.
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
            return ['ok' => true, 'needs_signup' => false, 'user' => $user];
        }

        // New social identity — require username + password before creating the
        // account. The nickname is offered as the default username but the user
        // must explicitly confirm it and set a password.
        return [
            'ok' => true,
            'needs_signup' => true,
            'user' => null,
            'profile' => [
                'provider' => $provider,
                'social_uid' => $socialUid,
                'nickname' => $nickname,
                'avatar_url' => $avatar,
            ],
        ];
    }

    /**
     * Complete a brand-new social signup: create the account with the chosen
     * username + password and bind the social identity to it. Username
     * defaults to the social nickname when empty; validation mirrors the
     * password-register rules. Returns user on success.
     */
    public function completeSocialSignup(array $profile, string $username, string $password, string $confirm, string $email = ''): array
    {
        $provider = in_array((string) ($profile['provider'] ?? ''), ['qq', 'wx'], true)
            ? (string) $profile['provider'] : 'qq';
        $socialUid = (string) ($profile['social_uid'] ?? '');
        if ($socialUid === '') {
            return ['ok' => false, 'error' => '第三方身份标识缺失，请重新使用 QQ/微信登录。', 'user' => null];
        }
        // Refuse if that social identity somehow became bound while the user
        // was on the completion form (e.g. a racing callback).
        if ($this->social->findByIdentity($provider, $socialUid) !== null) {
            return ['ok' => false, 'error' => '该第三方账号已绑定其他账户，请使用账号密码直接登录。', 'user' => null];
        }

        $username = trim($username);
        $nickname = (string) ($profile['nickname'] ?? '');
        if ($username === '') {
            // Derive a username from the social nickname, keeping Chinese chars
            // (usernames allow letters/digits/underscore/dash/CJK). Fall back
            // to a short uid-based value if the nickname has no usable chars.
            $slug = preg_replace('/[^a-zA-Z0-9_一-龥-]/u', '', $nickname) ?? '';
            $slug = substr($slug, 0, 24);
            // Usernames require >= 3 chars; pad short nicknames so the derived
            // username still satisfies the rule (e.g. 2-char "小A" → "小A_").
            while ($slug !== '' && mb_strlen($slug) < 3) {
                $slug .= '_';
            }
            $username = $slug !== '' ? $slug : ('u_' . substr(preg_replace('/[^a-zA-Z0-9_]/', '', $socialUid) ?: '', 0, 16));
            // Ensure uniqueness, preserving CJK (uniqueUsername() strips non-ASCII
            // which would drop Chinese from the nickname-derived username).
            $candidate = $username;
            $i = 1;
            while ($this->users->findByUsername($candidate) !== null) {
                $candidate = $username . '_' . $i;
                if (++$i > 50) {
                    $candidate = $username . '_' . bin2hex(random_bytes(3));
                }
            }
            $username = $candidate;
        }

        $usernameError = (function (string $u): string {
            if (strlen($u) < 3 || strlen($u) > 32) {
                return '用户名长度需为 3-32 个字符。';
            }
            return preg_match('/^[a-zA-Z0-9_一-龥-]+$/u', $u) === 1
                ? '' : '用户名仅支持字母、数字、下划线、短横线与中文。';
        })($username);
        if ($usernameError !== '') {
            return ['ok' => false, 'error' => $usernameError, 'user' => null];
        }
        if ($this->users->findByUsername($username) !== null) {
            return ['ok' => false, 'error' => '该用户名已被占用。', 'user' => null];
        }
        if (strlen($password) < 8) {
            return ['ok' => false, 'error' => '密码至少需要 8 位。', 'user' => null];
        }
        if ($password !== $confirm) {
            return ['ok' => false, 'error' => '两次输入的密码不一致。', 'user' => null];
        }
        $email = trim($email);
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['ok' => false, 'error' => '邮箱格式不正确。', 'user' => null];
        }

        $user = $this->users->create([
            'username' => $username,
            'password' => $password,
            'display_name' => $nickname !== '' ? $nickname : $username,
            'avatar_url' => (string) ($profile['avatar_url'] ?? ''),
            'email' => $email,
        ]);
        $this->social->bind((int) $user['id'], $provider, $socialUid, $nickname, (string) ($profile['avatar_url'] ?? ''));
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

    /**
     * Validate a username. Returns an error message or '' when valid.
     * Shared by registration and username changes so rules stay consistent.
     */
    private function usernameError(string $username): string
    {
        if (strlen($username) < 3 || strlen($username) > 32) {
            return '用户名长度需为 3-32 个字符。';
        }
        return preg_match('/^[a-zA-Z0-9_\-一-龥]+$/u', $username) === 1
            ? ''
            : '用户名仅支持字母、数字、下划线、短横线与中文。';
    }
}
