<?php

declare(strict_types=1);

namespace VoiceHubPay\Controllers;

use VoiceHubPay\Http\Request;
use VoiceHubPay\Http\Response;

final class AccountController extends Controller
{
    public function overview(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $ordersRepo = $this->app->make('orders');
        $recentOrders = $ordersRepo->listForUserLatest((int) $user['id'], 5);
        $orderCount = $ordersRepo->listForUser((int) $user['id'], '', '', 1, 1)['total'];

        $unitsRepo = $this->app->make('units');
        $cardCount = $unitsRepo->countDeliveredForUser((int) $user['id']);
        $connections = $this->app->make('social')->listForUser((int) $user['id']);

        return $this->render('account/overview', [
            'recent_orders' => $recentOrders,
            'order_count' => $orderCount,
            'card_count' => $cardCount,
            'connections' => $connections,
            'has_password' => !empty($user['password_hash']),
        ], 'shop');
    }

    public function orders(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $status = $request->string('status', '');
        $q = $request->string('q');
        $page = max(1, $request->int('page', 1));
        $result = $this->app->make('orders')->listForUser((int) $user['id'], $status, $q, $page, 10);
        return $this->render('account/orders', [
            'orders' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'status' => $status,
            'q' => $q,
        ], 'shop');
    }

    public function cards(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $unitsRepo = $this->app->make('units');
        $status = $request->string('status', '');
        $q = $request->string('q');
        $page = max(1, $request->int('page', 1));
        $result = $unitsRepo->listForUser((int) $user['id'], $status, $q, $page, 10);
        $crypto = $this->app->crypto;
        foreach ($result['items'] as &$item) {
            $item['code_masked'] = $item['delivery_code_ciphertext'] !== null ? $crypto->mask($crypto->decrypt($item['delivery_code_ciphertext'])) : '';
            $item['code_source_label'] = $this->sourceLabel($item);
        }
        return $this->render('account/cards', [
            'cards' => $result['items'],
            'total' => $result['total'],
            'page' => $result['page'],
            'pages' => (int) ceil($result['total'] / max(1, $result['perPage'])),
            'status' => $status,
            'q' => $q,
        ], 'shop');
    }

    public function connections(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $social = $this->app->make('social');
        $connections = $social->listForUser((int) $user['id']);
        $hasPassword = !empty($user['password_hash']);
        return $this->render('account/connections', [
            'connections' => $connections,
            'has_password' => $hasPassword,
            'qq_enabled' => $this->app->config->bool('QQ_LOGIN_ENABLED', false),
            'wx_enabled' => $this->app->config->bool('WX_LOGIN_ENABLED', false),
        ], 'shop');
    }

    public function unbind(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $provider = $request->string('provider');
        if (!in_array($provider, ['qq', 'wx'], true)) {
            return $this->redirect('/account/connections')->withFlash('不支持的登录方式。', 'error');
        }
        $social = $this->app->make('social');
        $identity = $social->getProvider((int) $user['id'], $provider);
        if ($identity === null) {
            return $this->redirect('/account/connections')->withFlash('该登录方式未绑定。', 'error');
        }
        // Never remove the last remaining login method.
        if ($social->loginMethodCount($user) <= 1) {
            return $this->redirect('/account/connections')->withFlash('至少需要保留一种登录方式。', 'error');
        }
        $social->unbind((int) $user['id'], $provider);
        $this->audit((int) $user['id'], 'social.unbind', 'user', (string) $user['id'], ['provider' => $provider], $request);
        return $this->redirect('/account/connections')->withFlash('已解绑 ' . ($provider === 'qq' ? 'QQ' : '微信') . ' 登录。');
    }

    public function security(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $hasPassword = !empty($user['password_hash']);
        return $this->render('account/security', [
            'has_password' => $hasPassword,
            'session_created' => $_SESSION['created_at'] ?? null,
        ], 'shop');
    }

    public function changePassword(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $current = $request->string('current_password');
        $new = $request->string('new_password');
        $confirm = $request->string('new_password_confirm');

        $hasPassword = !empty($user['password_hash']);
        if ($hasPassword && !\VoiceHubPay\Security\PasswordHasher::verify($current, $user['password_hash'])) {
            return $this->redirect('/account/security')->withFlash('当前密码不正确。', 'error');
        }
        if (strlen($new) < 8) {
            return $this->redirect('/account/security')->withFlash('新密码至少需要 8 位。', 'error');
        }
        if ($new !== $confirm) {
            return $this->redirect('/account/security')->withFlash('两次输入的新密码不一致。', 'error');
        }
        $users = $this->app->make('users');
        $users->setPassword((int) $user['id'], $new);
        $this->audit((int) $user['id'], 'password.change', 'user', (string) $user['id'], [], $request);
        return $this->redirect('/account/security')->withFlash('密码已更新。');
    }

    public function profile(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        return $this->render('account/profile', [
            'has_password' => !empty($this->currentUser()['password_hash']),
        ], 'shop');
    }

    public function updateProfile(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $user = $this->currentUser();

        $username = $request->string('username');
        $nickname = $request->string('display_name');

        // Username is optional to change — only update when a new value is given.
        if ($username !== '' && $username !== (string) $user['username']) {
            $result = $this->auth->changeUsername((int) $user['id'], $username);
            if (!$result['ok']) {
                return $this->redirect('/account/profile')->withFlash($result['error'], 'error');
            }
        }
        if ($nickname !== '') {
            $result = $this->auth->updateNickname((int) $user['id'], $nickname);
            if (!$result['ok']) {
                return $this->redirect('/account/profile')->withFlash($result['error'], 'error');
            }
        }
        $this->audit((int) $user['id'], 'profile.update', 'user', (string) $user['id'], [], $request);
        return $this->redirect('/account/profile')->withFlash('账号信息已更新。');
    }

    public function complete(Request $request): Response
    {
        if ($redirect = $this->requireLogin($request)) {
            return $redirect;
        }
        if ($redirect = $this->requireCsrf($request)) {
            return $redirect;
        }
        $user = $this->currentUser();
        $result = $this->auth->completeUsernamePassword(
            (int) $user['id'],
            $request->string('username'),
            $request->string('password'),
            $request->string('password_confirm'),
        );
        if (!$result['ok']) {
            return $this->redirect('/account?complete=1')->withFlash($result['error'], 'error');
        }
        return $this->redirect('/account')->withFlash('账号设置完成，已使用用户名和密码登录。');
    }

    private function sourceLabel(array $item): string
    {
        $mode = (string) ($item['delivery_mode_snapshot'] ?? '');
        if ($mode === 'card_and_voicehub' || $mode === 'card') {
            return '库存卡密';
        }
        if ($mode === 'voicehub') {
            return '商城订单券码';
        }
        if ($mode === 'manual') {
            return '人工发放';
        }
        return '卡券';
    }
}
